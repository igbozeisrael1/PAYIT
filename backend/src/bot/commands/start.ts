/**
 * start.ts — /start command and main menu for PayIT bot.
 */

import { InlineKeyboard } from 'grammy';
import { AccountType, WalletType } from '@prisma/client';
import { PayITContext } from '../middleware/session.js';
import { prisma } from '../../db/client.js';
import { walletService } from '../../services/wallet.service.js';
import { startOnboarding } from '../handlers/onboarding.js';

// ─── Main Menu ────────────────────────────────────────────────────────────────

export function mainMenuText(accountType: AccountType, activeWallet: WalletType): string {
  const walletLabel = activeWallet === WalletType.PERSONAL ? '👤 Personal' : '💼 Business';
  return (
    `*PayIT Account* — ${walletLabel} ${accountType === AccountType.BOTH ? '_(tap /switch to change)_' : ''}\n\n` +
    `What would you like to do?`
  );
}

export function mainMenuKeyboard(accountType: AccountType, activeWallet: WalletType): InlineKeyboard {
  const kb = new InlineKeyboard();

  if (activeWallet === WalletType.PERSONAL) {
    kb.text('🏦 Deposit', 'action_deposit')
      .text('💸 Send', 'action_send')
      .row()
      .text('🧾 Generate Invoice', 'action_invoices')
      .row()
      .text('🏦 Savings & Yield', 'action_savings')
      .text('🧾 Pay Bills', 'action_bills')
      .row()
      .text('⚙️ Settings', 'action_settings')
      .text('❓ FAQ', 'action_faq')
      .text('🎧 Support', 'action_support')
      .row();
    
    if (accountType === AccountType.BOTH || accountType === AccountType.BUSINESS) {
      kb.text('💼 Switch to Business Account', 'action_switch');
    } else {
      kb.text('💼 Upgrade to Business', 'type_business');
    }
  } else {
    // Business Wallet
    kb.text('💸 Send', 'action_send')
      .text('📥 Receive', 'action_receive')
      .row()
      .text('🧾 Invoice', 'action_invoices')
      .text('💰 Pay Salaries', 'action_salaries')
      .row()
      .text('⚙️ Settings', 'action_settings')
      .text('❓ FAQ', 'action_faq')
      .text('🎧 Support', 'action_support')
      .row()
      .text('👤 Switch to Personal Account', 'action_switch');
  }

  return kb;
}

// ─── /start Command ───────────────────────────────────────────────────────────

export async function handleStart(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  // If user exists, show main menu
  const user = await prisma.user.findUnique({ where: { telegramId } });

  if (user) {
    const balanceData = await walletService
      .getWallet(user.id, WalletType.PERSONAL)
      .then(async (w) => (w ? walletService.getBalance(w.address) : null))
      .catch(() => null);

    const balanceText = balanceData
      ? `\n💰 Balance: *$${parseFloat(balanceData.usdc).toFixed(2)} USDC*`
      : '';

    await ctx.reply(
      `👋 Welcome back, *${user.firstName ?? user.username ?? 'there'}*!${balanceText}\n\n` +
      mainMenuText(user.accountType, user.activeWallet),
      {
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard(user.accountType, user.activeWallet),
      },
    );
    return;
  }

  // New user — start onboarding
  await startOnboarding(ctx);
}

// ─── /help Command ────────────────────────────────────────────────────────────

export async function handleHelp(ctx: PayITContext): Promise<void> {
  await ctx.reply(
    `*PayIT Help* 📖\n\n` +
    `*Commands:*\n` +
    `/start — Open main menu\n` +
    `/send — Send USDC to someone\n` +
    `/receive — Get your payment link\n` +
    `/deposit — Add money (Naira → USDC)\n` +
    `/withdraw — Cash out (USDC → Naira)\n` +
    `/balance — Check your balance\n` +
    `/invoices — Manage invoices (Business)\n` +
    `/history — Transaction history\n` +
    `/switch — Switch between wallets\n` +
    `/restore — Restore wallet from recovery phrase\n\n` +
    `*Tips:*\n` +
    `• You can also just type naturally — our AI assistant will help!\n` +
    `• Example: "Send $20 to John" or "How much have I made this month?"\n\n` +
    `*Security:*\n` +
    `• PayIT will NEVER ask for your recovery phrase\n` +
    `• All transactions require your PIN`,
    { parse_mode: 'Markdown' },
  );
}

// ─── /balance Command ─────────────────────────────────────────────────────────

export async function handleBalance(ctx: PayITContext): Promise<void> {
  const userId = ctx.session.userId;
  if (!userId) return;

  const activeWallet = ctx.session.activeWallet;
  const walletRecord = await walletService.getWallet(userId, activeWallet);

  if (!walletRecord) {
    await ctx.reply('No wallet found. Run /start to set up your wallet.');
    return;
  }

  try {
    const balance = await walletService.getBalance(walletRecord.address);
    const label = activeWallet === WalletType.PERSONAL ? '👤 Personal' : '💼 Business';

    await ctx.reply(
      `${label} *Wallet Balance*\n\n` +
      `💵 USDC: *$${parseFloat(balance.usdc).toFixed(2)}*\n\n` +
      `📍 Address: \`${walletRecord.address}\``,
      { parse_mode: 'Markdown' },
    );
  } catch {
    await ctx.reply('⚠️ Unable to fetch balance right now. Please try again shortly.');
  }
}
