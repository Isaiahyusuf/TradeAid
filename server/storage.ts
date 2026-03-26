import { db, tradeDb, walletDb } from "./db";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
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
  private appStateTableReady: Record<"primary" | "wallet" | "trade", Promise<void> | null> = {
    primary: null,
    wallet: null,
    trade: null,
  };
  private whaleWatchTenantColumnsReady: Promise<void> | null = null;

  private getAppStateTargetForKey(key: string): "primary" | "wallet" | "trade" {
    const normalized = String(key || "").trim();
    if (
      normalized === "doctortrade.wallets.by_user.v1"
      || normalized === "doctortrade.runtime.by_user.v1"
      || normalized === "assistant.runtime.v1"
      || normalized.startsWith("assistant.runtime.v1:")
    ) {
      return "wallet";
    }

    if (normalized === "doctortrade.executions.v1" || normalized.startsWith("doctortrade.executions.v1:")) {
      return "trade";
    }

    return "primary";
  }

  private getStateDb(target: "primary" | "wallet" | "trade") {
    if (target === "wallet") return walletDb;
    if (target === "trade") return tradeDb;
    return db;
  }

  private shouldEncryptAppStateKey(key: string): boolean {
    const normalized = String(key || "").trim();
    return (
      normalized === "assistant.runtime.v1"
      || normalized.startsWith("assistant.runtime.v1:")
      || normalized === "auth.password_hashes.v1"
      || normalized === "doctortrade.wallets.by_user.v1"
      || normalized === "doctortrade.runtime.by_user.v1"
      || normalized === "doctortrade.preset.by_user.v1"
      || normalized === "tradeaid.user.settings.by_user.v1"
      || normalized === "doctortrade.executions.v1"
      || normalized.startsWith("doctortrade.executions.v1:")
    );
  }

  private resolveAppStateEncryptionSecret(): string {
    return String(
      process.env.APP_STATE_ENCRYPTION_KEY
      || process.env.DOCTORTRADE_WALLET_ENCRYPTION_KEY
      || process.env.DOCTORTRADE_ENCRYPTION_KEY
      || process.env.SESSION_SECRET
      || process.env.JWT_SECRET
      || "",
    ).trim();
  }

  private getAppStateEncryptionKey(): Buffer {
    const secret = this.resolveAppStateEncryptionSecret();
    if (!secret) {
      throw new Error("APP_STATE_ENCRYPTION_KEY is required for encrypted app_state keys");
    }
    return createHash("sha256").update(secret, "utf8").digest();
  }

  private encryptAppStateValue(value: unknown): Record<string, unknown> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.getAppStateEncryptionKey(), iv);
    const plaintext = Buffer.from(JSON.stringify(value ?? null), "utf8");
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      __enc_v1: true,
      alg: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: authTag.toString("base64"),
      data: encrypted.toString("base64"),
    };
  }

  private decryptAppStateValue<T = unknown>(value: unknown): T {
    const envelope = value as Record<string, unknown>;
    const ivRaw = String(envelope?.iv || "").trim();
    const tagRaw = String(envelope?.tag || "").trim();
    const dataRaw = String(envelope?.data || "").trim();
    if (!ivRaw || !tagRaw || !dataRaw) {
      throw new Error("invalid encrypted app_state envelope");
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.getAppStateEncryptionKey(),
      Buffer.from(ivRaw, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataRaw, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8")) as T;
  }

  private async ensureAppStateTable(target: "primary" | "wallet" | "trade"): Promise<void> {
    if (!this.appStateTableReady[target]) {
      const stateDb = this.getStateDb(target);
      this.appStateTableReady[target] = stateDb.execute(sql`
        CREATE TABLE IF NOT EXISTS app_state (
          key TEXT PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `).then(() => undefined);
    }
    await this.appStateTableReady[target];
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
    const target = this.getAppStateTargetForKey(key);
    const stateDb = this.getStateDb(target);
    await this.ensureAppStateTable(target);
    const result = await stateDb.execute(sql`SELECT value FROM app_state WHERE key = ${key} LIMIT 1`);
    const rows = (result as any)?.rows as Array<{ value?: T }> | undefined;
    let value = rows?.[0]?.value;
    if (value !== undefined && this.shouldEncryptAppStateKey(key)) {
      const maybeEnvelope = value as unknown as Record<string, unknown>;
      if (maybeEnvelope && typeof maybeEnvelope === "object" && maybeEnvelope.__enc_v1 === true) {
        value = this.decryptAppStateValue<T>(maybeEnvelope) as T;
      }
    }
    return value === undefined ? undefined : value;
  }

  async setAppState<T = unknown>(key: string, value: T): Promise<void> {
    const target = this.getAppStateTargetForKey(key);
    const stateDb = this.getStateDb(target);
    await this.ensureAppStateTable(target);
    const payload = this.shouldEncryptAppStateKey(key)
      ? this.encryptAppStateValue(value)
      : (value ?? null);
    const serialized = JSON.stringify(payload);
    await stateDb.execute(sql`
      INSERT INTO app_state (key, value, updated_at)
      VALUES (${key}, ${serialized}::jsonb, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `);
  }
}

export const storage = new DatabaseStorage();
