/**
 * notification.service.ts — Push notification delivery via Telegram.
 *
 * All user-facing notifications flow through this service.
 * It uses the bot instance to send messages proactively (push, not reply).
 */

import { Bot } from 'grammy';
import { prisma } from '../db/client.js';
import { PayITContext } from '../bot/middleware/session.js';

let _bot: Bot<PayITContext> | null = null;

class NotificationService {
  /** Called once during bot initialization to inject the bot instance */
  setBot(bot: Bot<PayITContext>): void {
    _bot = bot;
  }

  private get bot(): Bot<PayITContext> {
    if (!_bot) throw new Error('NotificationService: bot not initialized');
    return _bot;
  }

  /** Look up a user's Telegram ID by their wallet address or DB user ID */
  private async getTelegramId(userId: string): Promise<string | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { telegramId: true, isActive: true, isFrozen: true },
    });
    if (!user || !user.isActive || user.isFrozen) return null;
    return user.telegramId;
  }

  /** Send a notification to a user by their DB user ID */
  async notifyUser(userId: string, message: string): Promise<void> {
    const telegramId = await this.getTelegramId(userId);
    if (!telegramId) return;
    try {
      await this.bot.api.sendMessage(telegramId, message, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error(`[Notification] Failed to notify user ${userId}:`, err);
    }
  }

  /** Notify a recipient when they receive a transfer */
  async notifyTransferReceived(
    recipientRef: string,
    amount: string,
    senderName: string,
  ): Promise<void> {
    // Try to find user by Telegram handle
    const handle = recipientRef.startsWith('@') ? recipientRef.slice(1) : recipientRef;
    const user = await prisma.user.findFirst({
      where: { username: { equals: handle, mode: 'insensitive' } },
    });

    if (!user) return;

    await this.notifyUser(
      user.id,
      `💰 *You received $${amount} USDC!*\n\nFrom: ${senderName}\n\nCheck your balance with /balance`,
    );
  }

  /** Notify the business wallet owner when an invoice is paid */
  async notifyInvoicePaid(
    walletId: string,
    _invoiceId: string,
    amount: string,
    clientName: string,
  ): Promise<void> {
    const wallet = await prisma.wallet.findUnique({ where: { id: walletId } });
    if (!wallet) return;

    await this.notifyUser(
      wallet.userId,
      `🎉 *Invoice Paid!*\n\nClient: ${clientName}\nAmount: *$${amount} USDC*\n\nView your ledger: /invoices`,
    );
  }

  /** Notify a user about an overdue invoice */
  async notifyInvoiceOverdue(
    walletId: string,
    _invoiceId: string,
    clientName: string,
    amount: string,
  ): Promise<void> {
    const wallet = await prisma.wallet.findUnique({ where: { id: walletId } });
    if (!wallet) return;

    await this.notifyUser(
      wallet.userId,
      `⚠️ *Overdue Invoice*\n\nInvoice to *${clientName}* for *$${amount} USDC* is overdue.\n\nFollow up? Use /invoices to view details.`,
    );
  }

  /** Notify sender when their escrow deposit is refunded */
  async notifyEscrowRefunded(
    senderWalletId: string,
    amount: string,
    recipientRef: string,
  ): Promise<void> {
    const wallet = await prisma.wallet.findUnique({ where: { id: senderWalletId } });
    if (!wallet) return;

    await this.notifyUser(
      wallet.userId,
      `↩️ *Funds Returned*\n\n$${amount} USDC sent to ${recipientRef} has been returned to your wallet — they didn't join PayIT in time.`,
    );
  }

  /** Notify sender when their escrow is claimed */
  async notifyEscrowClaimed(
    senderWalletId: string,
    amount: string,
    claimerRef: string,
  ): Promise<void> {
    const wallet = await prisma.wallet.findUnique({ where: { id: senderWalletId } });
    if (!wallet) return;

    await this.notifyUser(
      wallet.userId,
      `✅ *Funds Claimed!*\n\n${claimerRef} joined PayIT and received your $${amount} USDC transfer.`,
    );
  }
}

export const notificationService = new NotificationService();
