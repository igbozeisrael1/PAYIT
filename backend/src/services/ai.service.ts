/**
 * ai.service.ts — Groq-powered AI assistant for PayIT.
 *
 * Parses natural language user messages into structured intents,
 * then returns pre-filled action payloads for the bot confirmation flow.
 *
 * SECURITY: The AI NEVER executes money-moving actions directly.
 * It only extracts intent + parameters, which are then presented to
 * the user for confirmation via the standard PIN flow.
 */

import Groq from 'groq-sdk';
import { prisma } from '../db/client.js';
import { env } from '../config/env.js';

// ─── Intent Types ─────────────────────────────────────────────────────────────

export type IntentType =
  | 'sendMoney'
  | 'checkBalance'
  | 'createInvoice'
  | 'getLedgerSummary'
  | 'getTransactionHistory'
  | 'checkInvoiceStatus'
  | 'unknown';

export interface ParsedIntent {
  intent: IntentType;
  confidence: number;       // 0.0–1.0
  args: Record<string, unknown>;
  confirmationText: string; // Human-readable summary for bot confirmation screen
  requiresPin: boolean;     // Whether this action needs PIN confirmation
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

const PAYIT_TOOLS: Groq.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'sendMoney',
      description:
        'Transfer USDC to another user or wallet address. Use when user wants to send, pay, or transfer money.',
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'string', description: 'Amount in USD, e.g. "50" or "100.50"' },
          recipient: {
            type: 'string',
            description: 'Recipient identifier: @username, phone number, or 0x wallet address',
          },
        },
        required: ['amount', 'recipient'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'checkBalance',
      description: 'Check current USDC wallet balance',
      parameters: {
        type: 'object',
        properties: {
          walletType: {
            type: 'string',
            enum: ['personal', 'business'],
            description: 'Which wallet to check',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getLedgerSummary',
      description:
        'Get a financial summary of the business ledger — total revenue, VAT collected, WHT withheld. Use when user asks about earnings, income, taxes, or financial summary.',
      parameters: {
        type: 'object',
        properties: {
          month: {
            type: 'string',
            description: 'Month in YYYY-MM format, e.g. "2025-11". Omit for all-time summary.',
          },
          metric: {
            type: 'string',
            enum: ['revenue', 'vat', 'wht', 'all'],
            description: 'Which specific metric to focus on',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getTransactionHistory',
      description:
        'Retrieve transaction history for the active wallet, with optional filters',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['send', 'receive', 'deposit', 'withdraw', 'all'],
          },
          limit: { type: 'number', description: 'Max number of transactions to show' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'checkInvoiceStatus',
      description: 'Check the status of invoices — pending, paid, overdue',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['all', 'pending', 'paid', 'overdue'],
          },
        },
        required: [],
      },
    },
  },
];

// ─── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the AI assistant for PayIT, a Telegram-native USDC wallet built on Monad blockchain for African SMEs and individuals.

Your job is to:
1. Parse the user's natural language message into a structured action
2. Call the appropriate tool with the extracted parameters
3. If details are missing or ambiguous, ask ONE clarifying question instead of guessing

Rules:
- You NEVER send money, sign transactions, or execute financial actions directly
- You extract intent and parameters — the user must confirm before anything happens
- Be concise, friendly, and clear
- For Nigerian users: 1 USDC ≈ 1 USD. They may refer to amounts in Naira or dollars
- If a message is unrelated to finance (e.g., casual chat), respond naturally without calling a tool`;

// ─── Service ──────────────────────────────────────────────────────────────────

class AiService {
  private client: Groq | null = null;

  private getClient(): Groq {
    if (!env.AI_ENABLED || !env.GROQ_API_KEY) {
      throw new Error('AI assistant is not configured. Please set GROQ_API_KEY.');
    }
    if (!this.client) {
      this.client = new Groq({ apiKey: env.GROQ_API_KEY });
    }
    return this.client;
  }

  get isEnabled(): boolean {
    return env.AI_ENABLED && !!env.GROQ_API_KEY;
  }

  /**
   * Parse a natural language message into a structured PayIT intent.
   */
  async parseIntent(userId: string, message: string): Promise<ParsedIntent> {
    const groq = this.getClient();

    let intent: IntentType = 'unknown';
    let args: Record<string, unknown> = {};
    let confidence = 0.5;
    let confirmationText = '';
    let requiresPin = false;
    let rawResponse = '';

    try {
      const response = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: message },
        ],
        tools: PAYIT_TOOLS,
        tool_choice: 'auto',
        max_tokens: 500,
        temperature: 0.1, // Low temperature for deterministic intent parsing
      });

      const choice = response.choices[0];
      if (!choice) throw new Error('No response from AI');

      rawResponse = choice.message.content ?? '';

      // Check if a tool was called
      if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
        const toolCall = choice.message.tool_calls[0]!;
        intent = toolCall.function.name as IntentType;
        args = JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>;
        confidence = 0.9; // High confidence when a specific tool is chosen

        confirmationText = this._buildConfirmationText(intent, args);
        requiresPin = this._requiresPin(intent);
      } else {
        // No tool called — model gave a conversational response
        intent = 'unknown';
        confidence = 0.3;
        confirmationText = rawResponse;
      }
    } catch (err) {
      console.error('[AiService] Intent parsing failed:', err);
      intent = 'unknown';
      confidence = 0.0;
      confirmationText = "I'm having trouble understanding that. Could you rephrase it?";
    }

    // Log to DB for monitoring
    await prisma.aiLog.create({
      data: {
        userId,
        inputMessage: message,
        parsedIntent: intent,
        confidence,
        parsedArgs: args as any,
        wasExecuted: false, // Updated to true after user confirms
      },
    }).catch(() => { /* Non-blocking — don't fail on log write error */ });

    return { intent, confidence, args, confirmationText, requiresPin };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private _buildConfirmationText(intent: IntentType, args: Record<string, unknown>): string {
    switch (intent) {
      case 'sendMoney':
        return `Send *$${args['amount']} USDC* to *${args['recipient']}*`;
      case 'checkBalance':
        return `Check ${args['walletType'] ?? 'current'} wallet balance`;
      case 'getLedgerSummary':
        return `View ${args['month'] ? `${args['month']} ` : ''}ledger summary${args['metric'] ? ` (${args['metric']})` : ''}`;
      case 'getTransactionHistory':
        return `View ${args['type'] ?? 'all'} transaction history`;
      case 'checkInvoiceStatus':
        return `Check ${args['status'] ?? 'all'} invoices`;
      default:
        return 'Unknown action';
    }
  }

  private _requiresPin(intent: IntentType): boolean {
    return intent === 'sendMoney';
  }
}

export const aiService = new AiService();
