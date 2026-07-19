# PayIT on Monad 🚀

PayIT is a simple app inside Telegram that helps African small business owners and everyday people send, save, and manage money using stablecoins, without needing a bank or a separate crypto app.

**Problems it solves:**

- **Hard access to stable money.** Many African currencies lose value fast. PayIT lets people hold and use stable digital dollars instead, protecting their money from local currency swings.
- **Complicated cross-border payments.** Sending or receiving money across borders is often slow and expensive. PayIT makes it fast and simple, right inside a chat app people already use.
- **Messy invoicing for small businesses.** Many SMEs struggle to track invoices, taxes, and payments properly. PayIT gives them a clean way to invoice customers and stay tax compliant, without needing accounting software.
- **Crypto feels too technical for most people.** PayIT hides all the complexity. Users don't need to understand wallets, keys, or blockchains. It just feels like using a simple payments app inside Telegram.
- **No separation between personal and business money.** PayIT gives users separate spaces for personal and business funds, so they can manage both without confusion.

## 🎯 Key Features
1. **Non-Custodial HD Wallets**: Every user gets a unique seed phrase. Keys are AES-encrypted with a user-defined 6-digit PIN before being stored in the database. The backend can only sign transactions when the user actively enters their PIN.
2. **Business Invoicing**: Merchants can dynamically generate professional invoices for clients. The bot automatically creates a unique HD child deposit address for each invoice.
3. **Automated Payment Detection**: A background cron worker automatically monitors the Monad blockchain for payments made to pending invoice addresses. When funds are detected, the bot instantly alerts the merchant on Telegram and provides a one-click "Sweep Funds" button to securely funnel the money into the main business wallet.
4. **Smart Escrow Payments**: Users can send funds securely to other Telegram users using an Escrow smart contract. Funds remain locked until the recipient registers and claims them, ensuring trustless P2P transfers.
5. **Dynamic Receipts (AI & SVG)**: Professional receipts and invoices are generated completely dynamically via code using custom SVG templates and rendered as high-quality images via Sharp, supporting custom fiat currencies and business logos.

## 🛠 Technical Architecture
PayIT relies on a robust and scalable tech stack:

- **Telegram Framework**: [GrammY](https://grammy.dev/) powers the conversational interface and interactive inline keyboards.
- **Backend**: Node.js and TypeScript.
- **Database**: PostgreSQL (hosted on Neon) managed by **Prisma ORM**.
- **Blockchain Interaction**: `ethers.js` connected to the Monad Testnet (`chainId: 10143`).
- **Background Jobs**: `node-cron` orchestrates automatic payment detection and overdue invoice tracking without blocking the main event loop.
- **Image Processing**: `sharp` converts dynamically generated SVGs into high-quality PNGs for Telegram photo delivery.

### Smart Contracts (Monad Testnet)
The contracts are deployed and verified on the Monad testnet:
- **Mock USDC:** `0x754704Bc059F8C67012fEd69BC8A327a5aafb603`
- **PayITInvoiceLedger:** `0x50efB2814FD72a24ceEeCBCCefA97C2bE5df8132` (On-chain registry for merchant invoices, enabling transparent audit trails)
- **PayITESCROW:** `0x9805642AF09a520d36fE5be111Ac4D86A585Bcbf` (Handles locked P2P transfers based on the hashed identifier of the recipient)

## 🔒 Security
- **Strictly Non-Custodial**: Seed phrases are encrypted using AES-256-CBC with the user's PIN acting as the decryption key. The raw seed is never stored or logged.
- **Ephemeral Signers**: Ethers.js Wallet instances are instantiated in memory only when a PIN is provided and immediately zeroed out after the transaction is signed.
- **Lockout Mechanism**: Brute-force attacks against the PIN are mitigated via a strict exponential lockout system in the database.

## 🚀 Local Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/igboze/PayITMonad.git
   cd PayITMonad/backend
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Environment Configuration**:
   Copy the example environment file and fill in your credentials.
   ```bash
   cp .env.example .env
   ```
   *You'll need a Telegram Bot Token (from BotFather), a Neon Postgres Database URL, and your Groq API key.*

4. **Database Migration**:
   ```bash
   npx prisma db push
   npx prisma generate
   ```

5. **Start the Development Server**:
   ```bash
   npm run dev
   ```

This will spin up both the Express API and the Telegram bot polling mechanism simultaneously.
