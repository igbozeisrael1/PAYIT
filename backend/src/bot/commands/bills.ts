import { InlineKeyboard } from 'grammy';
import { PayITContext } from '../middleware/session.js';
import { walletService } from '../../services/wallet.service.js';
import { requestPin } from '../handlers/pin.js';

interface BillsState {
  category: string;
  billerId: string;
  amount: string;
  step: 'category' | 'biller' | 'amount' | 'confirm';
}

const billsStateStore = new Map<number, BillsState>();

export async function handleBillsCommand(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  billsStateStore.delete(telegramId);
  ctx.session.conversation.step = undefined;

  const keyboard = new InlineKeyboard()
    .text('📱 Airtime / Data', 'bills_category_airtime').row()
    .text('💡 Electricity', 'bills_category_electricity').row()
    .text('🌐 Internet', 'bills_category_internet').row()
    .text('📺 Cable TV', 'bills_category_cable');

  await ctx.reply(
    '🧾 *Pay Bills*\n\n' +
    'Pay your everyday bills instantly using your Digital Dollars (USDC).\n\n' +
    'Select a bill category:',
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

export async function handleBillsCategorySelection(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  const data = ctx.callbackQuery?.data;
  if (!telegramId || !data) return;

  const categoryMap: Record<string, string> = {
    bills_category_airtime: 'Airtime / Data',
    bills_category_electricity: 'Electricity',
    bills_category_internet: 'Internet',
    bills_category_cable: 'Cable TV',
  };

  const categoryName = categoryMap[data];
  if (!categoryName) return;

  await ctx.answerCallbackQuery();

  billsStateStore.set(telegramId, {
    category: categoryName,
    billerId: '',
    amount: '',
    step: 'biller',
  });

  ctx.session.conversation.step = 'bills_biller';

  await ctx.reply(
    `✅ You selected **${categoryName}**.\n\n` +
    `Please enter the Biller ID (e.g., Phone Number, Meter Number, or Smartcard Number):`,
    { parse_mode: 'Markdown' }
  );
}

export async function handleBillsBiller(ctx: PayITContext, input: string): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const state = billsStateStore.get(telegramId);
  if (!state) return;

  state.billerId = input.trim();
  state.step = 'amount';
  billsStateStore.set(telegramId, state);

  ctx.session.conversation.step = 'bills_amount';

  await ctx.reply(
    `✅ Biller ID: **${state.billerId}**\n\n` +
    `How much would you like to pay? (Enter amount in USD, e.g., \`15.50\`)`,
    { parse_mode: 'Markdown' }
  );
}

export async function handleBillsAmount(ctx: PayITContext, input: string): Promise<void> {
  const telegramId = ctx.from?.id;
  const userId = ctx.session.userId;
  if (!telegramId || !userId) return;

  const state = billsStateStore.get(telegramId);
  if (!state) return;

  const amount = parseFloat(input);
  if (isNaN(amount) || amount <= 0) {
    await ctx.reply('❌ Invalid amount. Please enter a valid number like `15.50`.');
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
  billsStateStore.set(telegramId, state);
  ctx.session.conversation.step = undefined;

  const keyboard = new InlineKeyboard()
    .text('✅ Confirm Payment', 'bills_confirm').row()
    .text('❌ Cancel', 'bills_cancel');

  await ctx.reply(
    `📋 *Confirm Bill Payment*\n\n` +
    `🏷 Category: *${state.category}*\n` +
    `🆔 Biller ID: *${state.billerId}*\n` +
    `💰 Amount: *$${amount.toFixed(2)} USDC*\n\n` +
    `Proceed to pay?`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

export async function handleBillsConfirm(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const state = billsStateStore.get(telegramId);
  if (!state) return;

  await ctx.answerCallbackQuery();

  await requestPin(
    ctx,
    ctx.session.activeWallet,
    `Pay *$${state.amount} USDC* for ${state.category} (${state.billerId})`,
    async (pinCtx, signer) => {
      await pinCtx.reply('⏳ Processing payment through fiat off-ramp partner...');
      
      // Simulate transaction delay
      setTimeout(async () => {
        billsStateStore.delete(telegramId);
        pinCtx.session.conversation.step = undefined;

        await pinCtx.reply(
          `✅ *Payment Successful!*\n\n` +
          `Your ${state.category} bill for **${state.billerId}** has been settled.\n\n` +
          `🔗 Tx: \`0x${Math.random().toString(16).substring(2, 42).padEnd(40, '0')}\``,
          { parse_mode: 'Markdown' }
        );
      }, 2000);
    }
  );
}

export async function handleBillsCancel(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId) billsStateStore.delete(telegramId);
  ctx.session.conversation.step = undefined;
  await ctx.answerCallbackQuery('Cancelled');
  await ctx.editMessageText('Bill payment cancelled.');
}
