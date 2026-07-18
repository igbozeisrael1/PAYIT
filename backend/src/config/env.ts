import { z } from 'zod';
import { config } from 'dotenv';

config();

const envSchema = z.object({
  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(10, 'TELEGRAM_BOT_TOKEN is required'),

  // Monad
  MONAD_RPC_URL: z.string().url(),
  MONAD_CHAIN_ID: z.coerce.number().int().positive(),

  // Operator wallet (backend signer for relaying contract calls)
  OPERATOR_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid OPERATOR_PRIVATE_KEY format'),

  // Smart contracts
  INVOICE_LEDGER_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  ESCROW_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  USDC_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/),

  // Database
  DATABASE_URL: z.string().url(),

  // Security
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  MAGIC_LINK_SECRET: z.string().min(32, 'MAGIC_LINK_SECRET must be at least 32 chars'),
  SESSION_SECRET: z.string().min(16),

  // AI
  GROQ_API_KEY: z.string().optional(),
  AI_ENABLED: z.string().transform(v => v === 'true').default('true'),

  // On-ramp
  RAMP_PROVIDER: z.enum(['stub', 'flutterwave', 'paystack']).default('stub'),
  RAMP_API_KEY: z.string().optional(),
  RAMP_SECRET_KEY: z.string().optional(),
  RAMP_WEBHOOK_SECRET: z.string().optional(),

  // Tax
  VAT_RATE: z.coerce.number().min(0).max(1).default(0.075),
  WHT_DEFAULT_RATE: z.coerce.number().min(0).max(1).default(0.05),

  // App
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DASHBOARD_URL: z.string().url().default('http://localhost:5173'),
  BOT_WEBHOOK_URL: z.string().url().optional(),

  // Escrow
  ESCROW_DEFAULT_EXPIRY_SECONDS: z.coerce.number().int().positive().default(1209600),

  // Rate limiting
  PIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  PIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
  console.error(parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
