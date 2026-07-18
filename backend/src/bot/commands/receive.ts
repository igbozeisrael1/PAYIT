/**
 * receive.ts — Receive USDC command.
 * Generates a shareable payment link and optionally a QR code.
 */

import QRCode from 'qrcode';
import { WalletType } from '@prisma/client';
import { InlineKeyboard, InputFile } from 'grammy';
import { PayITContext } from '../middleware/session.js';
import { walletService } from '../../services/wallet.service.js';
import { env } from '../../config/env.js';

export async function handleReceiveCommand(ctx: PayITContext): Promise<void> {
  const userId = ctx.session.userId;
  if (!userId) return;

  const activeWallet = ctx.session.activeWallet;
  const walletRecord = await walletService.getWallet(userId, activeWallet);

  if (!walletRecord) {
    await ctx.reply('No wallet found. Please run /start to set up your wallet.');
    return;
  }

  const address = walletRecord.address;
  const label = activeWallet === WalletType.PERSONAL ? 'Personal' : 'Business';

  // Build a payment link (deep link into bot or web)
  const paymentLink = `${env.DASHBOARD_URL}/pay/${address}`;

  const keyboard = new InlineKeyboard()
    .text('📷 Get QR Code', `qr_${address}`)
    .url('🔗 Share Link', paymentLink);

  await ctx.reply(
    `📥 *Receive USDC — ${label} Wallet*\n\n` +
    `Your wallet address:\n\`${address}\`\n\n` +
    `Payment link:\n${paymentLink}\n\n` +
    `Share either with anyone to receive USDC instantly.`,
    { parse_mode: 'Markdown', reply_markup: keyboard },
  );
}

// Callback handler for QR code generation
export async function handleQRCallback(ctx: PayITContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? '';
  const address = data.replace('qr_', '');

  if (!address.startsWith('0x')) {
    await ctx.answerCallbackQuery('Invalid address');
    return;
  }

  await ctx.answerCallbackQuery('Generating QR code...');

  try {
    // Generate QR as PNG buffer
    const qrBuffer = await QRCode.toBuffer(address, {
      type: 'png',
      width: 512,
      margin: 2,
      color: { dark: '#1a0533', light: '#ffffff' },
    });

    await ctx.replyWithPhoto(
      new InputFile(qrBuffer),
      {
        caption: `📷 *Scan to Pay*\n\n\`${address}\``,
        parse_mode: 'Markdown',
      },
    );
  } catch {
    await ctx.reply('❌ Failed to generate QR code. Use the address above instead.');
  }
}
