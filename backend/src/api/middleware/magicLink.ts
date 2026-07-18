/**
 * magicLink.ts — Magic link authentication for the web dashboard.
 *
 * Flow:
 *  1. User sends /dashboard to the Telegram bot
 *  2. Bot generates a single-use token (256-bit random)
 *  3. Bot sends user a link: https://payit.app/auth?token=<token>
 *  4. User opens the link in their browser
 *  5. This middleware validates the token, creates a JWT session, redirects to dashboard
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../../db/client.js';
import { env } from '../../config/env.js';

// ─── Generate a magic link token ─────────────────────────────────────────────

export async function generateMagicLink(userId: string): Promise<string> {
  const { randomBytes } = await import('crypto');
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await prisma.magicLink.create({
    data: { userId, token, expiresAt },
  });

  return `${env.DASHBOARD_URL}/auth?token=${token}`;
}

// ─── Validate magic link and issue JWT ───────────────────────────────────────

export async function validateMagicLink(req: Request, res: Response): Promise<void> {
  const token = req.query['token'] as string;

  if (!token) {
    res.status(400).json({ error: 'Missing token' });
    return;
  }

  const magicLink = await prisma.magicLink.findUnique({ where: { token } });

  if (!magicLink || magicLink.used || magicLink.expiresAt < new Date()) {
    res.status(401).json({ error: 'Invalid or expired link. Please request a new one from the bot.' });
    return;
  }

  // Mark used
  await prisma.magicLink.update({ where: { id: magicLink.id }, data: { used: true } });

  // Issue JWT
  const jwtToken = jwt.sign(
    { userId: magicLink.userId, type: 'dashboard' },
    env.JWT_SECRET,
    { expiresIn: '7d' },
  );

  // Redirect to dashboard with JWT in cookie
  res
    .cookie('payit_token', jwtToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    })
    .redirect('/dashboard');
}

// ─── JWT authentication middleware ────────────────────────────────────────────

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.['payit_token'] as string | undefined
    ?? (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined);

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { userId: string };
    (req as Request & { userId: string }).userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}
