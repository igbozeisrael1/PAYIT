/**
 * session.ts — grammY session middleware for PayIT bot.
 *
 * The session stores per-user conversation state between bot turns.
 * Sensitive data (PINs, mnemonics) are NEVER stored in the session.
 * They are handled in-memory during conversations only.
 */

import { Context, SessionFlavor } from 'grammy';
import { WalletType } from '@prisma/client';

// ─── Session Data Types ───────────────────────────────────────────────────────

export interface ConversationState {
  // Tracks what the user is currently doing (multi-step flows)
  step?: string;
  // Temporary values during multi-step flows (non-sensitive only)
  pendingAmount?: string;
  pendingRecipient?: string;
  pendingInvoiceId?: string;
  pendingAction?: string;  // e.g., "send", "create_invoice"
  pendingMnemonic?: string; // e.g. for wallet creation
}

export interface SessionData {
  // Current active wallet (switches with /switch)
  activeWallet: WalletType;
  // Internal user DB ID (set on first interaction once user is registered)
  userId?: string;
  // Whether the user has completed onboarding
  onboarded: boolean;
  // Multi-step flow state
  conversation: ConversationState;
  // For AI assistant — last user message parsed intent (for confirmation flow)
  pendingAiAction?: {
    intent: string;
    args: Record<string, unknown>;
    confirmationText: string;
  };
}

export type PayITContext = Context & SessionFlavor<SessionData>;

// ─── Initial Session ──────────────────────────────────────────────────────────

export function initialSession(): SessionData {
  return {
    activeWallet: WalletType.PERSONAL,
    onboarded: false,
    conversation: {},
  };
}
