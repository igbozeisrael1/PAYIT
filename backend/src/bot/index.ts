/**
 * bot/index.ts — PayIT Telegram Bot entry point.
 *
 * Wires together all middleware, commands, and callback query handlers.
 * Uses grammY's Bot class with session management.
 */

import { Bot, session } from 'grammy';
import { env } from '../config/env.js';
import { notificationService } from '../services/notification.service.js';

import { initialSession, PayITContext } from './middleware/session.js';
import { authMiddleware } from './middleware/auth.js';
import { rateLimitMiddleware } from './middleware/rateLimit.js';

// Commands
import { handleStart, handleHelp, handleBalance } from './commands/start.js';
import { handleSendCommand, handleSendStep, handleSendConfirm, handleSendCancel } from './commands/send.js';
import { handleReceiveCommand, handleQRCallback } from './commands/receive.js';
import { handleSwitchCommand, handleSwitchCallback } from './commands/switch.js';
import { handleHistoryCommand, handleHistoryPage } from './commands/history.js';
import {
  handleInvoicesCommand,
  startNewInvoice,
  handleInvoiceStep,
  handleInvoiceSendConfirm,
  handleInvoiceExport,
  handleInvoiceFiat,
} from './commands/invoice.js';

// Handlers
import { handleOnboardingStep, startRestore } from './handlers/onboarding.js';
import { handlePinEntry } from './handlers/pin.js';
import { handleAiMessage } from './handlers/ai.js';

// ─── Bot Setup ────────────────────────────────────────────────────────────────

export function createBot(): Bot<PayITContext> {
  const bot = new Bot<PayITContext>(env.TELEGRAM_BOT_TOKEN);

  // ── Session middleware (in-memory; swap to storage adapter for production)
  bot.use(session({ initial: initialSession }));

  // ── Rate limiting
  bot.use(rateLimitMiddleware);

  // ── Authentication
  bot.use(authMiddleware);

  // ── Setup Telegram Menu Button
  bot.api.setMyCommands([
    { command: 'start', description: 'Main Menu' },
    { command: 'balance', description: 'Check Balance' },
    { command: 'send', description: 'Send Funds' },
    { command: 'receive', description: 'Receive Funds' },
    { command: 'history', description: 'Transaction History' },
    { command: 'switch', description: 'Switch Account (Personal/Business)' },
    { command: 'help', description: 'Get Help' },
  ]).catch(err => console.error('[Bot] Failed to set commands:', err));

  // ── Commands ───────────────────────────────────────────────────────────────

  bot.command('start', handleStart);
  bot.command('help', handleHelp);
  bot.command('balance', handleBalance);
  bot.command('send', handleSendCommand);
  bot.command('receive', handleReceiveCommand);
  bot.command('switch', handleSwitchCommand);
  bot.command('history', handleHistoryCommand);
  bot.command('invoices', handleInvoicesCommand);
  bot.command('restore', startRestore);

  // ── Callback Queries ───────────────────────────────────────────────────────


  bot.callbackQuery(/^type_/, (ctx) => handleOnboardingStep(ctx));

  bot.callbackQuery('action_start_onboarding', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { startOnboarding } = await import('./handlers/onboarding.js');
    return startOnboarding(ctx);
  });

  // Main menu actions
  bot.callbackQuery('action_send', handleSendCommand);
  bot.callbackQuery('action_receive', handleReceiveCommand);
  bot.callbackQuery('action_balance', handleBalance);
  bot.callbackQuery('action_history', handleHistoryCommand);
  bot.callbackQuery('action_invoices', handleInvoicesCommand);
  bot.callbackQuery('action_switch', handleSwitchCommand);

  bot.callbackQuery('action_upgrade_business', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { handleUpgradeToBusiness } = await import('./commands/start.js');
    return handleUpgradeToBusiness(ctx);
  });

  bot.callbackQuery('action_savings', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { handleSavingsCommand } = await import('./commands/savings.js');
    return handleSavingsCommand(ctx);
  });
  bot.callbackQuery(/^savings_/, async (ctx) => {
    if (ctx.callbackQuery?.data === 'savings_confirm') {
      const { handleSavingsConfirm } = await import('./commands/savings.js');
      return handleSavingsConfirm(ctx);
    } else if (ctx.callbackQuery?.data === 'savings_cancel') {
      const { handleSavingsCancel } = await import('./commands/savings.js');
      return handleSavingsCancel(ctx);
    } else {
      const { handleSavingsPlanSelection } = await import('./commands/savings.js');
      return handleSavingsPlanSelection(ctx);
    }
  });

  bot.callbackQuery('action_bills', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { handleBillsCommand } = await import('./commands/bills.js');
    return handleBillsCommand(ctx);
  });
  bot.callbackQuery(/^bills_cat_/, async (ctx) => {
    const { handleBillsCategory } = await import('./commands/bills.js');
    return handleBillsCategory(ctx);
  });

  bot.callbackQuery('action_support', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { handleSupportCommand } = await import('./commands/support.js');
    return handleSupportCommand(ctx);
  });

  bot.callbackQuery('action_faq', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply('❓ *FAQ*\n\n1. What is PayIT? PayIT is a non-custodial crypto wallet.\n2. Are my funds safe? Yes, you own your private keys.', { parse_mode: 'Markdown' });
  });

  bot.callbackQuery('action_salaries', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply('💰 *Salaries (Coming Soon)*\n\nAutomate mass payouts to your employees.', { parse_mode: 'Markdown' });
  });

  bot.callbackQuery('action_settings', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { handleSettingsCommand } = await import('./commands/settings.js');
    return handleSettingsCommand(ctx);
  });
  bot.callbackQuery(/^settings_/, async (ctx) => {
    const { handleSettingsAction } = await import('./commands/settings.js');
    return handleSettingsAction(ctx);
  });

  bot.callbackQuery('action_deposit', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { handleDepositCommand } = await import('./commands/deposit.js');
    return handleDepositCommand(ctx);
  });
  bot.callbackQuery(/^deposit_/, async (ctx) => {
    const { handleDepositOption } = await import('./commands/deposit.js');
    return handleDepositOption(ctx);
  });
  bot.callbackQuery('action_withdraw', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { handleWithdrawCommand } = await import('./commands/withdraw.js');
    return handleWithdrawCommand(ctx);
  });

  // Send flow
  bot.callbackQuery('send_fiat', async (ctx) => {
    const { handleSendCurrency } = await import('./commands/send.js');
    return handleSendCurrency(ctx);
  });
  bot.callbackQuery('send_crypto', async (ctx) => {
    const { handleSendCurrency } = await import('./commands/send.js');
    return handleSendCurrency(ctx);
  });
  bot.callbackQuery('send_confirm', handleSendConfirm);
  bot.callbackQuery('send_cancel', handleSendCancel);

  // Receive / QR
  bot.callbackQuery(/^qr_/, handleQRCallback);

  // Wallet switch
  bot.callbackQuery(/^switch_/, handleSwitchCallback);

  // Salaries flow
  bot.callbackQuery('action_salaries', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { handleSalariesCommand } = await import('./commands/salaries.js');
    return handleSalariesCommand(ctx);
  });
  bot.callbackQuery('salaries_confirm', async (ctx) => {
    const { handleSalariesConfirm } = await import('./commands/salaries.js');
    return handleSalariesConfirm(ctx);
  });
  bot.callbackQuery('salaries_cancel', async (ctx) => {
    const { handleSalariesCancel } = await import('./commands/salaries.js');
    return handleSalariesCancel(ctx);
  });

  // Support flow
  bot.callbackQuery('action_support', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { handleSupportCommand } = await import('./commands/support.js');
    return handleSupportCommand(ctx);
  });
  bot.callbackQuery('action_support_end', async (ctx) => {
    const { handleSupportEnd } = await import('./commands/support.js');
    return handleSupportEnd(ctx);
  });

  // Savings flow
  bot.callbackQuery('action_savings', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { handleSavingsCommand } = await import('./commands/savings.js');
    return handleSavingsCommand(ctx);
  });
  bot.callbackQuery(/^savings_plan_/, async (ctx) => {
    const { handleSavingsPlanSelection } = await import('./commands/savings.js');
    return handleSavingsPlanSelection(ctx);
  });
  bot.callbackQuery('savings_confirm', async (ctx) => {
    const { handleSavingsConfirm } = await import('./commands/savings.js');
    return handleSavingsConfirm(ctx);
  });
  bot.callbackQuery('savings_cancel', async (ctx) => {
    const { handleSavingsCancel } = await import('./commands/savings.js');
    return handleSavingsCancel(ctx);
  });

  // Bills flow
  bot.callbackQuery('action_bills', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { handleBillsCommand } = await import('./commands/bills.js');
    return handleBillsCommand(ctx);
  });
  bot.callbackQuery(/^bills_category_/, async (ctx) => {
    const { handleBillsCategorySelection } = await import('./commands/bills.js');
    return handleBillsCategorySelection(ctx);
  });
  bot.callbackQuery('bills_confirm', async (ctx) => {
    const { handleBillsConfirm } = await import('./commands/bills.js');
    return handleBillsConfirm(ctx);
  });
  bot.callbackQuery('bills_cancel', async (ctx) => {
    const { handleBillsCancel } = await import('./commands/bills.js');
    return handleBillsCancel(ctx);
  });

  // Settings flow
  bot.callbackQuery('action_settings', async (ctx) => {
    await ctx.answerCallbackQuery();
    const { handleSettingsCommand } = await import('./commands/settings.js');
    return handleSettingsCommand(ctx);
  });
  bot.callbackQuery(/^settings_/, async (ctx) => {
    const { handleSettingsAction } = await import('./commands/settings.js');
    return handleSettingsAction(ctx);
  });

  // Invoice flow
  bot.callbackQuery('invoice_new', async (ctx) => {
    await ctx.answerCallbackQuery();
    return startNewInvoice(ctx);
  });
  bot.callbackQuery('invoice_ledger', async (ctx) => {
    await ctx.answerCallbackQuery();
    return handleInvoicesCommand(ctx);
  });
  bot.callbackQuery('invoice_export', handleInvoiceExport);
  bot.callbackQuery(/^invoice_vat_/, handleInvoiceStep);
  bot.callbackQuery(/^invoice_wht_/, handleInvoiceStep);
  bot.callbackQuery(/^invoice_fiat_/, handleInvoiceFiat);
  bot.callbackQuery('invoice_send_confirm', handleInvoiceSendConfirm);
  bot.callbackQuery('invoice_cancel', async (ctx) => {
    await ctx.answerCallbackQuery('Cancelled');
    await ctx.reply('Invoice creation cancelled.');
  });

  bot.callbackQuery(/^invoice_view_/, async (ctx) => {
    const data = ctx.callbackQuery.data;
    const invoiceId = data.replace('invoice_view_', '');
    const { handleInvoiceView } = await import('./commands/invoice.js');
    return handleInvoiceView(ctx, invoiceId);
  });
  bot.callbackQuery(/^invoice_verify_/, async (ctx) => {
    const data = ctx.callbackQuery.data;
    const invoiceId = data.replace('invoice_verify_', '');
    const { handleInvoiceVerify } = await import('./commands/invoice.js');
    return handleInvoiceVerify(ctx, invoiceId);
  });
  bot.callbackQuery(/^history_page_/, async (ctx) => {
    const data = ctx.callbackQuery.data;
    const page = parseInt(data.replace('history_page_', ''));
    if (!isNaN(page)) return handleHistoryPage(ctx, page);
  });

  // AI action callbacks
  bot.callbackQuery('ai_cancel', async (ctx) => {
    ctx.session.pendingAiAction = undefined;
    await ctx.answerCallbackQuery('Cancelled');
    await ctx.editMessageText('Action cancelled.');
  });

  // ── Keyboard routing ──────────────────────────────────────────────────────

  bot.hears('💰 Balance', async (ctx) => {
    const { handleBalance } = await import('./commands/start.js');
    return handleBalance(ctx);
  });
  bot.hears('💸 Send', async (ctx) => {
    const { handleSendCommand } = await import('./commands/send.js');
    return handleSendCommand(ctx);
  });
  bot.hears('🏦 Deposit', async (ctx) => {
    const { handleDepositCommand } = await import('./commands/deposit.js');
    return handleDepositCommand(ctx);
  });
  bot.hears('🏦 Savings', async (ctx) => {
    const { handleSavingsCommand } = await import('./commands/savings.js');
    return handleSavingsCommand(ctx);
  });
  bot.hears('💳 Pay Bills', async (ctx) => {
    const { handleBillsCommand } = await import('./commands/bills.js');
    return handleBillsCommand(ctx);
  });
  bot.hears('📋 History', async (ctx) => {
    const { handleHistoryCommand } = await import('./commands/history.js');
    return handleHistoryCommand(ctx);
  });
  bot.hears('⚙️ Settings', async (ctx) => {
    const { handleSettingsCommand } = await import('./commands/settings.js');
    return handleSettingsCommand(ctx);
  });
  bot.hears('🎧 Support', async (ctx) => {
    const { handleSupportCommand } = await import('./commands/support.js');
    return handleSupportCommand(ctx);
  });
  bot.hears('❓ FAQ', async (ctx) => {
    const { handleFaqCommand } = await import('./commands/faq.js').catch(() => ({ handleFaqCommand: async (c: any) => c.reply('FAQ coming soon!') }));
    return handleFaqCommand(ctx);
  });
  
  // Business specific
  bot.hears('📥 Receive', async (ctx) => {
    const { handleReceiveCommand } = await import('./commands/receive.js');
    return handleReceiveCommand(ctx);
  });
  bot.hears('🧾 Invoices', async (ctx) => {
    const { handleInvoicesCommand } = await import('./commands/invoice.js');
    return handleInvoicesCommand(ctx);
  });
  bot.hears('📦 Pay Salaries', async (ctx) => {
    const { handleSalariesCommand } = await import('./commands/salaries.js');
    return handleSalariesCommand(ctx);
  });

  // Switch accounts
  bot.hears('💼 Switch to Business Account', async (ctx) => {
    const { handleSwitchCommand } = await import('./commands/switch.js');
    return handleSwitchCommand(ctx);
  });
  bot.hears('💼 Upgrade to Business', async (ctx) => {
    const { handleUpgradeToBusiness } = await import('./commands/start.js');
    return handleUpgradeToBusiness(ctx);
  });
  bot.hears('👤 Switch to Personal Account', async (ctx) => {
    const { handleSwitchCommand } = await import('./commands/switch.js');
    return handleSwitchCommand(ctx);
  });

  // ── Message router ────────────────────────────────────────────────────────

  bot.on('message:text', async (ctx) => {
    const step = ctx.session.conversation.step;
    const text = ctx.message.text;

    // During onboarding
    if (step && step.startsWith('type_')) return handleOnboardingStep(ctx);

    // During send flow
    if (step === 'send_amount' || step === 'send_recipient') return handleSendStep(ctx);

    // During salaries flow
    if (step === 'salaries_upload') {
      const { handleSalariesUpload } = await import('./commands/salaries.js');
      return handleSalariesUpload(ctx);
    }

    // During savings flow
    if (step === 'savings_amount') {
      const { handleSavingsAmount } = await import('./commands/savings.js');
      return handleSavingsAmount(ctx, text);
    }

    // During bills flow
    if (step === 'bills_biller') {
      const { handleBillsBiller } = await import('./commands/bills.js');
      return handleBillsBiller(ctx, text);
    }
    if (step === 'bills_amount') {
      const { handleBillsAmount } = await import('./commands/bills.js');
      return handleBillsAmount(ctx, text);
    }

    // During support chat
    if (step === 'support_chat') {
      const { handleSupportMessage } = await import('./commands/support.js');
      return handleSupportMessage(ctx);
    }

    // During invoice creation
    if (step && step.startsWith('invoice_')) return handleInvoiceStep(ctx);

    // During restore flow
    if (step && step.startsWith('restore_')) return handleOnboardingStep(ctx);

    // During onboarding
    if (
      step === 'set_pin' ||
      step === 'confirm_pin' ||
      step === 'verify_mnemonic' ||
      step?.startsWith('bus_')
    ) {
      return handleOnboardingStep(ctx);
    }

    // PIN entry (awaiting PIN for any money action)
    if (step === 'awaiting_pin') return handlePinEntry(ctx, text);

    // Fall through to AI assistant for registered users
    if (ctx.session.onboarded) return handleAiMessage(ctx);
  });

  // ── Photo Handler ─────────────────────────────────────────────────────────

  bot.on('message:photo', async (ctx) => {
    // If they are in salaries flow, route there
    if (ctx.session.conversation.step === 'salaries_upload') {
      const { handleSalariesUpload } = await import('./commands/salaries.js');
      return handleSalariesUpload(ctx);
    }
    
    // If they are in business onboarding, they might send a logo photo
    if (ctx.session.conversation.step === 'bus_logo') {
      const { handleOnboardingStep } = await import('./handlers/onboarding.js');
      return handleOnboardingStep(ctx);
    }

    // Fall through to AI Vision assistant for registered users
    if (ctx.session.onboarded) {
      const { handleAiVisionMessage } = await import('./handlers/ai.js');
      return handleAiVisionMessage(ctx);
    }
  });

  // ── Document Handler ──────────────────────────────────────────────────────

  bot.on('message:document', async (ctx) => {
    // If they are in salaries flow, route there
    if (ctx.session.conversation.step === 'salaries_upload') {
      const { handleSalariesUpload } = await import('./commands/salaries.js');
      return handleSalariesUpload(ctx);
    }

    // Fall through to AI Document assistant for registered users
    if (ctx.session.onboarded) {
      const { handleAiDocumentMessage } = await import('./handlers/ai.js');
      return handleAiDocumentMessage(ctx);
    }
  });

  // ── Error handler ─────────────────────────────────────────────────────────

  bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`[Bot] Error handling update ${ctx.update.update_id}:`, err.error);
    ctx.reply('⚠️ Something went wrong. Please try again.').catch(() => {});
  });

  // Inject bot into notification service
  notificationService.setBot(bot);

  return bot;
}
