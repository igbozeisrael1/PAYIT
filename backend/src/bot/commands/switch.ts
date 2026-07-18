/**
 * switch.ts — Wallet switch handler (/switch command).
 * Toggles the active wallet between Personal and Business.
 */

import { InlineKeyboard } from 'grammy';
import { AccountType, WalletType } from '@prisma/client';
import { PayITContext } from '../middleware/session.js';
import { prisma } from '../../db/client.js';
import { walletService } from '../../services/wallet.service.js';
import { mainMenuKeyboard, mainMenuText } from './start.js';

export async function handleSwitchCommand(ctx: PayITContext): Promise<void> {
  const userId = ctx.session.userId;
  if (!userId) return;

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { accountType: true, activeWallet: true },
  });

  if (user.accountType === AccountType.PERSONAL) {
    await ctx.reply('You only have a Personal wallet. Upgrade to Business to access invoicing!');
    return;
  }

  if (user.accountType === AccountType.BUSINESS) {
    await ctx.reply('You only have a Business wallet.');
    return;
  }

  // User has BOTH — show switch keyboard
  const currentLabel = user.activeWallet === WalletType.PERSONAL ? '👤 Personal' : '💼 Business';
  const keyboard = new InlineKeyboard()
    .text('👤 Personal Wallet', 'switch_personal')
    .text('💼 Business Wallet', 'switch_business');

  await ctx.reply(
    `Currently active: *${currentLabel}*\n\nSwitch to:`,
    { parse_mode: 'Markdown', reply_markup: keyboard },
  );
}

export async function handleSwitchCallback(ctx: PayITContext): Promise<void> {
  const userId = ctx.session.userId;
  if (!userId) return;

  const data = ctx.callbackQuery?.data ?? '';
  const newWallet = data === 'switch_personal' ? WalletType.PERSONAL : WalletType.BUSINESS;

  // Update DB and session
  await prisma.user.update({
    where: { id: userId },
    data: { activeWallet: newWallet },
  });
  ctx.session.activeWallet = newWallet;

  await ctx.answerCallbackQuery(`Switched to ${newWallet === WalletType.PERSONAL ? 'Personal' : 'Business'} wallet`);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  // Fetch balance for the newly active wallet
  const walletRecord = await walletService.getWallet(userId, newWallet);
  const balance = walletRecord
    ? await walletService.getBalance(walletRecord.address).catch(() => null)
    : null;
  const balanceText = balance ? `\n💰 Balance: *$${parseFloat(balance.usdc).toFixed(2)} USDC*` : '';

  await ctx.editMessageText(
    `✅ Switched to *${newWallet === WalletType.PERSONAL ? '👤 Personal' : '💼 Business'}* wallet${balanceText}\n\n` +
    mainMenuText(user.accountType, newWallet),
    {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard(user.accountType, newWallet),
    },
  );
}
