/**
 * pin.ts — PIN hashing and verification utilities.
 *
 * We use bcrypt (cost factor 12) to hash PINs for storage.
 * This is separate from the scrypt key-derivation in crypto.ts:
 *   - The bcrypt hash in the DB is used to VERIFY a PIN is correct before
 *     decrypting the wallet key (so we don't attempt decryption with wrong PINs).
 *   - scrypt in crypto.ts derives the AES key from the raw PIN at signing time.
 *
 * PIN rules:
 *   - 4 to 6 digits (0-9 only)
 *   - Never stored in plaintext anywhere
 */

import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 12;

const PIN_REGEX = /^\d{4,6}$/;

// ─── Validation ───────────────────────────────────────────────────────────────

export function validatePin(pin: string): { valid: boolean; error?: string } {
  if (!PIN_REGEX.test(pin)) {
    return { valid: false, error: 'PIN must be 4–6 digits (numbers only)' };
  }
  // Reject trivially guessable PINs
  const trivial = ['0000', '1234', '1111', '123456', '000000', '111111', '123123'];
  if (trivial.includes(pin)) {
    return { valid: false, error: 'PIN is too easy to guess. Choose a less obvious number.' };
  }
  return { valid: true };
}

// ─── Hashing ──────────────────────────────────────────────────────────────────

/**
 * Hash a PIN for storage using bcrypt.
 * This is async to avoid blocking the Node.js event loop.
 */
export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, BCRYPT_ROUNDS);
}

/**
 * Verify a raw PIN against its stored bcrypt hash.
 * Returns true if the PIN matches, false otherwise.
 * Always takes the same time to prevent timing attacks.
 */
export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

// ─── Rate limiting helpers (used by auth middleware) ──────────────────────────

export interface PinAttemptState {
  attempts: number;
  lockedUntil: Date | null;
}

/**
 * Check if a user's PIN entry is currently locked.
 */
export function isPinLocked(state: PinAttemptState): boolean {
  if (!state.lockedUntil) return false;
  return state.lockedUntil > new Date();
}

/**
 * Get a human-readable message for how long the lockout lasts.
 */
export function getLockoutMessage(state: PinAttemptState): string {
  if (!state.lockedUntil) return '';
  const msRemaining = state.lockedUntil.getTime() - Date.now();
  const minutesRemaining = Math.ceil(msRemaining / 60000);
  return `Too many failed attempts. Try again in ${minutesRemaining} minute${minutesRemaining === 1 ? '' : 's'}.`;
}
