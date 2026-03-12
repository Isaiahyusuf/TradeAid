import { db } from "./db";
import { 
  scannedTokens, trackedWallets, walletAlerts, trendingCoins, subscriptions, userUsage, paymentRecords,
  type InsertScannedToken, type InsertTrackedWallet, type InsertWalletAlert, type InsertTrendingCoin, type InsertSubscription, type InsertPaymentRecord,
  type ScannedToken, type TrackedWallet, type WalletAlert, type TrendingCoin, type Subscription, type UserUsage, type PaymentRecord
} from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";

export interface IStorage {
  // RugShield
  createScannedToken(token: InsertScannedToken): Promise<ScannedToken>;
  updateScannedToken(id: number, token: Partial<InsertScannedToken>): Promise<ScannedToken>;
  getScannedTokens(): Promise<ScannedToken[]>;
  getScannedTokenByAddress(address: string): Promise<ScannedToken | undefined>;

  // WhaleWatch
  createTrackedWallet(userId: string, wallet: Omit<InsertTrackedWallet, "userId">): Promise<TrackedWallet>;
  getTrackedWallets(userId: string): Promise<TrackedWallet[]>;
  deleteTrackedWallet(userId: string, id: number): Promise<void>;
  createWalletAlert(userId: string, alert: Omit<InsertWalletAlert, "userId">): Promise<WalletAlert>;
  getWalletAlerts(userId: string): Promise<(WalletAlert & { walletLabel: string })[]>;

  // MemeTrend
  getTrendingCoins(): Promise<TrendingCoin[]>;
  createTrendingCoin(coin: InsertTrendingCoin): Promise<TrendingCoin>;

  // Subscriptions
  getSubscription(userId: string): Promise<Subscription | undefined>;
  createSubscription(sub: InsertSubscription): Promise<Subscription>;
  
  // Usage tracking
  getUsage(userId: string): Promise<UserUsage>;
  incrementUsage(userId: string, type: string): Promise<UserUsage>;

  // Payment records
  createPaymentRecord(record: InsertPaymentRecord): Promise<PaymentRecord>;
  getPaymentByTxHash(txHash: string): Promise<PaymentRecord | undefined>;
  updatePaymentRecord(id: number, updates: Partial<InsertPaymentRecord & { status: string; verifiedAt: Date }>): Promise<PaymentRecord>;
  getUserPayments(userId: string): Promise<PaymentRecord[]>;

  // App state (JSON key/value)
  getAppState<T = unknown>(key: string): Promise<T | undefined>;
  setAppState<T = unknown>(key: string, value: T): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  private appStateTableReady: Promise<void> | null = null;
  private whaleWatchTenantColumnsReady: Promise<void> | null = null;

  private async ensureAppStateTable(): Promise<void> {
    if (!this.appStateTableReady) {
      this.appStateTableReady = db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_state (
          key TEXT PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `).then(() => undefined);
    }
    await this.appStateTableReady;
  }

  private async ensureWhaleWatchTenantColumns(): Promise<void> {
    if (!this.whaleWatchTenantColumnsReady) {
      this.whaleWatchTenantColumnsReady = (async () => {
        await db.execute(sql`ALTER TABLE tracked_wallets ADD COLUMN IF NOT EXISTS user_id TEXT`);
        await db.execute(sql`ALTER TABLE wallet_alerts ADD COLUMN IF NOT EXISTS user_id TEXT`);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tracked_wallets_user_id ON tracked_wallets(user_id)`);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_wallet_alerts_user_id ON wallet_alerts(user_id)`);
      })();
    }
    await this.whaleWatchTenantColumnsReady;
  }

  // RugShield
  async createScannedToken(token: InsertScannedToken): Promise<ScannedToken> {
    const [newItem] = await db.insert(scannedTokens).values(token).returning();
    return newItem;
  }

  async updateScannedToken(id: number, token: Partial<InsertScannedToken>): Promise<ScannedToken> {
    const [updated] = await db.update(scannedTokens)
      .set({ ...token, lastScannedAt: new Date() })
      .where(eq(scannedTokens.id, id))
      .returning();
    return updated;
  }

  async getScannedTokens(): Promise<ScannedToken[]> {
    return await db.select().from(scannedTokens).orderBy(desc(scannedTokens.createdAt)).limit(20);
  }

  async getScannedTokenByAddress(address: string): Promise<ScannedToken | undefined> {
    const [token] = await db.select().from(scannedTokens).where(eq(scannedTokens.address, address));
    return token;
  }

  // WhaleWatch
  async createTrackedWallet(userId: string, wallet: Omit<InsertTrackedWallet, "userId">): Promise<TrackedWallet> {
    await this.ensureWhaleWatchTenantColumns();
    const [newItem] = await db.insert(trackedWallets).values({ ...wallet, userId }).returning();
    return newItem;
  }

  async getTrackedWallets(userId: string): Promise<TrackedWallet[]> {
    await this.ensureWhaleWatchTenantColumns();
    return await db.select().from(trackedWallets).where(eq(trackedWallets.userId, userId));
  }

  async deleteTrackedWallet(userId: string, id: number): Promise<void> {
    await this.ensureWhaleWatchTenantColumns();
    await db.delete(walletAlerts).where(sql`${walletAlerts.walletId} = ${id} AND ${walletAlerts.userId} = ${userId}`);
    await db.delete(trackedWallets).where(sql`${trackedWallets.id} = ${id} AND ${trackedWallets.userId} = ${userId}`);
  }

  async createWalletAlert(userId: string, alert: Omit<InsertWalletAlert, "userId">): Promise<WalletAlert> {
    await this.ensureWhaleWatchTenantColumns();
    const [newItem] = await db.insert(walletAlerts).values({ ...alert, userId }).returning();
    return newItem;
  }

  async getWalletAlerts(userId: string): Promise<(WalletAlert & { walletLabel: string })[]> {
    await this.ensureWhaleWatchTenantColumns();
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
    .where(eq(walletAlerts.userId, userId))
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

  async getUsage(userId: string): Promise<UserUsage> {
    const [existing] = await db.select().from(userUsage).where(eq(userUsage.userId, userId));
    
    if (!existing) {
      const [created] = await db.insert(userUsage).values({ userId }).returning();
      return created;
    }

    const lastReset = existing.lastResetAt ? new Date(existing.lastResetAt) : new Date(0);
    const now = new Date();
    const shouldReset = now.getDate() !== lastReset.getDate() || 
                        now.getMonth() !== lastReset.getMonth() ||
                        now.getFullYear() !== lastReset.getFullYear();

    if (shouldReset) {
      const [reset] = await db.update(userUsage)
        .set({ dailyScans: 0, dailyDeepAnalyses: 0, dailySignalViews: 0, lastResetAt: now })
        .where(eq(userUsage.userId, userId))
        .returning();
      return reset;
    }

    return existing;
  }

  async incrementUsage(userId: string, type: string): Promise<UserUsage> {
    const usage = await this.getUsage(userId);
    
    const updates: Partial<UserUsage> = {};
    if (type === "scans") updates.dailyScans = (usage.dailyScans || 0) + 1;
    else if (type === "analyses") updates.dailyDeepAnalyses = (usage.dailyDeepAnalyses || 0) + 1;
    else if (type === "signals") updates.dailySignalViews = (usage.dailySignalViews || 0) + 1;
    else if (type === "ads") updates.adsViewed = (usage.adsViewed || 0) + 1;

    const [updated] = await db.update(userUsage)
      .set(updates)
      .where(eq(userUsage.userId, userId))
      .returning();
    
    return updated;
  }

  async createPaymentRecord(record: InsertPaymentRecord): Promise<PaymentRecord> {
    const [newRecord] = await db.insert(paymentRecords).values(record).returning();
    return newRecord;
  }

  async getPaymentByTxHash(txHash: string): Promise<PaymentRecord | undefined> {
    const [record] = await db.select().from(paymentRecords).where(eq(paymentRecords.txHash, txHash));
    return record;
  }

  async updatePaymentRecord(id: number, updates: Partial<InsertPaymentRecord & { status: string; verifiedAt: Date }>): Promise<PaymentRecord> {
    const [updated] = await db.update(paymentRecords)
      .set(updates)
      .where(eq(paymentRecords.id, id))
      .returning();
    return updated;
  }

  async getUserPayments(userId: string): Promise<PaymentRecord[]> {
    return await db.select().from(paymentRecords).where(eq(paymentRecords.userId, userId)).orderBy(desc(paymentRecords.createdAt));
  }

  async getAppState<T = unknown>(key: string): Promise<T | undefined> {
    await this.ensureAppStateTable();
    const result = await db.execute(sql`SELECT value FROM app_state WHERE key = ${key} LIMIT 1`);
    const rows = (result as any)?.rows as Array<{ value?: T }> | undefined;
    const value = rows?.[0]?.value;
    return value === undefined ? undefined : value;
  }

  async setAppState<T = unknown>(key: string, value: T): Promise<void> {
    await this.ensureAppStateTable();
    const serialized = JSON.stringify(value ?? null);
    await db.execute(sql`
      INSERT INTO app_state (key, value, updated_at)
      VALUES (${key}, ${serialized}::jsonb, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `);
  }
}

export const storage = new DatabaseStorage();
