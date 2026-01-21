import { db } from "./db";
import { 
  scannedTokens, trackedWallets, walletAlerts, trendingCoins, subscriptions,
  type InsertScannedToken, type InsertTrackedWallet, type InsertWalletAlert, type InsertTrendingCoin, type InsertSubscription,
  type ScannedToken, type TrackedWallet, type WalletAlert, type TrendingCoin, type Subscription
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  // RugShield
  createScannedToken(token: InsertScannedToken): Promise<ScannedToken>;
  getScannedTokens(): Promise<ScannedToken[]>;
  getScannedTokenByAddress(address: string): Promise<ScannedToken | undefined>;

  // WhaleWatch
  createTrackedWallet(wallet: InsertTrackedWallet): Promise<TrackedWallet>;
  getTrackedWallets(): Promise<TrackedWallet[]>;
  deleteTrackedWallet(id: number): Promise<void>;
  createWalletAlert(alert: InsertWalletAlert): Promise<WalletAlert>;
  getWalletAlerts(): Promise<(WalletAlert & { walletLabel: string })[]>;

  // MemeTrend
  getTrendingCoins(): Promise<TrendingCoin[]>;
  createTrendingCoin(coin: InsertTrendingCoin): Promise<TrendingCoin>;

  // Subscriptions
  getSubscription(userId: string): Promise<Subscription | undefined>;
  createSubscription(sub: InsertSubscription): Promise<Subscription>;
}

export class DatabaseStorage implements IStorage {
  // RugShield
  async createScannedToken(token: InsertScannedToken): Promise<ScannedToken> {
    const [newItem] = await db.insert(scannedTokens).values(token).returning();
    return newItem;
  }

  async getScannedTokens(): Promise<ScannedToken[]> {
    return await db.select().from(scannedTokens).orderBy(desc(scannedTokens.createdAt)).limit(20);
  }

  async getScannedTokenByAddress(address: string): Promise<ScannedToken | undefined> {
    const [token] = await db.select().from(scannedTokens).where(eq(scannedTokens.address, address));
    return token;
  }

  // WhaleWatch
  async createTrackedWallet(wallet: InsertTrackedWallet): Promise<TrackedWallet> {
    const [newItem] = await db.insert(trackedWallets).values(wallet).returning();
    return newItem;
  }

  async getTrackedWallets(): Promise<TrackedWallet[]> {
    return await db.select().from(trackedWallets);
  }

  async deleteTrackedWallet(id: number): Promise<void> {
    await db.delete(walletAlerts).where(eq(walletAlerts.walletId, id));
    await db.delete(trackedWallets).where(eq(trackedWallets.id, id));
  }

  async createWalletAlert(alert: InsertWalletAlert): Promise<WalletAlert> {
    const [newItem] = await db.insert(walletAlerts).values(alert).returning();
    return newItem;
  }

  async getWalletAlerts(): Promise<(WalletAlert & { walletLabel: string })[]> {
    const results = await db.select({
      id: walletAlerts.id,
      walletId: walletAlerts.walletId,
      tokenSymbol: walletAlerts.tokenSymbol,
      type: walletAlerts.type,
      amount: walletAlerts.amount,
      price: walletAlerts.price,
      timestamp: walletAlerts.timestamp,
      walletLabel: trackedWallets.label,
    })
    .from(walletAlerts)
    .innerJoin(trackedWallets, eq(walletAlerts.walletId, trackedWallets.id))
    .orderBy(desc(walletAlerts.timestamp))
    .limit(50);
    
    return results;
  }

  // MemeTrend
  async getTrendingCoins(): Promise<TrendingCoin[]> {
    return await db.select().from(trendingCoins).orderBy(desc(trendingCoins.hypeScore));
  }

  async createTrendingCoin(coin: InsertTrendingCoin): Promise<TrendingCoin> {
    const [newItem] = await db.insert(trendingCoins).values(coin).returning();
    return newItem;
  }

  // Subscriptions
  async getSubscription(userId: string): Promise<Subscription | undefined> {
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).orderBy(desc(subscriptions.createdAt));
    return sub;
  }

  async createSubscription(sub: InsertSubscription): Promise<Subscription> {
    const [newSub] = await db.insert(subscriptions).values(sub).returning();
    return newSub;
  }
}

export const storage = new DatabaseStorage();
