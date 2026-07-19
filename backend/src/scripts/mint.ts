import { ethers } from 'ethers';
import { env } from '../config/env.js';

const usdcAbi = [
  "function mint(address to, uint256 amount) external"
];

async function mintTokens() {
  const toAddress = process.argv[2];
  const amountStr = process.argv[3] || '1000'; // Default 1000 USDC

  if (!toAddress) {
    console.error('❌ Please provide a destination address: npx tsx src/scripts/mint.ts <address> [amount]');
    process.exit(1);
  }

  console.log(`🏦 Connecting to Monad...`);
  const provider = new ethers.JsonRpcProvider(env.MONAD_RPC_URL);
  const signer = new ethers.Wallet(env.OPERATOR_PRIVATE_KEY, provider);
  const mockUsdc = new ethers.Contract(env.USDC_ADDRESS, usdcAbi, signer);

  const amountUnits = ethers.parseUnits(amountStr, 6);
  
  console.log(`🪙 Minting ${amountStr} MockUSDC to ${toAddress}...`);
  try {
    const tx = await mockUsdc.mint(toAddress, amountUnits);
    console.log(`⏳ Waiting for transaction confirmation... Hash: ${tx.hash}`);
    await tx.wait();
    console.log(`✅ Successfully minted ${amountStr} MockUSDC to ${toAddress}!`);
  } catch (err: any) {
    console.error(`❌ Minting failed:`, err.message);
  }
}

mintTokens();
