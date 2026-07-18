/**
 * tax.service.ts — VAT and WHT calculation engine.
 *
 * Rates are loaded from the environment (configurable, not hardcoded)
 * so they can be updated without a code change.
 *
 * Nigerian defaults:
 *  - VAT: 7.5% (FIRS standard rate)
 *  - WHT rates vary by service type (5% for professional services, 10% for rent, etc.)
 */

import { env } from '../config/env.js';

// ─── WHT Service Type Categories ──────────────────────────────────────────────

export const WHT_CATEGORIES = [
  { id: 'professional', label: 'Professional Services (Consulting, Legal, etc.)', rate: 0.05 },
  { id: 'technical', label: 'Technical / IT Services', rate: 0.05 },
  { id: 'construction', label: 'Construction / Engineering', rate: 0.025 },
  { id: 'rent', label: 'Rent / Property', rate: 0.10 },
  { id: 'commission', label: 'Commission / Agency', rate: 0.10 },
  { id: 'dividend', label: 'Dividend', rate: 0.10 },
  { id: 'none', label: 'No WHT', rate: 0.0 },
] as const;

export type WhtCategoryId = (typeof WHT_CATEGORIES)[number]['id'];

// ─── Line Item ────────────────────────────────────────────────────────────────

export interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number; // In USD (human-readable)
}

// ─── Tax Calculation Result ───────────────────────────────────────────────────

export interface TaxBreakdown {
  /** Sum of (quantity × unitPrice) for all line items, in USDC base units */
  subtotalRaw: bigint;
  /** Human-readable subtotal */
  subtotal: string;

  /** VAT amount in USDC base units */
  vatAmountRaw: bigint;
  vatAmount: string;
  vatRate: number;
  vatEnabled: boolean;

  /** WHT amount in USDC base units (deducted from business net) */
  whtAmountRaw: bigint;
  whtAmount: string;
  whtRate: number;
  whtEnabled: boolean;
  whtCategory: string;

  /** Total due from payer = subtotal + VAT (WHT is deducted from business net) */
  totalRaw: bigint;
  total: string;

  /** What the business actually receives = total - WHT */
  netToBusinessRaw: bigint;
  netToBusiness: string;
}

// ─── Calculator ───────────────────────────────────────────────────────────────

class TaxService {
  /**
   * Calculate the full tax breakdown for an invoice.
   *
   * @param lineItems     - Array of line items
   * @param vatEnabled    - Whether to apply VAT
   * @param whtCategoryId - WHT category (or 'none')
   * @param vatRate       - Override VAT rate (defaults to env.VAT_RATE)
   */
  calculate(
    lineItems: LineItem[],
    vatEnabled: boolean,
    whtCategoryId: WhtCategoryId,
    vatRate?: number,
  ): TaxBreakdown {
    const effectiveVatRate = vatRate ?? env.VAT_RATE;

    // Find WHT category
    const whtCategory = WHT_CATEGORIES.find((c) => c.id === whtCategoryId)!;
    const whtRate = whtCategory.rate;

    // Calculate subtotal (sum of line items) in cents to avoid float issues
    // We work in integer cents, then convert to USDC base units (6 decimals)
    const subtotalCents = lineItems.reduce((acc, item) => {
      const itemTotal = Math.round(item.quantity * item.unitPrice * 100);
      return acc + itemTotal;
    }, 0);

    // Convert cents to USDC base units: 1 USD = 1 USDC = 1_000_000 base units
    // subtotalCents / 100 = USD, * 1_000_000 = base units
    const subtotalRaw = BigInt(subtotalCents) * 10000n; // subtotalCents * 1_000_000 / 100

    // VAT
    const vatAmountRaw = vatEnabled
      ? (subtotalRaw * BigInt(Math.round(effectiveVatRate * 10000))) / 10000n
      : 0n;

    // WHT (applied to subtotal only, not VAT)
    const whtEnabled = whtRate > 0;
    const whtAmountRaw = whtEnabled
      ? (subtotalRaw * BigInt(Math.round(whtRate * 10000))) / 10000n
      : 0n;

    // Total due from payer = subtotal + VAT
    const totalRaw = subtotalRaw + vatAmountRaw;

    // Net to business = total - WHT
    const netToBusinessRaw = totalRaw - whtAmountRaw;

    const formatUsdc = (raw: bigint) => (Number(raw) / 1_000_000).toFixed(2);

    return {
      subtotalRaw,
      subtotal: formatUsdc(subtotalRaw),
      vatAmountRaw,
      vatAmount: formatUsdc(vatAmountRaw),
      vatRate: effectiveVatRate,
      vatEnabled,
      whtAmountRaw,
      whtAmount: formatUsdc(whtAmountRaw),
      whtRate,
      whtEnabled,
      whtCategory: whtCategory.label,
      totalRaw,
      total: formatUsdc(totalRaw),
      netToBusinessRaw,
      netToBusiness: formatUsdc(netToBusinessRaw),
    };
  }

  /**
   * Format a TaxBreakdown into a Telegram-readable invoice preview.
   */
  formatBreakdown(breakdown: TaxBreakdown): string {
    let text = `📋 *Invoice Breakdown*\n\n`;
    text += `Subtotal: *$${breakdown.subtotal} USDC*\n`;

    if (breakdown.vatEnabled) {
      text += `VAT (${(breakdown.vatRate * 100).toFixed(1)}%): *$${breakdown.vatAmount} USDC*\n`;
    }

    text += `\n*Total Due: $${breakdown.total} USDC*\n`;

    if (breakdown.whtEnabled) {
      text += `\n🏛 WHT (${(breakdown.whtRate * 100).toFixed(1)}%): $${breakdown.whtAmount} USDC _(deducted from your net)_\n`;
      text += `💰 *You receive: $${breakdown.netToBusiness} USDC*\n`;
      text += `\n_WHT category: ${breakdown.whtCategory}_`;
    } else {
      text += `💰 *You receive: $${breakdown.netToBusiness} USDC*`;
    }

    return text;
  }
}

export const taxService = new TaxService();
