import axios from "axios";
import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
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

type TokenProjectMeta = {
  logoUrl: string;
  website: string;
  twitter: string;
  telegram: string;
  chart: string;
};

const PUSH_STATE_KEY = "telegram.bot.push.v1";

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
  private offset = 0;
  private running = false;
  private pushTimer: NodeJS.Timeout | null = null;
  private pushState: PushState = { chats: {}, sentMintAt: {} };
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
  }

  async start() {
    if (this.running) return;
    this.running = true;
    await this.loadPushState();
    this.startPushLoop();
    console.log("[TelegramBot] TradeAid Telegram bot started.");
    void this.pollLoop();
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.getUpdates();
        for (const update of updates) {
          this.offset = Math.max(this.offset, Number(update.update_id || 0) + 1);
          await this.handleUpdate(update);
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
          { text: "New Safe", callback_data: "new_safe" },
        ],
        [
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

  private async sendTokenCard(chatId: string, token: TokenRow, mode: "full" | "compact", badge?: string) {
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
      "/new [n] - newest safer tokens",
      "/token &lt;symbol|address&gt; - full token card",
      "/projects &lt;symbol|address&gt; - project links",
      "/push on|off|status - manage alerts",
      "/help - this help",
      "",
      "Tip: send just a symbol or CA and I will search it.",
      "Risk notice: informational only, always DYOR.",
    ].join("\n");
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
      await this.sendMessage(chatId, this.helpText(), this.buildStartButtons(this.isSubscribed(chatId)));
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
      await this.sendTokenCard(chatId, token, "compact", "SAFE CALL");
    }
  }

  private async handleNewSafe(chatId: string, limit: number) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await db
      .select()
      .from(scannedTokens)
      .where(
        and(
          eq(scannedTokens.chain, "solana"),
          gte(scannedTokens.safetyScore, 70),
          gte(scannedTokens.liquidity, 25_000),
          gte(scannedTokens.volume24h, 10_000),
          eq(scannedTokens.isHoneypot, false),
          gte(scannedTokens.pairCreatedAt, since),
        ),
      )
      .orderBy(desc(scannedTokens.pairCreatedAt), desc(scannedTokens.safetyScore), desc(scannedTokens.volume24h))
      .limit(limit);

    if (!rows.length) {
      await this.sendMessage(chatId, "No new safer tokens in the last 24h yet.");
      return;
    }

    await this.sendMessage(
      chatId,
      `<b>New Safe Solana Tokens (24h)</b>\nShowing ${rows.length} newly discovered picks.`,
      this.buildStartButtons(this.isSubscribed(chatId)),
    );

    for (const token of rows) {
      await this.sendTokenCard(chatId, token, "compact", "NEW SAFE");
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
          await this.sendTokenCard(chatId, token, "compact", "PUSH ALERT").catch(() => undefined);
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
