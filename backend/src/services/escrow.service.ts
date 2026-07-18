/**
 * escrow.service.ts — Pending transfer escrow management.
 *
 * Handles the full lifecycle of escrow deposits:
 *  - Creating escrow deposits for non-user recipients
 *  - Claiming deposits when a new user onboards
 *  - Refunding expired deposits
 *  - Daily cron job to sweep expired deposits
 */

import { ethers } from 'ethers';
import { prisma } from '../db/client.js';
import { blockchainService, BlockchainService } from './blockchain.service.js';
import { env } from '../config/env.js';

class EscrowService {
  /**
   * Create a pending transfer for a non-PayIT-user recipient.
   * Locks funds in the PayITEscrow contract.
   */
  async createPendingTransfer(
    senderWalletId: string,
    recipientRef: string,
    amountRaw: bigint,
    signer: ethers.Wallet,
  ): Promise<{ depositId: bigint; txHash: string }> {
    const recipientHash = BlockchainService.hashIdentifier(recipientRef);
    const expirySeconds = BigInt(env.ESCROW_DEFAULT_EXPIRY_SECONDS);

    // Create on-chain deposit
    const { depositId, txHash } = await blockchainService.createEscrowDeposit(
      signer,
      recipientHash,
      amountRaw,
      expirySeconds,
    );

    const expiresAt = new Date(Date.now() + Number(expirySeconds) * 1000);

    // Record in DB
    await prisma.escrowDeposit.create({
      data: {
        senderWalletId,
        recipientHash,
        recipientRef,
        amount: amountRaw.toString(),
        expiresAt,
        onchainDepositId: depositId.toString(),
      },
    });

    // Record as transaction
    await prisma.transaction.create({
      data: {
        walletId: senderWalletId,
        walletType: 'PERSONAL', // TODO: pass wallet type
        type: 'ESCROW_LOCKED',
        status: 'CONFIRMED',
        amount: amountRaw.toString(),
        counterpartyRef: recipientRef,
        txHash,
        externalRef: depositId.toString(),
        confirmedAt: new Date(),
      },
    });

    return { depositId, txHash };
  }

  /**
   * Claim all pending escrow deposits for a newly onboarded user.
   * Called during wallet creation when the user provides an identifier
   * that matches a pending deposit.
   */
  async claimDepositsForNewUser(
    recipientRef: string,
    claimerAddress: string,
    claimerWalletId: string,
  ): Promise<{ totalClaimed: bigint; txHash: string | null }> {
    const recipientHash = BlockchainService.hashIdentifier(recipientRef);

    // Check DB for pending deposits
    const pending = await prisma.escrowDeposit.findMany({
      where: {
        recipientHash,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
    });

    if (pending.length === 0) {
      return { totalClaimed: 0n, txHash: null };
    }

    // Claim on-chain
    const { totalClaimed, txHash } = await blockchainService.claimEscrowDeposits(
      recipientHash,
      claimerAddress,
    );

    // Update DB records
    await prisma.$transaction(
      pending.map((deposit) =>
        prisma.escrowDeposit.update({
          where: { id: deposit.id },
          data: {
            status: 'CLAIMED',
            resolvedAt: new Date(),
            resolvedToAddress: claimerAddress,
          },
        }),
      ),
    );

    // Record receive transaction for claimer
    if (pending.length > 0 && claimerWalletId) {
      const totalAmount = pending.reduce((acc, d) => acc + BigInt(d.amount), 0n);
      await prisma.transaction.create({
        data: {
          walletId: claimerWalletId,
          walletType: 'PERSONAL',
          type: 'ESCROW_CLAIMED',
          status: 'CONFIRMED',
          amount: totalAmount.toString(),
          counterpartyRef: 'Pending transfer claim',
          txHash,
          confirmedAt: new Date(),
        },
      });
    }

    return { totalClaimed, txHash };
  }

  /**
   * Refund a specific expired deposit back to the sender.
   * Can be called manually by the backend cron or by a user request.
   */
  async refundExpiredDeposit(depositId: string): Promise<{ txHash: string }> {
    const deposit = await prisma.escrowDeposit.findUniqueOrThrow({
      where: { id: depositId },
    });

    if (deposit.status !== 'PENDING') {
      throw new Error(`Deposit ${depositId} is already ${deposit.status}`);
    }

    if (deposit.expiresAt > new Date()) {
      throw new Error(`Deposit ${depositId} has not yet expired`);
    }

    if (!deposit.onchainDepositId) {
      throw new Error(`Deposit ${depositId} has no on-chain ID`);
    }

    // Call refund on-chain (permissionless)
    // We use the operator wallet just to pay gas
    const tx = await blockchainService.escrowContract.refund(
      BigInt(deposit.onchainDepositId),
    );
    const receipt = await (tx as ethers.TransactionResponse).wait(1);
    if (!receipt || receipt.status === 0) {
      throw new Error('Refund transaction failed on-chain');
    }

    // Update DB
    const senderWallet = await prisma.wallet.findFirstOrThrow({
      where: { id: deposit.senderWalletId },
    });

    await prisma.escrowDeposit.update({
      where: { id: depositId },
      data: {
        status: 'REFUNDED',
        resolvedAt: new Date(),
        resolvedToAddress: senderWallet.address,
      },
    });

    await prisma.transaction.create({
      data: {
        walletId: deposit.senderWalletId,
        walletType: 'PERSONAL',
        type: 'ESCROW_REFUNDED',
        status: 'CONFIRMED',
        amount: deposit.amount,
        counterpartyRef: `Refund: ${deposit.recipientRef}`,
        txHash: receipt.hash,
        confirmedAt: new Date(),
      },
    });

    return { txHash: receipt.hash };
  }

  /**
   * Daily cron: sweep all expired pending deposits and refund them.
   */
  async sweepExpiredDeposits(): Promise<void> {
    const expired = await prisma.escrowDeposit.findMany({
      where: {
        status: 'PENDING',
        expiresAt: { lt: new Date() },
        onchainDepositId: { not: null },
      },
      take: 50, // Process in batches
    });

    console.log(`[EscrowCron] Found ${expired.length} expired deposits to refund`);

    for (const deposit of expired) {
      try {
        const { txHash } = await this.refundExpiredDeposit(deposit.id);
        console.log(`[EscrowCron] Refunded deposit ${deposit.id}, tx: ${txHash}`);
      } catch (err) {
        console.error(`[EscrowCron] Failed to refund deposit ${deposit.id}:`, err);
      }
    }
  }
}

export const escrowService = new EscrowService();
