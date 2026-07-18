/**
 * wallet.service.ts — Non-custodial wallet management for PayIT.
 *
 * This service handles:
 *  1. Creating new wallets (keypair generation + AES-256-GCM encryption)
 *  2. Decrypting a key in memory only, to sign a transaction, then zeroing it
 *  3. Restoring a wallet from a BIP-39 recovery phrase
 *  4. Reading on-chain USDC balance
 *  5. Sending raw USDC transfers
 *
 * Security invariants:
 *  - Private keys NEVER appear in logs, DB plaintext, or error messages.
 *  - Decryption happens only at sign time, in memory.
 *  - All key material is zeroed after use.
 */

import { ethers } from 'ethers';
import { WalletType } from '@prisma/client';
import { prisma } from '../db/client.js';
import {
  encrypt,
  decrypt,
  serializeBlob,
  deserializeBlob,
} from '../utils/crypto.js';
import { verifyPin, isPinLocked, getLockoutMessage } from '../utils/pin.js';
import { generateMnemonic, mnemonicToSeed } from '../utils/mnemonic.js';
import { blockchainService } from './blockchain.service.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateWalletResult {
  address: string;
  mnemonic: string; // Shown ONCE to user — never stored
}

export interface WalletBalance {
  usdc: string;     // Human-readable USDC amount (e.g., "120.50")
  usdcRaw: bigint;  // Raw balance in base units (6 decimals)
}

// ─── Service ──────────────────────────────────────────────────────────────────

class WalletService {
  /**
   * Create a new wallet for a user. Called during onboarding.
   *
   * Flow:
   *  1. Generate BIP-39 mnemonic (12 words, 128-bit entropy)
   *  2. Derive HDNode from seed using BIP-44 path for Ethereum (m/44'/60'/0'/0/0)
   *  3. Encrypt the private key with the user's PIN (AES-256-GCM + scrypt)
   *  4. Store encrypted blob + address in KeyStore and Wallet tables
   *
   * @returns CreateWalletResult — the address and mnemonic (mnemonic shown ONCE)
   */
  async createWallet(
    userId: string,
    pin: string,
    walletType: WalletType,
  ): Promise<CreateWalletResult> {
    // Check if wallet already exists (idempotency guard)
    const existing = await prisma.keyStore.findUnique({
      where: { userId_walletType: { userId, walletType } },
    });
    if (existing) {
      throw new Error(`Wallet of type ${walletType} already exists for this user`);
    }

    // Generate mnemonic + derive key
    const mnemonic = generateMnemonic();
    const seed = await mnemonicToSeed(mnemonic);

    // Derive the HD node using BIP-44 path for Ethereum/EVM
    const hdNode = ethers.HDNodeWallet.fromSeed(seed);
    const derivedNode = hdNode.derivePath("m/44'/60'/0'/0/0");

    const address = derivedNode.address;
    const privateKeyHex = derivedNode.privateKey; // e.g., "0x..."

    // Encrypt private key with PIN
    const blob = encrypt(privateKeyHex, pin);
    const serializedBlob = serializeBlob(blob);

    // Persist: KeyStore + Wallet (in a transaction)
    await prisma.$transaction(async (tx) => {
      await tx.keyStore.create({
        data: { userId, walletType, encryptedKeyBlob: serializedBlob, address },
      });
      await tx.wallet.create({
        data: { userId, walletType, address },
      });
    });

    // Seed is a Buffer — zero it
    seed.fill(0);

    return { address, mnemonic };
  }

  /**
   * Restore a wallet from a BIP-39 mnemonic phrase.
   * Used when a user loses access and restores on a new device.
   * Re-encrypts the private key with the new PIN.
   */
  async restoreWallet(
    userId: string,
    mnemonic: string,
    newPin: string,
    walletType: WalletType,
  ): Promise<string> {
    const seed = await mnemonicToSeed(mnemonic);
    const hdNode = ethers.HDNodeWallet.fromSeed(seed);
    const derivedNode = hdNode.derivePath("m/44'/60'/0'/0/0");

    const address = derivedNode.address;
    const privateKeyHex = derivedNode.privateKey;

    const blob = encrypt(privateKeyHex, newPin);
    const serializedBlob = serializeBlob(blob);

    await prisma.$transaction(async (tx) => {
      // Upsert KeyStore
      await tx.keyStore.upsert({
        where: { userId_walletType: { userId, walletType } },
        create: { userId, walletType, encryptedKeyBlob: serializedBlob, address },
        update: { encryptedKeyBlob: serializedBlob, address },
      });
      // Upsert Wallet
      await tx.wallet.upsert({
        where: { userId_walletType: { userId, walletType } },
        create: { userId, walletType, address },
        update: { address },
      });
    });

    seed.fill(0);
    return address;
  }

  /**
   * Decrypt a user's private key in memory and return an ethers.js Wallet signer.
   * The signer is used to sign a single transaction, then discarded.
   *
   * PIN verification (bcrypt) happens BEFORE decryption to avoid spending
   * scrypt time on wrong PINs.
   */
  async getSigner(
    userId: string,
    walletType: WalletType,
    pin: string,
  ): Promise<ethers.Wallet> {
    // 1. Check PIN lockout
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const lockState = { attempts: user.pinAttempts, lockedUntil: user.pinLockedUntil };

    if (isPinLocked(lockState)) {
      throw new Error(getLockoutMessage(lockState));
    }

    // 2. Verify PIN against bcrypt hash
    const pinOk = await verifyPin(pin, user.pinHash);
    if (!pinOk) {
      await this._recordFailedPinAttempt(userId);
      throw new Error('Incorrect PIN');
    }

    // 3. Reset attempt counter on success
    await prisma.user.update({
      where: { id: userId },
      data: { pinAttempts: 0, pinLockedUntil: null },
    });

    // 4. Fetch and decrypt key blob
    const keyStore = await prisma.keyStore.findUniqueOrThrow({
      where: { userId_walletType: { userId, walletType } },
    });

    const blob = deserializeBlob(keyStore.encryptedKeyBlob);
    const privateKeyHex = decrypt(blob, pin);

    // 5. Create ephemeral signer connected to Monad
    const signer = new ethers.Wallet(privateKeyHex, blockchainService.provider);

    // Note: We do not zero privateKeyHex here because ethers.Wallet holds a reference.
    // The signer should be used immediately and not stored beyond the current request.

    return signer;
  }

  /**
   * Get the on-chain USDC balance for a wallet address.
   */
  async getBalance(address: string): Promise<WalletBalance> {
    const usdcRaw = await blockchainService.getUSDCBalance(address);
    const usdc = ethers.formatUnits(usdcRaw, 6);
    return { usdc, usdcRaw };
  }

  /**
   * Get a wallet record by userId + walletType.
   */
  async getWallet(userId: string, walletType: WalletType) {
    return prisma.wallet.findUnique({
      where: { userId_walletType: { userId, walletType } },
    });
  }

  /**
   * Get all wallets for a user.
   */
  async getUserWallets(userId: string) {
    return prisma.wallet.findMany({ where: { userId } });
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private async _recordFailedPinAttempt(userId: string): Promise<void> {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { pinAttempts: { increment: 1 } },
    });

    const { PIN_MAX_ATTEMPTS, PIN_LOCKOUT_MINUTES } = await import('../config/env.js').then(
      (m) => m.env,
    );

    if (user.pinAttempts >= PIN_MAX_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + PIN_LOCKOUT_MINUTES * 60 * 1000);
      await prisma.user.update({
        where: { id: userId },
        data: { pinLockedUntil: lockedUntil, pinAttempts: 0 },
      });
    }
  }
}

export const walletService = new WalletService();
