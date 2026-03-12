import axios from "axios";
import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
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

class TradeAidTelegramBot {
  private readonly token: string;
  private readonly apiBase: string;
  private readonly pollSeconds: number;
  private readonly allowedChatIds: Set<string>;
  private readonly appBaseUrl: string;
  private offset = 0;
  private running = false;

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
  }

  async start() {
    if (this.running) return;
    this.running = true;
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

  private async sendMessage(
    chatId: string,
    text: string,
    replyMarkup?: Record<string, any>,
  ) {
    await axios.post(
      `${this.apiBase}/sendMessage`,
      {
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        reply_markup: replyMarkup,
      },
      { timeout: 15_000 },
    );
  }

  private async answerCallbackQuery(callbackQueryId: string) {
    await axios.post(
      `${this.apiBase}/answerCallbackQuery`,
      { callback_query_id: callbackQueryId },
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

  private buildStartButtons() {
    return {
      inline_keyboard: [
        [
          { text: "Safe Calls", callback_data: "safe_calls" },
          { text: "New Safe", callback_data: "new_safe" },
        ],
        [
          { text: "Lookup Token", callback_data: "token_help" },
          { text: "Open TradeAid App", url: this.appBaseUrl },
        ],
      ],
    };
  }

  private async handleUpdate(update: TelegramUpdate) {
    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
      return;
    }

    const message = update.message;
    const text = String(message?.text || "").trim();
    const chatId = String(message?.chat?.id || "").trim();
    if (!text || !chatId) return;

    if (this.allowedChatIds.size > 0 && !this.allowedChatIds.has(chatId)) {
      await this.sendMessage(chatId, "This bot is private. Ask the admin to allow your chat id.").catch(() => undefined);
      return;
    }

    const lower = text.toLowerCase();
    if (lower === "/start" || lower === "/help") {
      await this.sendMessage(chatId, this.helpText(), this.buildStartButtons());
      return;
    }

    if (lower.startsWith("/safe") || lower.startsWith("/calls") || lower.startsWith("/top")) {
      const limitArg = text.split(/\s+/)[1];
      const limit = takeLimit(limitArg, 5, 12);
      await this.handleSafeCalls(chatId, limit);
      return;
    }

    if (lower.startsWith("/new")) {
      const limitArg = text.split(/\s+/)[1];
      const limit = takeLimit(limitArg, 5, 12);
      await this.handleNewSafe(chatId, limit);
      return;
    }

    if (lower.startsWith("/token ")) {
      const query = text.slice(7).trim();
      if (!query) {
        await this.sendMessage(chatId, "Usage: /token <symbol|address>");
        return;
      }
      await this.handleTokenLookup(chatId, query);
      return;
    }

    if (text.length >= 2) {
      await this.handleTokenLookup(chatId, text);
      return;
    }

    await this.sendMessage(chatId, this.helpText());
  }

  private async handleCallbackQuery(callbackQuery: NonNullable<TelegramUpdate["callback_query"]>) {
    const chatId = String(callbackQuery.message?.chat?.id || "").trim();
    if (!chatId) {
      await this.answerCallbackQuery(callbackQuery.id).catch(() => undefined);
      return;
    }

    if (this.allowedChatIds.size > 0 && !this.allowedChatIds.has(chatId)) {
      await this.answerCallbackQuery(callbackQuery.id).catch(() => undefined);
      return;
    }

    const data = String(callbackQuery.data || "").trim().toLowerCase();
    if (data === "safe_calls") {
      await this.handleSafeCalls(chatId, 5);
    } else if (data === "new_safe") {
      await this.handleNewSafe(chatId, 5);
    } else if (data === "token_help") {
      await this.sendMessage(chatId, "Send a token symbol or CA, or use /token <symbol|address>.");
    }

    await this.answerCallbackQuery(callbackQuery.id).catch(() => undefined);
  }

  private helpText() {
    return [
      "TradeAid Solana Bot",
      "",
      "Commands:",
      "/safe [n] - best safe-to-buy Solana calls",
      "/new [n] - newest safer Solana picks",
      "/token <symbol|address> - full token details",
      "/help - show this message",
      "",
      "Tip: send just a symbol/address and I will try to find it.",
      "Direct Buy: token results include a TradeAid buy button.",
      "",
      "Risk notice: this is informational, always DYOR before buying.",
    ].join("\n");
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

    const lines = ["Top Safe Solana Calls", ""];
    rows.forEach((token, index) => {
      const pairOrMint = String(token.pairAddress || token.address || "").trim();
      const chart = pairOrMint ? `https://dexscreener.com/solana/${pairOrMint}` : "n/a";
      lines.push(
        `${index + 1}. ${token.symbol} (${token.name})`,
        `Safety: ${Number(token.safetyScore || 0)}/100 | Risk: ${String(token.riskLevel || "unknown")}`,
        `Price: ${fmtUsd(token.priceUsd)} | Mcap: ${fmtUsd(token.marketCap)} | Liq: ${fmtUsd(token.liquidity)}`,
        `Vol24h: ${fmtUsd(token.volume24h)} | 1h: ${fmtPct(token.priceChange1h)}`,
        `Address: ${token.address}`,
        `Chart: ${chart}`,
        "",
      );
    });

    lines.push("Use /token <symbol|address> to get full details.");
    await this.sendMessage(chatId, lines.join("\n"), {
      inline_keyboard: [
        [
          { text: "Open TradeAid App", url: this.appBaseUrl },
        ],
      ],
    });
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

    const lines = ["New Safe Solana Tokens (24h)", ""];
    rows.forEach((token, index) => {
      const ageMinutes = token.pairCreatedAt
        ? Math.max(0, Math.trunc((Date.now() - new Date(token.pairCreatedAt).getTime()) / 60_000))
        : null;

      lines.push(
        `${index + 1}. ${token.symbol} (${token.name})`,
        `Safety: ${Number(token.safetyScore || 0)}/100 | Age: ${ageMinutes === null ? "n/a" : `${ageMinutes}m`}`,
        `Price: ${fmtUsd(token.priceUsd)} | Liq: ${fmtUsd(token.liquidity)} | Vol24h: ${fmtUsd(token.volume24h)}`,
        `Address: ${token.address}`,
        "",
      );
    });

    await this.sendMessage(chatId, lines.join("\n"), {
      inline_keyboard: [
        [
          { text: "Open TradeAid App", url: this.appBaseUrl },
        ],
      ],
    });
  }

  private async handleTokenLookup(chatId: string, rawQuery: string) {
    const query = String(rawQuery || "").trim();
    if (!query) {
      await this.sendMessage(chatId, "Please provide a token symbol or Solana mint address.");
      return;
    }

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

    const token = rows[0];
    if (!token) {
      await this.sendMessage(chatId, `No Solana token found for: ${query}`);
      return;
    }

    const socials = token.socialLinks || {};
    const pairOrMint = String(token.pairAddress || token.address || "").trim();
    const chart = pairOrMint ? `https://dexscreener.com/solana/${pairOrMint}` : "n/a";
    const createdAt = token.pairCreatedAt ? new Date(token.pairCreatedAt).toISOString() : "n/a";

    const message = [
      `${token.name} (${token.symbol})`,
      "",
      `CA: ${token.address}`,
      `Chain: ${token.chain}`,
      `Safety Score: ${Number(token.safetyScore || 0)}/100`,
      `Risk: ${String(token.riskLevel || "unknown")}`,
      `AI Signal: ${String(token.aiSignal || "hold")}`,
      `Price: ${fmtUsd(token.priceUsd)}`,
      `Market Cap: ${fmtUsd(token.marketCap)}`,
      `Liquidity: ${fmtUsd(token.liquidity)}`,
      `Volume 24h: ${fmtUsd(token.volume24h)}`,
      `Price Change 1h: ${fmtPct(token.priceChange1h)}`,
      `Buys/Sells 24h: ${Number(token.buys24h || 0)}/${Number(token.sells24h || 0)}`,
      `Top Holders: ${Number(token.topHoldersPercentage || 0)}%`,
      `Dev Wallet: ${Number(token.devWalletPercentage || 0)}%`,
      `Liquidity Locked: ${token.isLiquidityLocked ? "yes" : "no"}`,
      `Mint Disabled: ${token.mintAuthorityDisabled ? "yes" : "no"}`,
      `Honeypot: ${token.isHoneypot ? "yes" : "no"}`,
      `Pair Created: ${createdAt}`,
      `Website: ${String((socials as any).website || "n/a")}`,
      `Twitter: ${String((socials as any).twitter || "n/a")}`,
      `Telegram: ${String((socials as any).telegram || "n/a")}`,
      `Chart: ${chart}`,
      "",
      `Notes: ${String(token.aiAnalysis || "No AI note available.")}`,
    ].join("\n");

    await this.sendMessage(chatId, message, {
      inline_keyboard: [
        [
          { text: "Buy on TradeAid", url: this.buildTradeAidBuyUrl(token.address) },
          { text: "View in TradeAid", url: this.buildTradeAidTokenUrl(token.address) },
        ],
        [
          { text: "Open TradeAid App", url: this.appBaseUrl },
        ],
      ],
    });
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
