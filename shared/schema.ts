import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Export chat models from integration
export * from "./models/chat";
// Export auth models (REQUIRED for Replit Auth)
export * from "./models/auth";

// === RugShield ===
export const scannedTokens = pgTable("scanned_tokens", {
  id: serial("id").primaryKey(),
  address: text("address").notNull(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  safetyScore: integer("safety_score").notNull(), // 0-100
  isLiquidityLocked: boolean("is_liquidity_locked").notNull(),
  mintAuthorityDisabled: boolean("mint_authority_disabled").notNull(),
  topHoldersPercentage: integer("top_holders_percentage").notNull(),
  isHoneypot: boolean("is_honeypot").notNull(),
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
export const insertScannedTokenSchema = createInsertSchema(scannedTokens).omit({ id: true, createdAt: true });
export const insertTrackedWalletSchema = createInsertSchema(trackedWallets).omit({ id: true });
export const insertWalletAlertSchema = createInsertSchema(walletAlerts).omit({ id: true, timestamp: true });
export const insertTrendingCoinSchema = createInsertSchema(trendingCoins).omit({ id: true, lastUpdated: true });

// === Types ===
export type ScannedToken = typeof scannedTokens.$inferSelect;
export type InsertScannedToken = z.infer<typeof insertScannedTokenSchema>;

export type TrackedWallet = typeof trackedWallets.$inferSelect;
export type InsertTrackedWallet = z.infer<typeof insertTrackedWalletSchema>;

export type WalletAlert = typeof walletAlerts.$inferSelect;
export type InsertWalletAlert = z.infer<typeof insertWalletAlertSchema>;

export type TrendingCoin = typeof trendingCoins.$inferSelect;
export type InsertTrendingCoin = z.infer<typeof insertTrendingCoinSchema>;

// === Subscriptions ===
export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  plan: text("plan").notNull().default("free"), // 'free' or 'pro'
  paymentMethod: text("payment_method"), // 'SOL', 'ETH', 'BSC', 'BASE'
  txHash: text("tx_hash"),
  status: text("status").notNull().default("active"), // 'active', 'expired', 'pending'
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({ id: true, createdAt: true });
export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;

// === API Request/Response Types ===
export type ScanTokenRequest = { address: string };
export type AnalyzeSentimentRequest = { symbol: string };
export type AnalyzeSentimentResponse = { sentiment: string; score: number; summary: string };
