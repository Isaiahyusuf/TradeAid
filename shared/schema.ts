import { pgTable, text, serial, integer, boolean, timestamp, real, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Export chat models from integration
export * from "./models/chat";
// Export auth models (REQUIRED for Replit Auth)
export * from "./models/auth";

// === Token Discovery (Enhanced for Alpha Scanner) ===
export const scannedTokens = pgTable("scanned_tokens", {
  id: serial("id").primaryKey(),
  address: text("address").notNull().unique(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  chain: text("chain").notNull().default("solana"),
  dexId: text("dex_id"),
  pairAddress: text("pair_address"),
  priceUsd: text("price_usd"),
  priceNative: text("price_native"),
  liquidity: real("liquidity").default(0),
  marketCap: real("market_cap").default(0),
  volume24h: real("volume_24h").default(0),
  priceChange1h: real("price_change_1h").default(0),
  priceChange24h: real("price_change_24h").default(0),
  buys24h: integer("buys_24h").default(0),
  sells24h: integer("sells_24h").default(0),
  safetyScore: integer("safety_score").notNull().default(0),
  isLiquidityLocked: boolean("is_liquidity_locked").notNull().default(false),
  mintAuthorityDisabled: boolean("mint_authority_disabled").notNull().default(false),
  topHoldersPercentage: integer("top_holders_percentage").notNull().default(0),
  devWalletPercentage: integer("dev_wallet_percentage").notNull().default(0),
  isHoneypot: boolean("is_honeypot").notNull().default(false),
  riskLevel: text("risk_level").default("unknown"),
  aiSignal: text("ai_signal").default("hold"),
  aiAnalysis: text("ai_analysis"),
  socialLinks: jsonb("social_links").$type<{twitter?: string; telegram?: string; website?: string}>(),
  pairCreatedAt: timestamp("pair_created_at"),
  lastScannedAt: timestamp("last_scanned_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// === User Watchlists ===
export const watchlists = pgTable("watchlists", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  tokenAddress: text("token_address").notNull(),
  alertOnPriceUp: real("alert_on_price_up"),
  alertOnPriceDown: real("alert_on_price_down"),
  alertOnVolume: real("alert_on_volume"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// === User Alerts/Notifications ===
export const userAlerts = pgTable("user_alerts", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  tokenAddress: text("token_address"),
  alertType: text("alert_type").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// === Hot Token Signals ===
export const tokenSignals = pgTable("token_signals", {
  id: serial("id").primaryKey(),
  tokenAddress: text("token_address").notNull(),
  signalType: text("signal_type").notNull(),
  confidence: integer("confidence").default(0),
  entryPrice: text("entry_price"),
  targetPrice: text("target_price"),
  stopLoss: text("stop_loss"),
  reasoning: text("reasoning"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// === WhaleWatch ===
export const trackedWallets = pgTable("tracked_wallets", {
  id: serial("id").primaryKey(),
  address: text("address").notNull().unique(),
  label: text("label").notNull(),
  winRate: integer("win_rate").default(0), // Percentage
  totalProfit: text("total_profit").default("0 SOL"),
});

export const walletAlerts = pgTable("wallet_alerts", {
  id: serial("id").primaryKey(),
  walletId: integer("wallet_id").references(() => trackedWallets.id),
  tokenSymbol: text("token_symbol").notNull(),
  type: text("type").notNull(), // 'BUY' or 'SELL'
  amount: text("amount").notNull(),
  price: text("price").notNull(),
  timestamp: timestamp("timestamp").defaultNow(),
});

// === MemeTrend ===
// We'll store cached trend data here
export const trendingCoins = pgTable("trending_coins", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  price: text("price").notNull(),
  volume24h: text("volume_24h").notNull(),
  hypeScore: integer("hype_score").notNull(), // 0-100 (Social sentiment)
  trend: text("trend").notNull(), // 'UP', 'DOWN', 'FLAT'
  lastUpdated: timestamp("last_updated").defaultNow(),
});

// === Schemas ===
export const insertScannedTokenSchema = createInsertSchema(scannedTokens).omit({ id: true, createdAt: true, lastScannedAt: true });
export const insertTrackedWalletSchema = createInsertSchema(trackedWallets).omit({ id: true });
export const insertWalletAlertSchema = createInsertSchema(walletAlerts).omit({ id: true, timestamp: true });
export const insertTrendingCoinSchema = createInsertSchema(trendingCoins).omit({ id: true, lastUpdated: true });
export const insertWatchlistSchema = createInsertSchema(watchlists).omit({ id: true, createdAt: true });
export const insertUserAlertSchema = createInsertSchema(userAlerts).omit({ id: true, createdAt: true });
export const insertTokenSignalSchema = createInsertSchema(tokenSignals).omit({ id: true, createdAt: true });

// === Types ===
export type ScannedToken = typeof scannedTokens.$inferSelect;
export type InsertScannedToken = z.infer<typeof insertScannedTokenSchema>;

export type TrackedWallet = typeof trackedWallets.$inferSelect;
export type InsertTrackedWallet = z.infer<typeof insertTrackedWalletSchema>;

export type WalletAlert = typeof walletAlerts.$inferSelect;
export type InsertWalletAlert = z.infer<typeof insertWalletAlertSchema>;

export type TrendingCoin = typeof trendingCoins.$inferSelect;
export type InsertTrendingCoin = z.infer<typeof insertTrendingCoinSchema>;

export type Watchlist = typeof watchlists.$inferSelect;
export type InsertWatchlist = z.infer<typeof insertWatchlistSchema>;

export type UserAlert = typeof userAlerts.$inferSelect;
export type InsertUserAlert = z.infer<typeof insertUserAlertSchema>;

export type TokenSignal = typeof tokenSignals.$inferSelect;
export type InsertTokenSignal = z.infer<typeof insertTokenSignalSchema>;

// === Subscriptions ===
export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  plan: text("plan").notNull().default("free"),
  paymentMethod: text("payment_method"),
  txHash: text("tx_hash"),
  status: text("status").notNull().default("active"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({ id: true, createdAt: true });
export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;

// === Usage Tracking (for free tier limits) ===
export const userUsage = pgTable("user_usage", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  dailyScans: integer("daily_scans").default(0),
  dailyDeepAnalyses: integer("daily_deep_analyses").default(0),
  dailySignalViews: integer("daily_signal_views").default(0),
  adsViewed: integer("ads_viewed").default(0),
  lastResetAt: timestamp("last_reset_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserUsageSchema = createInsertSchema(userUsage).omit({ id: true, createdAt: true });
export type UserUsage = typeof userUsage.$inferSelect;
export type InsertUserUsage = z.infer<typeof insertUserUsageSchema>;

// === Free tier limits ===
export const FREE_TIER_LIMITS = {
  dailyScans: 10,
  dailyDeepAnalyses: 3,
  dailySignalViews: 5,
  adsPerSession: 3,
} as const;

export const SUBSCRIPTION_PRICES = {
  monthly: { sol: 0.5, eth: 0.01, bsc: 0.05, base: 0.01 },
  yearly: { sol: 4.5, eth: 0.08, bsc: 0.4, base: 0.08 },
} as const;

// === API Request/Response Types ===
export type ScanTokenRequest = { address: string };
export type AnalyzeSentimentRequest = { symbol: string };
export type AnalyzeSentimentResponse = { sentiment: string; score: number; summary: string };
