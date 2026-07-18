/**
 * api/index.ts — Express REST API for the PayIT web dashboard.
 *
 * This is a READ-MOSTLY companion to the bot.
 * No money-moving actions here — those require the Telegram bot + PIN.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from '../config/env.js';
import { validateMagicLink, requireAuth } from './middleware/magicLink.js';
import { prisma } from '../db/client.js';
import { walletService } from '../services/wallet.service.js';
import { invoiceService } from '../services/invoice.service.js';

export function createApi(): express.Application {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.DASHBOARD_URL, credentials: true }));
  app.use(express.json());

  // ── Auth ───────────────────────────────────────────────────────────────────

  app.get('/auth', validateMagicLink);

  // ── Protected routes ───────────────────────────────────────────────────────

  const api = express.Router();
  api.use(requireAuth);

  // GET /api/me — User profile + wallet overview
  api.get('/me', async (req, res) => {
    try {
      const userId = (req as express.Request & { userId: string }).userId;
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          telegramId: true,
          username: true,
          firstName: true,
          accountType: true,
          activeWallet: true,
          createdAt: true,
          wallets: {
            select: { walletType: true, address: true, cachedBalance: true },
          },
        },
      });
      res.json({ user });
    } catch {
      res.status(500).json({ error: 'Failed to fetch user' });
    }
  });

  // GET /api/invoices — Invoice list
  api.get('/invoices', async (req, res) => {
    try {
      const userId = (req as express.Request & { userId: string }).userId;
      const walletRecord = await walletService.getWallet(userId, 'BUSINESS');
      if (!walletRecord) {
        res.status(404).json({ error: 'Business wallet not found' });
        return;
      }

      const page = parseInt(req.query['page'] as string) || 1;
      const status = req.query['status'] as string | undefined;

      const result = await invoiceService.getInvoices(
        walletRecord.id,
        status as import('@prisma/client').InvoiceStatus | undefined,
        page,
      );
      res.json(result);
    } catch {
      res.status(500).json({ error: 'Failed to fetch invoices' });
    }
  });

  // GET /api/invoices/summary — Ledger summary
  api.get('/invoices/summary', async (req, res) => {
    try {
      const userId = (req as express.Request & { userId: string }).userId;
      const walletRecord = await walletService.getWallet(userId, 'BUSINESS');
      if (!walletRecord) {
        res.status(404).json({ error: 'Business wallet not found' });
        return;
      }

      const monthStr = req.query['month'] as string | undefined;
      const month = monthStr ? new Date(`${monthStr}-01`) : undefined;
      const summary = await invoiceService.getLedgerSummary(walletRecord.id, month);
      res.json(summary);
    } catch {
      res.status(500).json({ error: 'Failed to fetch ledger summary' });
    }
  });

  // GET /api/invoices/export.csv — CSV export
  api.get('/invoices/export.csv', async (req, res) => {
    try {
      const userId = (req as express.Request & { userId: string }).userId;
      const walletRecord = await walletService.getWallet(userId, 'BUSINESS');
      if (!walletRecord) {
        res.status(404).json({ error: 'Business wallet not found' });
        return;
      }

      const csv = await invoiceService.exportCSV(walletRecord.id);
      const filename = `payit-ledger-${new Date().toISOString().slice(0, 10)}.csv`;

      res
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(csv);
    } catch {
      res.status(500).json({ error: 'Failed to export CSV' });
    }
  });

  // GET /api/transactions — Transaction history (paginated)
  api.get('/transactions', async (req, res) => {
    try {
      const userId = (req as express.Request & { userId: string }).userId;
      const walletType = (req.query['walletType'] as string) || 'PERSONAL';
      const page = parseInt(req.query['page'] as string) || 1;
      const pageSize = 20;

      const walletRecord = await walletService.getWallet(userId, walletType as 'PERSONAL' | 'BUSINESS');
      if (!walletRecord) {
        res.status(404).json({ error: 'Wallet not found' });
        return;
      }

      const [transactions, total] = await Promise.all([
        prisma.transaction.findMany({
          where: { walletId: walletRecord.id },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.transaction.count({ where: { walletId: walletRecord.id } }),
      ]);

      res.json({ transactions, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
    } catch {
      res.status(500).json({ error: 'Failed to fetch transactions' });
    }
  });

  // GET /api/balance — On-chain balance
  api.get('/balance', async (req, res) => {
    try {
      const userId = (req as express.Request & { userId: string }).userId;
      const walletType = (req.query['walletType'] as string) || 'PERSONAL';
      const walletRecord = await walletService.getWallet(userId, walletType as 'PERSONAL' | 'BUSINESS');
      if (!walletRecord) {
        res.status(404).json({ error: 'Wallet not found' });
        return;
      }

      const balance = await walletService.getBalance(walletRecord.address);
      res.json({ usdc: balance.usdc, address: walletRecord.address, walletType });
    } catch {
      res.status(500).json({ error: 'Failed to fetch balance' });
    }
  });

  app.use('/api', api);

  // ── Health check ──────────────────────────────────────────────────────────

  app.get('/health', async (_req, res) => {
    const { blockchainService } = await import('../services/blockchain.service.js');
    const chain = await blockchainService.healthCheck();
    res.json({ status: 'ok', monad: chain });
  });

  return app;
}
