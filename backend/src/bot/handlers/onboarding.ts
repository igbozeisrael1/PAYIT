/**
 * onboarding.ts — Wallet creation and restoration handler for PayIT.
 *
 * This handler manages:
 *  1. First-time wallet creation (triggered from /start)
 *  2. Wallet restoration from recovery phrase
 *
 * State machine steps:
 *  - "welcome"         → show welcome + Terms, ask user to proceed
 *  - "choose_type"     → Personal / Business / Both
 *  - "set_pin"         → ask user to enter PIN
 *  - "confirm_pin"     → ask user to confirm PIN
 *  - "show_mnemonic"   → show recovery phrase, ask confirmation
 *  - "verify_mnemonic" → ask user to enter 3 random words to prove they saved it
 *  - "complete"        → wallet created, show main menu
 *
 * For restoration:
 *  - "restore_phrase"  → ask for recovery phrase
 *  - "restore_pin"     → ask for new PIN
 *  - "restore_confirm" → confirm PIN
 *  - "restore_done"    → wallet restored
 */

import { InlineKeyboard } from 'grammy';
import { AccountType, WalletType } from '@prisma/client';
import { PayITContext } from '../middleware/session.js';
import { prisma } from '../../db/client.js';
import { walletService } from '../../services/wallet.service.js';
import { validatePin, hashPin } from '../../utils/pin.js';
import {
  validateMnemonic,
  formatMnemonicForTelegram,
  mnemonicToWords,
} from '../../utils/mnemonic.js';
import { mainMenuKeyboard, mainMenuText } from '../commands/start.js';

// ─── PIN storage during onboarding (in-memory map, NOT session) ───────────────
// This is ephemeral: cleared as soon as the wallet is created.
const tempPinStore = new Map<number, { pin: string; step: string }>();

// ─── Onboarding Step Router ───────────────────────────────────────────────────

export async function handleOnboardingStep(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const step = ctx.session.conversation.step;
  const text = ctx.message?.text?.trim() ?? '';

  switch (step) {
    case 'choose_type':
      return handleChooseType(ctx);

    case 'bus_name':
    case 'bus_address':
    case 'bus_email':
    case 'bus_logo':
      return handleBusinessOnboarding(ctx, text);

    case 'set_pin':
      return handleSetPin(ctx, text);

    case 'confirm_pin':
      return handleConfirmPin(ctx, text);

    case 'verify_mnemonic':
      return handleVerifyMnemonic(ctx, text);

    case 'restore_phrase':
      return handleRestorePhrase(ctx, text);

    case 'restore_pin':
      return handleRestorePin(ctx, text);

    case 'restore_confirm':
      return handleRestoreConfirm(ctx, text);
  }
}

// ─── Welcome ─────────────────────────────────────────────────────────────────

export async function startOnboarding(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  // Idempotency: check if already has a wallet
  const existing = await prisma.user.findUnique({ where: { telegramId } });
  if (existing) {
    await ctx.reply(mainMenuText(existing.accountType, WalletType.PERSONAL), {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard(existing.accountType, WalletType.PERSONAL),
    });
    return;
  }

  const keyboard = new InlineKeyboard()
    .text('✅ I Agree — Create My Wallet', 'onboard_agree');

  await ctx.reply(
    `*Welcome to PayIT!* 🚀\n\n` +
    `PayIT is your ultimate *digital payment solution*.\n\n` +
    `✅ *Easily ON/OFF ramp* your funds\n` +
    `✅ Send and receive payments globally in *Digital Dollars*\n` +
    `✅ *Add funds* in any currency and auto-convert to dollars\n` +
    `✅ *Save* and earn yield effortlessly\n` +
    `✅ *Pay bills* securely and track your business ledgers\n\n` +
    `📋 *By proceeding, you agree to our Terms of Service.*\n` +
    `Your account is fully secure and private — please save your backup key carefully.`,
    { parse_mode: 'Markdown', reply_markup: keyboard },
  );
}

// ─── Choose Account Type ──────────────────────────────────────────────────────

export async function showChooseAccountType(ctx: PayITContext): Promise<void> {
  ctx.session.conversation.step = 'choose_type';
  const keyboard = new InlineKeyboard()
    .text('👤 Personal', 'type_personal').row()
    .text('💼 Business', 'type_business').row()
    .text('🔀 Both', 'type_both');

  await ctx.reply(
    '*What kind of wallet do you need?*\n\n' +
    '👤 *Personal* — Send and receive money\n' +
    '💼 *Business* — Invoicing, VAT/WHT, and ledger\n' +
    '🔀 *Both* — Full access to all features',
    { parse_mode: 'Markdown', reply_markup: keyboard },
  );
}

async function handleChooseType(ctx: PayITContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  const telegramId = ctx.from!.id.toString();
  await ctx.answerCallbackQuery();

  if (data === 'type_personal') {
    ctx.session.conversation.pendingAction = AccountType.PERSONAL;
    ctx.session.conversation.step = 'set_pin';
    await ctx.reply('🔒 Let\'s secure your account.\n\nPlease enter a 4-digit PIN:');
  } else if (data === 'type_business') {
    ctx.session.conversation.pendingAction = AccountType.BUSINESS;
    ctx.session.conversation.step = 'bus_name';
    await ctx.reply('🏢 Let\'s set up your business account.\n\nPlease enter your **Business Name**:');
  } else if (data === 'type_both') {
    // Treat "Both" as starting with Business onboarding, then creating both
    ctx.session.conversation.pendingAction = AccountType.BOTH;
    ctx.session.conversation.step = 'bus_name';
    await ctx.reply('🏢 Let\'s set up your business account first.\n\nPlease enter your **Business Name**:');
  }
}

// ─── Business Onboarding ──────────────────────────────────────────────────────

async function handleBusinessOnboarding(ctx: PayITContext, text: string): Promise<void> {
  const step = ctx.session.conversation.step;
  const telegramId = ctx.from!.id.toString();

  if (step === 'bus_name') {
    ctx.session.conversation.pendingRecipient = text; // Reuse for business name
    ctx.session.conversation.step = 'bus_address';
    await ctx.reply('📍 Please enter your **Business Address**:');
  } else if (step === 'bus_address') {
    ctx.session.conversation.pendingAmount = text; // Reuse for business address
    ctx.session.conversation.step = 'bus_email';
    await ctx.reply('📧 Please enter your **Business Email**:');
  } else if (step === 'bus_email') {
    ctx.session.conversation.pendingInvoiceId = text; // Reuse for business email
    ctx.session.conversation.step = 'bus_logo';
    await ctx.reply('🖼️ Please send a link to your **Business Logo** (or type "skip"):');
  } else if (step === 'bus_logo') {
    // Complete setup
    ctx.session.conversation.step = 'set_pin';
    await ctx.reply('🔒 Let\'s secure your account.\n\nPlease enter a 4-digit PIN:');
  }
}

// ─── Set PIN ──────────────────────────────────────────────────────────────────

async function handleSetPin(ctx: PayITContext, pin: string): Promise<void> {
  const telegramId = ctx.from!.id;
  const validation = validatePin(pin);

  if (!validation.valid) {
    await ctx.reply(`❌ ${validation.error}\n\nPlease enter a valid PIN:`);
    return;
  }

  // Store PIN in-memory temporarily (NOT in session)
  tempPinStore.set(telegramId, { pin, step: 'set' });
  ctx.session.conversation.step = 'confirm_pin';

  await ctx.reply('✅ Got it. Now *confirm your PIN* by entering it again:', {
    parse_mode: 'Markdown',
  });
}

// ─── Confirm PIN ──────────────────────────────────────────────────────────────

async function handleConfirmPin(ctx: PayITContext, confirmPin: string): Promise<void> {
  const telegramId = ctx.from!.id;
  const stored = tempPinStore.get(telegramId);

  if (!stored) {
    await ctx.reply('Something went wrong. Please run /start again.');
    return;
  }

  if (stored.pin !== confirmPin) {
    tempPinStore.delete(telegramId);
    ctx.session.conversation.step = 'set_pin';
    await ctx.reply("❌ PINs don't match. Let's try again. Enter your new PIN:");
    return;
  }

  const pin = stored.pin;

  // Now create the wallet
  await ctx.reply('⏳ Creating your wallet on Monad...');

  try {
    const accountType = (ctx.session.conversation.pendingAction as AccountType) ?? AccountType.PERSONAL;
    const telegramIdStr = telegramId.toString();

    // Create user record
    const pinHash = await hashPin(pin);
    const user = await prisma.user.create({
      data: {
        telegramId: telegramIdStr,
        username: ctx.from?.username,
        firstName: ctx.from?.first_name,
        lastName: ctx.from?.last_name,
        accountType,
        pinHash,
      },
    });

    // Create personal wallet (always)
    const { mnemonic: personalMnemonic, address: personalAddress } =
      await walletService.createWallet(user.id, pin, WalletType.PERSONAL);

    // Create business wallet if needed
    if (accountType === AccountType.BUSINESS || accountType === AccountType.BOTH) {
      await walletService.createWallet(user.id, pin, WalletType.BUSINESS);
    }

    // Clean up temp PIN
    tempPinStore.delete(telegramId);

    // Update session
    ctx.session.userId = user.id;
    ctx.session.onboarded = true;
    ctx.session.conversation = { step: 'verify_mnemonic' };

    // Store mnemonic temporarily for verification step
    // We use a separate map — never session
    tempPinStore.set(telegramId, {
      pin: personalMnemonic, // Re-using map for mnemonic storage (named for step)
      step: 'mnemonic',
    });

    const mnemonicDisplay = formatMnemonicForTelegram(personalMnemonic);

    await ctx.reply(
      `🎉 *Wallet Created!*\n\n` +
      `📍 Your wallet address:\n\`${personalAddress}\`\n\n` +
      `🔑 *Recovery Phrase (tap to reveal)*\n\n` +
      `${mnemonicDisplay}\n\n` +
      `⚠️ *This is the ONLY way to recover your wallet.* Write it down and store it safely offline.\n\n` +
      `PayIT will NEVER ask you for this phrase. Never share it with anyone.`,
      { parse_mode: 'Markdown' },
    );

    // Ask for confirmation
    const words = mnemonicToWords(personalMnemonic);
    const checkPositions = [2, 6, 10]; // Ask for words at positions 3, 7, 11 (1-indexed)

    ctx.session.conversation.pendingAction = checkPositions
      .map((i) => `${i + 1}:${words[i]}`)
      .join(',');

    await ctx.reply(
      `To confirm you saved your recovery phrase, please enter:\n\n` +
      `Word #${checkPositions[0] + 1}, Word #${checkPositions[1] + 1}, Word #${checkPositions[2] + 1}\n\n` +
      `(separated by spaces, e.g. \`apple mango river\`)`,
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    tempPinStore.delete(telegramId);
    ctx.session.conversation = {};
    console.error('[Onboarding] Wallet creation failed:', err);
    await ctx.reply(
      '❌ Something went wrong creating your wallet. Please try /start again.',
    );
  }
}

// ─── Verify Mnemonic ──────────────────────────────────────────────────────────

async function handleVerifyMnemonic(ctx: PayITContext, input: string): Promise<void> {
  const telegramId = ctx.from!.id;
  const checkSpec = ctx.session.conversation.pendingAction ?? '';

  const checks = checkSpec.split(',').map((s) => {
    const [pos, word] = s.split(':');
    return { pos: parseInt(pos!), word: word! };
  });

  const inputWords = input.trim().toLowerCase().split(/\s+/);

  const allCorrect = checks.every((check, i) => inputWords[i] === check.word);

  if (!allCorrect) {
    await ctx.reply(
      "❌ Those words don't match. Please check your recovery phrase and try again.\n\n" +
      `Enter Word #${checks[0]!.pos}, Word #${checks[1]!.pos}, Word #${checks[2]!.pos}:`,
    );
    return;
  }

  // Verification passed — clean up
  tempPinStore.delete(telegramId);
  ctx.session.conversation = {};

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: ctx.session.userId },
  });

  await ctx.reply(
    `✅ *Perfect! Your wallet is ready.*\n\n` +
    `Your funds are 100% yours — PayIT cannot access them.\n\n` +
    `Welcome to PayIT! 🚀`,
    { parse_mode: 'Markdown' },
  );

  await ctx.reply(mainMenuText(user.accountType, WalletType.PERSONAL), {
    parse_mode: 'Markdown',
    reply_markup: mainMenuKeyboard(user.accountType, WalletType.PERSONAL),
  });
}

// ─── Restore Flow ─────────────────────────────────────────────────────────────

export async function startRestore(ctx: PayITContext): Promise<void> {
  ctx.session.conversation.step = 'restore_phrase';
  await ctx.reply(
    '🔄 *Restore Wallet*\n\n' +
    'Enter your 12-word recovery phrase (separated by spaces).\n\n' +
    '⚠️ Only enter this in private — never share your screen.',
    { parse_mode: 'Markdown' },
  );
}

async function handleRestorePhrase(ctx: PayITContext, phrase: string): Promise<void> {
  const telegramId = ctx.from!.id;

  if (!validateMnemonic(phrase)) {
    await ctx.reply(
      '❌ Invalid recovery phrase. Please check each word and try again.\n\n' +
      'Enter your 12-word recovery phrase:',
    );
    return;
  }

  // Store phrase temporarily in memory
  tempPinStore.set(telegramId, { pin: phrase, step: 'restore_phrase' });
  ctx.session.conversation.step = 'restore_pin';

  await ctx.reply(
    '✅ Recovery phrase accepted.\n\n' +
    '🔒 *Set a new PIN* for this device (4–6 digits):',
    { parse_mode: 'Markdown' },
  );
}

async function handleRestorePin(ctx: PayITContext, pin: string): Promise<void> {
  const telegramId = ctx.from!.id;
  const validation = validatePin(pin);

  if (!validation.valid) {
    await ctx.reply(`❌ ${validation.error}\n\nEnter a valid PIN:`);
    return;
  }

  const stored = tempPinStore.get(telegramId);
  if (!stored) {
    await ctx.reply('Session expired. Please start over with /restore.');
    return;
  }

  // Temporarily stash both mnemonic and PIN
  tempPinStore.set(telegramId, { pin: `${stored.pin}|||${pin}`, step: 'restore_pin' });
  ctx.session.conversation.step = 'restore_confirm';

  await ctx.reply('Confirm your new PIN:');
}

async function handleRestoreConfirm(ctx: PayITContext, confirmPin: string): Promise<void> {
  const telegramId = ctx.from!.id;
  const stored = tempPinStore.get(telegramId);

  if (!stored) {
    await ctx.reply('Session expired. Please start over with /restore.');
    return;
  }

  const [mnemonic, pin] = stored.pin.split('|||');

  if (!mnemonic || !pin) {
    await ctx.reply('Session corrupted. Please start over with /restore.');
    tempPinStore.delete(telegramId);
    return;
  }

  if (pin !== confirmPin) {
    // Reset PIN steps but keep mnemonic
    tempPinStore.set(telegramId, { pin: mnemonic, step: 'restore_phrase' });
    ctx.session.conversation.step = 'restore_pin';
    await ctx.reply("❌ PINs don't match. Set your new PIN again:");
    return;
  }

  await ctx.reply('⏳ Restoring your wallet...');

  try {
    const telegramIdStr = telegramId.toString();
    const pinHash = await hashPin(pin);

    // Upsert user (may be returning to a new device)
    const user = await prisma.user.upsert({
      where: { telegramId: telegramIdStr },
      create: {
        telegramId: telegramIdStr,
        username: ctx.from?.username,
        firstName: ctx.from?.first_name,
        accountType: AccountType.PERSONAL,
        pinHash,
      },
      update: { pinHash },
    });

    await walletService.restoreWallet(user.id, mnemonic!, pin, WalletType.PERSONAL);

    tempPinStore.delete(telegramId);
    ctx.session.userId = user.id;
    ctx.session.onboarded = true;
    ctx.session.conversation = {};

    await ctx.reply(
      '✅ *Wallet Restored!*\n\nYour wallet is back and your funds are accessible.',
      { parse_mode: 'Markdown' },
    );

    await ctx.reply(mainMenuText(user.accountType, WalletType.PERSONAL), {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard(user.accountType, WalletType.PERSONAL),
    });
  } catch {
    tempPinStore.delete(telegramId);
    ctx.session.conversation = {};
    await ctx.reply('❌ Wallet restoration failed. Please check your recovery phrase and try again.');
  }
}
