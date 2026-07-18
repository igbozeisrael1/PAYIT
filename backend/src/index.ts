/**
 * src/index.ts — PayIT Backend Entry Point
 *
 * Starts:
 *  1. The Telegram bot (polling or webhook mode)
 *  2. The Express API server
 *  3. Background cron jobs (escrow sweep, overdue invoice detection)
 */

import { env } from './config/env.js';
import { createBot } from './bot/index.js';
import { createApi } from './api/index.js';
import { escrowService } from './services/escrow.service.js';
import { invoiceService } from './services/invoice.service.js';
import cron from 'node-cron';
import pino from 'pino';

const logger = pino({
  level: env.NODE_ENV === 'development' ? 'debug' : 'info',
  transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});

async function main(): Promise<void> {
  logger.info({ nodeEnv: env.NODE_ENV, chainId: env.MONAD_CHAIN_ID }, '🚀 PayIT starting...');

  // ── Create bot ────────────────────────────────────────────────────────────
  const bot = createBot();

  // ── Create Express API ────────────────────────────────────────────────────
  const api = createApi();

  // ── Start API server ──────────────────────────────────────────────────────
  api.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, `📡 API server listening`);
  });

  // ── Start bot ─────────────────────────────────────────────────────────────
  if (env.BOT_WEBHOOK_URL) {
    // Production: webhook mode
    logger.info('📡 Starting bot in webhook mode...');
    await bot.api.setWebhook(env.BOT_WEBHOOK_URL);
    logger.info({ webhookUrl: env.BOT_WEBHOOK_URL }, '✅ Webhook set');
  } else {
    // Development: long polling
    logger.info('🔄 Starting bot in polling mode...');
    bot.start({
      onStart: (botInfo) => {
        logger.info({ username: botInfo.username }, '✅ Bot started');
      },
    });
  }

  // ── Cron jobs ─────────────────────────────────────────────────────────────

  // Every day at 2am: sweep expired escrow deposits
  cron.schedule('0 2 * * *', async () => {
    logger.info('[Cron] Running escrow sweep...');
    try {
      await escrowService.sweepExpiredDeposits();
    } catch (err) {
      logger.error({ err }, '[Cron] Escrow sweep failed');
    }
  });

  // Every day at 9am: mark overdue invoices
  cron.schedule('0 9 * * *', async () => {
    logger.info('[Cron] Processing overdue invoices...');
    try {
      const overdueIds = await invoiceService.processOverdueInvoices();
      if (overdueIds.length > 0) {
        logger.info({ count: overdueIds.length }, '[Cron] Marked invoices as overdue');
      }
    } catch (err) {
      logger.error({ err }, '[Cron] Overdue invoice processing failed');
    }
  });

  logger.info('✅ PayIT fully started');
}

// ── Graceful shutdown ──────────────────────────────────────────────────────

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received — shutting down...');
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received — shutting down...');
  process.exit(0);
});

main().catch((err) => {
  logger.error({ err }, '❌ Fatal startup error');
  process.exit(1);
});
