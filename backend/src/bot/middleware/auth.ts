/**
 * auth.ts — Authentication middleware for PayIT bot.
 *
 * Loads the authenticated user from the database on each update
 * and enriches the context. Commands for unregistered users are blocked
 * with a prompt to run /start.
 *
 * Also handles the admin kill-switch: frozen accounts receive a notice
 * that their account is under review, without revealing why.
 */

import { Middleware } from 'grammy';
import { prisma } from '../../db/client.js';
import { PayITContext } from './session.js';

// Commands that don't require a registered user
const PUBLIC_COMMANDS = new Set(['/start', '/help', '/restore']);

export const authMiddleware: Middleware<PayITContext> = async (ctx, next) => {
  // Allow non-message updates through (e.g., callback queries are handled by their own flow)
  const messageText = ctx.message?.text ?? '';
  const isCommand = messageText.startsWith('/');
  const commandName = isCommand ? messageText.split(' ')[0]?.toLowerCase() : null;

  // Always allow public commands through
  if (commandName && PUBLIC_COMMANDS.has(commandName)) {
    return next();
  }

  // Allow onboarding callbacks through
  if (ctx.callbackQuery?.data?.startsWith('type_') || ctx.callbackQuery?.data === 'action_start_onboarding') {
    return next();
  }

  // Allow if user is actively in the onboarding flow
  if (ctx.session.conversation?.step) {
    return next();
  }

  // Require a registered Telegram user
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) {
    return; // Ignore updates without a sender
  }

  // Look up user in DB
  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: {
      id: true,
      isActive: true,
      isFrozen: true,
      accountType: true,
      activeWallet: true,
      pinAttempts: true,
      pinLockedUntil: true,
    },
  });

  if (!user) {
    // Not registered — prompt to onboard
    if (isCommand || ctx.message?.text) {
      const { InlineKeyboard } = await import('grammy');
      const keyboard = new InlineKeyboard().text('🚀 Create Account', 'action_start_onboarding');

      await ctx.reply(
        '👋 Welcome to *PayIT*! You don\'t have an Account yet.\n\n' +
        'Click the button below to create your account in under 2 minutes.',
        { parse_mode: 'Markdown', reply_markup: keyboard },
      );
    }
    return;
  }

  if (!user.isActive) {
    await ctx.reply('Your account is currently inactive. Please contact support.');
    return;
  }

  if (user.isFrozen) {
    await ctx.reply(
      '⚠️ Your account is temporarily restricted. Please contact PayIT support for assistance.',
    );
    return;
  }

  // Enrich session with user data
  ctx.session.userId = user.id;
  ctx.session.onboarded = true;
  ctx.session.activeWallet = user.activeWallet;

  return next();
};
