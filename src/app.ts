import express, { Request, Response } from 'express';
import axios from 'axios';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { analyzeTokenRisk } from './priceAnalysis';
import { sendTransaction } from './walletService';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const RECIPIENT_WALLET = '0x486BEa6B90243d2Ff3EE2723a47605C3361c3d95';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/sonic-investment';

// Define interfaces for type safety
interface PriceResponse {
  [tokenId: string]: {
    usd: number;
  };
}

interface ApiResponse {
  success: boolean;
  price?: number;
  currency?: string;
  token_id?: string;
  timestamp?: string;
  message?: string;
  error?: string;
  analysis?: any;
  user?: any;
  transactionHash?: string;
}

interface InvestmentRequest {
  amount: number;
  riskLevel: 'low' | 'medium' | 'high';
  walletAddress?: string;
}

interface UserRequest {
  walletAddress: string;
  lastSeen?: string;
  chainId?: string;
}

interface InvestmentRecord {
  amount: number;
  riskLevel: string;
  tokenPrice: number;
  transactionHash: string;
  timestamp: Date;
}

interface UserInvestmentRequest {
  walletAddress: string;
  investment: InvestmentRecord;
}

// MongoDB Connection
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err: any) => console.error('MongoDB connection error:', err));

// Define MongoDB Schemas
const investmentSchema = new mongoose.Schema({
  amount: Number,
  riskLevel: String,
  transactionHash: String,
  timestamp: Date,
  tokenPrice: Number
});

const userSchema = new mongoose.Schema({
  walletAddress: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  firstSeen: {
    type: Date,
    default: Date.now
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
});

// Create MongoDB Models
const User = mongoose.model('User', userSchema);

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, '../public')));

// Endpoint to fetch Sonic token price
app.get('/api/fetchsonicprice', async (req: Request, res: Response): Promise<any> => {
  try {
    // Define the token ID
    const tokenId: string = 'sonic-3';
    
    // Make the request to CoinGecko API
    const response = await axios.get<PriceResponse>('https://api.coingecko.com/api/v3/simple/price', {
      params: {
        ids: tokenId,
        vs_currencies: 'usd'
      }
    });

    // Log the raw response for debugging
    console.log('API Response:', JSON.stringify(response.data, null, 2));
    
    // Extract the price data using the correct token ID
    const sonicPrice: number = response.data[tokenId].usd;
    
    return res.status(200).json({
      success: true,
      price: sonicPrice,
      currency: 'USD',
      token_id: tokenId,
      timestamp: new Date().toISOString()
    } as ApiResponse);
  } catch (error) {
    // Safe error handling
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('Error fetching Sonic price:', errorMessage);
    
    // Handle response data logging safely
    if (error && typeof error === 'object' && 'response' in error) {
      const axiosError = error as { response?: { data?: unknown } };
      console.error('Error details:', axiosError.response?.data || 'No response data');
    }
    
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch Sonic token price',
      error: errorMessage
    } as ApiResponse);
  }
});

// Endpoint to analyze token and get investment recommendation
app.get('/api/analyze', async (req: Request, res: Response): Promise<any> => {
  try {
    const tokenId: string = 'sonic-3';
    const analysis = await analyzeTokenRisk(tokenId);
    
    return res.status(200).json({
      success: true,
      token_id: tokenId,
      analysis,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('Error analyzing token:', errorMessage);
    
    return res.status(500).json({
      success: false,
      message: 'Failed to analyze token',
      error: errorMessage
    });
  }
});

// Endpoint to process investment
app.post('/api/invest', async (req: Request, res: Response): Promise<any> => {
  try {
    const { amount, riskLevel, walletAddress }: InvestmentRequest = req.body;
    
    if (!amount || !riskLevel) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: amount and riskLevel'
      });
    }
    
    // Get current token price
    const priceResponse = await axios.get<ApiResponse>('http://localhost:' + PORT + '/api/fetchsonicprice');
    const tokenPrice = priceResponse.data.price;
    
    if (!tokenPrice) {
      throw new Error('Failed to get current token price');
    }
    
    // Send transaction
    const txHash = await sendTransaction({
      amount,
      tokenPrice,
      walletAddress: RECIPIENT_WALLET,
      riskLevel
    });
    
    // If wallet address is provided, store the investment in user history
    if (walletAddress) {
      try {
        // Add investment to user's history
        await User.findOneAndUpdate(
          { walletAddress: walletAddress.toLowerCase() },
          { 
            $push: { 
              investments: {
                amount,
                riskLevel,
                tokenPrice,
                transactionHash: txHash,
                timestamp: new Date()
              }
            },
            lastSeen: new Date()
          },
          { new: true, upsert: true }
        );
        
        console.log(`Investment recorded for user: ${walletAddress}`);
      } catch (dbError) {
        console.error('Error recording investment in database:', dbError);
        // Continue with the response - don't fail the transaction if DB record fails
      }
    }
    
    return res.status(200).json({
      success: true,
      message: `Successfully invested $${amount} at ${riskLevel} risk level`,
      transactionHash: txHash,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('Error processing investment:', errorMessage);
    
    return res.status(500).json({
      success: false,
      message: 'Failed to process investment',
      error: errorMessage
    });
  }
});

// User management endpoints
// Create or update user
app.post('/api/user', async (req: Request, res: Response): Promise<any> => {
  try {
    const { walletAddress, lastSeen, chainId }: UserRequest = req.body;
    
    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        message: 'Wallet address is required'
      });
    }
    
    // Find and update user, or create if not exists
    const user = await User.findOneAndUpdate(
      { walletAddress: walletAddress.toLowerCase() },
      { 
        lastSeen: lastSeen ? new Date(lastSeen) : new Date(),
        chainId: chainId || null
      },
      { 
        new: true,
        upsert: true,
        setDefaultsOnInsert: true
      }
    );
    
    return res.status(200).json({
      success: true,
      user: {
        walletAddress: user.walletAddress,
        firstSeen: user.firstSeen,
        lastSeen: user.lastSeen
      }
    } as ApiResponse);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('Error saving user data:', errorMessage);
    
    return res.status(500).json({
      success: false,
      message: 'Error saving user data',
      error: errorMessage
    } as ApiResponse);
  }
});

// Update user investment history
app.post('/api/user/investment', async (req: Request, res: Response): Promise<any> => {
  try {
    const { walletAddress, investment }: UserInvestmentRequest = req.body;
    
    if (!walletAddress || !investment) {
      return res.status(400).json({
        success: false,
        message: 'Wallet address and investment details are required'
      });
    }
    
    // Add investment to user's history
    const user = await User.findOneAndUpdate(
      { walletAddress: walletAddress.toLowerCase() },
      { 
        $push: { investments: investment },
        lastSeen: new Date()
      },
      { new: true }
    );
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    return res.status(200).json({
      success: true,
      message: 'Investment history updated'
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('Error updating investment history:', errorMessage);
    
    return res.status(500).json({
      success: false,
      message: 'Error updating investment history',
      error: errorMessage
    });
  }
});

// Get user data and investment history
app.get('/api/user/:walletAddress', async (req: Request, res: Response): Promise<any> => {
  try {
    const { walletAddress } = req.params;
    
    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        message: 'Wallet address is required'
      });
    }
    
    const user = await User.findOne({ 
      walletAddress: walletAddress.toLowerCase() 
    });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    return res.status(200).json({
      success: true,
      user: {
        walletAddress: user.walletAddress,
        firstSeen: user.firstSeen,
        lastSeen: user.lastSeen,
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('Error fetching user data:', errorMessage);
    
    return res.status(500).json({
      success: false,
      message: 'Error fetching user data',
      error: errorMessage
    });
  }
});

// Root endpoint - serve the frontend
app.get('/', (req: Request, res: Response): void => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start the server
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Access the app at http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received. Shutting down gracefully.');
  server.close(() => {
    mongoose.connection.close();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received. Shutting down gracefully.');
  server.close(() => {
    mongoose.connection.close();
    process.exit(0);
  });
});

export default app;