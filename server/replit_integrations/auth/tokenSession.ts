import { randomUUID } from "crypto";

export type SessionEntry = {
  userId: string;
  expiresAt: number;
};

const accessTokenStore = new Map<string, SessionEntry>();
const refreshTokenStore = new Map<string, SessionEntry>();

const ACCESS_TOKEN_TTL_MS = 1000 * 60 * 60 * 24;
const REFRESH_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export function issueSessionTokens(userId: string) {
  const accessToken = `ta_access_${randomUUID()}`;
  const refreshToken = `ta_refresh_${randomUUID()}`;
  accessTokenStore.set(accessToken, { userId, expiresAt: Date.now() + ACCESS_TOKEN_TTL_MS });
  refreshTokenStore.set(refreshToken, { userId, expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS });
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
  if (!token) return "";
  const store = kind === "refresh" ? refreshTokenStore : accessTokenStore;
  const session = store.get(token);
  if (!session) return "";
  if (session.expiresAt < Date.now()) {
    store.delete(token);
    return "";
  }
  return session.userId;
}

export function rotateRefreshToken(refreshToken: string) {
  const userId = getSessionUserId(refreshToken, "refresh");
  if (!userId) {
    return null;
  }
  refreshTokenStore.delete(refreshToken);
  return issueSessionTokens(userId);
}

export function revokeAllSessionTokens() {
  accessTokenStore.clear();
  refreshTokenStore.clear();
}
