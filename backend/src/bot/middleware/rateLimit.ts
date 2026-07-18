/**
 * rateLimit.ts — Per-user command rate limiting middleware.
 *
 * Prevents spam and abuse by limiting how frequently a user can
 * trigger bot commands. Uses a simple in-memory sliding window.
 * For production, replace with a Redis-backed store.
 */

import { Middleware } from 'grammy';
import { PayITContext } from './session.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const WINDOW_MS = 60_000;    // 1-minute window
const MAX_REQUESTS = 30;     // Max requests per window per user

// ─── In-Memory Store ─────────────────────────────────────────────────────────

interface RateEntry {
  timestamps: number[];
}

const store = new Map<string, RateEntry>();

// Clean up stale entries every 5 minutes to avoid memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < WINDOW_MS);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}, 5 * 60_000);

// ─── Middleware ───────────────────────────────────────────────────────────────

export const rateLimitMiddleware: Middleware<PayITContext> = async (ctx, next) => {
  const key = ctx.from?.id?.toString();
  if (!key) return next();

  const now = Date.now();
  const entry = store.get(key) ?? { timestamps: [] };

  // Filter to current window
  entry.timestamps = entry.timestamps.filter((t) => now - t < WINDOW_MS);

  if (entry.timestamps.length >= MAX_REQUESTS) {
    await ctx.reply(
      '⏱ You\'re sending messages too quickly. Please slow down and try again in a moment.',
    );
    return;
  }

  entry.timestamps.push(now);
  store.set(key, entry);

  return next();
};
