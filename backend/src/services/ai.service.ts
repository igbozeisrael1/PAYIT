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

  // ── Image Intent Understanding (NVIDIA NIM) ──────────────────────────────
  async parseImageIntent(userId: string, imageUrl: string): Promise<ParsedIntent> {
    if (!env.NVIDIA_API_KEY) throw new Error('Nvidia API key not configured');

    const openai = new (await import('openai')).default({
      baseURL: 'https://integrate.api.nvidia.com/v1',
      apiKey: env.NVIDIA_API_KEY,
    });

    const prompt = `
You are a financial AI assistant. The user has uploaded an image (like a physical bill, QR code, or invoice screenshot).
Extract payment intent details if present. If it looks like a bill or request for payment, extract the amount and the recipient.
Return a pure JSON object matching the function arguments for sendMoney: {"amount": "number", "recipient": "string"}.
If you cannot identify payment details, return an empty object {}.
    `.trim();

    try {
      const response = await openai.chat.completions.create({
        model: 'meta/llama-3.2-90b-vision-instruct',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
        temperature: 0.2,
        max_tokens: 512,
      });

      const content = response.choices[0]?.message?.content || '{}';
      
      // Clean markdown if present
      const jsonStr = content.replace(/^```json/i, '').replace(/```$/i, '').trim();
      const parsedJson = JSON.parse(jsonStr);

      if (parsedJson.amount && parsedJson.recipient) {
        return {
          intent: 'sendMoney',
          confidence: 0.9,
          args: parsedJson,
          confirmationText: `Send $${parsedJson.amount} to ${parsedJson.recipient}`,
          requiresPin: true,
        };
      }

      return {
        intent: 'unknown',
        confidence: 0,
        args: {},
        confirmationText: 'Could not understand the image',
        requiresPin: false,
      };

    } catch (e: any) {
      console.error('[AI] Vision parsing failed:', e);
      return {
        intent: 'unknown',
        confidence: 0,
        args: {},
        confirmationText: 'Vision parsing failed',
        requiresPin: false,
      };
    }
  }

  // ── Document Intent Understanding (NVIDIA NIM) ───────────────────────────
  async parseDocumentIntent(userId: string, documentText: string): Promise<ParsedIntent> {
    if (!env.NVIDIA_API_KEY) throw new Error('Nvidia API key not configured');

    const openai = new (await import('openai')).default({
      baseURL: 'https://integrate.api.nvidia.com/v1',
      apiKey: env.NVIDIA_API_KEY,
    });

    const prompt = `
You are a financial AI assistant. The user has uploaded a document (like an Excel sheet or CSV). 
Here is a sample of the document content:
"""
${documentText}
"""

Extract payment intent details if present. If it looks like a request for payment or payroll, extract the total amount and the recipient (or group of recipients).
Return a pure JSON object matching the function arguments for sendMoney: {"amount": "number", "recipient": "string"}.
If you cannot identify payment details, return an empty object {}.
    `.trim();

    try {
      const response = await openai.chat.completions.create({
        model: 'meta/llama-3.1-70b-instruct',
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.2,
        max_tokens: 512,
      });

      const content = response.choices[0]?.message?.content || '{}';
      
      // Clean markdown if present
      const jsonStr = content.replace(/^```json/i, '').replace(/```$/i, '').trim();
      const parsedJson = JSON.parse(jsonStr);

      if (parsedJson.amount && parsedJson.recipient) {
        return {
          intent: 'sendMoney',
          confidence: 0.9,
          args: parsedJson,
          confirmationText: `Send $${parsedJson.amount} to ${parsedJson.recipient}`,
          requiresPin: true,
        };
      }

      return {
        intent: 'unknown',
        confidence: 0,
        args: {},
        confirmationText: 'Could not understand the document',
        requiresPin: false,
      };

    } catch (e: any) {
      console.error('[AI] Document parsing failed:', e);
      return {
        intent: 'unknown',
        confidence: 0,
        args: {},
        confirmationText: 'Document parsing failed',
        requiresPin: false,
      };
    }
  }
}

export const aiService = new AiService();

// ─── Groq Invoice Image Generation ─────────────────────────────────────────────

interface InvoiceImageParams {
  businessName: string;
  clientName: string;
  invoiceId: string;
  totalAmount: string;
  depositAddress: string;
  items: Array<{ description: string; quantity: number; unitPrice: number }>;
  fiatCurrency: string;
  fiatAccountNumber: string;
  businessLogo?: string | null;
}

export async function generateInvoiceImage(params: InvoiceImageParams): Promise<Buffer> {
  const sharp = (await import('sharp')).default;

  let logoSvg = '';
  if (params.businessLogo && params.businessLogo.startsWith('http')) {
    try {
      const response = await fetch(params.businessLogo);
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        const mimeType = response.headers.get('content-type') || 'image/png';
        
        // Render logo, pushing business name text down slightly
        logoSvg = `<image x="660" y="70" width="60" height="60" href="data:${mimeType};base64,${base64}" preserveAspectRatio="xMaxYMid meet" />`;
      }
    } catch (e) {
      console.error('[Invoice Image] Failed to load business logo:', e);
    }
  }

  const svgCode = `
<svg width="800" height="1000" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f8fafc" />
      <stop offset="100%" stop-color="#e2e8f0" />
    </linearGradient>
    <linearGradient id="headerGradient" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#3b82f6" />
      <stop offset="100%" stop-color="#1d4ed8" />
    </linearGradient>
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
      <feDropShadow dx="0" dy="4" stdDeviation="10" flood-opacity="0.05"/>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="800" height="1000" fill="url(#bgGradient)" />

  <!-- Main Card -->
  <rect x="40" y="40" width="720" height="920" rx="20" fill="#ffffff" filter="url(#shadow)" />

  <!-- Header Section -->
  <path d="M 40 60 Q 40 40 60 40 L 740 40 Q 760 40 760 60 L 760 180 L 40 180 Z" fill="url(#headerGradient)" />
  <text x="80" y="100" font-family="Arial, sans-serif" font-size="36" font-weight="bold" fill="#ffffff">INVOICE</text>
  <text x="80" y="140" font-family="Arial, sans-serif" font-size="16" fill="#bfdbfe">Invoice ID: ${params.invoiceId}</text>
  
  ${logoSvg}
  <text x="720" y="${logoSvg ? '150' : '100'}" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="#ffffff" text-anchor="end">${params.businessName.substring(0, 30)}</text>
  
  <!-- Client Info -->
  <text x="80" y="240" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#64748b">BILLED TO</text>
  <text x="80" y="270" font-family="Arial, sans-serif" font-size="22" font-weight="bold" fill="#0f172a">${params.clientName.substring(0, 30)}</text>
  
  <!-- Payment Details -->
  <text x="400" y="220" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#64748b">PAYMENT METHOD 1 (CRYPTO)</text>
  <text x="400" y="240" font-family="monospace" font-size="14" fill="#3b82f6">${params.depositAddress}</text>
  
  <text x="400" y="280" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#64748b">PAYMENT METHOD 2 (FIAT - ${params.fiatCurrency})</text>
  <text x="400" y="300" font-family="monospace" font-size="14" fill="#3b82f6">Bank: Test Bank (${params.fiatCurrency})</text>
  <text x="400" y="320" font-family="monospace" font-size="14" fill="#3b82f6">Account No: ${params.fiatAccountNumber}</text>
  
  <!-- Table Header -->
  <rect x="80" y="360" width="640" height="40" rx="8" fill="#f1f5f9" />
  <text x="100" y="385" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#475569">DESCRIPTION</text>
  <text x="500" y="385" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#475569" text-anchor="end">QTY</text>
  <text x="600" y="385" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#475569" text-anchor="end">PRICE</text>
  <text x="700" y="385" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#475569" text-anchor="end">TOTAL</text>

  <!-- Items -->
  ${params.items.slice(0, 8).map((item, index) => {
    const y = 435 + index * 45;
    const itemTotal = (item.quantity * item.unitPrice).toFixed(2);
    return `
      <text x="100" y="${y}" font-family="Arial, sans-serif" font-size="14" fill="#1e293b">${item.description.substring(0, 40)}</text>
      <text x="500" y="${y}" font-family="Arial, sans-serif" font-size="14" fill="#64748b" text-anchor="end">${item.quantity}</text>
      <text x="600" y="${y}" font-family="Arial, sans-serif" font-size="14" fill="#64748b" text-anchor="end">$${item.unitPrice.toFixed(2)}</text>
      <text x="700" y="${y}" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#0f172a" text-anchor="end">$${itemTotal}</text>
      <line x1="80" y1="${y + 15}" x2="720" y2="${y + 15}" stroke="#e2e8f0" stroke-width="1" />
    `;
  }).join('')}

  <!-- Total Section -->
  <rect x="450" y="800" width="270" height="100" rx="12" fill="#eff6ff" />
  <text x="480" y="840" font-family="Arial, sans-serif" font-size="16" fill="#3b82f6">Total Amount Due</text>
  <text x="480" y="875" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="#1d4ed8">$${params.totalAmount} USDC</text>

  <!-- Footer -->
  <text x="400" y="950" font-family="Arial, sans-serif" font-size="14" fill="#94a3b8" text-anchor="middle">Powered by PayIT on Monad Network</text>
</svg>
  `.trim();

  // Convert SVG to PNG Buffer using Sharp
  const pngBuffer = await sharp(Buffer.from(svgCode))
    .png()
    .toBuffer();

  return pngBuffer;
}
