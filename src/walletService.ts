import { ethers } from 'ethers';

interface TransactionOptions {
  amount: number; // Amount in dollars to send
  tokenPrice: number; // Current token price in USD
  walletAddress: string; // Recipient wallet address
  riskLevel: 'low' | 'medium' | 'high'; // Risk level for tracking
}

export async function sendTransaction(options: TransactionOptions): Promise<string> {
  try {
    // Connect to Sonic testnet
    const provider = new ethers.JsonRpcProvider('https://rpc.blaze.soniclabs.com');
    
    // Use private key from environment variables for security
    const privateKey = process.env.WALLET_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('Wallet private key not found in environment variables');
    }
    
    const wallet = new ethers.Wallet(privateKey, provider);
    
    // Calculate token amount based on USD value and current price
    const tokenAmount = ethers.parseEther((options.amount / options.tokenPrice).toString());
    
    // Create transaction
    const tx = {
      to: options.walletAddress,
      value: tokenAmount,
      // Include risk level in transaction data for tracking
      data: ethers.hexlify(ethers.toUtf8Bytes(`Investment: ${options.riskLevel} risk`)),
    };
    
    // Send transaction
    const receipt = await wallet.sendTransaction(tx);
    console.log(`Transaction submitted: ${receipt.hash}`);
    
    // Wait for transaction to be mined
    const confirmedReceipt = await receipt.wait();
    console.log(`Transaction confirmed in block ${confirmedReceipt?.blockNumber}`);
    
    return receipt.hash;
  } catch (error) {
    console.error('Error sending transaction:', error);
    throw new Error('Failed to send transaction');
  }
}

// Helper function to check if a transaction was successful
export async function checkTransactionStatus(txHash: string): Promise<boolean> {
  try {
    const provider = new ethers.JsonRpcProvider('https://rpc.blaze.soniclabs.com');
    const receipt = await provider.getTransactionReceipt(txHash);
    
    // If receipt exists and status is 1, transaction was successful
    return receipt !== null && receipt.status === 1;
  } catch (error) {
    console.error('Error checking transaction status:', error);
    return false;
  }
}