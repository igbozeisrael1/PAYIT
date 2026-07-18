/**
 * blockchain.service.ts — Monad network interaction layer.
 *
 * Wraps ethers.js v6 and provides:
 *  - A shared JsonRpcProvider connected to Monad testnet/mainnet
 *  - USDC balance reads
 *  - USDC transfers (on behalf of user wallets)
 *  - Contract ABIs and interaction helpers
 *  - On-chain event listening for invoice paid / escrow claimed events
 */

import { ethers } from 'ethers';
import { env } from '../config/env.js';

// ─── Contract ABIs (minimal — only functions used by the backend) ─────────────

export const USDC_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
] as const;

export const INVOICE_LEDGER_ABI = [
  'function createInvoice(address businessAddress, bytes32 clientRef, bytes32 lineItemsHash, uint256 subtotal, uint256 vatAmount, uint256 whtAmount, uint256 total) returns (uint256)',
  'function payInvoice(uint256 invoiceId)',
  'function cancelInvoice(uint256 invoiceId)',
  'function getInvoice(uint256 invoiceId) view returns (tuple(uint256 id, address businessAddress, bytes32 clientRef, bytes32 lineItemsHash, uint256 subtotal, uint256 vatAmount, uint256 whtAmount, uint256 total, uint8 status, uint256 createdAt, uint256 paidAt))',
  'function totalInvoices() view returns (uint256)',
  'event InvoiceCreated(uint256 indexed invoiceId, address indexed businessAddress, bytes32 clientRef, bytes32 lineItemsHash, uint256 subtotal, uint256 vatAmount, uint256 whtAmount, uint256 total, uint256 createdAt)',
  'event InvoicePaid(uint256 indexed invoiceId, address indexed payer, uint256 netToBusinessAmount, uint256 whtDeducted, uint256 paidAt)',
] as const;

export const ESCROW_ABI = [
  'function deposit(bytes32 recipientHash, uint256 amount, uint256 expiryDuration) returns (uint256)',
  'function claimAll(bytes32 recipientHash, address claimerAddress) returns (uint256)',
  'function claimSingle(uint256 depositId, address claimerAddress)',
  'function refund(uint256 depositId)',
  'function getDeposit(uint256 depositId) view returns (tuple(uint256 id, address sender, bytes32 recipientHash, uint256 amount, uint256 expiresAt, uint8 status, uint256 createdAt, uint256 resolvedAt, address resolvedTo))',
  'function getPendingDepositIds(bytes32 recipientHash) view returns (uint256[])',
  'event Deposited(uint256 indexed depositId, address indexed sender, bytes32 indexed recipientHash, uint256 amount, uint256 expiresAt)',
  'event Claimed(uint256 indexed depositId, bytes32 indexed recipientHash, address indexed claimerAddress, uint256 amount)',
  'event Refunded(uint256 indexed depositId, address indexed sender, uint256 amount)',
] as const;

// ─── Blockchain Service ───────────────────────────────────────────────────────

export class BlockchainService {
  public readonly provider: ethers.JsonRpcProvider;
  private readonly operatorWallet: ethers.Wallet;

  // Contract instances (read-only, use operator wallet for writes)
  public readonly usdcContract: ethers.Contract;
  public readonly invoiceLedgerContract: ethers.Contract;
  public readonly escrowContract: ethers.Contract;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(env.MONAD_RPC_URL, {
      chainId: env.MONAD_CHAIN_ID,
      name: env.MONAD_CHAIN_ID === 143 ? 'monad' : 'monad-testnet',
    });

    // Operator wallet — used for gas fees when relaying contract calls
    this.operatorWallet = new ethers.Wallet(env.OPERATOR_PRIVATE_KEY, this.provider);

    // Contract instances
    this.usdcContract = new ethers.Contract(env.USDC_ADDRESS, USDC_ABI, this.provider);
    this.invoiceLedgerContract = new ethers.Contract(
      env.INVOICE_LEDGER_ADDRESS,
      INVOICE_LEDGER_ABI,
      this.operatorWallet,
    );
    this.escrowContract = new ethers.Contract(
      env.ESCROW_ADDRESS,
      ESCROW_ABI,
      this.operatorWallet,
    );
  }

  // ─── USDC ──────────────────────────────────────────────────────────────────

  /**
   * Get USDC balance for an address in base units (6 decimals).
   */
  async getUSDCBalance(address: string): Promise<bigint> {
    return this.usdcContract.balanceOf(address) as Promise<bigint>;
  }

  /**
   * Send USDC from a user's signer to a recipient address.
   * @param signer    - The user's ephemeral ethers.Wallet
   * @param recipient - Destination address
   * @param amount    - Amount in USDC base units (e.g., 100_000_000 = 100 USDC)
   */
  async sendUSDC(
    signer: ethers.Wallet,
    recipient: string,
    amount: bigint,
  ): Promise<ethers.TransactionReceipt> {
    const signerUsdc = this.usdcContract.connect(signer) as ethers.Contract;
    const tx = await signerUsdc.transfer(recipient, amount);
    const receipt = await (tx as ethers.TransactionResponse).wait(1);
    if (!receipt || receipt.status === 0) {
      throw new Error('USDC transfer failed on-chain');
    }
    return receipt;
  }

  /**
   * Approve the Invoice Ledger contract to spend USDC on behalf of the payer.
   * Must be called before payInvoice.
   */
  async approveInvoiceLedger(
    signer: ethers.Wallet,
    amount: bigint,
  ): Promise<ethers.TransactionReceipt> {
    const signerUsdc = this.usdcContract.connect(signer) as ethers.Contract;
    const tx = await signerUsdc.approve(env.INVOICE_LEDGER_ADDRESS, amount);
    const receipt = await (tx as ethers.TransactionResponse).wait(1);
    if (!receipt || receipt.status === 0) {
      throw new Error('USDC approval failed');
    }
    return receipt;
  }

  /**
   * Approve the Escrow contract to spend USDC on behalf of the sender.
   */
  async approveEscrow(
    signer: ethers.Wallet,
    amount: bigint,
  ): Promise<ethers.TransactionReceipt> {
    const signerUsdc = this.usdcContract.connect(signer) as ethers.Contract;
    const tx = await signerUsdc.approve(env.ESCROW_ADDRESS, amount);
    const receipt = await (tx as ethers.TransactionResponse).wait(1);
    if (!receipt || receipt.status === 0) {
      throw new Error('USDC escrow approval failed');
    }
    return receipt;
  }

  // ─── Invoice Ledger ────────────────────────────────────────────────────────

  /**
   * Create an invoice on-chain. Called by the operator wallet.
   */
  async createOnchainInvoice(params: {
    businessAddress: string;
    clientRef: string;
    lineItemsHash: string;
    subtotal: bigint;
    vatAmount: bigint;
    whtAmount: bigint;
    total: bigint;
  }): Promise<{ invoiceId: bigint; txHash: string }> {
    const clientRefBytes = ethers.encodeBytes32String(params.clientRef.slice(0, 31));
    const lineItemsHashBytes = params.lineItemsHash as `0x${string}`;

    const tx = await this.invoiceLedgerContract.createInvoice(
      params.businessAddress,
      clientRefBytes,
      lineItemsHashBytes,
      params.subtotal,
      params.vatAmount,
      params.whtAmount,
      params.total,
    );

    const receipt = await (tx as ethers.TransactionResponse).wait(1);
    if (!receipt || receipt.status === 0) {
      throw new Error('Invoice creation failed on-chain');
    }

    // Parse the InvoiceCreated event to get the assigned invoiceId
    const iface = new ethers.Interface(INVOICE_LEDGER_ABI);
    let invoiceId = 0n;

    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === 'InvoiceCreated') {
          invoiceId = parsed.args[0] as bigint;
          break;
        }
      } catch {
        // Not an InvoiceCreated log — skip
      }
    }

    return { invoiceId, txHash: receipt.hash };
  }

  /**
   * Pay an invoice on-chain. Caller must have approved the ledger to spend USDC.
   */
  async payOnchainInvoice(
    signer: ethers.Wallet,
    invoiceId: bigint,
  ): Promise<ethers.TransactionReceipt> {
    const signerLedger = this.invoiceLedgerContract.connect(signer) as ethers.Contract;
    const tx = await signerLedger.payInvoice(invoiceId);
    const receipt = await (tx as ethers.TransactionResponse).wait(1);
    if (!receipt || receipt.status === 0) {
      throw new Error('Invoice payment failed on-chain');
    }
    return receipt;
  }

  // ─── Escrow ────────────────────────────────────────────────────────────────

  /**
   * Lock USDC in escrow for an unregistered recipient.
   */
  async createEscrowDeposit(
    signer: ethers.Wallet,
    recipientHash: string,
    amount: bigint,
    expirySeconds: bigint,
  ): Promise<{ depositId: bigint; txHash: string }> {
    // First approve escrow to spend USDC
    await this.approveEscrow(signer, amount);

    // Then the operator calls deposit (we use operator since it relays)
    // Actually the sender's signer deposits — they own the funds
    const signerEscrow = this.escrowContract.connect(signer) as ethers.Contract;
    const tx = await signerEscrow.deposit(recipientHash, amount, expirySeconds);
    const receipt = await (tx as ethers.TransactionResponse).wait(1);
    if (!receipt || receipt.status === 0) {
      throw new Error('Escrow deposit failed on-chain');
    }

    const iface = new ethers.Interface(ESCROW_ABI);
    let depositId = 0n;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === 'Deposited') {
          depositId = parsed.args[0] as bigint;
          break;
        }
      } catch { /* skip */ }
    }

    return { depositId, txHash: receipt.hash };
  }

  /**
   * Claim all pending escrow deposits for a new user.
   * Called by the operator wallet during onboarding.
   */
  async claimEscrowDeposits(
    recipientHash: string,
    claimerAddress: string,
  ): Promise<{ totalClaimed: bigint; txHash: string }> {
    const tx = await this.escrowContract.claimAll(recipientHash, claimerAddress);
    const receipt = await (tx as ethers.TransactionResponse).wait(1);
    if (!receipt || receipt.status === 0) {
      throw new Error('Escrow claim failed on-chain');
    }

    return { totalClaimed: 0n, txHash: receipt.hash }; // totalClaimed parsed from event if needed
  }

  // ─── Utility ───────────────────────────────────────────────────────────────

  /**
   * Parse a human-readable USDC amount (e.g., "100.50") to base units (bigint).
   */
  static parseUSDC(amount: string): bigint {
    return ethers.parseUnits(amount, 6);
  }

  /**
   * Format USDC base units to a human-readable string (e.g., "100.50").
   */
  static formatUSDC(amount: bigint): string {
    return ethers.formatUnits(amount, 6);
  }

  /**
   * Check if a string is a valid Ethereum/EVM address.
   */
  static isValidAddress(address: string): boolean {
    return ethers.isAddress(address);
  }

  /**
   * keccak256 hash of a string identifier (for escrow recipient hash).
   */
  static hashIdentifier(identifier: string): string {
    return ethers.keccak256(ethers.toUtf8Bytes(identifier));
  }

  /**
   * keccak256 hash of arbitrary bytes (for invoice line items hash).
   */
  static hashContent(content: string): string {
    return ethers.keccak256(ethers.toUtf8Bytes(content));
  }

  /**
   * Check network connectivity to Monad.
   */
  async healthCheck(): Promise<{ ok: boolean; blockNumber: number }> {
    try {
      const blockNumber = Number(await this.provider.getBlockNumber());
      return { ok: true, blockNumber };
    } catch {
      return { ok: false, blockNumber: 0 };
    }
  }
}

export const blockchainService = new BlockchainService();
