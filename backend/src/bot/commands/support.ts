import { InlineKeyboard } from 'grammy';
import { PayITContext } from '../middleware/session.js';
import { aiService } from '../../services/ai.service.js';

export async function handleSupportCommand(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  ctx.session.conversation.step = 'support_chat';

  const keyboard = new InlineKeyboard()
    .text('❌ End Support Chat', 'action_support_end');

  await ctx.reply(
    '🎧 *PayIT Support*\n\n' +
    'Hi! I am the PayIT AI Support Assistant. How can I help you today?',
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

export async function handleSupportMessage(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  const userId = ctx.session.userId;
  const text = ctx.message?.text;
  if (!telegramId || !userId || !text) return;

  await ctx.replyWithChatAction('typing');

  try {
    const parsed = await aiService.parseIntent(userId, `Support request: ${text}`);
    
    const keyboard = new InlineKeyboard()
      .text('❌ End Support Chat', 'action_support_end');

    if (parsed.intent !== 'unknown') {
        // AI found an action
        await ctx.reply(`I can help you with that! Are you trying to ${parsed.confirmationText}? If so, you can use the main menu options, or I can try to set it up for you if you type it clearly here.`, { reply_markup: keyboard });
    } else {
        // AI gave conversational response
        await ctx.reply(`🤖 ${parsed.confirmationText}`, { reply_markup: keyboard });
    }

  } catch (err) {
    await ctx.reply('I am having trouble connecting to my knowledge base right now. Please try again later.');
  }
}

export async function handleSupportEnd(ctx: PayITContext): Promise<void> {
    ctx.session.conversation.step = undefined;
    await ctx.answerCallbackQuery();
    await ctx.reply('Support chat ended. Use the menu to continue.');
}
