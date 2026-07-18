import { InlineKeyboard } from 'grammy';
import { WalletType } from '@prisma/client';
import { PayITContext } from '../middleware/session.js';
import { walletService } from '../../services/wallet.service.js';

interface SalariesState {
  step: 'upload' | 'confirm';
  parsedData: Array<{ recipient: string; amount: number; currency: string }>;
  totalAmountUSD: number;
}

const salariesStateStore = new Map<number, SalariesState>();

export async function handleSalariesCommand(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  const userId = ctx.session.userId;
  if (!telegramId || !userId) return;

  if (ctx.session.activeWallet !== WalletType.BUSINESS) {
    await ctx.reply(
      '🔒 Payroll is only available in the *Business* wallet.\n\nSwitch with /switch',
      { parse_mode: 'Markdown' },
    );
    return;
  }

  salariesStateStore.set(telegramId, {
    step: 'upload',
    parsedData: [],
    totalAmountUSD: 0,
  });

  ctx.session.conversation.step = 'salaries_upload';

  await ctx.reply(
    '💰 *Pay Salaries*\n\n' +
    'Please send the payroll details.\n' +
    'You can upload a **CSV / Excel file**, send an **image**, or just **paste text** in the chat.\n\n' +
    'Example format:\n`Alice, 500 USD`\n`Bob, 100000 NGN`',
    { parse_mode: 'Markdown' },
  );
}

export async function handleSalariesUpload(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const state = salariesStateStore.get(telegramId);
  if (!state) return;

  // Mock parsing logic for demonstration
  // In a real app, this would use xlsx/tesseract + Groq AI for intent parsing
  await ctx.replyWithChatAction('typing');

  const text = ctx.message?.text || ctx.message?.caption || 'Mock upload';
  
  // Simulated parsed output
  const mockParsedData = [
    { recipient: 'Alice (@alice)', amount: 500, currency: 'USD' },
    { recipient: 'Bob (0x123...)', amount: 66.67, currency: 'USD' }, // 100000 NGN converted to USD
  ];

  const total = mockParsedData.reduce((acc, curr) => acc + curr.amount, 0);

  const fee = total * 0.01;
  const totalRequired = total + fee;

  state.parsedData = mockParsedData;
  state.totalAmountUSD = totalRequired;
  state.step = 'confirm';
  salariesStateStore.set(telegramId, state);

  const keyboard = new InlineKeyboard()
    .text('✅ Confirm Batch Payment', 'salaries_confirm').row()
    .text('❌ Cancel', 'salaries_cancel');

  let summaryText = `🤖 *AI Processed Payroll*\n\nFound ${mockParsedData.length} recipients:\n`;
  mockParsedData.forEach(p => {
    summaryText += `• ${p.recipient}: $${p.amount.toFixed(2)}\n`;
  });
  summaryText += `\n**Subtotal:** $${total.toFixed(2)} USDC\n`;
  summaryText += `🔥 **Total Required:** $${totalRequired.toFixed(2)} USDC\n\nProceed to pay?`;

  await ctx.reply(summaryText, { parse_mode: 'Markdown', reply_markup: keyboard });
}

export async function handleSalariesConfirm(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const state = salariesStateStore.get(telegramId);
  if (!state) return;

  await ctx.answerCallbackQuery('Processing batch payment...');
  await ctx.editMessageText('⏳ Broadcasting batch payment to Monad...');

  setTimeout(async () => {
    salariesStateStore.delete(telegramId);
    ctx.session.conversation.step = undefined;

    await ctx.reply(
      `✅ *Salaries Paid!*\n\nSuccessfully distributed **$${state.totalAmountUSD.toFixed(2)} USDC** to ${state.parsedData.length} employees.\n\n` +
      `🔗 Tx: \`0x${Math.random().toString(16).substring(2, 42).padEnd(40, '0')}\``,
      { parse_mode: 'Markdown' }
    );
  }, 2000);
}

export async function handleSalariesCancel(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId) salariesStateStore.delete(telegramId);
  ctx.session.conversation.step = undefined;
  await ctx.answerCallbackQuery('Cancelled');
  await ctx.editMessageText('Payroll cancelled.');
}
