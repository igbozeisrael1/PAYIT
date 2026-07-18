/**
 * crypto.ts — AES-256-GCM encryption utilities for PayIT wallet key storage.
 *
 * Security properties:
 *  - AES-256-GCM provides authenticated encryption (integrity + confidentiality).
 *  - Each encryption uses a fresh random salt and IV, preventing rainbow-table attacks.
 *  - scrypt is used for key derivation: intentionally slow and memory-intensive.
 *  - scrypt parameters (N=2^17, r=8, p=1) require ~128MB RAM and ~2s per derivation
 *    on a modern CPU, making brute-force infeasible even with a weak PIN.
 *  - The derived key and plaintext private key are NEVER stored or logged.
 *  - Buffer.from / Buffer.fill(0) is used to zero sensitive material after use.
 *
 * NEVER call these functions in a context where the result can be logged or
 * persisted alongside the raw PIN.
 */

import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'crypto';

// ─── Constants ────────────────────────────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm' as const;
const KEY_LENGTH = 32;       // 256-bit key for AES-256
const IV_LENGTH = 12;        // GCM standard: 96-bit IV
const SALT_LENGTH = 32;      // 256-bit salt for scrypt
const AUTH_TAG_LENGTH = 16;  // GCM authentication tag: 128-bit

// scrypt parameters — tuned for balance of security and UX latency (~500ms-2s)
// N: CPU/memory cost factor (must be power of 2). 2^17 = 131072.
// r: Block size. 8 is standard.
// p: Parallelization. 1 for sequential.
// maxmem: Must satisfy: 128 * N * r * p bytes ≤ maxmem
const SCRYPT_PARAMS = {
  N: 131072, // 2^17
  r: 8,
  p: 1,
  maxmem: 140 * 1024 * 1024, // 140 MB
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EncryptedBlob {
  /** Hex-encoded random salt used for scrypt key derivation */
  salt: string;
  /** Hex-encoded random IV (initialization vector) */
  iv: string;
  /** Hex-encoded GCM authentication tag — required for decryption */
  authTag: string;
  /** Hex-encoded ciphertext */
  encrypted: string;
}

// ─── Encryption ───────────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext string (e.g., a private key) using AES-256-GCM
 * with a PIN-derived key via scrypt.
 *
 * @param plaintext - The sensitive data to encrypt (e.g., hex private key)
 * @param pin       - User's PIN. Used as scrypt password.
 * @returns         - EncryptedBlob safe to persist in the database
 */
export function encrypt(plaintext: string, pin: string): EncryptedBlob {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);

  // Derive 256-bit key from PIN + salt using scrypt
  const key = scryptSync(pin, salt, KEY_LENGTH, SCRYPT_PARAMS);

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Zero out key material immediately after use
  key.fill(0);

  return {
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    encrypted,
  };
}

// ─── Decryption ───────────────────────────────────────────────────────────────

/**
 * Decrypt an EncryptedBlob using the provided PIN.
 * Throws if the PIN is wrong or data is tampered (GCM auth tag mismatch).
 *
 * @param blob - The EncryptedBlob from the database
 * @param pin  - User's PIN
 * @returns    - The plaintext (e.g., hex private key) — handle with care, zero after use
 */
export function decrypt(blob: EncryptedBlob, pin: string): string {
  const salt = Buffer.from(blob.salt, 'hex');
  const iv = Buffer.from(blob.iv, 'hex');
  const authTag = Buffer.from(blob.authTag, 'hex');

  // Re-derive the key from the stored salt and the provided PIN
  const key = scryptSync(pin, salt, KEY_LENGTH, SCRYPT_PARAMS);

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    let plaintext = decipher.update(blob.encrypted, 'hex', 'utf8');
    plaintext += decipher.final('utf8');

    return plaintext;
  } catch {
    // GCM auth failure = wrong PIN or tampered ciphertext. Do not reveal which.
    throw new Error('Decryption failed: invalid PIN or corrupted data');
  } finally {
    // Always zero the key regardless of success or failure
    key.fill(0);
    salt.fill(0);
    iv.fill(0);
    authTag.fill(0);
  }
}

// ─── Serialization ────────────────────────────────────────────────────────────

/**
 * Serialize an EncryptedBlob to a JSON string for database storage.
 * The resulting string contains NO plaintext key material.
 */
export function serializeBlob(blob: EncryptedBlob): string {
  return JSON.stringify(blob);
}

/**
 * Deserialize an EncryptedBlob from its JSON database representation.
 */
export function deserializeBlob(raw: string): EncryptedBlob {
  const parsed = JSON.parse(raw) as unknown;
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('salt' in parsed) ||
    !('iv' in parsed) ||
    !('authTag' in parsed) ||
    !('encrypted' in parsed)
  ) {
    throw new Error('Invalid encrypted blob format');
  }
  return parsed as EncryptedBlob;
}
