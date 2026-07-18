/**
 * send.ts — Send USDC command handler.
 *
 * Flow:
 *  1. User types /send (or taps Send button)
 *  2. Bot asks "How much?" → user enters amount
 *  3. Bot asks "To whom?" → user enters @username, phone, or 0x address
 *  4. Bot resolves recipient (PayIT user or pending/escrow)
 *  5. Bot shows confirmation: amount, recipient, estimated fee
 *  6. User enters PIN → transaction signed and broadcast
 *  7. Bot shows "Sent ✅" then updates to "Confirmed" on receipt
 */

import { InlineKeyboard } from 'grammy';
import { ethers } from 'ethers';
import { PayITContext } from '../middleware/session.js';
import { prisma } from '../../db/client.js';
import { walletService } from '../../services/wallet.service.js';
import { blockchainService } from '../../services/blockchain.service.js';
import { escrowService } from '../../services/escrow.service.js';
import { notificationService } from '../../services/notification.service.js';
import { requestPin } from '../handlers/pin.js';

// ─── State store (non-session, in-memory) ────────────────────────────────────

interface SendState {
  amount: string;       // Human-readable amount
  amountRaw: bigint;    // Base units in USDC (converted internally)
  currency: 'FIAT' | 'CRYPTO' | null;
  recipientRef: string; // What user typed
  recipientAddress: string | null;  // Resolved wallet address (null = non-user)
  recipientName: string;            // Display name
  isExistingUser: boolean;
  step: 'amount' | 'currency' | 'recipient' | 'confirm';
}

const sendStateStore = new Map<number, SendState>();

// ─── Entry Points ─────────────────────────────────────────────────────────────

export async function handleSendCommand(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  sendStateStore.delete(telegramId); // Clear any stale state

  sendStateStore.set(telegramId, {
    amount: '',
    amountRaw: 0n,
    currency: null,
    recipientRef: '',
    recipientAddress: null,
    recipientName: '',
    isExistingUser: false,
    step: 'amount',
  });

  ctx.session.conversation.step = 'send_amount';

  await ctx.reply(
    '💸 *Send Money*\n\nHow much would you like to send?\n\nEnter the amount in USD or Naira (e.g., `$25` or `₦25000`):',
    { parse_mode: 'Markdown' },
  );
}

// ─── Step Router ──────────────────────────────────────────────────────────────

export async function handleSendStep(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const step = ctx.session.conversation.step;
  const text = ctx.message?.text?.trim() ?? '';

  switch (step) {
    case 'send_amount':
      return handleSendAmount(ctx, text);
    case 'send_recipient':
      return handleSendRecipient(ctx, text);
  }
}

export async function handleSendCurrency(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  const data = ctx.callbackQuery?.data;
  if (!telegramId || !data) return;

  const state = sendStateStore.get(telegramId);
  if (!state) return;

  await ctx.answerCallbackQuery();

  state.currency = data === 'send_fiat' ? 'FIAT' : 'CRYPTO';
  state.step = 'recipient';
  sendStateStore.set(telegramId, state);

  ctx.session.conversation.step = 'send_recipient';

  if (state.currency === 'FIAT') {
    await ctx.reply('🏦 You chose Fiat.\n\nPlease enter the recipient\'s **Bank Account Number**:');
  } else {
    await ctx.reply('🪙 You chose Crypto.\n\nPlease enter the recipient\'s **Wallet Address**:');
  }
}

// ─── Step: Amount ─────────────────────────────────────────────────────────────

async function handleSendAmount(ctx: PayITContext, input: string): Promise<void> {
  const telegramId = ctx.from!.id;
  const state = sendStateStore.get(telegramId);
  if (!state) return;

  const numericString = input.replace(/[^0-9.]/g, '');
  const amount = parseFloat(numericString);
  if (isNaN(amount) || amount <= 0) {
    await ctx.reply('❌ Invalid amount. Enter a positive number like `$25` or `₦25000`:', {
      parse_mode: 'Markdown',
    });
    return;
  }

  // Basic conversion mock: if > 1000, assume Naira
  const isNaira = input.includes('₦') || amount > 1000;
  const usdAmount = isNaira ? amount / 1500 : amount;

  if (usdAmount > 50000) {
    await ctx.reply('❌ Maximum single transfer is $50,000 USD.');
    return;
  }

  state.amount = usdAmount.toFixed(6);
  state.amountRaw = ethers.parseUnits(usdAmount.toFixed(6), 6);
  state.step = 'currency';
  sendStateStore.set(telegramId, state);

  const keyboard = new InlineKeyboard()
    .text('💵 Send as Fiat (Bank)', 'send_fiat').row()
    .text('🪙 Send as Crypto (USDC)', 'send_crypto');

  await ctx.reply(
    `✅ *Amount: $${usdAmount.toFixed(2)} USD* (approx. ₦${(usdAmount * 1500).toLocaleString()})\n\nHow would you like to send this?`,
    { parse_mode: 'Markdown', reply_markup: keyboard },
  );
}

// ─── Step: Recipient ─────────────────────────────────────────────────────────

async function handleSendRecipient(ctx: PayITContext, input: string): Promise<void> {
  const telegramId = ctx.from!.id;
  const userId = ctx.session.userId!;
  const state = sendStateStore.get(telegramId);
  if (!state) return;

  state.recipientRef = input;

  // Check balance before resolving recipient
  const activeWallet = ctx.session.activeWallet;
  const walletRecord = await walletService.getWallet(userId, activeWallet);
  if (!walletRecord) {
    await ctx.reply('Wallet not found. Please run /start.');
    return;
  }

  const amountNumber = parseFloat(state.amount);
  const feeNumber = amountNumber * 0.01;
  const totalRequired = amountNumber + feeNumber;
  const totalRequiredRaw = ethers.parseUnits(totalRequired.toFixed(6), 6);

  const balance = await walletService.getBalance(walletRecord.address);
  if (balance.usdcRaw < totalRequiredRaw) {
    const available = parseFloat(balance.usdc).toFixed(2);
    await ctx.reply(
      `❌ Insufficient balance.\n\nYou have *$${available} USDC* available.`,
      { parse_mode: 'Markdown' },
    );
    sendStateStore.delete(telegramId);
    ctx.session.conversation.step = undefined;
    return;
  }

  // Resolve recipient
  let resolvedAddress: string | null = null;
  let resolvedName = input;
  let isExistingUser = false;

  if (ethers.isAddress(input as string)) {
    // Direct wallet address
    resolvedAddress = input;
    resolvedName = `${input.slice(0, 6)}...${input.slice(-4)}`;
    isExistingUser = true; // No escrow needed for direct address transfers
  } else {
    // Look up by Telegram handle or phone
    const searchHandle = input.startsWith('@') ? input.slice(1) : input;
    const recipientUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username: { equals: searchHandle, mode: 'insensitive' } },
        ],
      },
      include: { wallets: { where: { walletType: activeWallet } } },
    });

    if (recipientUser?.wallets[0]) {
      resolvedAddress = recipientUser.wallets[0].address;
      resolvedName = recipientUser.username
        ? `@${recipientUser.username}`
        : recipientUser.firstName ?? input;
      isExistingUser = true;
    } else {
      // Non-user — will go to escrow
      resolvedAddress = null;
      resolvedName = input;
      isExistingUser = false;
    }
  }

  state.recipientAddress = resolvedAddress;
  state.recipientName = resolvedName;
  state.isExistingUser = isExistingUser;
  state.step = 'confirm';
  sendStateStore.set(telegramId, state);

  // Build confirmation message

  const escrowNote = !isExistingUser
    ? '\n\n⏳ *This person isn\'t on PayIT yet.* Funds will be held in escrow for 14 days. They\'ll receive an invite — if they don\'t join, you\'ll get a refund.'
    : '';

  const confirmKeyboard = new InlineKeyboard()
    .text('✅ Confirm & Enter PIN', 'send_confirm')
    .row()
    .text('❌ Cancel', 'send_cancel');

  await ctx.reply(
    `📋 *Confirm Transfer*\n\n` +
    `💸 Amount: *$${amountNumber.toFixed(2)} USDC*\n` +
    `🔥 *Total Deducted: $${totalRequired.toFixed(2)} USDC*\n\n` +
    `👤 To: *${resolvedName}*\n` +
    `⏱ Arrival: ~1 second (Monad)${escrowNote}`,
    { parse_mode: 'Markdown', reply_markup: confirmKeyboard },
  );
}

// ─── Confirmation & PIN ───────────────────────────────────────────────────────

export async function handleSendConfirm(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const state = sendStateStore.get(telegramId);
  if (!state) {
    await ctx.answerCallbackQuery('Transfer expired. Please start over.');
    return;
  }

  await ctx.answerCallbackQuery();

  const activeWallet = ctx.session.activeWallet;

  await requestPin(
    ctx,
    activeWallet,
    `Send *$${parseFloat(state.amount).toFixed(2)} USDC* to *${state.recipientName}*`,
    async (pinCtx, signer) => {
      await executeSend(pinCtx, signer, state);
    },
  );
}

export async function handleSendCancel(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId) sendStateStore.delete(telegramId);
  ctx.session.conversation.step = undefined;
  await ctx.answerCallbackQuery('Cancelled');
  await ctx.reply('Transfer cancelled.');
}

// ─── Execute Transfer ─────────────────────────────────────────────────────────

async function executeSend(
  ctx: PayITContext,
  signer: ethers.Wallet,
  state: SendState,
): Promise<void> {
  const userId = ctx.session.userId!;
  const activeWallet = ctx.session.activeWallet;

  await ctx.reply('⏳ Broadcasting transaction to Monad...');

  try {
    const walletRecord = await walletService.getWallet(userId, activeWallet);
    if (!walletRecord) throw new Error('Wallet record not found');

    let txHash: string;

    if (state.isExistingUser && state.recipientAddress) {
      // Direct USDC transfer
      const receipt = await blockchainService.sendUSDC(
        signer,
        state.recipientAddress,
        state.amountRaw,
      );
      txHash = receipt.hash;

      // Record transaction
      await prisma.transaction.create({
        data: {
          walletId: walletRecord.id,
          walletType: activeWallet,
          type: 'SEND',
          status: 'CONFIRMED',
          amount: state.amountRaw.toString(),
          counterpartyRef: state.recipientName,
          txHash,
          confirmedAt: new Date(),
        },
      });

      await ctx.reply(
        `✅ *Sent!*\n\n` +
        `💸 $${parseFloat(state.amount).toFixed(2)} USDC → ${state.recipientName}\n` +
        `🔗 Tx: \`${txHash}\`\n` +
        `⏱ Confirmed on Monad`,
        { parse_mode: 'Markdown' },
      );

      // Notify recipient
      await notificationService.notifyTransferReceived(
        state.recipientRef,
        parseFloat(state.amount).toFixed(2),
        ctx.from?.username ? `@${ctx.from.username}` : 'Someone',
      );
    } else {
      // Escrow deposit for non-user
      const result = await escrowService.createPendingTransfer(
        walletRecord.id,
        state.recipientRef,
        state.amountRaw,
        signer,
      );

      txHash = result.txHash;

      await ctx.reply(
        `✅ *Funds Held in Escrow*\n\n` +
        `💸 $${parseFloat(state.amount).toFixed(2)} USDC reserved for *${state.recipientName}*\n` +
        `⏳ They have 14 days to join PayIT and claim it.\n` +
        `🔗 Tx: \`${txHash}\``,
        { parse_mode: 'Markdown' },
      );
    }

    // Clear state
    const telegramId = ctx.from!.id;
    sendStateStore.delete(telegramId);
    ctx.session.conversation.step = undefined;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Transaction failed';
    await ctx.reply(`❌ Transfer failed: ${message}\n\nPlease try again.`);
    ctx.session.conversation.step = undefined;
  }
}
