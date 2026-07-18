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
    select: { activeWallet: true },
  });

  const target = user.activeWallet === WalletType.PERSONAL ? WalletType.BUSINESS : WalletType.PERSONAL;
  return switchToWallet(ctx, target);
}

export async function switchToWallet(ctx: PayITContext, target: WalletType): Promise<void> {
  const userId = ctx.session.userId;
  if (!userId) return;

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  // 1. Check if they already have the target wallet
  const walletRecord = await walletService.getWallet(userId, target);

  if (!walletRecord) {
    // 2. They don't have it, so start the creation flow
    if (target === WalletType.BUSINESS) {
      const { handleUpgradeToBusiness } = await import('./start.js');
      return handleUpgradeToBusiness(ctx);
    } else {
      // Create personal wallet flow (since they somehow bypassed it)
      // We can just ask them to set a PIN for the new personal wallet
      ctx.session.conversation.step = 'set_pin';
      ctx.session.conversation.pendingAction = AccountType.BOTH; // Mark that they will now have both
      await ctx.reply('🔒 Let\'s set up your Personal Account.\n\nPlease enter a 4-digit PIN:');
      return;
    }
  }

  // 3. They have the wallet, so switch to it
  await prisma.user.update({
    where: { id: userId },
    data: { activeWallet: target },
  });
  ctx.session.activeWallet = target;

  const updatedUser = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  // Fetch balance for the newly active wallet
  const balance = await walletService.getBalance(walletRecord.address).catch(() => null);
  const balanceText = balance ? `\n💰 Balance: *$${parseFloat(balance.usdc).toFixed(2)} USDC*` : '';

  await ctx.reply(
    `✅ Switched to *${target === WalletType.PERSONAL ? '👤 Personal' : '💼 Business'}* wallet${balanceText}\n\n` +
    mainMenuText(updatedUser.accountType, target),
    {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard(updatedUser.accountType, target),
    },
  );
}

// Keep handleSwitchCallback just in case any old inline keyboards are still clicked
export async function handleSwitchCallback(ctx: PayITContext): Promise<void> {
  await ctx.answerCallbackQuery();
  const data = ctx.callbackQuery?.data ?? '';
  const newWallet = data === 'switch_personal' ? WalletType.PERSONAL : WalletType.BUSINESS;
  return switchToWallet(ctx, newWallet);
}
