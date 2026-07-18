/**
 * deposit.ts — Add money (Naira → USDC on-ramp)
 */

import { InlineKeyboard } from 'grammy';
import { PayITContext } from '../middleware/session.js';
import { rampService } from '../../services/ramp.service.js';
import { walletService } from '../../services/wallet.service.js';

export async function handleDepositCommand(ctx: PayITContext): Promise<void> {
  const keyboard = new InlineKeyboard()
    .text('🪙 Crypto (USDT/USDC)', 'deposit_crypto').row()
    .text('🇳🇬 Naira (Bank Transfer)', 'deposit_naira').row()
    .text('🌍 Other Fiat (Card/Wire)', 'deposit_fiat');

  await ctx.reply(
    '🏦 *Add Funds*\n\nHow would you like to fund your account?',
    { parse_mode: 'Markdown', reply_markup: keyboard },
  );
}

export async function handleDepositOption(ctx: PayITContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  const userId = ctx.session.userId;
  if (!data || !userId) return;

  await ctx.answerCallbackQuery();

  const walletRecord = await walletService.getWallet(userId, ctx.session.activeWallet);
  if (!walletRecord) return;

  if (data === 'deposit_crypto') {
    await ctx.reply(
      `🪙 *Crypto Deposit*\n\n` +
      `Send USDT, USDC, ETH, or Monad to your secure address. It will automatically reflect in your balance.\n\n` +
      `*Address (Tap to copy):*\n\`${walletRecord.address}\``,
      { parse_mode: 'Markdown' }
    );
  } else if (data === 'deposit_naira') {
    // Generate mock virtual fiat account for this wallet
    const mockAccountNum = `9${userId.substring(0, 9).replace(/\D/g, '0').padEnd(9, '0')}`;
    
    await ctx.reply(
      `🇳🇬 *Naira Bank Transfer*\n\n` +
      `Transfer Naira to your dedicated virtual account. It will be converted instantly to Digital Dollars.\n\n` +
      `*Bank:* Wema Bank\n` +
      `*Account Name:* PayIT - ${ctx.from?.first_name}\n` +
      `*Account Number (Tap to copy):*\n\`${mockAccountNum}\``,
      { parse_mode: 'Markdown' }
    );
  } else if (data === 'deposit_fiat') {
    await ctx.reply(
      `🌍 *Other Fiat Deposit*\n\n` +
      `USD/EUR/GBP card deposits and wire transfers are coming soon!`,
      { parse_mode: 'Markdown' }
    );
  }
}
