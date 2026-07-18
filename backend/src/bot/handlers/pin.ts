/**
 * pin.ts — PIN collection handler.
 *
 * A reusable in-memory PIN collection flow for the Telegram bot.
 * Used by send, withdraw, invoice payment, and any other money-moving action.
 *
 * SECURITY: PINs are never stored in the session. They are collected in memory,
 * verified via bcrypt, and used once for the transaction signing via scrypt.
 * After use, they are not retained.
 */

import { PayITContext } from '../middleware/session.js';
import { walletService } from '../../services/wallet.service.js';
import { WalletType } from '@prisma/client';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PinConfirmedCallback = (
  ctx: PayITContext,
  signer: import('ethers').Wallet,
) => Promise<void>;

// ─── In-memory pending PIN callbacks ─────────────────────────────────────────
// Maps Telegram user ID → pending action awaiting PIN confirmation

interface PendingPinAction {
  walletType: WalletType;
  callback: PinConfirmedCallback;
  createdAt: number;
}

const pendingPinActions = new Map<number, PendingPinAction>();

// Clean up stale entries after 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of pendingPinActions.entries()) {
    if (now - entry.createdAt > 5 * 60_000) {
      pendingPinActions.delete(key);
    }
  }
}, 60_000);

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Request a PIN from the user and call `callback` with their signer once verified.
 * This sets a pending action and sends a message asking for the PIN.
 */
export async function requestPin(
  ctx: PayITContext,
  walletType: WalletType,
  actionDescription: string,
  callback: PinConfirmedCallback,
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  pendingPinActions.set(telegramId, {
    walletType,
    callback,
    createdAt: Date.now(),
  });

  ctx.session.conversation.step = 'awaiting_pin';

  const promptMsg = await ctx.reply(
    `🔒 *Confirm with PIN*\n\n${actionDescription}\n\nEnter your PIN to proceed:`,
    { parse_mode: 'Markdown' },
  );

  // Auto-destruct prompt after 60 seconds
  setTimeout(async () => {
    try {
      await ctx.api.deleteMessage(ctx.chat!.id, promptMsg.message_id);
    } catch (e) { /* ignore */ }
  }, 60000);
}

/**
 * Handle a PIN entry from the user.
 * Called from the main bot message router when step === 'awaiting_pin'.
 */
export async function handlePinEntry(ctx: PayITContext, pin: string): Promise<void> {
  const telegramId = ctx.from?.id;
  const userId = ctx.session.userId;

  if (!telegramId || !userId) return;

  const pending = pendingPinActions.get(telegramId);
  if (!pending) {
    await ctx.reply('No pending action found. Please start over.');
    return;
  }

  // Auto-destruct the user's PIN message after 30 seconds
  if (ctx.message?.message_id) {
    setTimeout(async () => {
      try {
        await ctx.api.deleteMessage(ctx.chat!.id, ctx.message!.message_id);
      } catch (e) { /* ignore */ }
    }, 30000);
  }

  try {
    const signer = await walletService.getSigner(userId, pending.walletType, pin);
    pendingPinActions.delete(telegramId);
    ctx.session.conversation.step = undefined;

    await pending.callback(ctx, signer);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Incorrect PIN';

    if (message.includes('locked') || message.includes('Try again in')) {
      pendingPinActions.delete(telegramId);
      ctx.session.conversation.step = undefined;
      await ctx.reply(`🔒 ${message}`);
    } else {
      await ctx.reply(`❌ ${message}\n\nEnter your PIN again:`);
    }
  }
}
