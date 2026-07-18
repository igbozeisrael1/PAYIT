/**
 * ai.ts — AI assistant message handler for the bot.
 * Handles natural language messages that aren't commands.
 */

import { InlineKeyboard } from 'grammy';
import { PayITContext } from '../middleware/session.js';
import { aiService } from '../../services/ai.service.js';
import { walletService } from '../../services/wallet.service.js';
import { invoiceService } from '../../services/invoice.service.js';

export async function handleAiMessage(ctx: PayITContext): Promise<void> {
  const userId = ctx.session.userId;
  const text = ctx.message?.text ?? '';

  if (!userId || !text) return;

  if (!aiService.isEnabled) {
    await ctx.reply(
      "I'm not quite sure what you mean. Try using the menu buttons or a command like /send, /balance, or /invoices.",
    );
    return;
  }

  // Show typing indicator
  await ctx.replyWithChatAction('typing');

  const parsed = await aiService.parseIntent(userId, text);

  // Low confidence — ask clarifying question or just reply
  if (parsed.confidence < 0.6 || parsed.intent === 'unknown') {
    const reply = parsed.confirmationText || "I'm not sure what you mean. Try /help for a list of commands.";
    await ctx.reply(reply);
    return;
  }

  // Route to the right handler based on intent
  switch (parsed.intent) {
    case 'checkBalance': {
      const activeWallet = ctx.session.activeWallet;
      const walletRecord = await walletService.getWallet(userId, activeWallet);
      if (!walletRecord) {
        await ctx.reply('Wallet not found.');
        return;
      }
      const balance = await walletService.getBalance(walletRecord.address);
      await ctx.reply(
        `💰 Your ${activeWallet.toLowerCase()} wallet balance:\n\n*$${parseFloat(balance.usdc).toFixed(2)} USDC*`,
        { parse_mode: 'Markdown' },
      );
      break;
    }

    case 'getLedgerSummary': {
      const walletRecord = await walletService.getWallet(userId, 'BUSINESS');
      if (!walletRecord) {
        await ctx.reply('You need a Business wallet to view the ledger. Switch with /switch.');
        return;
      }
      const monthStr = parsed.args['month'] as string | undefined;
      const month = monthStr ? new Date(`${monthStr}-01`) : undefined;
      const summary = await invoiceService.getLedgerSummary(walletRecord.id, month);
      await ctx.reply(
        `📊 *Ledger Summary — ${summary.period}*\n\n` +
        `💰 Revenue: *$${summary.totalRevenue} USDC*\n` +
        `🏛 VAT Collected: $${summary.totalVat}\n` +
        `📊 WHT Withheld: $${summary.totalWht}\n` +
        `📋 Invoices: ${summary.invoiceCount}`,
        { parse_mode: 'Markdown' },
      );
      break;
    }

    case 'getTransactionHistory': {
      // Re-use history command
      const { handleHistoryCommand } = await import('../commands/history.js');
      await handleHistoryCommand(ctx);
      break;
    }

    case 'checkInvoiceStatus': {
      const { handleInvoicesCommand } = await import('../commands/invoice.js');
      await handleInvoicesCommand(ctx);
      break;
    }

    case 'sendMoney': {
      // Pre-fill send flow from AI extracted args
      const amount = parsed.args['amount'] as string | undefined;
      const recipient = parsed.args['recipient'] as string | undefined;

      if (!amount || !recipient) {
        await ctx.reply(
          `I want to help you send money. Could you clarify:\n` +
          `${!amount ? '• How much do you want to send?\n' : ''}` +
          `${!recipient ? '• Who should receive it?\n' : ''}`,
        );
        return;
      }

      // Show confirmation with pre-filled details
      const keyboard = new InlineKeyboard()
        .text('✅ Yes, proceed to send', `ai_send_${encodeURIComponent(amount)}_${encodeURIComponent(recipient)}`)
        .row()
        .text('❌ Cancel', 'ai_cancel');

      await ctx.reply(
        `🤖 I understood:\n\n${parsed.confirmationText}\n\nShall I set this up for you?`,
        { parse_mode: 'Markdown', reply_markup: keyboard },
      );

      // Store as pending AI action
      ctx.session.pendingAiAction = {
        intent: parsed.intent,
        args: parsed.args,
        confirmationText: parsed.confirmationText,
      };
      break;
    }
  }
}
