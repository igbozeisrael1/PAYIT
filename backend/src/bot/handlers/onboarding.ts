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

  ctx.session.conversation.step = 'choose_type';
  
  const keyboard = new InlineKeyboard()
    .text('👤 Personal', 'type_personal').row()
    .text('💼 Business', 'type_business').row()
    .text('🔀 Both', 'type_both');

  await ctx.reply(
    `*Welcome to PayIT!* 🚀\n\n` +
    `PayIT is your ultimate *digital payment solution*.\n\n` +
    `✅ *Easily ON/OFF ramp* your funds\n` +
    `✅ Send and receive payments globally in *Digital Dollars*\n` +
    `✅ *Add funds* in any currency and auto-convert to dollars\n` +
    `✅ *Save* to earn up to 10% APY\n` +
    `✅ *Pay bills* securely and track your business ledgers\n\n` +
    `📋 *By proceeding, you agree to our Terms of Service.*\n` +
    `Your account is fully secure and private — please save your backup key carefully.\n\n` +
    `*What kind of account do you need?*`,
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
    // Save business data
    ctx.session.conversation.pendingMnemonic = text; // Reuse for business logo

    // Complete setup
    if (ctx.session.userId) {
      // They are upgrading. Ask for existing PIN to create the wallet.
      const { requestPin } = await import('./pin.js');
      await requestPin(
        ctx,
        WalletType.PERSONAL,
        'Create Business Account',
        async (pinCtx, signer) => {
          await pinCtx.reply('⏳ Creating your Business account on Monad...');
          
          const pin = pinCtx.message?.text?.trim() || '';
          if (pin) {
            await walletService.createWallet(ctx.session.userId!, pin, WalletType.BUSINESS);
          }

          const busName = ctx.session.conversation.pendingRecipient;
          const busAddress = ctx.session.conversation.pendingAmount;
          const busEmail = ctx.session.conversation.pendingInvoiceId;
          const busLogo = ctx.session.conversation.pendingMnemonic;

          // Switch active wallet and account type, and save business details
          ctx.session.activeWallet = WalletType.BUSINESS;
          await prisma.user.update({
            where: { id: ctx.session.userId },
            data: { 
              activeWallet: WalletType.BUSINESS,
              accountType: AccountType.BOTH,
              businessName: busName,
              businessAddress: busAddress,
              businessEmail: busEmail,
              businessLogo: busLogo === 'skip' ? null : busLogo,
            },
          });

          ctx.session.conversation = {}; // Clear onboarding state

          await pinCtx.reply(
            '✅ *Business Account Created!*\n\n' +
            'You have successfully upgraded. You can now access invoices and business tools.',
            { parse_mode: 'Markdown' }
          );

          await pinCtx.reply(mainMenuText(AccountType.BOTH, WalletType.BUSINESS), {
            parse_mode: 'Markdown',
            reply_markup: mainMenuKeyboard(AccountType.BOTH, WalletType.BUSINESS),
          });
        }
      );
    } else {
      // They are brand new users.
      ctx.session.conversation.step = 'set_pin';
      const promptMsg = await ctx.reply('🔒 Let\'s secure your account.\n\nPlease enter a 4-digit PIN:');
      setTimeout(async () => { try { await ctx.api.deleteMessage(ctx.chat!.id, promptMsg.message_id); } catch(e){} }, 60000);
    }
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

  if (ctx.message?.message_id) {
    setTimeout(async () => { try { await ctx.api.deleteMessage(ctx.chat!.id, ctx.message!.message_id); } catch(e){} }, 30000);
  }

  const promptMsg = await ctx.reply('✅ Got it. Now *confirm your PIN* by entering it again:', {
    parse_mode: 'Markdown',
  });
  setTimeout(async () => { try { await ctx.api.deleteMessage(ctx.chat!.id, promptMsg.message_id); } catch(e){} }, 60000);
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
    const promptMsg = await ctx.reply("❌ PINs don't match. Let's try again. Enter your new PIN:");
    setTimeout(async () => { try { await ctx.api.deleteMessage(ctx.chat!.id, promptMsg.message_id); } catch(e){} }, 60000);
    return;
  }

  if (ctx.message?.message_id) {
    setTimeout(async () => { try { await ctx.api.deleteMessage(ctx.chat!.id, ctx.message!.message_id); } catch(e){} }, 30000);
  }

  const pin = stored.pin;

  // Now create the account
  await ctx.reply('⏳ Creating your account on Monad...');

  try {
    const accountType = (ctx.session.conversation.pendingAction as AccountType) ?? AccountType.PERSONAL;
    const telegramIdStr = telegramId.toString();

    // Create user record
    const pinHash = await hashPin(pin);
    const busName = ctx.session.conversation.pendingRecipient;
    const busAddress = ctx.session.conversation.pendingAmount;
    const busEmail = ctx.session.conversation.pendingInvoiceId;
    const busLogo = ctx.session.conversation.pendingMnemonic;

    const user = await prisma.user.create({
      data: {
        telegramId: telegramIdStr,
        username: ctx.from?.username,
        firstName: ctx.from?.first_name,
        lastName: ctx.from?.last_name,
        accountType,
        pinHash,
        businessName: busName,
        businessAddress: busAddress,
        businessEmail: busEmail,
        businessLogo: busLogo === 'skip' ? null : busLogo,
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
    ctx.session.userId = user.id;
    ctx.session.onboarded = true;
    ctx.session.conversation = {};

    await ctx.reply(
      `🎉 *Account Created!*\n\n` +
      `Your account is fully secured by your PIN.\n` +
      `You can view your private keys in the Settings menu later.`,
      { parse_mode: 'Markdown' },
    );

    // Show main menu immediately
    const initialWallet = (accountType === AccountType.BUSINESS || accountType === AccountType.BOTH) 
      ? WalletType.BUSINESS 
      : WalletType.PERSONAL;
      
    ctx.session.activeWallet = initialWallet;

    await ctx.reply(mainMenuText(user.accountType, initialWallet), {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard(user.accountType, initialWallet),
    });
  } catch (err) {
    tempPinStore.delete(telegramId);
    ctx.session.conversation = {};
    console.error('[Onboarding] Wallet creation failed:', err);
    await ctx.reply(
      '❌ Something went wrong creating your wallet. Please try /start again.',
    );
  }
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
