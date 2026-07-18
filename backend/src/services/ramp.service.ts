/**
 * ramp.service.ts — On-ramp and off-ramp stub.
 *
 * This is a clean stub interface for Naira ↔ USDC conversion.
 * Replace the STUB implementations with real API calls to Flutterwave,
 * Paystack, Kotani Pay, or another provider when ready.
 *
 * The interface contract is fixed — bot commands call these methods
 * and don't need to know which provider is underneath.
 */

import { prisma } from '../db/client.js';
import { env } from '../config/env.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RateQuote {
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;          // Quote per 1 base unit (e.g. NGN per 1 USDC)
  inverseRate: number;   // Base units per 1 quote (e.g. USDC per 1 NGN)
  expiresAt: Date;
  snapshotId: string;
}

export interface DepositRequest {
  userId: string;
  amountNGN: number;
  walletAddress: string;
}

export interface DepositResponse {
  reference: string;
  paymentInstructions: string; // Text shown to user (bank details, card link, etc.)
  amountNGN: number;
  amountUSDC: string; // Estimated USDC (human-readable)
  snapshotId: string;
}

export interface WithdrawalRequest {
  userId: string;
  amountUSDCRaw: bigint;
  bankAccountNumber: string;
  bankName: string;
}

export interface WithdrawalResponse {
  reference: string;
  amountNGN: string;
  estimatedArrival: string;
}

// ─── Rate Locking ─────────────────────────────────────────────────────────────

const RATE_LOCK_SECONDS = 60;

// ─── Ramp Service ─────────────────────────────────────────────────────────────

class RampService {
  readonly provider = env.RAMP_PROVIDER;

  /**
   * Get a rate quote and lock it for RATE_LOCK_SECONDS.
   * The snapshotId must be used in subsequent deposit/withdrawal calls
   * to validate that the rate hasn't changed.
   */
  async getRate(baseCurrency: string, quoteCurrency: string): Promise<RateQuote> {
    const rate = await this._fetchRate(baseCurrency, quoteCurrency);
    const expiresAt = new Date(Date.now() + RATE_LOCK_SECONDS * 1000);

    const snapshot = await prisma.rateSnapshot.create({
      data: {
        baseCurrency,
        quoteCurrency,
        rate,
        expiresAt,
      },
    });

    return {
      baseCurrency,
      quoteCurrency,
      rate,
      inverseRate: 1 / rate,
      expiresAt,
      snapshotId: snapshot.id,
    };
  }

  /**
   * Validate a rate snapshot is still valid and mark it used.
   */
  async validateAndUseSnapshot(snapshotId: string): Promise<number> {
    const snapshot = await prisma.rateSnapshot.findUniqueOrThrow({
      where: { id: snapshotId },
    });

    if (snapshot.used) throw new Error('Rate snapshot already used');
    if (snapshot.expiresAt < new Date()) throw new Error('Rate has expired. Please get a new quote.');

    await prisma.rateSnapshot.update({ where: { id: snapshotId }, data: { used: true } });
    return snapshot.rate;
  }

  /**
   * Initiate a deposit (Naira → USDC).
   * Returns payment instructions to show the user.
   */
  async initiateDeposit(req: DepositRequest): Promise<DepositResponse> {
    if (this.provider === 'stub') {
      return this._stubDeposit(req);
    }
    // TODO: Implement real provider
    throw new Error(`Ramp provider "${this.provider}" not yet implemented`);
  }

  /**
   * Initiate a withdrawal (USDC → Naira).
   */
  async initiateWithdrawal(req: WithdrawalRequest): Promise<WithdrawalResponse> {
    if (this.provider === 'stub') {
      return this._stubWithdrawal(req);
    }
    throw new Error(`Ramp provider "${this.provider}" not yet implemented`);
  }

  // ─── Private: Stub Implementations ─────────────────────────────────────────

  private async _fetchRate(baseCurrency: string, quoteCurrency: string): Promise<number> {
    if (this.provider === 'stub') {
      // Stub: 1 USDC = 1650 NGN
      if (baseCurrency === 'USDC' && quoteCurrency === 'NGN') return 1650;
      if (baseCurrency === 'NGN' && quoteCurrency === 'USDC') return 1 / 1650;
      throw new Error(`Unsupported currency pair: ${baseCurrency}/${quoteCurrency}`);
    }

    // TODO: Fetch from real rate provider
    throw new Error('Real rate provider not configured');
  }

  private async _stubDeposit(req: DepositRequest): Promise<DepositResponse> {
    const rate = 1 / 1650; // NGN to USDC
    const amountUSDC = (req.amountNGN * rate).toFixed(2);
    const reference = `PAYIT-DEP-${Date.now()}`;

    return {
      reference,
      paymentInstructions:
        `[STUB — No real payment] To fund your wallet with ₦${req.amountNGN.toLocaleString()}, ` +
        `transfer to:\n\nBank: Stub Bank\nAccount: 1234567890\nRef: ${reference}\n\n` +
        `You will receive ~${amountUSDC} USDC after confirmation.`,
      amountNGN: req.amountNGN,
      amountUSDC,
      snapshotId: 'stub',
    };
  }

  private async _stubWithdrawal(req: WithdrawalRequest): Promise<WithdrawalResponse> {
    const amountUSDC = Number(req.amountUSDCRaw) / 1_000_000;
    const amountNGN = amountUSDC * 1650;

    return {
      reference: `PAYIT-WITH-${Date.now()}`,
      amountNGN: amountNGN.toLocaleString('en-NG', { style: 'currency', currency: 'NGN' }),
      estimatedArrival: '1–3 business days [STUB]',
    };
  }
}

export const rampService = new RampService();
