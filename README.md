# PayIT — Telegram-Native USDC Wallet on Monad

**PayIT** is a non-custodial digital wallet and SME finance tool built as a Telegram bot on top of the **Monad** blockchain. Users send and receive USDC, issue invoices with VAT/WHT support, and manage business finances — all from inside Telegram.

---

## Architecture at a Glance

```
PayITMonad/
├── contracts/    Foundry smart contracts (Solidity)
│                 ├── PayITInvoiceLedger.sol  — On-chain tamper-proof invoice ledger
│                 ├── PayITEscrow.sol          — Pending transfer escrow
│                 └── mocks/MockUSDC.sol       — Testnet ERC-20
│
├── backend/      Node.js / TypeScript monolith
│                 ├── bot/       grammY Telegram bot (primary UX)
│                 ├── services/  Business logic (wallet, blockchain, AI, tax, etc.)
│                 ├── db/        Prisma + PostgreSQL
│                 └── api/       Express REST API for dashboard
│
└── dashboard/    Vite + React web dashboard (read-only companion)
```

---

## Network: Monad

| | Testnet | Mainnet |
|--|--|--|
| Chain ID | 10143 | 143 |
| RPC | `https://testnet-rpc.monad.xyz` | `https://rpc.monad.xyz` |
| Explorer | `testnet.monadvision.com` | `monadvision.com` |
| USDC | MockUSDC (deploy yourself) | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` |

---

## Prerequisites

- **Node.js** v20+
- **PostgreSQL** (local or remote)
- **Telegram Bot Token** — get from [@BotFather](https://t.me/BotFather)
- **Groq API Key** — get from [console.groq.com](https://console.groq.com) (optional, for AI assistant)
- **Foundry** (WSL or Git Bash on Windows) — for smart contract deployment

---

## Quick Start

### 1. Smart Contracts

Install Foundry (in WSL or Git Bash):
```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

Deploy to Monad testnet:
```bash
cd contracts
forge install  # If you have OpenZeppelin dependencies
forge script script/Deploy.s.sol \
  --rpc-url https://testnet-rpc.monad.xyz \
  --private-key $OPERATOR_PRIVATE_KEY \
  --broadcast
```

Copy the deployed contract addresses from the output.

### 2. Backend

```bash
cd backend
cp .env.example .env
# Edit .env — fill in:
#   TELEGRAM_BOT_TOKEN
#   OPERATOR_PRIVATE_KEY
#   INVOICE_LEDGER_ADDRESS
#   ESCROW_ADDRESS
#   USDC_ADDRESS
#   DATABASE_URL
#   JWT_SECRET, MAGIC_LINK_SECRET
#   GROQ_API_KEY (optional)

npm install
npx prisma generate
npx prisma migrate dev --name init
npm run dev
```

### 3. Dashboard

```bash
cd dashboard
cp .env.example .env  # set VITE_API_URL=http://localhost:3000
npm install
npm run dev
```

Dashboard will be available at `http://localhost:5173`.

---

## Bot Commands

| Command | Description |
|--|--|
| `/start` | Create wallet or open main menu |
| `/send` | Send USDC to a user or address |
| `/receive` | Get payment link + QR code |
| `/deposit` | Naira → USDC on-ramp |
| `/withdraw` | USDC → Naira off-ramp |
| `/balance` | Check wallet balance |
| `/invoices` | Invoice management (Business) |
| `/history` | Transaction history |
| `/switch` | Toggle Personal ↔ Business wallet |
| `/restore` | Restore wallet from recovery phrase |
| `/help` | Command reference |

You can also type naturally — the AI assistant (powered by Groq) will parse your message and help you take action.

---

## Smart Contract Design

### PayITInvoiceLedger
- Creates tamper-proof invoice records on Monad
- On payment, atomically splits: net amount → business wallet, WHT → holding address
- All records are publicly readable for auditors and tax authorities
- Events: `InvoiceCreated`, `InvoicePaid`, `InvoiceCancelled`

### PayITEscrow
- Holds USDC for transfers to unregistered users
- Releases on claim when recipient joins PayIT
- Permissionless refund after expiry (default 14 days)
- Events: `Deposited`, `Claimed`, `Refunded`

---

## Security Design

| Layer | Mechanism |
|--|--|
| Private key storage | AES-256-GCM, PIN-derived key via scrypt (N=2^17) |
| PIN verification | bcrypt (rounds=12) checked before scrypt decrypt |
| PIN rate limiting | 5 attempts → 15 min lockout |
| Recovery phrase | Shown once, never stored, BIP-39 12-word |
| Admin kill-switch | `isFrozen` flag freezes account UI, not funds |
| Dashboard auth | Single-use magic links → HTTP-only JWT cookie |
| AI security | AI never executes actions; user PIN required for all money movement |

---

## Adding a Real On-Ramp Provider

The `backend/src/services/ramp.service.ts` has a clean stub interface.
To add Flutterwave:

1. Set `RAMP_PROVIDER=flutterwave` in `.env`
2. Implement the `flutterwave` branch in `_fetchRate()`, `initiateDeposit()`, and `initiateWithdrawal()`
3. Add webhook endpoint in `backend/src/api/index.ts` for payment confirmation callbacks

---

## Environment Variables

See [`backend/.env.example`](backend/.env.example) for the full list with comments.

---

## Development Tips

- Run `npx prisma studio` to browse the database visually
- The bot runs in polling mode locally (`BOT_WEBHOOK_URL` empty = polling)
- Set `GROQ_API_KEY` to enable the AI assistant; without it, all bot commands still work
- MockUSDC has a public `mint()` function — use it to fund test wallets
- The dashboard is read-only in v1; all money-moving actions require the Telegram bot

---

## License

MIT
