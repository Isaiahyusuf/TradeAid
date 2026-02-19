import { useState, useEffect, useCallback } from "react";
import { apiGet, apiPost, setToken, clearToken } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

export type User = {
  user_id: string;
  username: string;
  email: string;
  is_admin: boolean;
  totp_enabled: boolean;
};

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();

  const checkAuth = useCallback(async () => {
    const token = localStorage.getItem("trade_aid_token");
    if (!token) {
      setIsLoading(false);
      return;
    }
    try {
      const data = await apiGet<User>("/api/auth/me");
      setUser(data);
    } catch {
      clearToken();
      setUser(null);
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
    await checkAuth();
    return data;
  };

  const register = async (username: string, email: string, password: string) => {
    const data = await apiPost<{ user_id: string; username: string }>("/api/auth/register", {
      username,
      email,
      password,
    });
    return data;
  };

  const logout = () => {
    clearToken();
    setUser(null);
    queryClient.clear();
  };

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    register,
    logout,
  };
}
