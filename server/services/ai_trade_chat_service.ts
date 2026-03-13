import OpenAI from "openai";
import type { AdvisorResult } from "./preset_advisor_engine";

export type AiChatMemoryMessage = {
  role: "user" | "assistant";
  text: string;
  at?: string;
};

export type AiTradeChatRequest = {
  message: string;
  advisor: AdvisorResult;
  username?: string;
  displayName?: string;
  memory?: AiChatMemoryMessage[];
};

export type AiTradeChatResponse = {
  answer: string;
  model: string;
  generated_at: string;
  risk_notice: string;
};

const nowIso = () => new Date().toISOString();

const resolveOpenAiApiKey = () => {
  return String(
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY
      || process.env.OPENAI_API_KEY
      || "",
  ).trim();
};

const resolveOpenAiBaseUrl = () => {
  const value = String(
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
      || process.env.OPENAI_BASE_URL
      || "",
  ).trim();
  return value || undefined;
};

const resolveModel = () => {
  const preferred = String(process.env.DOCTOR_AI_ASSISTANT_MODEL || "gpt-4.1").trim() || "gpt-4.1";
  return preferred;
};

const normalizeMemory = (rows: AiChatMemoryMessage[] | undefined, limit = 16) => {
  if (!Array.isArray(rows)) return [] as AiChatMemoryMessage[];
  return rows
    .filter((row) => row && (row.role === "user" || row.role === "assistant"))
    .map((row) => ({
      role: row.role,
      text: String(row.text || "").trim().slice(0, 2000),
      at: row.at ? String(row.at) : undefined,
    }))
    .filter((row) => row.text.length > 0)
    .slice(-Math.max(0, limit));
};

const buildFallbackAnswer = (message: string, advisor: AdvisorResult) => {
  const lower = String(message || "").toLowerCase();
  const presetLine = `Recommended preset now: ${advisor.recommended_preset} (confidence ${advisor.confidence_score}%).`;
  const stateLine = `Market state: ${advisor.market_state}.`;
  const reasonLine = advisor.reason;

  if (lower.includes("preset") || lower.includes("use")) {
    return `${presetLine} ${stateLine} ${reasonLine} Use defined stop loss and avoid over-sizing while volatility remains high.`;
  }

  if (lower.includes("risk") || lower.includes("safe") || lower.includes("stop")) {
    return `${stateLine} Current rug-rate estimate is ${advisor.metrics.rug_rate_last_hour.toFixed(1)}%. Keep strict risk controls: stop loss, position sizing, and max daily loss limits.`;
  }

  return `${stateLine} ${presetLine} ${reasonLine}`;
};

export const askAiTradeAssistant = async (
  payload: AiTradeChatRequest,
): Promise<AiTradeChatResponse> => {
  const assistantName = "Savatar";
  const riskNotice = "Not financial advice. No preset guarantees profits. Use stop losses and risk limits.";
  const message = String(payload.message || "").trim();
  const advisor = payload.advisor;
  const model = resolveModel();
  const username = String(payload.username || "").trim();
  const displayName = String(payload.displayName || "").trim();
  const userAddressingName = displayName || username || "Trader";
  const memory = normalizeMemory(payload.memory, 16);

  if (!message) {
    return {
      answer: `${userAddressingName}, please ask a trading question. ${riskNotice}`,
      model,
      generated_at: nowIso(),
      risk_notice: riskNotice,
    };
  }

  const apiKey = resolveOpenAiApiKey();
  if (!apiKey) {
    return {
      answer: `${userAddressingName}, ${buildFallbackAnswer(message, advisor)} ${riskNotice}`,
      model: "fallback_no_openai_key",
      generated_at: nowIso(),
      risk_notice: riskNotice,
    };
  }

  const client = new OpenAI({
    apiKey,
    baseURL: resolveOpenAiBaseUrl(),
  });

  const systemPrompt = [
    `You are ${assistantName}, an elite crypto trading assistant inside the TradeAid DoctorTrade app.`,
    `You are speaking to user ${userAddressingName}.`,
    "Your job is to help traders understand market conditions, token momentum, risk management, and trading strategies for Solana meme coin markets.",
    "Use real-time market metrics provided by the backend to explain current trading conditions.",
    "Address the user by name naturally in your answer.",
    "Keep answers concise, sharp, and actionable.",
    "Prefer structured guidance: market read, preset recommendation, entry/exit and risk controls.",
    "Never guarantee profits.",
    "Always mention risk and encourage stop-loss usage.",
  ].join(" ");

  const contextPayload = {
    current_market_state: advisor.market_state,
    recommended_preset: advisor.recommended_preset,
    confidence_score: advisor.confidence_score,
    avg_volume_5m: advisor.metrics.avg_volume_5m,
    avg_market_cap_new_tokens: advisor.metrics.avg_market_cap_new_tokens,
    launch_frequency: advisor.metrics.launch_frequency,
    rug_rate: advisor.metrics.rug_rate_last_hour,
    buy_sell_ratio: advisor.metrics.buy_sell_ratio,
    top_gainers: advisor.metrics.top_gainers,
    reason: advisor.reason,
    user_name: userAddressingName,
    assistant_name: assistantName,
    memory,
  };

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.15,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            `Assistant Name: ${assistantName}`,
            `User Name: ${userAddressingName}`,
            `User Question: ${message}`,
            `Context Data: ${JSON.stringify(contextPayload)}`,
            `Mandatory risk reminder: ${riskNotice}`,
          ].join("\n\n"),
        },
      ],
    });

    const answer = String(completion.choices?.[0]?.message?.content || "").trim() || buildFallbackAnswer(message, advisor);

    return {
      answer,
      model,
      generated_at: nowIso(),
      risk_notice: riskNotice,
    };
  } catch {
    return {
      answer: `${userAddressingName}, ${buildFallbackAnswer(message, advisor)} ${riskNotice}`,
      model: "fallback_openai_error",
      generated_at: nowIso(),
      risk_notice: riskNotice,
    };
  }
};
