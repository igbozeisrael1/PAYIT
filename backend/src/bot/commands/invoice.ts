/**
 * invoice.ts — Invoice management bot commands.
 * Only accessible from Business wallet context.
 */

import { InlineKeyboard, InputFile } from 'grammy';
import { InvoiceStatus, WalletType } from '@prisma/client';
import { PayITContext } from '../middleware/session.js';
import { walletService } from '../../services/wallet.service.js';
import { invoiceService } from '../../services/invoice.service.js';
import QRCode from 'qrcode';
import { taxService, WHT_CATEGORIES, WhtCategoryId } from '../../services/tax.service.js';
import { ethers } from 'ethers';

// ─── Invoice List ─────────────────────────────────────────────────────────────

export async function handleInvoicesCommand(ctx: PayITContext): Promise<void> {
  const userId = ctx.session.userId;
  if (!userId) return;

  if (ctx.session.activeWallet !== WalletType.BUSINESS) {
    await ctx.reply(
      '🔒 Invoices are only available in the *Business* wallet.\n\nSwitch with /switch',
      { parse_mode: 'Markdown' },
    );
    return;
  }

  const walletRecord = await walletService.getWallet(userId, WalletType.BUSINESS);
  if (!walletRecord) {
    await ctx.reply('Business wallet not found. Please contact support.');
    return;
  }

  const { invoices, total } = await invoiceService.getInvoices(walletRecord.id);
  const summary = await invoiceService.getLedgerSummary(walletRecord.id);

  const keyboard = new InlineKeyboard()
    .text('➕ New Invoice', 'invoice_new').row()
    .text('📊 Ledger Summary', 'invoice_ledger').row()
    .text('📤 Export CSV', 'invoice_export');

  const statusEmoji: Record<InvoiceStatus, string> = {
    DRAFT: '📝',
    SENT: '📨',
    PAID: '✅',
    OVERDUE: '⚠️',
    CANCELLED: '❌',
  };

  let invoiceList = '';
  if (invoices.length === 0) {
    invoiceList = '_No invoices yet. Create your first one!_';
  } else {
    invoiceList = invoices
      .slice(0, 5)
      .map((inv) => {
        const fmt = (raw: string) => (Number(BigInt(raw)) / 1_000_000).toFixed(2);
        return `${statusEmoji[inv.status]} *${inv.clientName}* — $${fmt(inv.total)} — ${inv.status}`;
      })
      .join('\n');
    if (total > 5) invoiceList += `\n_...and ${total - 5} more_`;
  }

  await ctx.reply(
    `🧾 *Invoice Ledger*\n\n` +
    `💰 Revenue: *$${summary.totalRevenue} USDC*\n` +
    `🏛 VAT Collected: $${summary.totalVat}\n` +
    `📊 WHT Withheld: $${summary.totalWht}\n` +
    `📋 Total Invoices: ${summary.invoiceCount}\n\n` +
    `*Recent Invoices:*\n${invoiceList}`,
    { parse_mode: 'Markdown', reply_markup: keyboard },
  );
}

// ─── New Invoice Flow ─────────────────────────────────────────────────────────

interface InvoiceState {
  step: 'client' | 'items' | 'tax' | 'wht' | 'confirm';
  clientName: string;
  clientEmail: string;
  lineItems: Array<{ description: string; quantity: number; unitPrice: number }>;
  vatEnabled: boolean;
  whtCategoryId: WhtCategoryId;
}

const invoiceStateStore = new Map<number, InvoiceState>();

export async function startNewInvoice(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  invoiceStateStore.set(telegramId, {
    step: 'client',
    clientName: '',
    clientEmail: '',
    lineItems: [],
    vatEnabled: false,
    whtCategoryId: 'none',
  });
  ctx.session.conversation.step = 'invoice_client';

  await ctx.reply(
    '🧾 *New Invoice*\n\nStep 1/4: Who is this invoice for?\n\nEnter the client\'s name (and optionally email, separated by comma):\nExample: `Acme Corp` or `Acme Corp, billing@acme.com`',
    { parse_mode: 'Markdown' },
  );
}

export async function handleInvoiceStep(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const step = ctx.session.conversation.step;
  const text = ctx.message?.text?.trim() ?? '';

  switch (step) {
    case 'invoice_client': return handleInvoiceClient(ctx, text);
    case 'invoice_items': return handleInvoiceItems(ctx, text);
    case 'invoice_tax': return handleInvoiceTax(ctx);
    case 'invoice_wht': return handleInvoiceWht(ctx);
  }
}

async function handleInvoiceClient(ctx: PayITContext, input: string): Promise<void> {
  const telegramId = ctx.from!.id;
  const state = invoiceStateStore.get(telegramId);
  if (!state) return;

  const parts = input.split(',').map((p) => p.trim());
  state.clientName = parts[0] ?? input;
  state.clientEmail = parts[1] ?? '';
  state.step = 'items';
  ctx.session.conversation.step = 'invoice_items';

  await ctx.reply(
    `✅ Client: *${state.clientName}*\n\n` +
    `Step 2/4: Add line items.\n\n` +
    `Enter each item on a new line in format:\n\`Description, Quantity, Unit Price\`\n\n` +
    `Example:\n\`Website Design, 1, 500\`\n\`Consulting, 5, 100\`\n\n` +
    `Send all items at once, then type "done" on a new line.`,
    { parse_mode: 'Markdown' },
  );
}

async function handleInvoiceItems(ctx: PayITContext, input: string): Promise<void> {
  const telegramId = ctx.from!.id;
  const state = invoiceStateStore.get(telegramId);
  if (!state) return;

  const lines = input.split('\n').filter((l) => l.trim() && l.toLowerCase() !== 'done');
  const items: Array<{ description: string; quantity: number; unitPrice: number }> = [];

  for (const line of lines) {
    const parts = line.split(',').map((p) => p.trim());
    if (parts.length < 3) {
      await ctx.reply(
        `❌ Couldn't parse: "${line}"\n\nUse format: \`Description, Quantity, Unit Price\``,
        { parse_mode: 'Markdown' },
      );
      return;
    }
    const quantity = parseFloat(parts[1]!);
    const unitPrice = parseFloat(parts[2]!);
    if (isNaN(quantity) || isNaN(unitPrice) || quantity <= 0 || unitPrice <= 0) {
      await ctx.reply(`❌ Invalid quantity or price in: "${line}"`);
      return;
    }
    items.push({ description: parts[0]!, quantity, unitPrice });
  }

  if (items.length === 0) {
    await ctx.reply('Please add at least one line item.');
    return;
  }

  state.lineItems = items;
  state.step = 'tax';
  ctx.session.conversation.step = 'invoice_tax';

  const keyboard = new InlineKeyboard()
    .text('✅ Yes, Apply VAT (7.5%)', 'invoice_vat_yes')
    .text('❌ No VAT', 'invoice_vat_no');

  const itemSummary = items
    .map((i) => `• ${i.description}: ${i.quantity} × $${i.unitPrice.toFixed(2)}`)
    .join('\n');

  await ctx.reply(
    `✅ *${items.length} item(s) added:*\n${itemSummary}\n\nStep 3/4: Apply VAT?`,
    { parse_mode: 'Markdown', reply_markup: keyboard },
  );
}

async function handleInvoiceTax(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const state = invoiceStateStore.get(telegramId);
  if (!state) return;

  const data = ctx.callbackQuery?.data ?? '';
  state.vatEnabled = data === 'invoice_vat_yes';
  state.step = 'wht';
  ctx.session.conversation.step = 'invoice_wht';

  await ctx.answerCallbackQuery();

  // Build WHT category keyboard
  const keyboard = new InlineKeyboard();
  WHT_CATEGORIES.forEach((cat) => {
    keyboard.text(cat.label.split(' (')[0]!, `invoice_wht_${cat.id}`).row();
  });

  await ctx.reply(
    'Step 4/4: Select WHT category (Withholding Tax):',
    { reply_markup: keyboard },
  );
}

async function handleInvoiceWht(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const state = invoiceStateStore.get(telegramId);
  if (!state) return;

  const data = ctx.callbackQuery?.data ?? '';
  const categoryId = data.replace('invoice_wht_', '') as WhtCategoryId;

  const validIds = WHT_CATEGORIES.map((c) => c.id);
  if (!validIds.includes(categoryId)) return;

  state.whtCategoryId = categoryId;
  await ctx.answerCallbackQuery();

  // Calculate breakdown
  const breakdown = taxService.calculate(state.lineItems, state.vatEnabled, categoryId);
  const breakdownText = taxService.formatBreakdown(breakdown);

  const keyboard = new InlineKeyboard()
    .text('✅ Send Invoice', 'invoice_send_confirm')
    .text('❌ Cancel', 'invoice_cancel');

  await ctx.reply(
    `${breakdownText}\n\n*Client: ${state.clientName}*\n\nConfirm and send?`,
    { parse_mode: 'Markdown', reply_markup: keyboard },
  );
}

export async function handleInvoiceSendConfirm(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  const userId = ctx.session.userId;
  if (!telegramId || !userId) return;

  const state = invoiceStateStore.get(telegramId);
  if (!state) {
    await ctx.answerCallbackQuery('Invoice session expired');
    return;
  }

  await ctx.answerCallbackQuery('Creating invoice...');
  await ctx.reply('⏳ Publishing invoice to Monad...');

  try {
    const walletRecord = await walletService.getWallet(userId, WalletType.BUSINESS);
    if (!walletRecord) throw new Error('Business wallet not found');

    const { invoice, breakdown } = await invoiceService.createInvoice({
      walletId: walletRecord.id,
      businessAddress: walletRecord.address,
      clientName: state.clientName,
      clientEmail: state.clientEmail || undefined,
      lineItems: state.lineItems,
      vatEnabled: state.vatEnabled,
      whtCategoryId: state.whtCategoryId,
    });

    invoiceStateStore.delete(telegramId);
    ctx.session.conversation.step = undefined;

    // Real Wallet Address for this specific invoice
    const invoiceWallet = ethers.Wallet.createRandom();
    const realAddress = invoiceWallet.address;
    const mockFiatAccount = `9${Math.floor(Math.random() * 100000000).toString().padEnd(9, '0')}`;

    // Generate QR code for the payment link
    const qrBuffer = await QRCode.toBuffer(invoice.paymentLink, {
      color: { dark: '#000000', light: '#ffffff' },
      width: 300,
    });

    const caption = `✅ *Invoice Created!*\n\n` +
      `Client: *${state.clientName}*\n` +
      `Total: *$${breakdown.total} USDC*\n\n` +
      `💳 *Payment Options for Client:*\n` +
      `1. **Crypto (USDC):** \`${realAddress}\`\n` +
      `2. **Bank Transfer (Naira):** \n   Bank: Wema Bank\n   Account: \`${mockFiatAccount}\`\n\n` +
      `📤 Payment link:\n${invoice.paymentLink}`;

    await ctx.replyWithPhoto(new InputFile(qrBuffer, 'invoice_qr.png'), {
      caption,
      parse_mode: 'Markdown',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    invoiceStateStore.delete(telegramId);
    ctx.session.conversation.step = undefined;
    await ctx.reply(`❌ Failed to create invoice: ${message}`);
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────

export async function handleInvoiceExport(ctx: PayITContext): Promise<void> {
  const userId = ctx.session.userId;
  if (!userId) return;

  const walletRecord = await walletService.getWallet(userId, WalletType.BUSINESS);
  if (!walletRecord) return;

  await ctx.answerCallbackQuery('Generating CSV...');

  const csv = await invoiceService.exportCSV(walletRecord.id);
  const filename = `payit-ledger-${new Date().toISOString().slice(0, 10)}.csv`;

  await ctx.replyWithDocument(
    new InputFile(Buffer.from(csv, 'utf-8'), filename),
    { caption: '📊 Your complete invoice ledger export.' },
  );
}
