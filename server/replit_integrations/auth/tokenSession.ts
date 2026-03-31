import { createHmac, randomUUID, timingSafeEqual } from "crypto";

const ACCESS_TOKEN_TTL_MS = 1000 * 60 * 60 * 24;
const REFRESH_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30;

type SessionTokenPayload = {
  sub: string;
  exp: number;
  kind: "access" | "refresh";
  jti: string;
};

const TOKEN_PREFIX = "ta";
const TOKEN_SECRET = String(process.env.SESSION_SECRET || "default-secret-change-in-production").trim() || "default-secret-change-in-production";

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signToken(body: string): string {
  return createHmac("sha256", TOKEN_SECRET).update(body).digest("base64url");
}

function createSessionToken(userId: string, kind: "access" | "refresh", ttlMs: number): string {
  const payload: SessionTokenPayload = {
    sub: String(userId || "").trim(),
    exp: Date.now() + Math.max(1, Number(ttlMs || 0)),
    kind,
    jti: randomUUID(),
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const body = `${TOKEN_PREFIX}.${kind}.${encodedPayload}`;
  const signature = signToken(body);
  return `${body}.${signature}`;
}

function parseSessionToken(token: string, expectedKind: "access" | "refresh"): SessionTokenPayload | null {
  const raw = String(token || "").trim();
  if (!raw) return null;

  const parts = raw.split(".");
  if (parts.length !== 4) return null;
  const [prefix, kind, encodedPayload, signature] = parts;
  if (prefix !== TOKEN_PREFIX || kind !== expectedKind) return null;

  const body = `${prefix}.${kind}.${encodedPayload}`;
  const expectedSignature = signToken(body);
  try {
    const providedBuffer = Buffer.from(signature, "utf8");
    const expectedBuffer = Buffer.from(expectedSignature, "utf8");
    if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload)) as SessionTokenPayload;
    if (!payload || typeof payload !== "object") return null;
    if (payload.kind !== expectedKind) return null;
    if (!String(payload.sub || "").trim()) return null;
    if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function issueSessionTokens(userId: string) {
  const accessToken = createSessionToken(userId, "access", ACCESS_TOKEN_TTL_MS);
  const refreshToken = createSessionToken(userId, "refresh", REFRESH_TOKEN_TTL_MS);
  return { accessToken, refreshToken, tokenType: "bearer" as const };
}

export function readBearerToken(req: any): string {
  const authHeader = String(req?.headers?.authorization || "").trim();
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return "";
  }
  return authHeader.slice(7).trim();
}

export function getSessionUserId(token: string, kind: "access" | "refresh" = "access"): string {
  const payload = parseSessionToken(token, kind);
  return String(payload?.sub || "").trim();
}

export function rotateRefreshToken(refreshToken: string) {
  const userId = getSessionUserId(refreshToken, "refresh");
  if (!userId) {
    return null;
  }
  return issueSessionTokens(userId);
}

export function revokeAllSessionTokens() {
  // Stateless tokens are not centrally stored, so there is nothing to clear here.
  // Kept for API compatibility with callers.
}
