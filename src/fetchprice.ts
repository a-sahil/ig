import express, { Request, Response } from 'express';
import axios from 'axios';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

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
}

// Middleware
app.use(express.json());
app.use(cors());

// Endpoint to fetch Sonic token price
app.get('/fetchsonicprice', async (req: Request, res: Response): Promise<any> => {
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

// Root endpoint
app.get('/', (req: Request, res: Response): void => {
  res.send('Sonic Token Price API - Use /fetchsonicprice to get the current price');
});

// Start the server
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Configured to fetch price for token ID: sonic-3`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received. Shutting down gracefully.');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received. Shutting down gracefully.');
  server.close(() => {
    process.exit(0);
  });
});