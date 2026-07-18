/**
 * withdraw.ts — Cash out (USDC → Naira off-ramp)
 */

import { InlineKeyboard } from 'grammy';
import { PayITContext } from '../middleware/session.js';
import { rampService } from '../../services/ramp.service.js';
import { walletService } from '../../services/wallet.service.js';
import { requestPin } from '../handlers/pin.js';
import { ethers } from 'ethers';

interface WithdrawState {
  amountUSDC: string;
  amountRaw: bigint;
  bankAccount: string;
  bankName: string;
  step: 'amount' | 'bank' | 'confirm';
}

const withdrawStateStore = new Map<number, WithdrawState>();

export async function handleWithdrawCommand(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  withdrawStateStore.delete(telegramId);
  withdrawStateStore.set(telegramId, {
    amountUSDC: '',
    amountRaw: 0n,
    bankAccount: '',
    bankName: '',
    step: 'amount',
  });
  ctx.session.conversation.step = 'withdraw_amount';

  await ctx.reply(
    '💵 *Withdraw USDC*\n\nHow much USDC would you like to withdraw?\n\nEnter amount (e.g. `100` or `50.50`):',
    { parse_mode: 'Markdown' },
  );
}

export async function handleWithdrawStep(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  const userId = ctx.session.userId;
  if (!telegramId || !userId) return;

  const text = ctx.message?.text?.trim() ?? '';
  const state = withdrawStateStore.get(telegramId);
  if (!state) return;

  const step = ctx.session.conversation.step;

  if (step === 'withdraw_amount') {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount < 1) {
      await ctx.reply('❌ Minimum withdrawal is $1 USDC. Enter a valid amount:');
      return;
    }

    // Check balance
    const walletRecord = await walletService.getWallet(userId, ctx.session.activeWallet);
    if (!walletRecord) return;
    const balance = await walletService.getBalance(walletRecord.address);
    const amountRaw = ethers.parseUnits(amount.toFixed(6), 6);

    if (balance.usdcRaw < amountRaw) {
      await ctx.reply(
        `❌ Insufficient balance.\nAvailable: *$${parseFloat(balance.usdc).toFixed(2)} USDC*`,
        { parse_mode: 'Markdown' },
      );
      return;
    }

    state.amountUSDC = amount.toFixed(2);
    state.amountRaw = amountRaw;
    state.step = 'bank';
    ctx.session.conversation.step = 'withdraw_bank';

    await ctx.reply(
      `✅ *$${amount.toFixed(2)} USDC*\n\nEnter your bank details:\n\nFormat: \`Account Number, Bank Name\`\nExample: \`0123456789, GTBank\``,
      { parse_mode: 'Markdown' },
    );
  } else if (step === 'withdraw_bank') {
    const parts = text.split(',').map((p) => p.trim());
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      await ctx.reply('❌ Please enter both account number and bank name:\n`Account Number, Bank Name`', {
        parse_mode: 'Markdown',
      });
      return;
    }

    state.bankAccount = parts[0];
    state.bankName = parts[1];
    state.step = 'confirm';
    ctx.session.conversation.step = 'withdraw_confirm';

    const quote = await rampService.getRate('USDC', 'NGN');
    const ngnAmount = (parseFloat(state.amountUSDC) * quote.rate).toLocaleString('en-NG', {
      style: 'currency',
      currency: 'NGN',
    });

    const keyboard = new InlineKeyboard()
      .text('✅ Confirm & Enter PIN', 'withdraw_confirm')
      .row()
      .text('❌ Cancel', 'withdraw_cancel');

    await ctx.reply(
      `📋 *Withdrawal Summary*\n\n` +
      `USDC Amount: *$${state.amountUSDC}*\n` +
      `You receive: *${ngnAmount}*\n` +
      `Bank: ${state.bankName}\n` +
      `Account: ${state.bankAccount}\n` +
      `Rate: 1 USDC = ₦${quote.rate.toFixed(0)}`,
      { parse_mode: 'Markdown', reply_markup: keyboard },
    );
  }
}

export async function handleWithdrawConfirm(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const state = withdrawStateStore.get(telegramId);
  if (!state) {
    await ctx.answerCallbackQuery('Session expired');
    return;
  }

  await ctx.answerCallbackQuery();
  const activeWallet = ctx.session.activeWallet;

  await requestPin(
    ctx,
    activeWallet,
    `Withdraw *$${state.amountUSDC} USDC* to ${state.bankName} (${state.bankAccount})`,
    async (pinCtx, signer) => {
      await executeWithdrawal(pinCtx, signer, state);
    },
  );
}

async function executeWithdrawal(
  ctx: PayITContext,
  _signer: ethers.Wallet,
  state: WithdrawState,
): Promise<void> {
  const userId = ctx.session.userId!;
  await ctx.reply('⏳ Processing withdrawal...');

  try {
    const result = await rampService.initiateWithdrawal({
      userId,
      amountUSDCRaw: state.amountRaw,
      bankAccountNumber: state.bankAccount,
      bankName: state.bankName,
    });

    const telegramId = ctx.from!.id;
    withdrawStateStore.delete(telegramId);
    ctx.session.conversation.step = undefined;

    await ctx.reply(
      `✅ *Withdrawal Initiated*\n\n` +
      `Amount: *${result.amountNGN}*\n` +
      `Arrival: ${result.estimatedArrival}\n` +
      `Reference: \`${result.reference}\``,
      { parse_mode: 'Markdown' },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await ctx.reply(`❌ Withdrawal failed: ${message}`);
    ctx.session.conversation.step = undefined;
  }
}
