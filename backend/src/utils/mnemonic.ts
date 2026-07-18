/**
 * mnemonic.ts — BIP-39 recovery phrase utilities.
 *
 * CRITICAL SECURITY RULES:
 *  - The mnemonic is shown to the user EXACTLY ONCE during onboarding.
 *  - It must NEVER be logged, stored in plaintext, sent to analytics, or
 *    included in any error messages.
 *  - After the user confirms they saved it, it should not be reconstructable
 *    from anything stored in the PayIT database.
 *  - The only way to re-derive the wallet is from the mnemonic itself.
 */

import * as bip39 from 'bip39';

// ─── Generation ───────────────────────────────────────────────────────────────

/**
 * Generate a new 12-word BIP-39 mnemonic phrase.
 * Entropy is sourced from Node.js crypto.randomBytes (CSPRNG).
 * 128 bits of entropy = 12 words.
 */
export function generateMnemonic(): string {
  return bip39.generateMnemonic(128); // 12 words
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate that a string is a valid BIP-39 mnemonic.
 * Used when a user enters their recovery phrase during wallet restore.
 */
export function validateMnemonic(phrase: string): boolean {
  const normalized = phrase.trim().toLowerCase().replace(/\s+/g, ' ');
  return bip39.validateMnemonic(normalized);
}

/**
 * Normalize a mnemonic phrase entered by a user:
 *  - Trim whitespace
 *  - Lowercase
 *  - Collapse multiple spaces to single space
 */
export function normalizeMnemonic(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ─── Seed Derivation ──────────────────────────────────────────────────────────

/**
 * Derive the BIP-39 seed buffer from a mnemonic.
 * This is used ONLY at wallet creation and during recovery.
 * The resulting seed is passed to the wallet service and immediately
 * used to derive the keypair — it is never stored.
 *
 * @param mnemonic - The BIP-39 recovery phrase
 * @returns        - 64-byte seed Buffer
 */
export async function mnemonicToSeed(mnemonic: string): Promise<Buffer> {
  return bip39.mnemonicToSeed(normalizeMnemonic(mnemonic));
}

// ─── Display helpers ──────────────────────────────────────────────────────────

/**
 * Format a mnemonic as a numbered list for display in Telegram.
 * Example output:
 *   1. apple  2. banana  3. cherry  ...
 *
 * Uses a spoiler block so users must consciously tap to reveal it.
 */
export function formatMnemonicForTelegram(mnemonic: string): string {
  const words = mnemonic.split(' ');
  const numbered = words.map((w, i) => `${i + 1}. ${w}`).join('  ');
  // Wrap in a spoiler so it's hidden until the user taps it
  return `||${numbered}||`;
}

/**
 * Split a mnemonic into an array of words.
 * Useful for word-by-word confirmation flows.
 */
export function mnemonicToWords(mnemonic: string): string[] {
  return normalizeMnemonic(mnemonic).split(' ');
}
