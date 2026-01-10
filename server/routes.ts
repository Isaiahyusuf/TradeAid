import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { registerChatRoutes } from "./replit_integrations/chat";
import { registerImageRoutes } from "./replit_integrations/image";
import OpenAI from "openai";

// Initialize OpenAI for sentiment analysis
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Register AI integration routes
  registerChatRoutes(app);
  registerImageRoutes(app);

  // === RugShield ===
  app.post(api.rugcheck.scan.path, async (req, res) => {
    try {
      const { address } = api.rugcheck.scan.input.parse(req.body);
      
      // Mocking the scan logic since we don't have real Solana RPC
      // In production, this would call Solana RPC / Helius / Solscan
      const isGood = Math.random() > 0.3; // 70% chance of being "good" for demo
      const mockResult = {
        address,
        symbol: isGood ? "SAFE" : "SCAM",
        name: isGood ? "Safe Coin" : "Rug Pull Coin",
        safetyScore: isGood ? Math.floor(Math.random() * 20 + 80) : Math.floor(Math.random() * 40),
        isLiquidityLocked: isGood,
        mintAuthorityDisabled: isGood,
        topHoldersPercentage: isGood ? Math.floor(Math.random() * 20 + 10) : Math.floor(Math.random() * 40 + 50),
        isHoneypot: !isGood,
      };

      const result = await storage.createScannedToken(mockResult);
      res.json(result);
    } catch (err) {
      res.status(400).json({ message: "Invalid request" });
    }
  });

  app.get(api.rugcheck.history.path, async (req, res) => {
    const history = await storage.getScannedTokens();
    res.json(history);
  });

  // === WhaleWatch ===
  app.get(api.whalewatch.wallets.list.path, async (req, res) => {
    const wallets = await storage.getTrackedWallets();
    res.json(wallets);
  });

  app.post(api.whalewatch.wallets.create.path, async (req, res) => {
    try {
      const input = api.whalewatch.wallets.create.input.parse(req.body);
      const wallet = await storage.createTrackedWallet(input);
      res.status(201).json(wallet);
    } catch (err) {
      res.status(400).json({ message: "Invalid request" });
    }
  });

  app.delete(api.whalewatch.wallets.delete.path, async (req, res) => {
    await storage.deleteTrackedWallet(Number(req.params.id));
    res.status(204).send();
  });

  app.get(api.whalewatch.alerts.list.path, async (req, res) => {
    const alerts = await storage.getWalletAlerts();
    res.json(alerts);
  });

  // === MemeTrend ===
  app.get(api.memetrend.list.path, async (req, res) => {
    const coins = await storage.getTrendingCoins();
    res.json(coins);
  });

  app.post(api.memetrend.analyze.path, async (req, res) => {
    try {
      const { symbol } = api.memetrend.analyze.input.parse(req.body);
      
      // Use OpenAI to generate a "fake" analysis based on the symbol
      // In reality, you'd feed it real tweets/news
      const prompt = `Analyze the sentiment for the memecoin ${symbol}. 
      Assume there is high social media activity. 
      Provide a JSON response with: 
      - sentiment: "BULLISH", "BEARISH", or "NEUTRAL"
      - score: number between 0-100
      - summary: A short witty summary of why (max 2 sentences).`;

      const completion = await openai.chat.completions.create({
        model: "gpt-5.1",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      });

      const aiResponse = JSON.parse(completion.choices[0].message.content || "{}");
      
      res.json({
        sentiment: aiResponse.sentiment || "NEUTRAL",
        score: aiResponse.score || 50,
        summary: aiResponse.summary || "No data available.",
      });

    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "AI Analysis failed" });
    }
  });

  // === Seed Data ===
  await seedDatabase();

  return httpServer;
}

async function seedDatabase() {
  const wallets = await storage.getTrackedWallets();
  if (wallets.length === 0) {
    await storage.createTrackedWallet({
      address: "HN7c...k8j2",
      label: "Smart Money Whale",
      winRate: 85,
      totalProfit: "450 SOL"
    });
    await storage.createTrackedWallet({
      address: "Ab9...xY3z",
      label: "Insider 1",
      winRate: 92,
      totalProfit: "1200 SOL"
    });
    
    // Create some alerts for these wallets
    const wallet1 = (await storage.getTrackedWallets())[0];
    if (wallet1) {
      await storage.createWalletAlert({
        walletId: wallet1.id,
        tokenSymbol: "$PEPE",
        type: "BUY",
        amount: "50 SOL",
        price: "0.0000042",
      });
    }
  }

  const trends = await storage.getTrendingCoins();
  if (trends.length === 0) {
    await storage.createTrendingCoin({
      symbol: "$BONK",
      name: "Bonk",
      price: "0.0000123",
      volume24h: "$45M",
      hypeScore: 95,
      trend: "UP",
    });
    await storage.createTrendingCoin({
      symbol: "$WIF",
      name: "dogwifhat",
      price: "2.45",
      volume24h: "$120M",
      hypeScore: 88,
      trend: "UP",
    });
    await storage.createTrendingCoin({
      symbol: "$POPCAT",
      name: "Popcat",
      price: "0.45",
      volume24h: "$12M",
      hypeScore: 65,
      trend: "FLAT",
    });
  }
}
