import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { apiGet, apiPost, apiPatch, setToken, clearToken } from "@/lib/api";
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
};

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  hasToken: boolean;
  login: (username: string, password: string, totp_code?: string) => Promise<any>;
  register: (username: string, email: string, password: string) => Promise<any>;
  verifyEmail: (email: string, code: string) => Promise<any>;
  resendVerification: (email: string) => Promise<any>;
  requestPasswordResetCode: (email: string) => Promise<any>;
  confirmPasswordReset: (email: string, code: string, newPassword: string) => Promise<any>;
  updateProfile: (payload: { username?: string; display_name?: string; avatar_url?: string }) => Promise<User>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tokenState, setTokenState] = useState<boolean>(!!localStorage.getItem("trade_aid_token"));
  const queryClient = useQueryClient();

  const checkAuth = useCallback(async () => {
    const token = localStorage.getItem("trade_aid_token");
    if (!token) {
      setUser(null);
      setTokenState(false);
      setIsLoading(false);
      return;
    }
    setTokenState(true);
    try {
      const data = await apiGet<User>("/api/auth/me");
      setUser(data);
    } catch {
      clearToken();
      setUser(null);
      setTokenState(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (username: string, password: string, totp_code?: string) => {
    const data = await apiPost<{ access_token: string; token_type: string }>("/api/auth/login", {
      username,
      password,
      totp_code,
    });
    setToken(data.access_token);
    setTokenState(true);
    const me = await apiGet<User>("/api/auth/me");
    setUser(me);
    queryClient.invalidateQueries();
    return data;
  };

  const register = async (username: string, email: string, password: string) => {
    const data = await apiPost<{ user_id: string; username: string; email: string; requires_email_verification: boolean; verification_email_sent?: boolean; retry_after_seconds?: number }>("/api/auth/register", {
      username,
      email,
      password,
    });
    return data;
  };

  const verifyEmail = async (email: string, code: string) => {
    return apiPost<{ verified: boolean }>("/api/auth/verify-email", { email, code });
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

  const updateProfile = async (payload: { username?: string; display_name?: string; avatar_url?: string }) => {
    const updated = await apiPatch<User>("/api/auth/profile", payload);
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
      register,
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
