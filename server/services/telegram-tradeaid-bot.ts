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
  lastBoardAt?: string;
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
  milestonesHit?: number[];
  topHoldersPctAtCall?: number;
  devWalletPctAtCall?: number;
  priceChange1hAtCall?: number;
  pairAgeMinutesAtCall?: number;
};

type BotCallState = {
  calls: BotCallRecord[];
};

type PnlSnapshot = {
  call: BotCallRecord;
  token: TokenRow | undefined;
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

type LearnedRankedToken = {
  token: TokenRow;
  baseScore: number;
  learnedBonus: number;
  finalScore: number;
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
const DIVIDER = "━━━━━━━━━━━━━━";

type TelegramSentMessage = {
  message_id: number;
};

const isAxiosError = (error: unknown): error is { response?: { status?: number; data?: any } } => {
  return Boolean(error) && typeof error === "object" && "response" in (error as Record<string, unknown>);
};

const nowIso = () => new Date().toISOString();

const escapeHtml = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const escapeMarkdown = (value: unknown) => String(value ?? "")
  .replace(/([_\*\[\]\(\)~`>#\+\-=\|\{\}\.!\\])/g, "\\$1");

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

const summarizeWindow = (rows: PnlSnapshot[], hours: number) => {
  const nowMs = Date.now();
  const cutoffMs = nowMs - (hours * 60 * 60 * 1000);
  const windowRows = rows.filter((row) => new Date(row.call.calledAt).getTime() >= cutoffMs);
  if (!windowRows.length) {
    return { calls: 0, winRate: 0, avgPnl: 0 };
  }
  const winners = windowRows.filter((row) => row.pnlPct > 0).length;
  const avgPnl = windowRows.reduce((sum, row) => sum + row.pnlPct, 0) / windowRows.length;
  return {
    calls: windowRows.length,
    winRate: (winners / windowRows.length) * 100,
    avgPnl,
  };
};

const statusBadgeFromPnl = (pnlPct: number) => {
  if (pnlPct >= 0.01) return "🟢 WIN";
  if (pnlPct <= -0.01) return "🔴 LOSS";
  return "🟡 FLAT";
};

const statusBadgeFromMultiplier = (multiplier: number) => {
  if (multiplier > 1.0001) return "🟢 WIN";
  if (multiplier < 0.9999) return "🔴 LOSS";
  return "🟡 FLAT";
};

const progressBar = (multiplier: number, width = 14, maxScale = 3) => {
  const normalized = Math.max(0, Math.min(1, (Number(multiplier || 0) - 1) / Math.max(0.0001, maxScale - 1)));
  const filled = Math.max(0, Math.min(width, Math.round(width * normalized)));
  const empty = Math.max(0, width - filled);
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${Number(multiplier || 0).toFixed(2)}x`;
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
  private readonly callMaxTopHoldersPct: number;
  private readonly callMaxDevWalletPct: number;
  private readonly callMax1hPumpPct: number;
  private readonly callMinSafetyScore: number;
  private readonly callMinLiquidityUsd: number;
  private readonly callMinVolume24hUsd: number;
  private readonly callTakeProfitMultiplier: number;
  private readonly badCallDropMultiplier: number;
  private readonly badCallMinHoldMinutes: number;
  private readonly badCallMinSafetyScore: number;
  private readonly earlyLookbackMinutes: number;
  private readonly earlyMinSafetyScore: number;
  private readonly earlyMinLiquidityUsd: number;
  private readonly earlyMinVolume24hUsd: number;
  private readonly boardIntervalSeconds: number;
  private readonly useWebhookMode: boolean;
  private readonly webhookUrl: string;
  private readonly webhookSecret: string;
  private offset = 0;
  private running = false;
  private pushTimer: NodeJS.Timeout | null = null;
  private pushState: PushState = { chats: {}, sentMintAt: {} };
  private callState: BotCallState = { calls: [] };
  private pushInFlight = false;
  private readonly learningMinClosedCalls: number;
  private readonly learningBonusCap: number;

  private pruneCallHistory() {
    const maxAgeMs = 45 * 24 * 60 * 60 * 1000;
    const nowMs = Date.now();
    const filtered = this.callState.calls.filter((row) => {
      const calledAtMs = new Date(String(row.calledAt || "")).getTime();
      return Number.isFinite(calledAtMs) && (nowMs - calledAtMs) <= maxAgeMs;
    });
    this.callState.calls = filtered.slice(-5000);
  }

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
    this.callMaxTopHoldersPct = Math.max(8, Number(process.env.TELEGRAM_BOT_CALL_MAX_TOP_HOLDERS_PCT || 22));
    this.callMaxDevWalletPct = Math.max(1, Number(process.env.TELEGRAM_BOT_CALL_MAX_DEV_WALLET_PCT || 7));
    this.callMax1hPumpPct = Math.max(15, Number(process.env.TELEGRAM_BOT_CALL_MAX_1H_PUMP_PCT || 70));
    this.callMinSafetyScore = Math.max(60, Math.trunc(Number(process.env.TELEGRAM_BOT_CALL_MIN_SAFETY_SCORE || 82)));
    this.callMinLiquidityUsd = Math.max(10_000, Number(process.env.TELEGRAM_BOT_CALL_MIN_LIQUIDITY_USD || 50_000));
    this.callMinVolume24hUsd = Math.max(8_000, Number(process.env.TELEGRAM_BOT_CALL_MIN_VOLUME24H_USD || 30_000));
    this.callTakeProfitMultiplier = Math.max(4, Math.min(50, Number(process.env.TELEGRAM_BOT_TAKE_PROFIT_MULTIPLIER || 20)));
    this.badCallDropMultiplier = Math.max(0.1, Math.min(0.95, Number(process.env.TELEGRAM_BOT_BAD_CALL_DROP_MULTIPLIER || 0.65)));
    this.badCallMinHoldMinutes = Math.max(5, Math.min(180, Math.trunc(Number(process.env.TELEGRAM_BOT_BAD_CALL_MIN_HOLD_MINUTES || 15))));
    this.badCallMinSafetyScore = Math.max(20, Math.min(95, Math.trunc(Number(process.env.TELEGRAM_BOT_BAD_CALL_MIN_SAFETY_SCORE || 70))));
    this.earlyLookbackMinutes = Math.max(10, Math.trunc(Number(process.env.TELEGRAM_BOT_EARLY_LOOKBACK_MINUTES || 240)));
    this.earlyMinSafetyScore = Math.max(55, Math.trunc(Number(process.env.TELEGRAM_BOT_EARLY_MIN_SAFETY_SCORE || 76)));
    this.earlyMinLiquidityUsd = Math.max(5_000, Number(process.env.TELEGRAM_BOT_EARLY_MIN_LIQUIDITY_USD || 30_000));
    this.earlyMinVolume24hUsd = Math.max(2_000, Number(process.env.TELEGRAM_BOT_EARLY_MIN_VOLUME24H_USD || 15_000));
    this.boardIntervalSeconds = Math.max(300, Math.trunc(Number(process.env.TELEGRAM_BOT_BOARD_INTERVAL_SECONDS || 1800)));
    this.learningMinClosedCalls = Math.max(8, Math.trunc(Number(process.env.TELEGRAM_BOT_LEARNING_MIN_CLOSED_CALLS || 20)));
    this.learningBonusCap = Math.max(4, Number(process.env.TELEGRAM_BOT_LEARNING_BONUS_CAP || 16));
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
      { command: "tg", description: "Tokens with Telegram communities" },
      { command: "x", description: "Tokens with X communities" },
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
    options?: { disablePreview?: boolean; parseMode?: "HTML" | "Markdown" | "MarkdownV2" },
  ) {
    try {
      const response = await axios.post<TelegramApiResponse<TelegramSentMessage>>(
        `${this.apiBase}/sendMessage`,
        {
          chat_id: chatId,
          text,
          parse_mode: options?.parseMode || "HTML",
          disable_web_page_preview: options?.disablePreview !== false,
          reply_markup: replyMarkup,
        },
        { timeout: 15_000 },
      );
      return response.data?.result;
    } catch (error) {
      if (isAxiosError(error)) {
        const status = Number(error.response?.status || 0);
        const body = JSON.stringify(error.response?.data || {});
        console.error(`[TelegramBot] sendMessage failed status=${status} parseMode=${options?.parseMode || "HTML"} body=${body.slice(0, 400)}`);
      }
      throw error;
    }
  }

  private async sendPhoto(
    chatId: string,
    photoUrl: string,
    caption: string,
    replyMarkup?: Record<string, any>,
    options?: { parseMode?: "HTML" | "Markdown" | "MarkdownV2" },
  ) {
    const response = await axios.post<TelegramApiResponse<TelegramSentMessage>>(
      `${this.apiBase}/sendPhoto`,
      {
        chat_id: chatId,
        photo: photoUrl,
        caption,
        parse_mode: options?.parseMode || "HTML",
        reply_markup: replyMarkup,
      },
      { timeout: 20_000 },
    );
    return response.data?.result;
  }

  private async pinMessage(chatId: string, messageId: number) {
    await axios.post(
      `${this.apiBase}/pinChatMessage`,
      {
        chat_id: chatId,
        message_id: messageId,
        disable_notification: true,
      },
      { timeout: 10_000 },
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
          { text: "TG Communities", callback_data: "tg_community" },
        ],
        [
          { text: "X Communities", callback_data: "x_community" },
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

  private buildMarketButtons(token: TokenRow, project: TokenProjectMeta) {
    const mint = String(token.address || "").trim();
    const pairOrMint = String(token.pairAddress || mint).trim();
    const dexUrl = project.chart || (pairOrMint ? `https://dexscreener.com/solana/${pairOrMint}` : "https://dexscreener.com");
    const pumpUrl = mint ? `https://pump.fun/coin/${encodeURIComponent(mint)}` : "https://pump.fun";
    const solscanUrl = mint ? `https://solscan.io/token/${encodeURIComponent(mint)}` : "https://solscan.io";
    const telegramUrl = isHttpUrl(project.telegram) ? String(project.telegram).trim() : "";
    const twitterUrl = isHttpUrl(project.twitter) ? String(project.twitter).trim() : "";

    const linksRow = [
      { text: "DexScreener", url: dexUrl },
      { text: "Pump.fun", url: pumpUrl },
      { text: "Solscan", url: solscanUrl },
    ];

    const actionRow = [
      { text: "Buy", url: this.buildTradeAidBuyUrl(mint) },
      { text: "View", url: this.buildTradeAidTokenUrl(mint) },
    ];

    const keyboard = [linksRow, actionRow];
    if (telegramUrl || twitterUrl) {
      const communityRow: Array<{ text: string; url: string }> = [];
      if (telegramUrl) communityRow.push({ text: "Telegram Community", url: telegramUrl });
      if (twitterUrl) communityRow.push({ text: "X Community", url: twitterUrl });
      keyboard.push(communityRow);
    }

    return {
      inline_keyboard: keyboard,
    };
  }

  private buildProfessionalCallMessage(token: TokenRow, project: TokenProjectMeta, call?: BotCallRecord) {
    const entryPrice = Number(call?.calledPriceUsd || token.priceUsd || 0);
    const priceNow = Number(token.priceUsd || 0);
    const multiplier = entryPrice > 0 && priceNow > 0 ? priceNow / entryPrice : 1;
    const pnlPct = (multiplier - 1) * 100;
    const peakPrice = Math.max(Number(call?.peakPriceUsd || 0), priceNow, entryPrice);
    const drawdownPct = peakPrice > 0 ? ((peakPrice - priceNow) / peakPrice) * 100 : 0;
    const age = call?.calledAt ? formatAge(call.calledAt) : formatAge(token.pairCreatedAt);
    const status = statusBadgeFromPnl(pnlPct);
    const stampedAt = new Date().toISOString().replace("T", " ").replace(".000Z", " UTC");

    const dexUrl = project.chart || "https://dexscreener.com";
    const pumpUrl = token.address ? `https://pump.fun/coin/${encodeURIComponent(String(token.address))}` : "https://pump.fun";
    const solscanUrl = token.address ? `https://solscan.io/token/${encodeURIComponent(String(token.address))}` : "https://solscan.io";
    const telegramUrl = isHttpUrl(project.telegram) ? String(project.telegram).trim() : "";
    const linksLine = telegramUrl
      ? `[DexScreener](${dexUrl}) \| [Pump\.fun](${pumpUrl}) \| [Solscan](${solscanUrl}) \| [Telegram Community](${telegramUrl})`
      : `[DexScreener](${dexUrl}) \| [Pump\.fun](${pumpUrl}) \| [Solscan](${solscanUrl})`;

    return [
      "🚨 *TRADEAID CALL DETECTED*",
      "",
      `Token: *${escapeMarkdown(String(token.symbol || token.name || "UNK"))}*`,
      "Pair: *SOL*",
      `Entry Price: *${escapeMarkdown(fmtUsd(entryPrice))}*`,
      "",
      DIVIDER,
      "",
      "📊 *Live Performance*",
      `Price Now: *${escapeMarkdown(fmtUsd(priceNow))}*`,
      `PnL: *${escapeMarkdown(fmtPct(pnlPct))}*`,
      `Multiplier: *${escapeMarkdown(multiplier.toFixed(2))}x*`,
      `Age: *${escapeMarkdown(age)}*`,
      "",
      "Price Progress",
      escapeMarkdown(progressBar(multiplier)),
      "",
      DIVIDER,
      "",
      "📈 *Trade Stats*",
      `Liquidity: *${escapeMarkdown(fmtUsd(token.liquidity))}*`,
      `Market Cap: *${escapeMarkdown(fmtUsd(token.marketCap))}*`,
      `Volume: *${escapeMarkdown(fmtUsd(token.volume24h))}*`,
      "",
      DIVIDER,
      "",
      "📉 *Risk Metrics*",
      `Drawdown: *${escapeMarkdown(fmtPct(-drawdownPct))}*`,
      `Status: *${escapeMarkdown(status)}*`,
      "",
      DIVIDER,
      "",
      "🔗 *Links*",
      linksLine,
      "",
      DIVIDER,
      `Updated: ${escapeMarkdown(stampedAt)}`,
      "TradeAid Intelligence Engine",
      "Powered by Solana Data",
    ].join("\n");
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
            topHoldersPctAtCall: Number((row as any).topHoldersPctAtCall || 0) || undefined,
            devWalletPctAtCall: Number((row as any).devWalletPctAtCall || 0) || undefined,
            priceChange1hAtCall: Number((row as any).priceChange1hAtCall || 0) || undefined,
            pairAgeMinutesAtCall: Number((row as any).pairAgeMinutesAtCall || 0) || undefined,
            milestonesHit: Array.isArray((row as any).milestonesHit)
              ? (row as any).milestonesHit.map((value: unknown) => Math.trunc(Number(value || 0))).filter((value: number) => value > 0)
              : [],
          }))
          .filter((row) => Boolean(row.mint))
          .slice(-5000),
      };
      this.pruneCallHistory();
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

  private async recordBotCall(token: TokenRow, origin: string): Promise<BotCallRecord | null> {
    const mint = String(token.address || "").trim();
    if (!mint) return null;

    const now = nowIso();
    const price = Number(token.priceUsd || 0);
    const recentDuplicate = this.callState.calls.find((row) => {
      if (row.mint !== mint || row.origin !== origin) return false;
      const ageMs = Date.now() - new Date(String(row.calledAt || "")).getTime();
      return Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 10 * 60 * 1000;
    });
    if (recentDuplicate) return recentDuplicate;

    const created: BotCallRecord = {
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
      milestonesHit: [],
      topHoldersPctAtCall: Number(token.topHoldersPercentage || 0),
      devWalletPctAtCall: Number(token.devWalletPercentage || 0),
      priceChange1hAtCall: Number(token.priceChange1h || 0),
      pairAgeMinutesAtCall: (() => {
        const ts = new Date(String(token.pairCreatedAt || "")).getTime();
        if (!Number.isFinite(ts) || ts <= 0) return undefined;
        const minutes = Math.max(0, (Date.now() - ts) / 60_000);
        return Number(minutes.toFixed(2));
      })(),
    };

    this.callState.calls.push(created);
    this.pruneCallHistory();
    await this.persistCallState();
    return created;
  }

  private getClosedCallRows() {
    return this.callState.calls.filter((row) => {
      if (!row.closedAt) return false;
      const entry = Number(row.calledPriceUsd || 0);
      const exit = Number(row.closedPriceUsd || 0);
      return Number.isFinite(entry) && entry > 0 && Number.isFinite(exit) && exit > 0;
    });
  }

  private getCallPnlPct(row: BotCallRecord) {
    const entry = Number(row.calledPriceUsd || 0);
    const exit = Number(row.closedPriceUsd || 0);
    if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(exit) || exit <= 0) return 0;
    return ((exit / entry) - 1) * 100;
  }

  private computeBaseCandidateScore(token: TokenRow) {
    const safety = Number(token.safetyScore || 0);
    const liquidity = Math.max(0, Number(token.liquidity || 0));
    const volume = Math.max(0, Number(token.volume24h || 0));
    const topHolder = Math.max(0, Number(token.topHoldersPercentage || 0));
    const devWallet = Math.max(0, Number(token.devWalletPercentage || 0));
    const momentum1h = Number(token.priceChange1h || 0);
    const liqScore = Math.log10(liquidity + 1) * 7.5;
    const volScore = Math.log10(volume + 1) * 7.5;
    const riskPenalty = (topHolder * 0.5) + (devWallet * 0.8);
    const momentumScore = Math.max(-40, Math.min(80, momentum1h)) * 0.08;
    const overextendedPenalty = Math.max(0, Math.abs(momentum1h) - this.callMax1hPumpPct) * 0.22;
    return (safety * 0.75) + liqScore + volScore + momentumScore - riskPenalty - overextendedPenalty;
  }

  private isQualityCallCandidate(token: TokenRow) {
    if (String(token.chain || "").toLowerCase() !== "solana") return false;
    if (Boolean(token.isHoneypot)) return false;

    const safetyScore = Number(token.safetyScore || 0);
    const liquidityUsd = Math.max(0, Number(token.liquidity || 0));
    const volume24hUsd = Math.max(0, Number(token.volume24h || 0));
    const topHolderPct = Math.max(0, Number(token.topHoldersPercentage || 0));
    const devWalletPct = Math.max(0, Number(token.devWalletPercentage || 0));
    const priceChange1h = Number(token.priceChange1h || 0);

    if (safetyScore < this.callMinSafetyScore) return false;
    if (liquidityUsd < this.callMinLiquidityUsd) return false;
    if (volume24hUsd < this.callMinVolume24hUsd) return false;
    if (topHolderPct > this.callMaxTopHoldersPct) return false;
    if (devWalletPct > this.callMaxDevWalletPct) return false;
    if (Math.abs(priceChange1h) > this.callMax1hPumpPct) return false;

    return true;
  }

  private shouldDropBadCall(token: TokenRow | undefined, holdMinutes: number, liveMultiplier: number, drawdownPct: number) {
    if (!token) return false;
    if (holdMinutes < this.badCallMinHoldMinutes) return false;

    const safetyScore = Number(token.safetyScore || 0);
    const topHolderPct = Math.max(0, Number(token.topHoldersPercentage || 0));
    const devWalletPct = Math.max(0, Number(token.devWalletPercentage || 0));
    const momentum1h = Number(token.priceChange1h || 0);

    if (Boolean(token.isHoneypot)) return true;
    if (liveMultiplier <= this.badCallDropMultiplier) return true;
    if (safetyScore < this.badCallMinSafetyScore) return true;
    if (topHolderPct > (this.callMaxTopHoldersPct + 8)) return true;
    if (devWalletPct > (this.callMaxDevWalletPct + 4)) return true;
    if (momentum1h <= -35 && holdMinutes >= 10) return true;
    if (drawdownPct >= 38 && liveMultiplier < 1.1) return true;

    return false;
  }

  private computeLearnedBonus(token: TokenRow) {
    const closed = this.getClosedCallRows();
    if (closed.length < this.learningMinClosedCalls) return 0;

    const globalAvg = closed.reduce((sum, row) => sum + this.getCallPnlPct(row), 0) / Math.max(1, closed.length);
    const safety = Number(token.safetyScore || 0);
    const liquidity = Math.max(0, Number(token.liquidity || 0));
    const volume = Math.max(0, Number(token.volume24h || 0));
    const topHolder = Math.max(0, Number(token.topHoldersPercentage || 0));
    const devWallet = Math.max(0, Number(token.devWalletPercentage || 0));

    const localRows = closed.filter((row) => {
      const rowSafety = Number(row.safetyScore || 0);
      const rowLiq = Math.max(0, Number(row.liquidityUsd || 0));
      const rowVol = Math.max(0, Number(row.volume24hUsd || 0));
      const rowTop = Math.max(0, Number(row.topHoldersPctAtCall || 0));
      const rowDev = Math.max(0, Number(row.devWalletPctAtCall || 0));

      const safetyOk = Math.abs(rowSafety - safety) <= 10;
      const liqRatio = rowLiq > 0 && liquidity > 0 ? Math.max(rowLiq, liquidity) / Math.max(1, Math.min(rowLiq, liquidity)) : 99;
      const volRatio = rowVol > 0 && volume > 0 ? Math.max(rowVol, volume) / Math.max(1, Math.min(rowVol, volume)) : 99;
      const topOk = Math.abs(rowTop - topHolder) <= 10;
      const devOk = Math.abs(rowDev - devWallet) <= 8;

      return safetyOk && liqRatio <= 2.5 && volRatio <= 2.5 && topOk && devOk;
    });

    if (!localRows.length) {
      const bonus = globalAvg * 0.12;
      return Math.max(-this.learningBonusCap, Math.min(this.learningBonusCap, bonus));
    }

    const localAvg = localRows.reduce((sum, row) => sum + this.getCallPnlPct(row), 0) / localRows.length;
    const confidence = Math.max(0.1, Math.min(1, localRows.length / 25));
    const blended = (localAvg * confidence) + (globalAvg * (1 - confidence));
    const bonus = blended * 0.18;
    return Math.max(-this.learningBonusCap, Math.min(this.learningBonusCap, bonus));
  }

  private rankCandidatesWithLearning(tokens: TokenRow[]): LearnedRankedToken[] {
    const ranked = tokens.map((token) => {
      const baseScore = this.computeBaseCandidateScore(token);
      const learnedBonus = this.computeLearnedBonus(token);
      return {
        token,
        baseScore,
        learnedBonus,
        finalScore: baseScore + learnedBonus,
      } satisfies LearnedRankedToken;
    });

    return ranked.sort((a, b) => {
      const byFinal = b.finalScore - a.finalScore;
      if (Math.abs(byFinal) > 0.00001) return byFinal;
      const bySafety = Number(b.token.safetyScore || 0) - Number(a.token.safetyScore || 0);
      if (Math.abs(bySafety) > 0.00001) return bySafety;
      return Number(b.token.volume24h || 0) - Number(a.token.volume24h || 0);
    });
  }

  private async buildPnlBoard(limit = 10): Promise<PnlBoardResult> {
    const calls = [...this.callState.calls]
      .filter((row) => Boolean(row?.mint))
      .sort((a, b) => new Date(b.calledAt).getTime() - new Date(a.calledAt).getTime());

    if (!calls.length) {
      return { text: "🏆 *TRADEAID PERFORMANCE BOARD*\nNo tracked calls yet\. Use /safe or /new first\." };
    }

    const mints = Array.from(new Set(calls.map((row) => row.mint))).slice(0, 500);
    if (!mints.length) {
      return { text: "🏆 *TRADEAID PERFORMANCE BOARD*\nNo tracked calls yet\." };
    }

    const rows = await db
      .select()
      .from(scannedTokens)
      .where(and(eq(scannedTokens.chain, "solana"), inArray(scannedTokens.address, mints)));

    const tokenMap = new Map(rows.map((row) => [String(row.address || "").trim(), row]));
    let stateChanged = false;
    const droppedCallIds = new Set<string>();
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
          if (this.shouldDropBadCall(token, holdMinutes, liveMultiplier, drawdownPct)) {
            droppedCallIds.add(call.id);
            stateChanged = true;
            return null;
          }
          let closeReason = "";
          if (liveMultiplier >= this.callTakeProfitMultiplier) {
            closeReason = `tp_${this.callTakeProfitMultiplier}x`;
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
          token,
          currentPriceUsd: effectiveCurrent,
          multiplier,
          pnlPct,
          holdMinutes,
          drawdownPct,
          isClosed: Boolean(call.closedAt),
        } satisfies PnlSnapshot;
      })
      .filter((row): row is PnlSnapshot => Boolean(row));

    if (droppedCallIds.size > 0) {
      this.callState.calls = this.callState.calls.filter((row) => !droppedCallIds.has(row.id));
    }

    if (stateChanged) {
      await this.persistCallState();
    }

    if (!snapshots.length) {
      return {
        text: [
          "🏆 *TRADEAID PERFORMANCE BOARD*",
          "Tracked calls found, but live price snapshots are not available yet\.",
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
    const x5 = snapshots.filter((row) => row.multiplier >= 5).length;
    const x10 = snapshots.filter((row) => row.multiplier >= 10).length;
    const x20 = snapshots.filter((row) => row.multiplier >= this.callTakeProfitMultiplier).length;
    const window24h = summarizeWindow(snapshots, 24);
    const window72h = summarizeWindow(snapshots, 72);
    const window7d = summarizeWindow(snapshots, 24 * 7);
    const window30d = summarizeWindow(snapshots, 24 * 30);

    const topWins = [...winners].sort((a, b) => b.pnlPct - a.pnlPct).slice(0, Math.max(1, Math.min(limit, 8)));
    const topLosses = [...losers].sort((a, b) => a.pnlPct - b.pnlPct).slice(0, Math.max(1, Math.min(limit, 6)));
    const recent = [...snapshots].sort((a, b) => new Date(b.call.calledAt).getTime() - new Date(a.call.calledAt).getTime()).slice(0, 8);
    const topWinner = topWins[0];
    const secondWinner = topWins[1];
    const worstLoss = topLosses[0];

    const updatedDate = new Date().toISOString().slice(0, 10);
    const topWinnerSymbol = String(topWinner?.call.symbol || "n/a");
    const secondWinnerSymbol = String(secondWinner?.call.symbol || "n/a");
    const worstLossSymbol = String(worstLoss?.call.symbol || "n/a");
    const topWinnerMult = topWinner ? `${topWinner.multiplier.toFixed(2)}x` : "n/a";
    const secondWinnerMult = secondWinner ? `${secondWinner.multiplier.toFixed(2)}x` : "n/a";
    const worstLossPct = worstLoss ? fmtPct(worstLoss.pnlPct) : "n/a";

    const lines = [
      "🏆 *TRADEAID PERFORMANCE BOARD*",
      "",
      `📊 Total Calls: ${escapeMarkdown(String(calls.length))}`,
      `🟢 Open Trades: ${escapeMarkdown(String(openSnapshots.length))}`,
      `✅ Closed Trades: ${escapeMarkdown(String(closedSnapshots.length))}`,
      "",
      `🎯 Win Rate: ${escapeMarkdown(`${winRate.toFixed(1)}%`)}`,
      "",
      `💰 Average Profit/Loss: ${escapeMarkdown(fmtPct(avgPnl))}`,
      "",
      `⏳ Median Hold Time: ${escapeMarkdown(formatHoldTime(medianHoldMinutes))}`,
      "",
      "🚀 *Profit Multipliers Hit*",
      "",
      `💎 2x Winners: ${escapeMarkdown(String(x2))} trades`,
      `🔥 5x Winners: ${escapeMarkdown(String(x5))} trades`,
      `⚡ 10x Winners: ${escapeMarkdown(String(x10))} trades`,
      `🚀 ${escapeMarkdown(String(this.callTakeProfitMultiplier))}x\+ Moonshots: ${escapeMarkdown(String(x20))} trade${x20 === 1 ? "" : "s"}`,
      "",
      "🏅 *Best & Worst Trades*",
      "",
      "🥇 *Top Winner*",
      `${escapeMarkdown(topWinnerSymbol)} — ${escapeMarkdown(topWinnerMult)}`,
      `📈 Profit: ${escapeMarkdown(topWinner ? fmtPct(topWinner.pnlPct) : "n/a")}`,
      "",
      "🥈 *Second Best*",
      `${escapeMarkdown(secondWinnerSymbol)} — ${escapeMarkdown(secondWinnerMult)}`,
      `📈 Profit: ${escapeMarkdown(secondWinner ? fmtPct(secondWinner.pnlPct) : "n/a")}`,
      "",
      "💀 *Biggest Loss*",
      `${escapeMarkdown(worstLossSymbol)} — ${escapeMarkdown(worstLossPct)}`,
      "📉 Almost full loss",
      "",
      "⏱ *Performance Over Time*",
      "",
      "📅 *Last 24 Hours*",
      `🎯 Win Rate: ${escapeMarkdown(`${window24h.winRate.toFixed(1)}%`)}`,
      `💰 Avg PnL: ${escapeMarkdown(fmtPct(window24h.avgPnl))}`,
      `📊 Trades: ${escapeMarkdown(String(window24h.calls))}`,
      "",
      "📅 *Last 72 Hours*",
      `🎯 Win Rate: ${escapeMarkdown(`${window72h.winRate.toFixed(1)}%`)}`,
      `💰 Avg PnL: ${escapeMarkdown(fmtPct(window72h.avgPnl))}`,
      `📊 Trades: ${escapeMarkdown(String(window72h.calls))}`,
      "",
      "📅 *Last 7 Days*",
      `🎯 Win Rate: ${escapeMarkdown(`${window7d.winRate.toFixed(1)}%`)}`,
      `💰 Avg PnL: ${escapeMarkdown(fmtPct(window7d.avgPnl))}`,
      `📊 Trades: ${escapeMarkdown(String(window7d.calls))}`,
      "",
      "📅 *Last 30 Days*",
      `🎯 Win Rate: ${escapeMarkdown(`${window30d.winRate.toFixed(1)}%`)}`,
      `💰 Avg PnL: ${escapeMarkdown(fmtPct(window30d.avgPnl))}`,
      `📊 Trades: ${escapeMarkdown(String(window30d.calls))}`,
      "",
      "📡 *Latest TradeAid Calls*",
      "",
      "These are the newest tokens detected by the AI scanner\.",
      "",
    ];

    for (const row of recent) {
      const calledAgo = formatAge(row.call.calledAt);
      const xText = `${row.multiplier.toFixed(2)}x`;
      const status = row.isClosed ? "CLOSED" : "OPEN";
      const marker = row.multiplier > 1.0001 ? "🟢" : row.multiplier < 0.9999 ? "🔴" : "🟡";
      lines.push(
        `${marker} ${escapeMarkdown(String(row.call.symbol || "UNK"))} — ${escapeMarkdown(xText)}`,
        `⏱ Age: ${escapeMarkdown(calledAgo)}`,
        `📊 Status: ${escapeMarkdown(status)}`,
        "",
      );
    }

    lines.push(
      `⚡ Last Updated: ${escapeMarkdown(updatedDate)}`,
      "🧠 TradeAid Intelligence Engine",
      "🔗 Powered by Solana On\-Chain Data",
    );

    const chartSnapshots = [...snapshots]
      .sort((a, b) => b.multiplier - a.multiplier)
      .slice(0, 12);
    const chartUrl = this.buildPnlMultiplierChartUrl(chartSnapshots);
    const chartCaption = [
      "📊 *TRADEAID MULTIPLIER SNAPSHOT*",
      `2x: *${escapeMarkdown(String(x2))}* \\| 5x: *${escapeMarkdown(String(x5))}* \\| 10x: *${escapeMarkdown(String(x10))}* \\| ${escapeMarkdown(String(this.callTakeProfitMultiplier))}x\+: *${escapeMarkdown(String(x20))}*`,
      "Green bars indicate stronger winners\.",
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

  private async getLiveSnapshots(): Promise<PnlSnapshot[]> {
    const calls = [...this.callState.calls]
      .filter((row) => Boolean(row?.mint))
      .sort((a, b) => new Date(b.calledAt).getTime() - new Date(a.calledAt).getTime());
    if (!calls.length) return [];

    const mints = Array.from(new Set(calls.map((row) => row.mint))).slice(0, 500);
    if (!mints.length) return [];

    const rows = await db
      .select()
      .from(scannedTokens)
      .where(and(eq(scannedTokens.chain, "solana"), inArray(scannedTokens.address, mints)));

    const tokenMap = new Map(rows.map((row) => [String(row.address || "").trim(), row]));
    let stateChanged = false;
    const droppedCallIds = new Set<string>();
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
          if (this.shouldDropBadCall(token, holdMinutes, liveMultiplier, drawdownPct)) {
            droppedCallIds.add(call.id);
            stateChanged = true;
            return null;
          }
          let closeReason = "";
          if (liveMultiplier >= this.callTakeProfitMultiplier) {
            closeReason = `tp_${this.callTakeProfitMultiplier}x`;
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
          token,
          currentPriceUsd: effectiveCurrent,
          multiplier,
          pnlPct,
          holdMinutes,
          drawdownPct,
          isClosed: Boolean(call.closedAt),
        } satisfies PnlSnapshot;
      })
      .filter((row): row is PnlSnapshot => Boolean(row));

    if (droppedCallIds.size > 0) {
      this.callState.calls = this.callState.calls.filter((row) => !droppedCallIds.has(row.id));
    }

    if (stateChanged) {
      await this.persistCallState();
    }

    return snapshots;
  }

  private buildMilestoneMessage(snapshot: PnlSnapshot, milestone: number) {
    const token = snapshot.token;
    const symbol = String(snapshot.call.symbol || token?.symbol || "UNK");
    const age = formatHoldTime(snapshot.holdMinutes);
    const milestones = [1.5, 2, 3, 5].filter((level) => snapshot.multiplier >= level).map((level) => `${level}x`);
    const stampedAt = new Date().toISOString().replace("T", " ").replace(".000Z", " UTC");

    return [
      "🚀 *TRADEAID UPDATE*",
      "",
      `Token: *${escapeMarkdown(symbol)}*`,
      "",
      "New Milestone Reached",
      `Multiplier: *${escapeMarkdown(snapshot.multiplier.toFixed(2))}x*`,
      `PnL: *${escapeMarkdown(fmtPct(snapshot.pnlPct))}*`,
      "",
      `Age: *${escapeMarkdown(age)}*`,
      "",
      "Milestones:",
      escapeMarkdown(milestones.join(" • ") || `${milestone}x`),
      "",
      "Price Progress",
      escapeMarkdown(progressBar(snapshot.multiplier)),
      "",
      DIVIDER,
      `Updated: ${escapeMarkdown(stampedAt)}`,
      "TradeAid Intelligence Engine",
      "Powered by Solana Data",
    ].join("\n");
  }

  private async sendMilestoneUpdates(subscribers: string[]) {
    if (!subscribers.length) return;

    const snapshots = await this.getLiveSnapshots();
    if (!snapshots.length) return;

    const milestones = [1.5, 2, 3, 5];
    let stateChanged = false;

    for (const snapshot of snapshots) {
      if (snapshot.isClosed) continue;
      const hit = new Set((snapshot.call.milestonesHit || []).map((value) => Math.trunc(Number(value || 0) * 10) / 10));
      const newlyHit = milestones.filter((level) => snapshot.multiplier >= level && !hit.has(level));
      if (!newlyHit.length) continue;

      const token = snapshot.token;
      if (!token) continue;
      const project = await this.fetchProjectMeta(token);
      const buttons = this.buildMarketButtons(token, project);

      for (const level of newlyHit) {
        const text = this.buildMilestoneMessage(snapshot, level);
        for (const chatId of subscribers) {
          try {
            let sent: TelegramSentMessage | undefined;
            if (project.logoUrl && isHttpUrl(project.logoUrl)) {
              sent = await this.sendPhoto(chatId, project.logoUrl, text, buttons, { parseMode: "Markdown" });
            } else {
              sent = await this.sendMessage(chatId, text, buttons, { parseMode: "Markdown" });
            }
            if (level >= 2 && sent?.message_id) {
              await this.pinMessage(chatId, sent.message_id).catch(() => undefined);
            }
          } catch {
          }
        }
        hit.add(level);
      }

      snapshot.call.milestonesHit = Array.from(hit).sort((a, b) => a - b);
      stateChanged = true;
    }

    if (stateChanged) {
      await this.persistCallState();
    }
  }

  private async maybeSendPeriodicBoard(subscribers: string[]) {
    if (!subscribers.length) return;
    const lastAtMs = new Date(String(this.pushState.lastBoardAt || 0)).getTime();
    const elapsed = Date.now() - (Number.isFinite(lastAtMs) ? lastAtMs : 0);
    if (elapsed >= 0 && elapsed < this.boardIntervalSeconds * 1000) {
      return;
    }

    for (const chatId of subscribers) {
      await this.sendPnlBoard(chatId, 10).catch(() => undefined);
    }
    this.pushState.lastBoardAt = nowIso();
    await this.persistPushState();
  }

  private async sendPnlBoard(chatId: string, limit = 10) {
    const board = await this.buildPnlBoard(limit);
    if (board.chartUrl) {
      try {
        await this.sendPhoto(chatId, board.chartUrl, board.chartCaption || "📊 *TRADEAID MULTIPLIER SNAPSHOT*", undefined, {
          parseMode: "Markdown",
        });
      } catch {
      }
    }
    await this.sendMessage(chatId, board.text, this.buildStartButtons(this.isSubscribed(chatId)), {
      parseMode: "Markdown",
    });
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
        lastBoardAt: typeof loaded?.lastBoardAt === "string" ? loaded.lastBoardAt : undefined,
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
    let callRecord: BotCallRecord | null = null;
    if (options?.trackCall) {
      callRecord = await this.recordBotCall(token, String(options.origin || "bot_call"));
    }

    const project = await this.fetchProjectMeta(token);
    const useProfessionalFormat = mode === "compact";
    const caption = useProfessionalFormat
      ? this.buildProfessionalCallMessage(token, project, callRecord || undefined)
      : this.buildTokenCaption(token, project, mode, badge);
    const buttons = useProfessionalFormat
      ? this.buildMarketButtons(token, project)
      : this.buildTokenButtons(token, project.chart);
    const parseMode: "HTML" | "Markdown" = useProfessionalFormat ? "Markdown" : "HTML";

    if (project.logoUrl && isHttpUrl(project.logoUrl)) {
      try {
        await this.sendPhoto(chatId, project.logoUrl, caption, buttons, { parseMode });
        return;
      } catch {
      }
    }

    await this.sendMessage(chatId, caption, buttons, { parseMode });
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
      "/tg [n] - tokens with Telegram communities",
      "/x [n] - tokens with X communities",
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
    try {
      await this.handleUpdate(update);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "update_failed");
      console.error(`[TelegramBot] handleUpdate failed: ${message}`);
    }
  }

  isWebhookAuthorized(req: Request) {
    if (!this.webhookSecret) return false;
    const headerToken = String(req.headers["x-telegram-bot-api-secret-token"] || "").trim();
    if (headerToken.length > 0 && headerToken === this.webhookSecret) {
      return true;
    }

    const querySecretRaw = (req.query as Record<string, unknown> | undefined)?.secret;
    const queryTokenRaw = (req.query as Record<string, unknown> | undefined)?.token;
    const querySecret = Array.isArray(querySecretRaw)
      ? String(querySecretRaw[0] || "").trim()
      : String(querySecretRaw || "").trim();
    const queryToken = Array.isArray(queryTokenRaw)
      ? String(queryTokenRaw[0] || "").trim()
      : String(queryTokenRaw || "").trim();

    return (querySecret.length > 0 && querySecret === this.webhookSecret)
      || (queryToken.length > 0 && queryToken === this.webhookSecret);
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

    if (lower.startsWith("/tg") || lower.startsWith("/telegram")) {
      const limitArg = text.split(/\s+/)[1];
      const limit = takeLimit(limitArg, 5, 8);
      await this.handleTelegramCommunityCalls(chatId, limit);
      return;
    }

    if (lower.startsWith("/x") || lower.startsWith("/twitter")) {
      const limitArg = text.split(/\s+/)[1];
      const limit = takeLimit(limitArg, 5, 8);
      await this.handleXCommunityCalls(chatId, limit);
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

    if (dataLower === "tg_community") {
      await this.handleTelegramCommunityCalls(chatId, 5);
      await this.answerCallbackQuery(callbackQuery.id, "Loaded Telegram community tokens").catch(() => undefined);
      return;
    }

    if (dataLower === "x_community") {
      await this.handleXCommunityCalls(chatId, 5);
      await this.answerCallbackQuery(callbackQuery.id, "Loaded X community tokens").catch(() => undefined);
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

    const qualityRows = rows.filter((token) => this.isQualityCallCandidate(token));

    if (!qualityRows.length) {
      await this.sendMessage(chatId, "No safe calls found right now. Try again in a few minutes.");
      return;
    }

    const ranked = this.rankCandidatesWithLearning(qualityRows).slice(0, limit);
    const picked = ranked.map((item) => item.token);

    await this.sendMessage(
      chatId,
      `<b>Top Safe Solana Calls</b>\nShowing ${picked.length} opportunities ranked by safety + learned call performance.`,
      this.buildStartButtons(this.isSubscribed(chatId)),
    );

    for (const token of picked) {
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

    const qualityRows = rows.filter((token) => this.isQualityCallCandidate(token));

    if (!qualityRows.length) {
      await this.sendMessage(chatId, "No early safer tokens found in the current window yet.");
      return;
    }

    const ranked = this.rankCandidatesWithLearning(qualityRows).slice(0, limit);
    const picked = ranked.map((item) => item.token);

    await this.sendMessage(
      chatId,
      `<b>Early Safe Solana Calls</b>\nShowing ${picked.length} fresh picks ranked by learned outcomes + safety.`,
      this.buildStartButtons(this.isSubscribed(chatId)),
    );

    for (const token of picked) {
      await this.sendTokenCard(chatId, token, "compact", "EARLY SAFE", { trackCall: true, origin: "early_safe" });
    }
  }

  private async handleTelegramCommunityCalls(chatId: string, limit: number) {
    const candidateLimit = Math.max(limit * 4, 20);
    const rows = await db
      .select()
      .from(scannedTokens)
      .where(
        and(
          eq(scannedTokens.chain, "solana"),
          gte(scannedTokens.safetyScore, 72),
          gte(scannedTokens.liquidity, 25_000),
          gte(scannedTokens.volume24h, 15_000),
          eq(scannedTokens.isHoneypot, false),
        ),
      )
      .orderBy(desc(scannedTokens.safetyScore), desc(scannedTokens.volume24h), desc(scannedTokens.liquidity))
      .limit(candidateLimit);

    const picked: Array<{ token: TokenRow; telegram: string }> = [];
    for (const token of rows) {
      if (picked.length >= limit) break;
      if (!this.isQualityCallCandidate(token)) continue;
      const project = await this.fetchProjectMeta(token).catch(() => ({
        logoUrl: "",
        website: "",
        twitter: "",
        telegram: "",
        chart: "",
      } satisfies TokenProjectMeta));
      const telegram = String(project.telegram || "").trim();
      if (!isHttpUrl(telegram)) continue;
      picked.push({ token, telegram });
    }

    if (!picked.length) {
      await this.sendMessage(chatId, "No Telegram-community tokens found right now. Try again soon.", this.buildStartButtons(this.isSubscribed(chatId)));
      return;
    }

    await this.sendMessage(
      chatId,
      `<b>Telegram Community Tokens</b>\nShowing ${picked.length} tokens with active Telegram links.`,
      this.buildStartButtons(this.isSubscribed(chatId)),
    );

    const communityList = picked
      .map((item, idx) => {
        const symbol = String(item.token.symbol || item.token.name || "UNK").trim() || "UNK";
        return `${idx + 1}. <b>${escapeHtml(symbol)}</b> - <a href=\"${escapeHtml(item.telegram)}\">${escapeHtml(item.telegram)}</a>`;
      })
      .join("\n");

    await this.sendMessage(
      chatId,
      `<b>Telegram Community Links</b>\n${communityList}`,
      undefined,
      { disablePreview: false, parseMode: "HTML" },
    );

    for (const item of picked) {
      await this.sendTokenCard(chatId, item.token, "compact", "TG COMMUNITY", { trackCall: true, origin: "tg_community" });
    }
  }

  private async handleXCommunityCalls(chatId: string, limit: number) {
    const candidateLimit = Math.max(limit * 4, 20);
    const rows = await db
      .select()
      .from(scannedTokens)
      .where(
        and(
          eq(scannedTokens.chain, "solana"),
          gte(scannedTokens.safetyScore, 72),
          gte(scannedTokens.liquidity, 25_000),
          gte(scannedTokens.volume24h, 15_000),
          eq(scannedTokens.isHoneypot, false),
        ),
      )
      .orderBy(desc(scannedTokens.safetyScore), desc(scannedTokens.volume24h), desc(scannedTokens.liquidity))
      .limit(candidateLimit);

    const picked: Array<{ token: TokenRow; twitter: string }> = [];
    for (const token of rows) {
      if (picked.length >= limit) break;
      if (!this.isQualityCallCandidate(token)) continue;
      const project = await this.fetchProjectMeta(token).catch(() => ({
        logoUrl: "",
        website: "",
        twitter: "",
        telegram: "",
        chart: "",
      } satisfies TokenProjectMeta));
      const twitter = String(project.twitter || "").trim();
      if (!isHttpUrl(twitter)) continue;
      picked.push({ token, twitter });
    }

    if (!picked.length) {
      await this.sendMessage(chatId, "No X-community tokens found right now. Try again soon.", this.buildStartButtons(this.isSubscribed(chatId)));
      return;
    }

    await this.sendMessage(
      chatId,
      `<b>X Community Tokens</b>\nShowing ${picked.length} tokens with active X links.`,
      this.buildStartButtons(this.isSubscribed(chatId)),
    );

    const communityList = picked
      .map((item, idx) => {
        const symbol = String(item.token.symbol || item.token.name || "UNK").trim() || "UNK";
        return `${idx + 1}. <b>${escapeHtml(symbol)}</b> - <a href=\"${escapeHtml(item.twitter)}\">${escapeHtml(item.twitter)}</a>`;
      })
      .join("\n");

    await this.sendMessage(
      chatId,
      `<b>X Community Links</b>\n${communityList}`,
      undefined,
      { disablePreview: false, parseMode: "HTML" },
    );

    for (const item of picked) {
      await this.sendTokenCard(chatId, item.token, "compact", "X COMMUNITY", { trackCall: true, origin: "x_community" });
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

      await this.sendMilestoneUpdates(subscribers);
      await this.maybeSendPeriodicBoard(subscribers);

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
        .limit(12);

      if (!candidates.length) {
        this.pushState.lastPushAt = nowIso();
        await this.persistPushState();
        return;
      }

      this.pruneSentPushCache();
      const qualityCandidates = candidates.filter((token) => this.isQualityCallCandidate(token));
      const ranked = this.rankCandidatesWithLearning(qualityCandidates);
      let changed = false;
      for (const item of ranked) {
        const token = item.token;
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
