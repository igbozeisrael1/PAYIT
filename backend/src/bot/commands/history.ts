/**
 * history.ts — Transaction history command.
 */

import { InlineKeyboard } from 'grammy';
import { TransactionType } from '@prisma/client';
import { PayITContext } from '../middleware/session.js';
import { walletService } from '../../services/wallet.service.js';
import { prisma } from '../../db/client.js';

const TYPE_EMOJI: Record<TransactionType, string> = {
  SEND: '💸',
  RECEIVE: '📥',
  DEPOSIT: '🏦',
  WITHDRAWAL: '💵',
  INVOICE_PAID: '🧾',
  ESCROW_LOCKED: '🔒',
  ESCROW_CLAIMED: '🔓',
  ESCROW_REFUNDED: '↩️',
};

export async function handleHistoryCommand(ctx: PayITContext): Promise<void> {
  const userId = ctx.session.userId;
  if (!userId) return;

  const activeWallet = ctx.session.activeWallet;
  const walletRecord = await walletService.getWallet(userId, activeWallet);
  if (!walletRecord) {
    await ctx.reply('No wallet found.');
    return;
  }

  const transactions = await prisma.transaction.findMany({
    where: { walletId: walletRecord.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  const total = await prisma.transaction.count({ where: { walletId: walletRecord.id } });

  if (transactions.length === 0) {
    await ctx.reply('No transactions yet. Send or receive USDC to get started!');
    return;
  }

  const fmt = (raw: string) => (Number(BigInt(raw)) / 1_000_000).toFixed(2);
  const fmtDate = (d: Date) => d.toLocaleDateString('en-NG', { day: '2-digit', month: 'short' });

  const lines = transactions.map((tx) => {
    const emoji = TYPE_EMOJI[tx.type] ?? '•';
    const sign = ['SEND', 'ESCROW_LOCKED', 'WITHDRAWAL'].includes(tx.type) ? '-' : '+';
    return `${emoji} ${fmtDate(tx.createdAt)} | ${sign}$${fmt(tx.amount)} | ${tx.counterpartyRef ?? tx.type} | ${tx.status}`;
  });

  const walletLabel = activeWallet === 'PERSONAL' ? '👤 Personal' : '💼 Business';
  const keyboard = new InlineKeyboard();
  if (total > 10) {
    keyboard.text('📜 Load More', 'history_page_2');
  }

  await ctx.reply(
    `📜 *${walletLabel} Transaction History*\n\n` +
    `\`\`\`\n${lines.join('\n')}\n\`\`\`\n\n` +
    `Showing 10 of ${total} transactions`,
    { parse_mode: 'Markdown', reply_markup: total > 10 ? keyboard : undefined },
  );
}

export async function handleHistoryPage(ctx: PayITContext, page: number): Promise<void> {
  const userId = ctx.session.userId;
  if (!userId) return;

  const activeWallet = ctx.session.activeWallet;
  const walletRecord = await walletService.getWallet(userId, activeWallet);
  if (!walletRecord) return;

  const skip = (page - 1) * 10;
  const transactions = await prisma.transaction.findMany({
    where: { walletId: walletRecord.id },
    orderBy: { createdAt: 'desc' },
    skip,
    take: 10,
  });

  const total = await prisma.transaction.count({ where: { walletId: walletRecord.id } });
  const fmt = (raw: string) => (Number(BigInt(raw)) / 1_000_000).toFixed(2);
  const fmtDate = (d: Date) => d.toLocaleDateString('en-NG', { day: '2-digit', month: 'short' });

  const lines = transactions.map((tx) => {
    const emoji = TYPE_EMOJI[tx.type] ?? '•';
    const sign = ['SEND', 'ESCROW_LOCKED', 'WITHDRAWAL'].includes(tx.type) ? '-' : '+';
    return `${emoji} ${fmtDate(tx.createdAt)} | ${sign}$${fmt(tx.amount)} | ${tx.counterpartyRef ?? tx.type}`;
  });

  const keyboard = new InlineKeyboard();
  if (skip + 10 < total) keyboard.text('📜 Load More', `history_page_${page + 1}`);
  if (page > 1) keyboard.text('⬅️ Back', `history_page_${page - 1}`);

  await ctx.answerCallbackQuery();
  await ctx.editMessageText(
    `📜 *Transaction History — Page ${page}*\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n\nShowing ${skip + 1}–${Math.min(skip + 10, total)} of ${total}`,
    { parse_mode: 'Markdown', reply_markup: keyboard },
  );
}
