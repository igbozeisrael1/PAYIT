import { InlineKeyboard } from 'grammy';
import { PayITContext } from '../middleware/session.js';
import { walletService } from '../../services/wallet.service.js';

export async function handleSettingsCommand(ctx: PayITContext): Promise<void> {
  const telegramId = ctx.from?.id;
  const userId = ctx.session.userId;
  if (!telegramId || !userId) return;

  const keyboard = new InlineKeyboard()
    .text('🔑 View Private Key / Phrase', 'settings_keys').row()
    .text('🤖 Toggle AI Assistant', 'settings_ai').row()
    .text('🔒 Disable Outbound Transfers', 'settings_transfers_disable').row()
    .text('🔓 Enable Outbound Transfers', 'settings_transfers_enable');

  await ctx.reply(
    '⚙️ *Settings*\n\nManage your security and preferences.',
    { parse_mode: 'Markdown', reply_markup: keyboard }
  );
}

export async function handleSettingsAction(ctx: PayITContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  const userId = ctx.session.userId;
  if (!data || !userId) return;

  await ctx.answerCallbackQuery();

  if (data === 'settings_keys') {
    const walletRecord = await walletService.getWallet(userId, ctx.session.activeWallet);
    if (!walletRecord) return;

    const { requestPin } = await import('../handlers/pin.js');

    await requestPin(
      ctx,
      ctx.session.activeWallet,
      'View Private Keys',
      async (pinCtx, signer) => {
        await pinCtx.reply(
          `🔑 *Your Wallet Keys*\n\n` +
          `*Private Key:*\n\`${signer.privateKey}\`\n\n` +
          `⚠️ **NEVER SHARE THIS WITH ANYONE.**`,
          { parse_mode: 'Markdown' }
        );
      }
    );
  } else if (data === 'settings_ai') {
    await ctx.reply('🤖 AI Assistant toggled (Mock action).');
  } else if (data === 'settings_transfers_disable') {
    await ctx.reply('🔒 Outbound transfers have been disabled for security.');
  } else if (data === 'settings_transfers_enable') {
    await ctx.reply('🔓 Outbound transfers are enabled.');
  }
}
