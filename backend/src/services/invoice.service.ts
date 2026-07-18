/**
 * invoice.service.ts — Invoice management (off-chain + on-chain coordination).
 *
 * Handles:
 *  - Creating invoices (DB + on-chain)
 *  - Generating payment links
 *  - Marking invoices paid when on-chain InvoicePaid event fires
 *  - Exporting ledger data as CSV
 *  - Sending overdue reminders
 */

import { InvoiceStatus, WalletType } from '@prisma/client';
import { prisma } from '../db/client.js';
import { blockchainService, BlockchainService } from './blockchain.service.js';
import { taxService, LineItem, WhtCategoryId } from './tax.service.js';
import { env } from '../config/env.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateInvoiceParams {
  walletId: string;
  businessAddress: string;
  clientName: string;
  clientEmail?: string;
  lineItems: LineItem[];
  vatEnabled: boolean;
  whtCategoryId: WhtCategoryId;
  dueDate?: Date;
  depositAddress: string;
}

export interface InvoiceSummary {
  id: string;
  clientName: string;
  total: string;
  status: InvoiceStatus;
  createdAt: Date;
  dueDate: Date | null;
  paymentLink: string | null;
  onchainInvoiceId: string | null;
  depositAddress: string | null;
}

// ─── Service ──────────────────────────────────────────────────────────────────

class InvoiceService {
  /**
   * Create a new invoice: calculate taxes, write to DB, publish on-chain.
   */
  async createInvoice(params: CreateInvoiceParams): Promise<{
    invoice: { id: string; paymentLink: string | null };
    breakdown: ReturnType<typeof taxService.calculate>;
  }> {
    const breakdown = taxService.calculate(
      params.lineItems,
      params.vatEnabled,
      params.whtCategoryId,
    );

    // Compute line items hash for on-chain verification
    const lineItemsJson = JSON.stringify(params.lineItems);
    const lineItemsHash = BlockchainService.hashContent(lineItemsJson) as `0x${string}`;

    // Client ref: hash of client identifier
    const clientRef = BlockchainService.hashIdentifier(
      params.clientEmail ?? params.clientName,
    ).slice(0, 31); // bytes32 limit

    // Create invoice on-chain via operator wallet
    const { invoiceId: onchainId, txHash } = await blockchainService.createOnchainInvoice({
      businessAddress: params.businessAddress,
      clientRef,
      lineItemsHash,
      subtotal: breakdown.subtotalRaw,
      vatAmount: breakdown.vatAmountRaw,
      whtAmount: breakdown.whtAmountRaw,
      total: breakdown.totalRaw,
    });

    // Generate payment link
    const paymentLink = `${env.DASHBOARD_URL}/invoice/${onchainId.toString()}`;

    // Save to DB
    const invoice = await prisma.invoice.create({
      data: {
        walletId: params.walletId,
        clientName: params.clientName,
        clientEmail: params.clientEmail,
        clientRef,
        lineItems: params.lineItems as any,
        lineItemsHash,
        subtotal: breakdown.subtotalRaw.toString(),
        vatAmount: breakdown.vatAmountRaw.toString(),
        vatRate: breakdown.vatRate,
        whtAmount: breakdown.whtAmountRaw.toString(),
        whtRate: breakdown.whtRate,
        total: breakdown.totalRaw.toString(),
        onchainInvoiceId: onchainId.toString(),
        depositAddress: params.depositAddress,
        paymentLink,
        status: InvoiceStatus.SENT,
        sentAt: new Date(),
        dueDate: params.dueDate,
      },
    });

    console.log(`[InvoiceService] Created invoice ${invoice.id}, on-chain ID: ${onchainId}, tx: ${txHash}`);

    return { invoice, breakdown };
  }

  /**
   * Mark an invoice as paid — called when InvoicePaid event is detected on-chain.
   */
  async markPaid(onchainInvoiceId: string, txHash: string): Promise<void> {
    const invoice = await prisma.invoice.findFirst({
      where: { onchainInvoiceId },
    });

    if (!invoice) {
      console.warn(`[InvoiceService] No DB record for on-chain invoice ${onchainInvoiceId}`);
      return;
    }

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: InvoiceStatus.PAID, paidAt: new Date() },
    });

    // Record as INVOICE_PAID transaction
    await prisma.transaction.create({
      data: {
        walletId: invoice.walletId,
        walletType: WalletType.BUSINESS,
        type: 'INVOICE_PAID',
        status: 'CONFIRMED',
        amount: invoice.total,
        counterpartyRef: invoice.clientName,
        txHash,
        externalRef: invoice.id,
        confirmedAt: new Date(),
      },
    });
  }

  /**
   * Get paginated invoice list for a wallet.
   */
  async getInvoices(
    walletId: string,
    status?: InvoiceStatus,
    page = 1,
    pageSize = 10,
  ) {
    const where = { walletId, ...(status ? { status } : {}) };
    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.invoice.count({ where }),
    ]);
    return { invoices, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  /**
   * Get Ledger summary: running totals for VAT collected and WHT withheld.
   */
  async getLedgerSummary(walletId: string, month?: Date) {
    const start = month ? new Date(month.getFullYear(), month.getMonth(), 1) : undefined;
    const end = month ? new Date(month.getFullYear(), month.getMonth() + 1, 0) : undefined;

    const paid = await prisma.invoice.findMany({
      where: {
        walletId,
        status: InvoiceStatus.PAID,
        ...(start && end ? { paidAt: { gte: start, lte: end } } : {}),
      },
    });

    const totals = paid.reduce(
      (acc, inv) => ({
        totalRevenue: acc.totalRevenue + BigInt(inv.total),
        totalVat: acc.totalVat + BigInt(inv.vatAmount),
        totalWht: acc.totalWht + BigInt(inv.whtAmount),
        invoiceCount: acc.invoiceCount + 1,
      }),
      { totalRevenue: 0n, totalVat: 0n, totalWht: 0n, invoiceCount: 0 },
    );

    const fmt = (raw: bigint) => (Number(raw) / 1_000_000).toFixed(2);

    return {
      totalRevenue: fmt(totals.totalRevenue),
      totalVat: fmt(totals.totalVat),
      totalWht: fmt(totals.totalWht),
      invoiceCount: totals.invoiceCount,
      period: month ? `${month.toLocaleString('default', { month: 'long' })} ${month.getFullYear()}` : 'All Time',
    };
  }

  /**
   * Export ledger as CSV string.
   */
  async exportCSV(walletId: string): Promise<string> {
    const invoices = await prisma.invoice.findMany({
      where: { walletId },
      orderBy: { createdAt: 'asc' },
    });

    const fmt = (raw: string) => (Number(BigInt(raw)) / 1_000_000).toFixed(2);

    const headers = [
      'Invoice ID', 'Client', 'Status', 'Subtotal (USDC)', 'VAT (USDC)',
      'WHT (USDC)', 'Total (USDC)', 'Created At', 'Paid At', 'On-Chain ID',
    ].join(',');

    const rows = invoices.map((inv) =>
      [
        inv.id,
        `"${inv.clientName}"`,
        inv.status,
        fmt(inv.subtotal),
        fmt(inv.vatAmount),
        fmt(inv.whtAmount),
        fmt(inv.total),
        inv.createdAt.toISOString(),
        inv.paidAt?.toISOString() ?? '',
        inv.onchainInvoiceId ?? '',
      ].join(','),
    );

    return [headers, ...rows].join('\n');
  }

  /**
   * Mark overdue invoices and send reminders.
   * Run daily by the cron job.
   */
  async processOverdueInvoices(): Promise<string[]> {
    const overdue = await prisma.invoice.findMany({
      where: {
        status: InvoiceStatus.SENT,
        dueDate: { lt: new Date() },
      },
    });

    const updatedIds: string[] = [];

    for (const inv of overdue) {
      await prisma.invoice.update({
        where: { id: inv.id },
        data: { status: InvoiceStatus.OVERDUE },
      });
      updatedIds.push(inv.id);
    }

    return updatedIds;
  }

  /**
   * Run frequently by cron job to detect payments for pending invoices.
   */
  async pollPendingInvoices(bot: any): Promise<void> {
    const pending = await prisma.invoice.findMany({
      where: {
        status: { in: [InvoiceStatus.SENT, InvoiceStatus.PARTIAL] },
        depositAddress: { not: null }
      },
      include: { wallet: { include: { user: true } } }
    });

    const { walletService } = await import('./wallet.service.js');
    const { InlineKeyboard } = await import('grammy');

    for (const invoice of pending) {
      if (!invoice.depositAddress) continue;

      try {
        const balance = await walletService.getBalance(invoice.depositAddress);
        const currentBalanceRaw = balance.usdcRaw;
        const previouslyPaidRaw = BigInt(invoice.amountPaid);
        const totalRequiredRaw = BigInt(invoice.total);

        if (currentBalanceRaw > previouslyPaidRaw) {
          // New payment detected!
          let newStatus = invoice.status;
          let msgText = '';

          if (currentBalanceRaw < totalRequiredRaw) {
            newStatus = InvoiceStatus.PARTIAL;
            msgText = `🎉 **Partial Payment Detected!**\n\nYour client sent *$${balance.usdc} USDC* for Invoice to ${invoice.clientName}.\nAmount required: $${(Number(totalRequiredRaw)/1e6).toFixed(2)} USDC.`;
          } else if (currentBalanceRaw > totalRequiredRaw) {
            newStatus = InvoiceStatus.PARTIAL; // Leave it partial until swept
            const over = currentBalanceRaw - totalRequiredRaw;
            msgText = `🚨 **Overpayment Detected!**\n\nYour client sent *$${balance.usdc} USDC* for Invoice to ${invoice.clientName} (Overpaid by $${(Number(over)/1e6).toFixed(2)}).\n\nClick below to sweep funds and settle the invoice.`;
          } else {
            newStatus = InvoiceStatus.PARTIAL;
            msgText = `✅ **Exact Payment Detected!**\n\nYour client fully paid *$${balance.usdc} USDC* for Invoice to ${invoice.clientName}.\n\nClick below to sweep funds and settle the invoice.`;
          }

          await prisma.invoice.update({
            where: { id: invoice.id },
            data: { amountPaid: currentBalanceRaw.toString(), status: newStatus }
          });

          const kb = new InlineKeyboard()
            .text('🧹 Sweep Funds', `invoice_verify_${invoice.id}`);

          await bot.api.sendMessage(invoice.wallet.user.telegramId, msgText, { parse_mode: 'Markdown', reply_markup: kb });
        }
      } catch (err) {
        console.error(`[Invoice Poll] Error checking invoice ${invoice.id}:`, err);
      }
    }
  }
}

export const invoiceService = new InvoiceService();
