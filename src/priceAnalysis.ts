import axios from 'axios';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

// Initialize OpenAI client

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface PriceData {
  date: string;
  price: number;
}

interface AnalysisResult {
  movingAverage: number;
  riskLevel: 'low' | 'medium' | 'high';
  recommendation: string;
  suggestedInvestment: number;
}

export async function fetchHistoricalPrices(tokenId: string, days: number = 30): Promise<PriceData[]> {
  try {
    const response = await axios.get(`https://api.coingecko.com/api/v3/coins/${tokenId}/market_chart`, {
      params: {
        vs_currency: 'usd',
        days: days,
      },
    });

    // CoinGecko returns prices as [timestamp, price] arrays
    const data = response.data as { prices: [number, number][] };
    return data.prices.map((item: [number, number]) => ({
      date: new Date(item[0]).toISOString(),
      price: item[1],
    }));
  } catch (error) {
    console.error('Error fetching historical prices:', error);
    throw new Error('Failed to fetch historical prices');
  }
}

export function calculateMovingAverage(prices: PriceData[], period: number = 7): number {
  if (prices.length < period) {
    throw new Error('Not enough price data to calculate moving average');
  }

  const recentPrices = prices.slice(-period);
  const sum = recentPrices.reduce((acc, data) => acc + data.price, 0);
  return sum / period;
}

export async function analyzeTokenRisk(tokenId: string): Promise<AnalysisResult> {
  try {
    // Fetch historical price data
    const priceData = await fetchHistoricalPrices(tokenId);
    
    // Calculate 7-day moving average
    const movingAverage7Day = calculateMovingAverage(priceData, 7);
    
    // Calculate 30-day moving average
    const movingAverage30Day = calculateMovingAverage(priceData, 30);
    
    // Calculate volatility (standard deviation of price changes)
    const priceChanges = [];
    for (let i = 1; i < priceData.length; i++) {
      const percentChange = ((priceData[i].price - priceData[i-1].price) / priceData[i-1].price) * 100;
      priceChanges.push(percentChange);
    }
    
    const average = priceChanges.reduce((sum, val) => sum + val, 0) / priceChanges.length;
    
    const variance = priceChanges.reduce((sum, val) => sum + Math.pow(val - average, 2), 0) / priceChanges.length;
    
    const volatility = Math.sqrt(variance);
    
    // Current price
    const currentPrice = priceData[priceData.length - 1].price;
    
    // Use OpenAI to analyze and provide recommendations
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are a cryptocurrency investment analyst. Analyze the provided data and suggest an investment risk level (low, medium, or high) based on the data.Every time user refresh give answer with different tone "
        },
        {
          role: "user",
          content: `
          Please analyze this token data and provide an investment recommendation:
          
          Token: ${tokenId}
          Current Price: $${currentPrice}
          7-Day Moving Average: $${movingAverage7Day}
          30-Day Moving Average: $${movingAverage30Day}
          Volatility (Std Dev of Daily % Change): ${volatility.toFixed(2)}%
          
          Classify the risk as:
          - Low Risk (suggest $10 investment) if volatility is low and price is stable or gradually increasing
          - Medium Risk (suggest $20 investment) if there's moderate volatility or unclear trend
          - High Risk (suggest $30 investment) if there's high volatility or sharp price movements
          
          Format your response as JSON with fields: riskLevel (low, medium, or high), recommendation (brief explanation), suggestedInvestment (dollar amount)
          `
        }
      ],
      response_format: { type: "json_object" }
    });
    
    // Parse the JSON response
    if (!completion.choices[0].message.content) {
      throw new Error('OpenAI response content is null');
    }
    const analysis = JSON.parse(completion.choices[0].message.content);
    
    return {
      movingAverage: movingAverage7Day,
      riskLevel: analysis.riskLevel,
      recommendation: analysis.recommendation,
      suggestedInvestment: analysis.suggestedInvestment
    };
  } catch (error) {
    console.error('Error analyzing token risk:', error);
    // Default to medium risk if analysis fails
    return {
      movingAverage: 0,
      riskLevel: 'medium',
      recommendation: 'Analysis failed. Consider standard diversification approaches.',
      suggestedInvestment: 20
    };
  }
}