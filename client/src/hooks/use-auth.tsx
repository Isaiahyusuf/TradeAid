import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { apiGet, apiPost, apiPatch, setAuthTokens, clearToken, ensureAuthSession, hasRefreshToken } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

export type User = {
  user_id: string;
  username: string;
  email: string;
  is_admin: boolean;
  totp_enabled: boolean;
  email_verified?: boolean;
  display_name?: string;
  avatar_url?: string;
  telemetry_opt_in?: boolean;
};

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  hasToken: boolean;
  login: (username: string, password: string, accessCode?: string, totp_code?: string) => Promise<any>;
  consumeOAuthTokens: (accessToken: string, refreshToken?: string) => Promise<void>;
  register: (username: string, email: string | undefined, password: string, accessCode?: string) => Promise<any>;
  checkUsername: (username: string) => Promise<{ username: string; available: boolean; valid: boolean; message: string }>;
  verifyEmail: (email: string, code: string) => Promise<any>;
  resendVerification: (email: string) => Promise<any>;
  requestPasswordResetCode: (email: string) => Promise<any>;
  confirmPasswordReset: (email: string, code: string, newPassword: string) => Promise<any>;
  updateProfile: (payload: { username?: string; display_name?: string; avatar_url?: string; telemetry_opt_in?: boolean }) => Promise<User>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isTransientAuthUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  const normalized = message.toLowerCase();
  return (
    normalized.includes("auth_db_unavailable")
    || normalized.includes("temporarily unavailable")
    || normalized.includes("request failed") && normalized.includes("503")
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tokenState, setTokenState] = useState<boolean>(!!localStorage.getItem("trade_aid_token"));
  const queryClient = useQueryClient();

  const checkAuth = useCallback(async () => {
    const hasSession = await ensureAuthSession();
    if (!hasSession) {
      setUser(null);
      setTokenState(false);
      setIsLoading(false);
      return;
    }
    setTokenState(true);
    try {
      const data = await apiGet<User>("/api/auth/me");
      setUser(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const normalized = message.toLowerCase();
      const hasStoredToken = !!localStorage.getItem("trade_aid_token");
      const unauthorized = (
        message.includes("401")
        || normalized.includes("unauthorized")
        || normalized.includes("not authenticated")
      );

      if (unauthorized && hasStoredToken && hasRefreshToken()) {
        const recovered = await ensureAuthSession(true);
        if (recovered) {
          try {
            const retry = await apiGet<User>("/api/auth/me");
            setUser(retry);
            setTokenState(true);
            return;
          } catch {
          }
        }
      }

      if (
        !hasStoredToken
        || unauthorized
      ) {
        clearToken();
        setUser(null);
        setTokenState(false);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!tokenState || user) return;
    const timer = window.setInterval(() => {
      void checkAuth();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [checkAuth, tokenState, user]);

  const hydrateUserProfile = useCallback(async () => {
    try {
      const me = await apiGet<User>("/api/auth/me");
      setUser(me);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const normalized = message.toLowerCase();
      if (
        message.includes("401")
        || normalized.includes("unauthorized")
        || normalized.includes("not authenticated")
      ) {
        clearToken();
        setUser(null);
        setTokenState(false);
      }
    } finally {
      queryClient.invalidateQueries();
    }
  }, [queryClient]);

  const login = async (username: string, password: string, accessCode?: string, totp_code?: string) => {
    const maxAttempts = 3;
    let data: { access_token: string; refresh_token?: string; token_type: string } | null = null;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        data = await apiPost<{ access_token: string; refresh_token?: string; token_type: string }>("/api/auth/login", {
          username,
          password,
          access_code: accessCode,
          totp_code,
        });
        break;
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts || !isTransientAuthUnavailable(error)) {
          throw error;
        }
        await sleep(400 * attempt);
      }
    }

    if (!data) {
      throw lastError instanceof Error ? lastError : new Error("Login failed");
    }

    setAuthTokens(data.access_token, data.refresh_token);
    setTokenState(true);
    // Allow route transition immediately after successful token issuance.
    setUser((prev) => prev || {
      user_id: String(username || "").trim().toLowerCase() || "pending",
      username: String(username || "").trim() || "pending",
      email: "",
      is_admin: false,
      totp_enabled: false,
      email_verified: true,
      display_name: "",
      avatar_url: "",
      telemetry_opt_in: true,
    });
    void hydrateUserProfile();
    return data;
  };

  const consumeOAuthTokens = async (accessToken: string, refreshToken?: string) => {
    setAuthTokens(accessToken, refreshToken);
    setTokenState(true);
    setUser((prev) => prev || {
      user_id: "pending",
      username: "pending",
      email: "",
      is_admin: false,
      totp_enabled: false,
      email_verified: true,
      display_name: "",
      avatar_url: "",
      telemetry_opt_in: true,
    });
    void hydrateUserProfile();
  };

  const register = async (username: string, email: string | undefined, password: string, accessCode?: string) => {
    const data = await apiPost<{ user_id: string; username: string; email: string; requires_email_verification: boolean; verification_email_sent?: boolean; retry_after_seconds?: number }>("/api/auth/register", {
      username,
      email,
      password,
      access_code: accessCode,
    });
    return data;
  };

  const verifyEmail = async (email: string, code: string) => {
    return apiPost<{ verified: boolean }>("/api/auth/verify-email", { email, code });
  };

  const checkUsername = async (username: string) => {
    return apiGet<{ username: string; available: boolean; valid: boolean; message: string }>(`/api/auth/check-username?username=${encodeURIComponent(username)}`);
  };

  const resendVerification = async (email: string) => {
    return apiPost<{ sent: boolean; retry_after_seconds?: number }>("/api/auth/resend-verification", { email });
  };

  const requestPasswordResetCode = async (email: string) => {
    return apiPost<{ sent: boolean }>("/api/auth/forgot-password/request-code", { email });
  };

  const confirmPasswordReset = async (email: string, code: string, newPassword: string) => {
    return apiPost<{ reset: boolean }>("/api/auth/forgot-password/confirm", {
      email,
      code,
      new_password: newPassword,
    });
  };

  const updateProfile = async (payload: { username?: string; display_name?: string; avatar_url?: string; telemetry_opt_in?: boolean }) => {
    await apiPatch<User>("/api/auth/profile", payload);
    const updated = await apiGet<User>("/api/auth/me");
    setUser(updated);
    queryClient.invalidateQueries();
    return updated;
  };

  const logout = () => {
    clearToken();
    setUser(null);
    setTokenState(false);
    queryClient.clear();
  };

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      isAuthenticated: !!user,
      hasToken: tokenState,
      login,
      consumeOAuthTokens,
      register,
      checkUsername,
      verifyEmail,
      resendVerification,
      requestPasswordResetCode,
      confirmPasswordReset,
      updateProfile,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
