import { useState, useEffect, createContext, useContext } from 'react';
import * as SecureStore from 'expo-secure-store';
import { authService, profileService } from '../services/api';
import { initializeNotifications } from '../services/notifications';
import type { UserProfile } from '../types';

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function useAuthState() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = async () => {
    try {
      const response = await authService.getMe();
      setUser(response.data);

      const pushToken = await initializeNotifications();
      if (pushToken) {
        try {
          await authService.registerPushToken(pushToken);
        } catch {
        }
      }
    } catch (error) {
      setUser(null);
    }
  };

  const login = async (token: string) => {
    await SecureStore.setItemAsync('authToken', token);
    await refreshUser();
  };

  const logout = async () => {
    // Clear local token (Trade Aid backend doesn't require logout endpoint)
    await SecureStore.deleteItemAsync('authToken');
    setUser(null);
  };

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = await SecureStore.getItemAsync('authToken');
        if (token) {
          await refreshUser();
        }
      } catch (error) {
        console.log('Auth check error:', error);
      } finally {
        setIsLoading(false);
      }
    };
    checkAuth();
  }, []);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    logout,
    refreshUser,
  };
}
