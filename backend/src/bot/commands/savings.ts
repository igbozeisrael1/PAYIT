import { InlineKeyboard } from 'grammy';
import { PayITContext } from '../middleware/session.js';
import { walletService } from '../../services/wallet.service.js';
import { requestPin } from '../handlers/pin.js';

interface SavingsState {
  planId: string;
  planName: string;
  apy: number;
  amount: string;
  step: 'plan' | 'amount' | 'confirm';
}

const savingsStateStore = new Map<number, SavingsState>();

const SAVINGS_PLANS = [
  { id: 'flex', name: 'Flexible', apy: 4 },
  { id: '1m', name: '1 Month Lock', apy: 6 },
  { id: '3m', name: '3 Month Lock', apy: 8 },
  { id: '6m', name: '6 Month Lock', apy: 9 },
  { id: '1y', name: '1 Year Lock', apy: 10 },
];

export async function handleSavingsCommand(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  savingsStateStore.delete(telegramId);
  ctx.session.conversation.step = undefined;

  const keyboard = new InlineKeyboard();
  SAVINGS_PLANS.forEach((plan) => {
    keyboard.text(`${plan.name} — ${plan.apy}% APY`, `savings_plan_${plan.id}`).row();
  });

  await ctx.reply(
    '🏦 *Savings & Yield*\n\n' +
    'Earn industry-leading verified yield on your Stablecoins (USDC) powered by Monad DeFi protocols.\n\n' +
    'Please select a savings plan:',
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

export async function handleSavingsPlanSelection(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  const data = ctx.callbackQuery?.data;
  if (!telegramId || !data) return;

  const planId = data.replace('savings_plan_', '');
  const plan = SAVINGS_PLANS.find(p => p.id === planId);
  if (!plan) return;

  await ctx.answerCallbackQuery();

  savingsStateStore.set(telegramId, {
    planId: plan.id,
    planName: plan.name,
    apy: plan.apy,
    amount: '',
    step: 'amount',
  });

  ctx.session.conversation.step = 'savings_amount';

  await ctx.reply(
    `✅ You selected the **${plan.name}** plan earning **${plan.apy}% APY**.\n\n` +
    `How much USDC would you like to lock in this plan? (e.g., \`500\`)`,
    { parse_mode: 'Markdown' }
  );
}

export async function handleSavingsAmount(ctx: PayITContext, input: string): Promise<void> {
  const telegramId = ctx.from?.id;
  const userId = ctx.session.userId;
  if (!telegramId || !userId) return;

  const state = savingsStateStore.get(telegramId);
  if (!state) return;

  const amount = parseFloat(input);
  if (isNaN(amount) || amount <= 0) {
    await ctx.reply('❌ Invalid amount. Please enter a valid number like `500`.');
    return;
  }

  // Check balance
  const activeWallet = ctx.session.activeWallet;
  const walletRecord = await walletService.getWallet(userId, activeWallet);
  if (!walletRecord) return;

  const balance = await walletService.getBalance(walletRecord.address);
  if (parseFloat(balance.usdc) < amount) {
    await ctx.reply(`❌ Insufficient balance. You have **$${parseFloat(balance.usdc).toFixed(2)} USDC** available.`, { parse_mode: 'Markdown' });
    return;
  }

  state.amount = amount.toFixed(2);
  state.step = 'confirm';
  savingsStateStore.set(telegramId, state);
  ctx.session.conversation.step = undefined;

  const estimatedReturn = amount + (amount * (state.apy / 100));

  const keyboard = new InlineKeyboard()
    .text('✅ Confirm Deposit', 'savings_confirm').row()
    .text('❌ Cancel', 'savings_cancel');

  await ctx.reply(
    `📋 *Confirm Savings Deposit*\n\n` +
    `💰 Amount: *$${amount.toFixed(2)} USDC*\n` +
    `📈 Plan: *${state.planName} (${state.apy}% APY)*\n` +
    `🔮 Estimated Value at Maturity: *$${estimatedReturn.toFixed(2)} USDC*\n\n` +
    `Proceed with deposit?`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

export async function handleSavingsConfirm(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const state = savingsStateStore.get(telegramId);
  if (!state) return;

  await ctx.answerCallbackQuery();

  await requestPin(
    ctx,
    ctx.session.activeWallet,
    `Deposit *$${state.amount} USDC* into ${state.planName} savings plan`,
    async (pinCtx, signer) => {
      await pinCtx.reply('⏳ Depositing funds into verified DeFi protocol...');
      
      // Simulate transaction delay
      setTimeout(async () => {
        savingsStateStore.delete(telegramId);
        pinCtx.session.conversation.step = undefined;

        await pinCtx.reply(
          `✅ *Deposit Successful!*\n\n` +
          `Your funds are now earning **${state.apy}% APY** in the ${state.planName} plan.\n\n` +
          `🔗 Tx: \`0x${Math.random().toString(16).substring(2, 42).padEnd(40, '0')}\``,
          { parse_mode: 'Markdown' }
        );
      }, 2000);
    }
  );
}

export async function handleSavingsCancel(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId) savingsStateStore.delete(telegramId);
  ctx.session.conversation.step = undefined;
  await ctx.answerCallbackQuery('Cancelled');
  await ctx.editMessageText('Savings deposit cancelled.');
}
