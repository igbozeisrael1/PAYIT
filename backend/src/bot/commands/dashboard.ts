/**
 * dashboard.ts — /dashboard command: generates a magic link for web access.
 */

import { PayITContext } from '../middleware/session.js';
import { generateMagicLink } from '../../api/middleware/magicLink.js';

export async function handleDashboardCommand(ctx: PayITContext): Promise<void> {
  const userId = ctx.session.userId;
  if (!userId) return;

  try {
    const link = await generateMagicLink(userId);

    await ctx.reply(
      `🌐 *PayIT Dashboard*\n\n` +
      `Here's your personal access link:\n\n${link}\n\n` +
      `⚠️ This link expires in *10 minutes* and can only be used once.\n` +
      `Do not share it — it grants full access to your dashboard.`,
      { parse_mode: 'Markdown' },
    );
  } catch {
    await ctx.reply('❌ Failed to generate dashboard link. Please try again.');
  }
}
