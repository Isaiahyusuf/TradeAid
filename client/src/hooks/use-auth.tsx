import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { apiGet, apiPost, setToken, clearToken } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

export type User = {
  user_id: string;
  username: string;
  email: string;
  is_admin: boolean;
  totp_enabled: boolean;
};

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string, totp_code?: string) => Promise<any>;
  register: (username: string, email: string, password: string) => Promise<any>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();

  const checkAuth = useCallback(async () => {
    const token = localStorage.getItem("trade_aid_token");
    if (!token) {
      setUser(null);
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
    const me = await apiGet<User>("/api/auth/me");
    setUser(me);
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

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      isAuthenticated: !!user,
      login,
      register,
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
