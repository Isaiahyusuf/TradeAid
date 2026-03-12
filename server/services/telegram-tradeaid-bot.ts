import type { Express, Request, Response } from "express";
import axios from "axios";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { scannedTokens } from "@shared/schema";

type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    chat?: {
      id: number;
      type: string;
    };
    from?: {
      id: number;
      first_name?: string;
      username?: string;
    };
  };
  callback_query?: {
    id: string;
    data?: string;
    from?: {
      id: number;
      first_name?: string;
      username?: string;
    };
    message?: {
      message_id: number;
      chat?: {
        id: number;
      };
    };
  };
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result: T;
};

type TokenRow = typeof scannedTokens.$inferSelect;

type DexPairInfo = {
  imageUrl?: string;
  socials?: Array<{ type?: string; url?: string }>;
  websites?: Array<{ label?: string; url?: string }>;
};

type DexPair = {
  chainId?: string;
  pairAddress?: string;
  baseToken?: { address?: string };
  info?: DexPairInfo;
};

type DexResponse = {
  pairs?: DexPair[];
};

type ChatSubscription = {
  subscribed: boolean;
  firstName?: string;
  username?: string;
  updatedAt: string;
};

type PushState = {
  chats: Record<string, ChatSubscription>;
  sentMintAt: Record<string, string>;
  lastPushAt?: string;
};

type BotCallRecord = {
  id: string;
  mint: string;
  symbol: string;
  name: string;
  calledAt: string;
  calledPriceUsd: number;
  safetyScore: number;
  liquidityUsd: number;
  volume24hUsd: number;
  origin: string;
  peakPriceUsd?: number;
  peakAt?: string;
  closedAt?: string;
  closedPriceUsd?: number;
  closeReason?: string;
};

type BotCallState = {
  calls: BotCallRecord[];
};

type PnlSnapshot = {
  call: BotCallRecord;
  currentPriceUsd: number;
  multiplier: number;
  pnlPct: number;
  holdMinutes: number;
  drawdownPct: number;
  isClosed: boolean;
};

type PnlBoardResult = {
  text: string;
  chartUrl?: string;
  chartCaption?: string;
};

type TokenProjectMeta = {
  logoUrl: string;
  website: string;
  twitter: string;
  telegram: string;
  chart: string;
};

const PUSH_STATE_KEY = "telegram.bot.push.v1";
const CALL_STATE_KEY = "telegram.bot.calls.v1";

const nowIso = () => new Date().toISOString();

const escapeHtml = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const fmtUsd = (value: unknown) => {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "$0";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  if (n >= 1) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(10)}`;
};

const fmtPct = (value: unknown) => {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0.00%";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
};

const takeLimit = (value: string | undefined, fallback = 5, max = 15) => {
  const n = Math.trunc(Number(value || fallback));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(max, n);
};

const isHttpUrl = (value: unknown) => /^https?:\/\//i.test(String(value || "").trim());

const formatAge = (dateValue: Date | string | null | undefined) => {
  if (!dateValue) return "n/a";
  const date = new Date(dateValue);
  const ms = Date.now() - date.getTime();
  if (!Number.isFinite(ms) || ms < 0) return "n/a";
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
};

const median = (values: number[]) => {
  const rows = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!rows.length) return 0;
  const mid = Math.floor(rows.length / 2);
  if (rows.length % 2 === 1) return rows[mid];
  return (rows[mid - 1] + rows[mid]) / 2;
};

const formatHoldTime = (minutesRaw: number) => {
  const minutes = Math.max(0, Math.floor(Number(minutesRaw || 0)));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
};

class TradeAidTelegramBot {
  private readonly token: string;
  private readonly apiBase: string;
  private readonly pollSeconds: number;
  private readonly allowedChatIds: Set<string>;
  private readonly appBaseUrl: string;
  private readonly pushIntervalSeconds: number;
  private readonly pushLookbackMinutes: number;
  private readonly pushMinSafetyScore: number;
  private readonly pushMinLiquidityUsd: number;
  private readonly pushMinVolume24hUsd: number;
  private readonly earlyLookbackMinutes: number;
  private readonly earlyMinSafetyScore: number;
  private readonly earlyMinLiquidityUsd: number;
  private readonly earlyMinVolume24hUsd: number;
  private readonly useWebhookMode: boolean;
  private readonly webhookUrl: string;
  private readonly webhookSecret: string;
  private offset = 0;
  private running = false;
  private pushTimer: NodeJS.Timeout | null = null;
  private pushState: PushState = { chats: {}, sentMintAt: {} };
  private callState: BotCallState = { calls: [] };
  private pushInFlight = false;

  constructor(token: string) {
    this.token = token;
    this.apiBase = `https://api.telegram.org/bot${token}`;
    this.pollSeconds = Math.max(10, Math.trunc(Number(process.env.TELEGRAM_BOT_POLL_SECONDS || 25)));

    const configured = String(process.env.TELEGRAM_ALLOWED_CHAT_IDS || "")
      .split(",")
      .map((item) => String(item || "").trim())
      .filter(Boolean);

    const defaultChatId = String(process.env.TELEGRAM_CHAT_ID || "").trim();
    if (defaultChatId) configured.push(defaultChatId);
    this.allowedChatIds = new Set(configured);

    this.appBaseUrl = String(process.env.TRADEAID_APP_URL || process.env.FRONTEND_URL || "https://tradeaid.ink")
      .trim()
      .replace(/\/$/, "");

    this.pushIntervalSeconds = Math.max(20, Math.trunc(Number(process.env.TELEGRAM_BOT_PUSH_INTERVAL_SECONDS || 60)));
    this.pushLookbackMinutes = Math.max(5, Math.trunc(Number(process.env.TELEGRAM_BOT_PUSH_LOOKBACK_MINUTES || 45)));
    this.pushMinSafetyScore = Math.max(50, Math.trunc(Number(process.env.TELEGRAM_BOT_PUSH_MIN_SAFETY_SCORE || 78)));
    this.pushMinLiquidityUsd = Math.max(5_000, Number(process.env.TELEGRAM_BOT_PUSH_MIN_LIQUIDITY_USD || 35_000));
    this.pushMinVolume24hUsd = Math.max(2_000, Number(process.env.TELEGRAM_BOT_PUSH_MIN_VOLUME24H_USD || 20_000));
    this.earlyLookbackMinutes = Math.max(10, Math.trunc(Number(process.env.TELEGRAM_BOT_EARLY_LOOKBACK_MINUTES || 240)));
    this.earlyMinSafetyScore = Math.max(55, Math.trunc(Number(process.env.TELEGRAM_BOT_EARLY_MIN_SAFETY_SCORE || 76)));
    this.earlyMinLiquidityUsd = Math.max(5_000, Number(process.env.TELEGRAM_BOT_EARLY_MIN_LIQUIDITY_USD || 30_000));
    this.earlyMinVolume24hUsd = Math.max(2_000, Number(process.env.TELEGRAM_BOT_EARLY_MIN_VOLUME24H_USD || 15_000));
    const webhookPath = String(process.env.TELEGRAM_BOT_WEBHOOK_PATH || "/api/telegram/webhook").trim() || "/api/telegram/webhook";
    this.webhookUrl = String(process.env.TELEGRAM_BOT_WEBHOOK_URL || `${this.appBaseUrl}${webhookPath}`).trim();
    this.webhookSecret = String(process.env.TELEGRAM_BOT_WEBHOOK_SECRET || "").trim();
    this.useWebhookMode = this.webhookUrl.length > 0;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    await this.loadPushState();
    await this.loadCallState();
    await this.configureBotMenu();
    if (this.useWebhookMode) {
      await this.configureWebhook();
    } else {
      await this.deleteWebhook();
    }
    this.startPushLoop();
    console.log("[TelegramBot] TradeAid Telegram bot started.");
    if (!this.useWebhookMode) {
      void this.pollLoop();
    }
  }

  private async configureWebhook() {
    const payload: Record<string, any> = {
      url: this.webhookUrl,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
    };
    if (this.webhookSecret) {
      payload.secret_token = this.webhookSecret;
    }

    await axios.post(`${this.apiBase}/setWebhook`, payload, { timeout: 15_000 });
    console.log(`[TelegramBot] Webhook mode enabled: ${this.webhookUrl}`);
  }

  private async deleteWebhook() {
    try {
      await axios.post(
        `${this.apiBase}/deleteWebhook`,
        { drop_pending_updates: false },
        { timeout: 12_000 },
      );
    } catch {
    }
  }

  private async configureBotMenu() {
    const commands = [
      { command: "start", description: "Open TradeAid menu" },
      { command: "safe", description: "Top safer calls" },
      { command: "new", description: "Early safe calls" },
      { command: "pnl", description: "SpyDefi-style PnL board" },
      { command: "token", description: "Lookup token by symbol or CA" },
      { command: "projects", description: "Show project links" },
      { command: "push", description: "Push alerts on/off/status" },
      { command: "help", description: "Show help" },
    ];

    try {
      await axios.post(`${this.apiBase}/setMyCommands`, { commands }, { timeout: 12_000 });
      await axios.post(
        `${this.apiBase}/setChatMenuButton`,
        { menu_button: { type: "commands" } },
        { timeout: 12_000 },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "menu_config_failed");
      console.warn(`[TelegramBot] Menu setup failed: ${message}`);
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.getUpdates();
        for (const update of updates) {
          await this.processUpdate(update);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || "unknown");
        console.warn(`[TelegramBot] Poll error: ${message}`);
      }
    }
  }

  private startPushLoop() {
    if (this.pushTimer) {
      clearInterval(this.pushTimer);
    }

    this.pushTimer = setInterval(() => {
      void this.runPushCycle();
    }, this.pushIntervalSeconds * 1000);
    this.pushTimer.unref?.();
    void this.runPushCycle();
  }

  private async getUpdates() {
    const response = await axios.get<TelegramApiResponse<TelegramUpdate[]>>(`${this.apiBase}/getUpdates`, {
      params: {
        timeout: this.pollSeconds,
        offset: this.offset,
        allowed_updates: JSON.stringify(["message", "callback_query"]),
      },
      timeout: (this.pollSeconds + 10) * 1000,
    });
    return Array.isArray(response.data?.result) ? response.data.result : [];
  }

  private isChatAllowed(chatId: string) {
    if (this.allowedChatIds.size === 0) return true;
    return this.allowedChatIds.has(chatId);
  }

  private async sendMessage(
    chatId: string,
    text: string,
    replyMarkup?: Record<string, any>,
    options?: { disablePreview?: boolean },
  ) {
    await axios.post(
      `${this.apiBase}/sendMessage`,
      {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: options?.disablePreview !== false,
        reply_markup: replyMarkup,
      },
      { timeout: 15_000 },
    );
  }

  private async sendPhoto(
    chatId: string,
    photoUrl: string,
    caption: string,
    replyMarkup?: Record<string, any>,
  ) {
    await axios.post(
      `${this.apiBase}/sendPhoto`,
      {
        chat_id: chatId,
        photo: photoUrl,
        caption,
        parse_mode: "HTML",
        reply_markup: replyMarkup,
      },
      { timeout: 20_000 },
    );
  }

  private async answerCallbackQuery(callbackQueryId: string, text?: string) {
    await axios.post(
      `${this.apiBase}/answerCallbackQuery`,
      {
        callback_query_id: callbackQueryId,
        text: text ? String(text).slice(0, 180) : undefined,
        show_alert: false,
      },
      { timeout: 10_000 },
    );
  }

  private buildTradeAidBuyUrl(ca: string) {
    const contract = encodeURIComponent(String(ca || "").trim());
    return `${this.appBaseUrl}/doctortrade?action=buy&contract=${contract}&chain=solana`;
  }

  private buildTradeAidTokenUrl(ca: string) {
    const contract = encodeURIComponent(String(ca || "").trim());
    return `${this.appBaseUrl}/doctortrade?token=${contract}`;
  }

  private buildStartButtons(subscribed: boolean) {
    return {
      inline_keyboard: [
        [
          { text: "Safe Calls", callback_data: "safe_calls" },
          { text: "Early Safe", callback_data: "new_safe" },
        ],
        [
          { text: "PnL Board", callback_data: "pnl_board" },
          { text: subscribed ? "Push: ON" : "Push: OFF", callback_data: subscribed ? "push_off" : "push_on" },
          { text: "Push Status", callback_data: "push_status" },
        ],
        [
          { text: "Lookup Token", callback_data: "token_help" },
          { text: "Open TradeAid App", url: this.appBaseUrl },
        ],
      ],
    };
  }

  private buildTokenButtons(token: TokenRow, chart: string) {
    const ca = String(token.address || "").trim();
    return {
      inline_keyboard: [
        [
          { text: "Buy", url: this.buildTradeAidBuyUrl(ca) },
          { text: "View", url: this.buildTradeAidTokenUrl(ca) },
        ],
        [
          { text: "Copy CA", callback_data: `copyca:${ca}` },
          { text: "Chart", url: chart },
        ],
      ],
    };
  }

  private async loadCallState() {
    try {
      const loaded = await storage.getAppState<BotCallState>(CALL_STATE_KEY);
      const calls = Array.isArray(loaded?.calls) ? loaded.calls : [];
      this.callState = {
        calls: calls
          .filter((row) => row && typeof row === "object")
          .map((row) => ({
            id: String(row.id || "").trim() || `${String(row.mint || "")}:${String(row.calledAt || nowIso())}`,
            mint: String(row.mint || "").trim(),
            symbol: String(row.symbol || "").trim(),
            name: String(row.name || "").trim(),
            calledAt: String(row.calledAt || nowIso()),
            calledPriceUsd: Number(row.calledPriceUsd || 0),
            safetyScore: Number(row.safetyScore || 0),
            liquidityUsd: Number(row.liquidityUsd || 0),
            volume24hUsd: Number(row.volume24hUsd || 0),
            origin: String(row.origin || "bot_call").trim() || "bot_call",
            peakPriceUsd: Number(row.peakPriceUsd || 0) || undefined,
            peakAt: row.peakAt ? String(row.peakAt) : undefined,
            closedAt: row.closedAt ? String(row.closedAt) : undefined,
            closedPriceUsd: Number(row.closedPriceUsd || 0) || undefined,
            closeReason: row.closeReason ? String(row.closeReason) : undefined,
          }))
          .filter((row) => Boolean(row.mint))
          .slice(-1200),
      };
    } catch {
      this.callState = { calls: [] };
    }
  }

  private async persistCallState() {
    try {
      await storage.setAppState(CALL_STATE_KEY, this.callState);
    } catch {
    }
  }

  private async recordBotCall(token: TokenRow, origin: string) {
    const mint = String(token.address || "").trim();
    if (!mint) return;

    const now = nowIso();
    const price = Number(token.priceUsd || 0);
    const recentDuplicate = this.callState.calls.find((row) => {
      if (row.mint !== mint || row.origin !== origin) return false;
      const ageMs = Date.now() - new Date(String(row.calledAt || "")).getTime();
      return Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 10 * 60 * 1000;
    });
    if (recentDuplicate) return;

    this.callState.calls.push({
      id: `${mint}:${now}:${Math.random().toString(36).slice(2, 8)}`,
      mint,
      symbol: String(token.symbol || "").trim(),
      name: String(token.name || "").trim(),
      calledAt: now,
      calledPriceUsd: Number.isFinite(price) && price > 0 ? price : 0,
      safetyScore: Number(token.safetyScore || 0),
      liquidityUsd: Number(token.liquidity || 0),
      volume24hUsd: Number(token.volume24h || 0),
      origin: String(origin || "bot_call").trim() || "bot_call",
      peakPriceUsd: Number.isFinite(price) && price > 0 ? price : undefined,
      peakAt: Number.isFinite(price) && price > 0 ? now : undefined,
    });

    if (this.callState.calls.length > 1200) {
      this.callState.calls = this.callState.calls.slice(-1200);
    }
    await this.persistCallState();
  }

  private async buildPnlBoard(limit = 10): Promise<PnlBoardResult> {
    const calls = [...this.callState.calls]
      .filter((row) => Boolean(row?.mint))
      .sort((a, b) => new Date(b.calledAt).getTime() - new Date(a.calledAt).getTime());

    if (!calls.length) {
      return { text: "<b>PnL Board</b>\nNo tracked calls yet. Use Safe Calls or Early Safe first." };
    }

    const mints = Array.from(new Set(calls.map((row) => row.mint))).slice(0, 500);
    if (!mints.length) {
      return { text: "<b>PnL Board</b>\nNo tracked calls yet." };
    }

    const rows = await db
      .select()
      .from(scannedTokens)
      .where(and(eq(scannedTokens.chain, "solana"), inArray(scannedTokens.address, mints)));

    const tokenMap = new Map(rows.map((row) => [String(row.address || "").trim(), row]));
    let stateChanged = false;
    const snapshots = calls
      .map((call) => {
        const token = tokenMap.get(call.mint);
        const currentPriceUsd = Number(token?.priceUsd || 0);
        const calledPriceUsd = Number(call.calledPriceUsd || 0);
        if (!Number.isFinite(currentPriceUsd) || currentPriceUsd <= 0 || !Number.isFinite(calledPriceUsd) || calledPriceUsd <= 0) {
          return null;
        }
        const nowMs = Date.now();
        const holdMinutes = Math.max(0, (nowMs - new Date(call.calledAt).getTime()) / 60_000);

        if (!call.closedAt) {
          const peak = Number(call.peakPriceUsd || 0);
          if (!Number.isFinite(peak) || peak <= 0 || currentPriceUsd > peak) {
            call.peakPriceUsd = currentPriceUsd;
            call.peakAt = new Date(nowMs).toISOString();
            stateChanged = true;
          }
        }

        const peakPriceUsd = Math.max(Number(call.peakPriceUsd || 0), currentPriceUsd, calledPriceUsd);
        const drawdownPct = peakPriceUsd > 0 ? ((peakPriceUsd - currentPriceUsd) / peakPriceUsd) * 100 : 0;

        if (!call.closedAt) {
          const liveMultiplier = currentPriceUsd / calledPriceUsd;
          const livePnlPct = (liveMultiplier - 1) * 100;
          let closeReason = "";
          if (liveMultiplier >= 4) {
            closeReason = "tp_4x";
          } else if (holdMinutes >= 24 * 60) {
            closeReason = "time_exit";
          } else if (liveMultiplier <= 0.45 && holdMinutes >= 30) {
            closeReason = "hard_stop";
          } else if (drawdownPct >= 45 && livePnlPct > 10) {
            closeReason = "trailing_stop";
          }

          if (closeReason) {
            call.closedAt = new Date(nowMs).toISOString();
            call.closedPriceUsd = currentPriceUsd;
            call.closeReason = closeReason;
            stateChanged = true;
          }
        }

        const effectiveCurrent = call.closedAt && Number(call.closedPriceUsd || 0) > 0
          ? Number(call.closedPriceUsd || 0)
          : currentPriceUsd;
        const multiplier = effectiveCurrent / calledPriceUsd;
        const pnlPct = (multiplier - 1) * 100;
        return {
          call,
          currentPriceUsd: effectiveCurrent,
          multiplier,
          pnlPct,
          holdMinutes,
          drawdownPct,
          isClosed: Boolean(call.closedAt),
        } satisfies PnlSnapshot;
      })
      .filter((row): row is PnlSnapshot => Boolean(row));

    if (stateChanged) {
      await this.persistCallState();
    }

    if (!snapshots.length) {
      return {
        text: [
        "<b>PnL Board</b>",
        "Tracked calls found, but live price snapshots are not available yet.",
      ].join("\n"),
      };
    }

    const winners = snapshots.filter((row) => row.pnlPct > 0);
    const losers = snapshots.filter((row) => row.pnlPct < 0);
    const breakeven = snapshots.length - winners.length - losers.length;
    const closedSnapshots = snapshots.filter((row) => row.isClosed);
    const openSnapshots = snapshots.filter((row) => !row.isClosed);
    const winRate = (winners.length / snapshots.length) * 100;
    const avgPnl = snapshots.reduce((sum, row) => sum + row.pnlPct, 0) / snapshots.length;
    const medianHoldMinutes = median(snapshots.map((row) => row.holdMinutes));

    const x2 = snapshots.filter((row) => row.multiplier >= 2).length;
    const x3 = snapshots.filter((row) => row.multiplier >= 3).length;
    const x4 = snapshots.filter((row) => row.multiplier >= 4).length;

    const topWins = [...winners].sort((a, b) => b.pnlPct - a.pnlPct).slice(0, Math.max(1, Math.min(limit, 8)));
    const topLosses = [...losers].sort((a, b) => a.pnlPct - b.pnlPct).slice(0, Math.max(1, Math.min(limit, 6)));
    const recent = [...snapshots].sort((a, b) => new Date(b.call.calledAt).getTime() - new Date(a.call.calledAt).getTime()).slice(0, 8);

    const lines = [
      "<b>SpyDefi PnL Board</b>",
      `Calls tracked: <b>${calls.length}</b> | Snapshots priced: <b>${snapshots.length}</b>`,
      `Win rate: <b>${winRate.toFixed(1)}%</b> | Avg PnL: <b>${fmtPct(avgPnl)}</b>`,
      `Win bucket: <b>${winners.length}</b> | Loss bucket: <b>${losers.length}</b> | Flat: <b>${breakeven}</b>`,
      `Open: <b>${openSnapshots.length}</b> | Closed: <b>${closedSnapshots.length}</b>`,
      `Median hold time: <b>${escapeHtml(formatHoldTime(medianHoldMinutes))}</b>`,
      `2x: <b>${x2}</b> | 3x: <b>${x3}</b> | 4x+: <b>${x4}</b>`,
      "",
      "<b>Recent Per-Call Snapshots</b>",
    ];

    for (const row of recent) {
      const calledAgo = formatAge(row.call.calledAt);
      const xText = `${row.multiplier.toFixed(2)}x`;
      const direction = row.pnlPct >= 0 ? "WIN" : "LOSS";
      const status = row.isClosed ? `CLOSED:${String(row.call.closeReason || "exit").toUpperCase()}` : "OPEN";
      lines.push(
        `${direction} ${escapeHtml(String(row.call.symbol || "UNK"))}: <b>${escapeHtml(xText)}</b> (${fmtPct(row.pnlPct)}) | ` +
        `Call ${escapeHtml(fmtUsd(row.call.calledPriceUsd))} -> ${escapeHtml(fmtUsd(row.currentPriceUsd))} | ` +
        `Age ${escapeHtml(calledAgo)} | DD ${fmtPct(-row.drawdownPct)} | ${escapeHtml(status)}`,
      );
    }

    if (closedSnapshots.length) {
      lines.push("", "<b>Closed Snapshot Ledger</b>");
      for (const row of closedSnapshots.slice(0, 8)) {
        const reason = String(row.call.closeReason || "exit").toUpperCase();
        lines.push(
          `${escapeHtml(String(row.call.symbol || "UNK"))}: Entry ${escapeHtml(fmtUsd(row.call.calledPriceUsd))} | ` +
          `Peak ${escapeHtml(fmtUsd(row.call.peakPriceUsd || row.currentPriceUsd))} | ` +
          `Close ${escapeHtml(fmtUsd(row.currentPriceUsd))} | DD ${fmtPct(-row.drawdownPct)} | ${escapeHtml(reason)}`,
        );
      }
    }

    if (topWins.length) {
      lines.push("", "<b>Top Wins</b>");
      for (const row of topWins) {
        lines.push(`${escapeHtml(String(row.call.symbol || "UNK"))}: <b>${row.multiplier.toFixed(2)}x</b> (${fmtPct(row.pnlPct)})`);
      }
    }

    if (topLosses.length) {
      lines.push("", "<b>Top Losses</b>");
      for (const row of topLosses) {
        lines.push(`${escapeHtml(String(row.call.symbol || "UNK"))}: <b>${row.multiplier.toFixed(2)}x</b> (${fmtPct(row.pnlPct)})`);
      }
    }

    const chartSnapshots = [...snapshots]
      .sort((a, b) => b.multiplier - a.multiplier)
      .slice(0, 12);
    const chartUrl = this.buildPnlMultiplierChartUrl(chartSnapshots);
    const chartCaption = [
      "<b>PnL Multipliers</b>",
      `2x: <b>${x2}</b> | 3x: <b>${x3}</b> | 4x+: <b>${x4}</b>`,
      "Green bars are stronger multiples.",
    ].join("\n");

    return {
      text: lines.join("\n"),
      chartUrl,
      chartCaption,
    };
  }

  private buildPnlMultiplierChartUrl(rows: PnlSnapshot[]) {
    if (!rows.length) return "";
    const labels = rows.map((row, idx) => {
      const sym = String(row.call.symbol || "UNK").toUpperCase();
      return `${sym}-${idx + 1}`;
    });
    const values = rows.map((row) => Number(row.multiplier.toFixed(3)));
    const badges = rows.map((row) => {
      if (row.multiplier >= 4) return "4x+";
      if (row.multiplier >= 3) return "3x";
      if (row.multiplier >= 2) return "2x";
      return "<2x";
    });
    const colors = rows.map((row) => {
      if (row.multiplier >= 4) return "#00d084";
      if (row.multiplier >= 3) return "#22c55e";
      if (row.multiplier >= 2) return "#84cc16";
      if (row.multiplier >= 1) return "#f59e0b";
      return "#ef4444";
    });

    const chartConfig = {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Multiple (x)",
            data: values,
            backgroundColor: colors,
            borderColor: "#111827",
            borderWidth: 2,
            borderRadius: 10,
            barPercentage: 0.72,
            categoryPercentage: 0.8,
          },
        ],
      },
      options: {
        layout: { padding: { top: 24, right: 20, left: 20, bottom: 20 } },
        plugins: {
          title: {
            display: true,
            text: "TRADEAID ALPHA BOARD - MULTIPLIER SNAPSHOT",
            color: "#e5e7eb",
            font: { size: 20, weight: "bold" },
          },
          legend: { display: false },
          subtitle: {
            display: true,
            text: badges.join("  |  "),
            color: "#93c5fd",
            font: { size: 13 },
            padding: { bottom: 8 },
          },
        },
        scales: {
          x: {
            ticks: { color: "#d1d5db", maxRotation: 65, minRotation: 30, font: { size: 11 } },
            grid: { color: "rgba(148,163,184,0.18)" },
          },
          y: {
            beginAtZero: true,
            ticks: { color: "#d1d5db" },
            grid: { color: "rgba(148,163,184,0.18)" },
          },
        },
      },
      backgroundColor: "#020617",
    };

    return `https://quickchart.io/chart?width=1200&height=628&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
  }

  private async sendPnlBoard(chatId: string, limit = 10) {
    const board = await this.buildPnlBoard(limit);
    if (board.chartUrl) {
      try {
        await this.sendPhoto(chatId, board.chartUrl, board.chartCaption || "<b>PnL Multipliers</b>");
      } catch {
      }
    }
    await this.sendMessage(chatId, board.text, this.buildStartButtons(this.isSubscribed(chatId)));
  }

  private async loadPushState() {
    try {
      const loaded = await storage.getAppState<PushState>(PUSH_STATE_KEY);
      const chats = loaded?.chats && typeof loaded.chats === "object" ? loaded.chats : {};
      const sentMintAt = loaded?.sentMintAt && typeof loaded.sentMintAt === "object" ? loaded.sentMintAt : {};
      this.pushState = {
        chats,
        sentMintAt,
        lastPushAt: typeof loaded?.lastPushAt === "string" ? loaded.lastPushAt : undefined,
      };
    } catch {
      this.pushState = { chats: {}, sentMintAt: {} };
    }
  }

  private async persistPushState() {
    try {
      await storage.setAppState(PUSH_STATE_KEY, this.pushState);
    } catch {
    }
  }

  private async updateChatSubscription(chatId: string, subscribed: boolean, firstName?: string, username?: string) {
    this.pushState.chats[chatId] = {
      subscribed,
      firstName: firstName ? String(firstName).trim() : undefined,
      username: username ? String(username).trim() : undefined,
      updatedAt: nowIso(),
    };
    await this.persistPushState();
  }

  private isSubscribed(chatId: string) {
    return Boolean(this.pushState.chats[chatId]?.subscribed);
  }

  private getSubscribedChatIds() {
    return Object.entries(this.pushState.chats)
      .filter(([, row]) => Boolean(row?.subscribed))
      .map(([chatId]) => chatId)
      .filter((chatId) => this.isChatAllowed(chatId));
  }

  private pruneSentPushCache() {
    const maxAgeMs = 48 * 60 * 60 * 1000;
    const nowMs = Date.now();
    const next: Record<string, string> = {};
    for (const [mint, at] of Object.entries(this.pushState.sentMintAt || {})) {
      const ts = new Date(String(at || "")).getTime();
      if (Number.isFinite(ts) && nowMs - ts <= maxAgeMs) {
        next[mint] = at;
      }
    }
    this.pushState.sentMintAt = next;
  }

  private async fetchProjectMeta(token: TokenRow): Promise<TokenProjectMeta> {
    const socials = token.socialLinks || {};
    let website = isHttpUrl((socials as any).website) ? String((socials as any).website) : "";
    let twitter = isHttpUrl((socials as any).twitter) ? String((socials as any).twitter) : "";
    let telegram = isHttpUrl((socials as any).telegram) ? String((socials as any).telegram) : "";
    let logoUrl = "";

    const pairOrMint = String(token.pairAddress || token.address || "").trim();
    const chart = pairOrMint ? `https://dexscreener.com/solana/${pairOrMint}` : "https://dexscreener.com";

    try {
      const mint = String(token.address || "").trim();
      if (mint) {
        const response = await axios.get<DexResponse>(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
          timeout: 8_000,
        });
        const pairs = Array.isArray(response.data?.pairs) ? response.data.pairs : [];
        const pair = pairs.find((item) => String(item?.chainId || "").toLowerCase() === "solana") || pairs[0];
        const info = pair?.info;

        const infoWeb = Array.isArray(info?.websites)
          ? info!.websites!.find((item) => isHttpUrl(item?.url))
          : undefined;
        const socialsRows = Array.isArray(info?.socials) ? info!.socials! : [];
        const infoTwitter = socialsRows.find((item) => String(item?.type || "").toLowerCase().includes("twitter"));
        const infoTelegram = socialsRows.find((item) => String(item?.type || "").toLowerCase().includes("telegram"));

        logoUrl = isHttpUrl(info?.imageUrl) ? String(info?.imageUrl) : "";
        if (!website && isHttpUrl(infoWeb?.url)) website = String(infoWeb!.url);
        if (!twitter && isHttpUrl(infoTwitter?.url)) twitter = String(infoTwitter!.url);
        if (!telegram && isHttpUrl(infoTelegram?.url)) telegram = String(infoTelegram!.url);
      }
    } catch {
    }

    return {
      logoUrl,
      website,
      twitter,
      telegram,
      chart,
    };
  }

  private buildTokenCaption(token: TokenRow, project: TokenProjectMeta, mode: "full" | "compact", badge?: string) {
    const heading = `${badge ? `${escapeHtml(badge)} ` : ""}<b>${escapeHtml(token.name)} (${escapeHtml(token.symbol)})</b>`;
    const age = formatAge(token.pairCreatedAt);

    const sections: string[] = [
      heading,
      "",
      `Safety: <b>${Number(token.safetyScore || 0)}/100</b> | Risk: <b>${escapeHtml(String(token.riskLevel || "unknown"))}</b>`,
      `Price: <b>${escapeHtml(fmtUsd(token.priceUsd))}</b> | MCap: <b>${escapeHtml(fmtUsd(token.marketCap))}</b>`,
      `Liquidity: <b>${escapeHtml(fmtUsd(token.liquidity))}</b> | Vol24h: <b>${escapeHtml(fmtUsd(token.volume24h))}</b>`,
      `1h: <b>${escapeHtml(fmtPct(token.priceChange1h))}</b> | Age: <b>${escapeHtml(age)}</b>`,
      `CA: <code>${escapeHtml(token.address)}</code>`,
    ];

    sections.push(
      "",
      `<a href=\"${escapeHtml(project.chart)}\">DexScreener</a> | ${project.website ? `<a href=\"${escapeHtml(project.website)}\">Website</a>` : "Website n/a"}`,
      `${project.twitter ? `<a href=\"${escapeHtml(project.twitter)}\">Twitter</a>` : "Twitter n/a"} | ${project.telegram ? `<a href=\"${escapeHtml(project.telegram)}\">Telegram</a>` : "Telegram n/a"}`,
    );

    if (mode === "full") {
      sections.push(
        "",
        `AI Signal: <b>${escapeHtml(String(token.aiSignal || "hold"))}</b>`,
        `Honeypot: <b>${token.isHoneypot ? "yes" : "no"}</b> | Mint Disabled: <b>${token.mintAuthorityDisabled ? "yes" : "no"}</b>`,
        `Top Holders: <b>${Number(token.topHoldersPercentage || 0)}%</b> | Dev Wallet: <b>${Number(token.devWalletPercentage || 0)}%</b>`,
        `Liquidity Locked: <b>${token.isLiquidityLocked ? "yes" : "no"}</b>`,
      );
      if (token.aiAnalysis) {
        sections.push("", `<i>${escapeHtml(String(token.aiAnalysis))}</i>`);
      }
    }

    return sections.join("\n");
  }

  private async sendTokenCard(
    chatId: string,
    token: TokenRow,
    mode: "full" | "compact",
    badge?: string,
    options?: { trackCall?: boolean; origin?: string },
  ) {
    if (options?.trackCall) {
      await this.recordBotCall(token, String(options.origin || "bot_call"));
    }

    const project = await this.fetchProjectMeta(token);
    const caption = this.buildTokenCaption(token, project, mode, badge);
    const buttons = this.buildTokenButtons(token, project.chart);

    if (project.logoUrl && isHttpUrl(project.logoUrl)) {
      try {
        await this.sendPhoto(chatId, project.logoUrl, caption, buttons);
        return;
      } catch {
      }
    }

    await this.sendMessage(chatId, caption, buttons);
  }

  private helpText() {
    return [
      "<b>TradeAid Solana Bot</b>",
      "",
      "Modern token cards with logo, project links, buy/view buttons, and quick CA copy.",
      "",
      "<b>Commands</b>",
      "/safe [n] - top safer calls",
      "/new [n] - early safer tokens",
      "/early [n] - alias for /new",
      "/pnl - bot call performance board",
      "/token &lt;symbol|address&gt; - full token card",
      "/projects &lt;symbol|address&gt; - project links",
      "/push on|off|status - manage alerts",
      "/help - this help",
      "",
      "Tip: send just a symbol or CA and I will search it.",
      "Risk notice: informational only, always DYOR.",
    ].join("\n");
  }

  async processUpdate(update: TelegramUpdate) {
    if (!update || typeof update !== "object") return;
    this.offset = Math.max(this.offset, Number(update.update_id || 0) + 1);
    await this.handleUpdate(update);
  }

  isWebhookAuthorized(req: Request) {
    if (!this.webhookSecret) return true;
    const token = String(req.headers["x-telegram-bot-api-secret-token"] || "").trim();
    return token.length > 0 && token === this.webhookSecret;
  }

  private async handleUpdate(update: TelegramUpdate) {
    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
      return;
    }

    const message = update.message;
    const text = String(message?.text || "").trim();
    const chatId = String(message?.chat?.id || "").trim();
    const firstName = String(message?.from?.first_name || "").trim();
    const username = String(message?.from?.username || "").trim();
    if (!text || !chatId) return;

    if (!this.isChatAllowed(chatId)) {
      await this.sendMessage(chatId, "This bot is private. Ask admin to allow your chat id.").catch(() => undefined);
      return;
    }

    const lower = text.toLowerCase();
    if (lower === "/start" || lower === "/help") {
      await this.updateChatSubscription(chatId, this.isSubscribed(chatId), firstName, username);
      await this.sendMessage(
        chatId,
        `${this.helpText()}\n\nTap a menu command or use buttons below to open the bot menu quickly.`,
        this.buildStartButtons(this.isSubscribed(chatId)),
      );
      return;
    }

    if (lower.startsWith("/push")) {
      const mode = String(text.split(/\s+/)[1] || "status").trim().toLowerCase();
      if (mode === "on") {
        await this.updateChatSubscription(chatId, true, firstName, username);
        await this.sendMessage(chatId, "Push alerts enabled. You will receive new safe token notifications.", this.buildStartButtons(true));
      } else if (mode === "off") {
        await this.updateChatSubscription(chatId, false, firstName, username);
        await this.sendMessage(chatId, "Push alerts disabled for this chat.", this.buildStartButtons(false));
      } else {
        const subscribed = this.isSubscribed(chatId);
        await this.sendMessage(chatId, `Push status: <b>${subscribed ? "ON" : "OFF"}</b>`, this.buildStartButtons(subscribed));
      }
      return;
    }

    if (lower.startsWith("/safe") || lower.startsWith("/calls") || lower.startsWith("/top")) {
      const limitArg = text.split(/\s+/)[1];
      const limit = takeLimit(limitArg, 5, 8);
      await this.handleSafeCalls(chatId, limit);
      return;
    }

    if (lower.startsWith("/new")) {
      const limitArg = text.split(/\s+/)[1];
      const limit = takeLimit(limitArg, 5, 8);
      await this.handleNewSafe(chatId, limit);
      return;
    }

    if (lower.startsWith("/early")) {
      const limitArg = text.split(/\s+/)[1];
      const limit = takeLimit(limitArg, 5, 8);
      await this.handleNewSafe(chatId, limit);
      return;
    }

    if (lower.startsWith("/pnl")) {
      await this.sendPnlBoard(chatId, 10);
      return;
    }

    if (lower.startsWith("/token ")) {
      const query = text.slice(7).trim();
      if (!query) {
        await this.sendMessage(chatId, "Usage: /token &lt;symbol|address&gt;");
        return;
      }
      await this.handleTokenLookup(chatId, query);
      return;
    }

    if (lower.startsWith("/projects ")) {
      const query = text.slice(10).trim();
      if (!query) {
        await this.sendMessage(chatId, "Usage: /projects &lt;symbol|address&gt;");
        return;
      }
      await this.handleProjectLookup(chatId, query);
      return;
    }

    if (text.length >= 2) {
      await this.handleTokenLookup(chatId, text);
      return;
    }

    await this.sendMessage(chatId, this.helpText(), this.buildStartButtons(this.isSubscribed(chatId)));
  }

  private async handleCallbackQuery(callbackQuery: NonNullable<TelegramUpdate["callback_query"]>) {
    const chatId = String(callbackQuery.message?.chat?.id || "").trim();
    if (!chatId) {
      await this.answerCallbackQuery(callbackQuery.id).catch(() => undefined);
      return;
    }

    if (!this.isChatAllowed(chatId)) {
      await this.answerCallbackQuery(callbackQuery.id).catch(() => undefined);
      return;
    }

    const data = String(callbackQuery.data || "").trim();
    const dataLower = data.toLowerCase();

    if (dataLower === "safe_calls") {
      await this.handleSafeCalls(chatId, 5);
      await this.answerCallbackQuery(callbackQuery.id, "Loaded safe calls").catch(() => undefined);
      return;
    }

    if (dataLower === "new_safe") {
      await this.handleNewSafe(chatId, 5);
      await this.answerCallbackQuery(callbackQuery.id, "Loaded new safe tokens").catch(() => undefined);
      return;
    }

    if (dataLower === "pnl_board") {
      await this.sendPnlBoard(chatId, 10);
      await this.answerCallbackQuery(callbackQuery.id, "Loaded PnL board").catch(() => undefined);
      return;
    }

    if (dataLower === "token_help") {
      await this.sendMessage(chatId, "Send a token symbol or CA, or use /token &lt;symbol|address&gt;.");
      await this.answerCallbackQuery(callbackQuery.id).catch(() => undefined);
      return;
    }

    if (dataLower === "push_on") {
      await this.updateChatSubscription(chatId, true);
      await this.sendMessage(chatId, "Push alerts enabled for this chat.", this.buildStartButtons(true));
      await this.answerCallbackQuery(callbackQuery.id, "Push ON").catch(() => undefined);
      return;
    }

    if (dataLower === "push_off") {
      await this.updateChatSubscription(chatId, false);
      await this.sendMessage(chatId, "Push alerts disabled for this chat.", this.buildStartButtons(false));
      await this.answerCallbackQuery(callbackQuery.id, "Push OFF").catch(() => undefined);
      return;
    }

    if (dataLower === "push_status") {
      const subscribed = this.isSubscribed(chatId);
      await this.sendMessage(chatId, `Push status: <b>${subscribed ? "ON" : "OFF"}</b>`, this.buildStartButtons(subscribed));
      await this.answerCallbackQuery(callbackQuery.id).catch(() => undefined);
      return;
    }

    if (dataLower.startsWith("copyca:")) {
      const ca = String(data.slice(7) || "").trim();
      if (ca) {
        await this.sendMessage(
          chatId,
          [
            "<b>Copy Contract Address</b>",
            `<code>${escapeHtml(ca)}</code>`,
            "Tap and hold the CA above to copy.",
          ].join("\n"),
          {
            inline_keyboard: [
              [
                { text: "Buy", url: this.buildTradeAidBuyUrl(ca) },
                { text: "View", url: this.buildTradeAidTokenUrl(ca) },
              ],
            ],
          },
        );
      }
      await this.answerCallbackQuery(callbackQuery.id, "CA sent").catch(() => undefined);
      return;
    }

    await this.answerCallbackQuery(callbackQuery.id).catch(() => undefined);
  }

  private async queryToken(query: string) {
    const queryLike = `%${query}%`;
    const rows = await db
      .select()
      .from(scannedTokens)
      .where(
        and(
          eq(scannedTokens.chain, "solana"),
          or(
            eq(scannedTokens.address, query),
            ilike(scannedTokens.symbol, query),
            ilike(scannedTokens.symbol, queryLike),
            ilike(scannedTokens.name, queryLike),
          ),
        ),
      )
      .orderBy(
        desc(
          sql`CASE WHEN lower(${scannedTokens.symbol}) = lower(${query}) THEN 1 ELSE 0 END`,
        ),
        desc(scannedTokens.safetyScore),
        desc(scannedTokens.volume24h),
      )
      .limit(1);

    return rows[0];
  }

  private async handleSafeCalls(chatId: string, limit: number) {
    const rows = await db
      .select()
      .from(scannedTokens)
      .where(
        and(
          eq(scannedTokens.chain, "solana"),
          gte(scannedTokens.safetyScore, 75),
          gte(scannedTokens.liquidity, 40_000),
          gte(scannedTokens.volume24h, 25_000),
          eq(scannedTokens.isHoneypot, false),
          lte(scannedTokens.topHoldersPercentage, 25),
          lte(scannedTokens.devWalletPercentage, 12),
          gte(scannedTokens.priceChange1h, -30),
        ),
      )
      .orderBy(desc(scannedTokens.safetyScore), desc(scannedTokens.volume24h), desc(scannedTokens.liquidity))
      .limit(limit);

    if (!rows.length) {
      await this.sendMessage(chatId, "No safe calls found right now. Try again in a few minutes.");
      return;
    }

    await this.sendMessage(
      chatId,
      `<b>Top Safe Solana Calls</b>\nShowing ${rows.length} opportunities ranked by safety + liquidity.`,
      this.buildStartButtons(this.isSubscribed(chatId)),
    );

    for (const token of rows) {
      await this.sendTokenCard(chatId, token, "compact", "SAFE CALL", { trackCall: true, origin: "safe_calls" });
    }
  }

  private async handleNewSafe(chatId: string, limit: number) {
    const since = new Date(Date.now() - this.earlyLookbackMinutes * 60 * 1000);
    const rows = await db
      .select()
      .from(scannedTokens)
      .where(
        and(
          eq(scannedTokens.chain, "solana"),
          gte(scannedTokens.safetyScore, this.earlyMinSafetyScore),
          gte(scannedTokens.liquidity, this.earlyMinLiquidityUsd),
          gte(scannedTokens.volume24h, this.earlyMinVolume24hUsd),
          eq(scannedTokens.isHoneypot, false),
          lte(scannedTokens.topHoldersPercentage, 30),
          lte(scannedTokens.devWalletPercentage, 12),
          gte(scannedTokens.pairCreatedAt, since),
        ),
      )
      .orderBy(desc(scannedTokens.pairCreatedAt), desc(scannedTokens.safetyScore), desc(scannedTokens.volume24h))
      .limit(limit);

    if (!rows.length) {
      await this.sendMessage(chatId, "No early safer tokens found in the current window yet.");
      return;
    }

    await this.sendMessage(
      chatId,
      `<b>Early Safe Solana Calls</b>\nShowing ${rows.length} fresh picks from scanned app tokens.`,
      this.buildStartButtons(this.isSubscribed(chatId)),
    );

    for (const token of rows) {
      await this.sendTokenCard(chatId, token, "compact", "EARLY SAFE", { trackCall: true, origin: "early_safe" });
    }
  }

  private async handleProjectLookup(chatId: string, rawQuery: string) {
    const query = String(rawQuery || "").trim();
    if (!query) {
      await this.sendMessage(chatId, "Please provide a token symbol or Solana mint address.");
      return;
    }

    const token = await this.queryToken(query);
    if (!token) {
      await this.sendMessage(chatId, `No Solana token found for: ${escapeHtml(query)}`);
      return;
    }

    const project = await this.fetchProjectMeta(token);
    const text = [
      `<b>Project Links - ${escapeHtml(token.symbol)}</b>`,
      `CA: <code>${escapeHtml(token.address)}</code>`,
      "",
      `${project.website ? `<a href=\"${escapeHtml(project.website)}\">Website</a>` : "Website n/a"}`,
      `${project.twitter ? `<a href=\"${escapeHtml(project.twitter)}\">Twitter</a>` : "Twitter n/a"}`,
      `${project.telegram ? `<a href=\"${escapeHtml(project.telegram)}\">Telegram</a>` : "Telegram n/a"}`,
      `<a href=\"${escapeHtml(project.chart)}\">DexScreener</a>`,
    ].join("\n");

    await this.sendMessage(chatId, text, this.buildTokenButtons(token, project.chart));
  }

  private async handleTokenLookup(chatId: string, rawQuery: string) {
    const query = String(rawQuery || "").trim();
    if (!query) {
      await this.sendMessage(chatId, "Please provide a token symbol or Solana mint address.");
      return;
    }

    const token = await this.queryToken(query);
    if (!token) {
      await this.sendMessage(chatId, `No Solana token found for: ${escapeHtml(query)}`);
      return;
    }

    await this.sendTokenCard(chatId, token, "full", "TOKEN DETAILS");
  }

  private async runPushCycle() {
    if (this.pushInFlight) return;
    this.pushInFlight = true;

    try {
      const subscribers = this.getSubscribedChatIds();
      if (!subscribers.length) return;

      const since = new Date(Date.now() - this.pushLookbackMinutes * 60 * 1000);
      const candidates = await db
        .select()
        .from(scannedTokens)
        .where(
          and(
            eq(scannedTokens.chain, "solana"),
            gte(scannedTokens.safetyScore, this.pushMinSafetyScore),
            gte(scannedTokens.liquidity, this.pushMinLiquidityUsd),
            gte(scannedTokens.volume24h, this.pushMinVolume24hUsd),
            eq(scannedTokens.isHoneypot, false),
            lte(scannedTokens.topHoldersPercentage, 30),
            lte(scannedTokens.devWalletPercentage, 12),
            gte(scannedTokens.pairCreatedAt, since),
          ),
        )
        .orderBy(desc(scannedTokens.pairCreatedAt), desc(scannedTokens.safetyScore), desc(scannedTokens.volume24h))
        .limit(5);

      if (!candidates.length) {
        this.pushState.lastPushAt = nowIso();
        await this.persistPushState();
        return;
      }

      this.pruneSentPushCache();
      let changed = false;
      for (const token of candidates) {
        const mint = String(token.address || "").trim();
        if (!mint) continue;
        if (this.pushState.sentMintAt[mint]) continue;

        for (const chatId of subscribers) {
          await this.sendTokenCard(chatId, token, "compact", "EARLY SAFE ALERT", {
            trackCall: true,
            origin: "push_alert",
          }).catch(() => undefined);
        }

        this.pushState.sentMintAt[mint] = nowIso();
        changed = true;
      }

      this.pushState.lastPushAt = nowIso();
      if (changed) {
        await this.persistPushState();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "push_cycle_failed");
      console.warn(`[TelegramBot] Push error: ${message}`);
    } finally {
      this.pushInFlight = false;
    }
  }
}

let telegramBotSingleton: TradeAidTelegramBot | null = null;

export const startTradeAidTelegramBot = async () => {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) {
    console.log("[TelegramBot] TELEGRAM_BOT_TOKEN missing. Bot is disabled.");
    return;
  }

  if (telegramBotSingleton) {
    return;
  }

  telegramBotSingleton = new TradeAidTelegramBot(token);
  await telegramBotSingleton.start();
};

export const getTradeAidTelegramBot = () => telegramBotSingleton;

export const registerTradeAidTelegramWebhookRoute = (app: Express) => {
  const path = String(process.env.TELEGRAM_BOT_WEBHOOK_PATH || "/api/telegram/webhook").trim() || "/api/telegram/webhook";

  app.post(path, async (req: Request, res: Response) => {
    const bot = getTradeAidTelegramBot();
    if (!bot) {
      return res.status(503).json({ ok: false, message: "bot_not_started" });
    }

    if (!bot.isWebhookAuthorized(req)) {
      return res.status(401).json({ ok: false, message: "unauthorized" });
    }

    try {
      await bot.processUpdate(req.body as TelegramUpdate);
      return res.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "update_failed";
      console.warn(`[TelegramBot] Webhook update error: ${message}`);
      return res.status(500).json({ ok: false, message: "update_failed" });
    }
  });

  console.log(`[TelegramBot] Webhook route registered at ${path}`);
};
