import axios from 'axios';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

const API_URL = Constants.expoConfig?.extra?.apiUrl || 'https://your-backend-url.com';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('authToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const tokenService = {
  getAll: () => api.get('/api/tokens'),
  getHot: () => api.get('/api/tokens/hot'),
  getSafePicks: () => api.get('/api/tokens/safe-picks'),
  getByAddress: (address: string) => api.get(`/api/tokens/${address}`),
  scan: (address: string) => api.post('/api/tokens/scan', { address }),
  deepAnalyze: (address: string) => api.post(`/api/tokens/${address}/deep-analyze`),
  scanNow: () => api.post('/api/scanner/scan-now'),
};

export const signalService = {
  getAll: () => api.get('/api/signals'),
  getByAddress: (address: string) => api.get(`/api/signals/${address}`),
};

export const profileService = {
  get: () => api.get('/api/profile'),
  update: (data: any) => api.patch('/api/profile', data),
};

export const subscriptionService = {
  get: () => api.get('/api/subscription'),
  subscribe: (data: any) => api.post('/api/subscribe', data),
};

export const usageService = {
  get: () => api.get('/api/usage'),
};

export const whaleService = {
  getWallets: () => api.get('/api/whalewatch/wallets'),
  getAlerts: () => api.get('/api/whalewatch/alerts'),
};

export const trendService = {
  getList: () => api.get('/api/memetrend/list'),
};

export const authService = {
  getUser: () => api.get('/api/auth/user'),
  logout: () => api.post('/api/auth/logout'),
};

export default api;
