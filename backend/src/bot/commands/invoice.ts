/**
 * invoice.ts — Invoice management bot commands.
 * Only accessible from Business wallet context.
 */

import { InlineKeyboard, InputFile } from 'grammy';
import { InvoiceStatus, WalletType } from '@prisma/client';
import { prisma } from '../../db/client.js';
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

  const statusEmoji: Record<InvoiceStatus, string> = {
    DRAFT: '📝',
    SENT: '📨',
    PARTIAL: '⏳',
    PAID: '✅',
    OVERDUE: '⚠️',
    CANCELLED: '❌',
  };

  const keyboard = new InlineKeyboard();

  let invoiceList = '';
  if (invoices.length === 0) {
    invoiceList = '_No invoices yet. Create your first one!_';
  } else {
    invoiceList = 'Click an invoice below to view details and verify payments:';
    invoices.slice(0, 5).forEach((inv) => {
      const fmt = (raw: string) => (Number(BigInt(raw)) / 1_000_000).toFixed(2);
      keyboard.text(`${statusEmoji[inv.status]} ${inv.clientName} - $${fmt(inv.total)}`, `invoice_view_${inv.id}`).row();
    });
    if (total > 5) invoiceList += `\n_...and ${total - 5} more_`;
  }

  keyboard.text('➕ New Invoice', 'invoice_new').row()
          .text('📊 Ledger Summary', 'invoice_ledger').row()
          .text('📤 Export CSV', 'invoice_export');

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
  step: 'client' | 'items' | 'tax' | 'wht' | 'fiat' | 'confirm';
  clientName: string;
  clientEmail: string;
  lineItems: Array<{ description: string; quantity: number; unitPrice: number }>;
  vatEnabled: boolean;
  whtCategoryId: WhtCategoryId;
  fiatCurrency: string;
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
    fiatCurrency: 'USD',
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

  state.step = 'fiat';
  ctx.session.conversation.step = 'invoice_fiat';

  const keyboard = new InlineKeyboard()
    .text('🇳🇬 Naira (NGN)', 'invoice_fiat_NGN').row()
    .text('🇺🇸 US Dollar (USD)', 'invoice_fiat_USD').row()
    .text('🇪🇺 Euro (EUR)', 'invoice_fiat_EUR').row()
    .text('🇬🇧 Brit Pound (GBP)', 'invoice_fiat_GBP');

  await ctx.reply(
    'Step 5/5: In which currency will your client pay via Bank Transfer?',
    { reply_markup: keyboard },
  );
}

export async function handleInvoiceFiat(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const state = invoiceStateStore.get(telegramId);
  if (!state) return;

  const data = ctx.callbackQuery?.data ?? '';
  const currency = data.replace('invoice_fiat_', '');
  
  if (!['NGN', 'USD', 'EUR', 'GBP'].includes(currency)) return;

  state.fiatCurrency = currency;
  await ctx.answerCallbackQuery();

  // Calculate breakdown
  const breakdown = taxService.calculate(state.lineItems, state.vatEnabled, state.whtCategoryId);
  const breakdownText = taxService.formatBreakdown(breakdown);

  const keyboard = new InlineKeyboard()
    .text('✅ Send Invoice', 'invoice_send_confirm')
    .text('❌ Cancel', 'invoice_cancel');

  await ctx.reply(
    `${breakdownText}\n\n*Client: ${state.clientName}*\n*Fiat Currency:* ${state.fiatCurrency}\n\nConfirm and send?`,
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
  await ctx.answerCallbackQuery();

  const { requestPin } = await import('../handlers/pin.js');

  await requestPin(
    ctx,
    WalletType.BUSINESS,
    'Create Invoice',
    async (pinCtx, _signer) => {
      await pinCtx.reply('⏳ Generating secure invoice address on Monad...');

      const pin = pinCtx.message?.text?.trim() || '';
      
      try {
        const walletRecord = await walletService.getWallet(userId, WalletType.BUSINESS);
        if (!walletRecord) throw new Error('Business wallet not found');

        // Derive Real HD Wallet Address for this specific invoice
        const realAddress = await walletService.deriveNextInvoiceAddress(userId, pin, WalletType.BUSINESS);

        const { invoice, breakdown } = await invoiceService.createInvoice({
          walletId: walletRecord.id,
          businessAddress: walletRecord.address,
          clientName: state.clientName,
          clientEmail: state.clientEmail || undefined,
          lineItems: state.lineItems,
          vatEnabled: state.vatEnabled,
          whtCategoryId: state.whtCategoryId,
          depositAddress: realAddress,
        });

        invoiceStateStore.delete(telegramId);
        ctx.session.conversation.step = undefined;

        const mockFiatAccount = `9${Math.floor(Math.random() * 100000000).toString().padEnd(9, '0')}`;

        // Generate Invoice Image using Groq and Sharp
        await pinCtx.reply('🎨 Generating professional invoice receipt...');
        
        const { generateInvoiceImage } = await import('../../services/ai.service.js');
        const { prisma } = await import('../../db/client.js');
        const user = await prisma.user.findUnique({ where: { id: userId } });
        
        const imageBuffer = await generateInvoiceImage({
          businessName: user?.businessName || user?.username || 'Your Business',
          businessLogo: user?.businessLogo,
          businessAddress: user?.businessAddress,
          businessEmail: user?.businessEmail,
          clientName: state.clientName,
          invoiceId: invoice.id.toString().substring(0, 8).toUpperCase(),
          totalAmount: breakdown.total,
          depositAddress: realAddress,
          items: state.lineItems,
          fiatCurrency: state.fiatCurrency,
          fiatAccountNumber: mockFiatAccount,
        });

        const caption = `✅ *Invoice Created!*\n\n` +
          `Client: *${state.clientName}*\n` +
          `Total: *$${breakdown.total} USDC*\n\n` +
          `💳 *Payment Options for Client:*\n` +
          `1. **Crypto (USDC):** \`${realAddress}\`\n` +
          `2. **Bank Transfer (${state.fiatCurrency}):** \n   Bank: Test Bank\n   Account: \`${mockFiatAccount}\`\n\n` +
          `📤 Payment link:\n${invoice.paymentLink}`;

        await pinCtx.replyWithPhoto(new InputFile(imageBuffer, `Invoice_${invoice.id}.png`), {
          caption,
          parse_mode: 'Markdown',
        });

      } catch (error: any) {
        console.error('[Invoice] Generate error:', error);
        await pinCtx.reply(`❌ Failed to create invoice: ${error.message}`);
      }
    }
  );
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

// ─── Verification & View ────────────────────────────────────────────────────────

export async function handleInvoiceView(ctx: PayITContext, invoiceId: string): Promise<void> {
  const { prisma } = await import('../../db/client.js');
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) {
    await ctx.answerCallbackQuery('Invoice not found.');
    return;
  }

  const fmt = (raw: string) => (Number(BigInt(raw)) / 1_000_000).toFixed(2);
  const statusEmoji: Record<string, string> = { DRAFT: '📝', SENT: '📨', PAID: '✅', OVERDUE: '⚠️', CANCELLED: '❌' };

  let text = `🧾 *Invoice Details*\n\n` +
    `*Client:* ${invoice.clientName}\n` +
    `*Total:* $${fmt(invoice.total)} USDC\n` +
    `*Status:* ${statusEmoji[invoice.status]} ${invoice.status}\n\n`;

  if (invoice.depositAddress) {
    text += `*Deposit Address:*\n\`${invoice.depositAddress}\`\n\n`;
  }

  const keyboard = new InlineKeyboard();
  if (invoice.status === 'SENT' || invoice.status === 'PARTIAL') {
    keyboard.text('🔄 Verify Payment', `invoice_verify_${invoice.id}`).row();
  }
  keyboard.text('🔙 Back to Invoices', 'invoice_ledger');

  await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

export async function handleInvoiceVerify(ctx: PayITContext, invoiceId: string): Promise<void> {
  const { prisma } = await import('../../db/client.js');
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { wallet: true } });
  if (!invoice || (invoice.status !== 'SENT' && invoice.status !== 'PARTIAL') || !invoice.depositAddress) {
    await ctx.answerCallbackQuery('Cannot verify this invoice.');
    return;
  }

  const userId = ctx.session.userId;
  if (!userId) return;

  await ctx.answerCallbackQuery('Checking blockchain for payment...');

  try {
    const { requestPin } = await import('../handlers/pin.js');
    await requestPin(ctx, WalletType.BUSINESS, 'Verify Payment', async (pinCtx, _signer) => {
      await pinCtx.reply('🔄 Checking deposit address balance on Monad...');
      
      const pin = pinCtx.message?.text?.trim() || '';
      const invoiceSigner = await walletService.findInvoiceSigner(
        userId,
        pin,
        WalletType.BUSINESS,
        invoice.depositAddress!,
        invoice.wallet.invoiceCount + 5
      );

      if (!invoiceSigner) {
        await pinCtx.reply('❌ Could not find the cryptographic key for this invoice.');
        return;
      }

      const balance = await walletService.getBalance(invoice.depositAddress!);
      const currentBalanceRaw = balance.usdcRaw;
      const totalRequiredRaw = BigInt(invoice.total);
      const previouslyPaidRaw = BigInt(invoice.amountPaid);

      if (currentBalanceRaw === 0n) {
        await pinCtx.reply(`❌ No payment received yet. Expected: $${(Number(totalRequiredRaw)/1e6).toFixed(2)} USDC.`);
        return;
      }

      if (currentBalanceRaw === previouslyPaidRaw && currentBalanceRaw < totalRequiredRaw) {
        await pinCtx.reply(`ℹ️ No new payments detected. Accumulated balance is still $${balance.usdc} USDC.`);
        return;
      }

      if (currentBalanceRaw < totalRequiredRaw) {
        // Partial Payment
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { 
            status: 'PARTIAL',
            amountPaid: currentBalanceRaw.toString() 
          }
        });
        await pinCtx.reply(`⚠️ **Partial Payment Detected!**\n\nReceived: *$${balance.usdc} USDC*\nRequired: *$${(Number(totalRequiredRaw)/1e6).toFixed(2)} USDC*\n\nThe invoice has been marked as **Incomplete**. Funds will be swept once the full amount is reached.`, { parse_mode: 'Markdown' });
      } else {
        // Full or Overpayment
        let sweepMessage = '';
        if (currentBalanceRaw > totalRequiredRaw) {
          const over = currentBalanceRaw - totalRequiredRaw;
          sweepMessage = `🚨 **Overpayment Detected!**\n\nReceived: *$${balance.usdc} USDC* (Overpaid by $${(Number(over)/1e6).toFixed(2)} USDC)\nSweeping the entire $${balance.usdc} USDC to your main wallet...`;
        } else {
          sweepMessage = `✅ **Exact Payment Detected!**\n\nSweeping $${balance.usdc} USDC to main wallet...`;
        }

        await pinCtx.reply(sweepMessage, { parse_mode: 'Markdown' });

        try {
          const { blockchainService } = await import('../../services/blockchain.service.js');
          const tx = await blockchainService.sendUSDC(invoiceSigner, invoice.wallet.address, currentBalanceRaw);
          
          await prisma.invoice.update({
            where: { id: invoice.id },
            data: { 
              status: 'PAID',
              amountPaid: currentBalanceRaw.toString() 
            }
          });
          
          await invoiceService.markPaid(invoice.onchainInvoiceId!, tx.hash);
          await pinCtx.reply(`🎉 Invoice Paid & Funds Swept!\nTx: \`${tx.hash}\``, { parse_mode: 'Markdown' });
        } catch (e: any) {
          console.error('[Sweep Error]', e);
          await pinCtx.reply(`⚠️ Payment detected, but sweeping failed: ${e.message}. You may need MON gas in the deposit address.`);
        }
      }
    });
  } catch (err: any) {
    console.error('[Verify] Error:', err);
    await ctx.reply(`❌ Verification failed: ${err.message}`);
  }
}
