import axios from 'axios';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

// Default to local development or use environment variable
const API_URL = Constants.expoConfig?.extra?.apiUrl || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

// Request interceptor to add auth token
api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('authToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Token expired, clear and redirect to login
      await SecureStore.deleteItemAsync('authToken');
    }
    return Promise.reject(error);
  }
);

// Token service - aligned with Trade Aid backend
export const tokenService = {
  // Get all tokens with filters
  getAll: (params?: { chain?: string; limit?: number; offset?: number }) => 
    api.get('/api/tokens', { params }),
  
  // Get hot tokens (newest/trending)
  getHot: () => api.get('/api/tokens', { params: { sort_by: 'created_at', limit: 50 } }),
  
  // Get safe picks (high safety score)
  getSafePicks: () => api.get('/api/tokens', { params: { sort_by: 'safety_score', limit: 50 } }),
  
  // Get specific token by chain and address
  getByAddress: (chain: string, address: string) => 
    api.get(`/api/tokens/${chain}/${address}`),
  
  // Scan a token address
  scan: (chain: string, address: string) => 
    api.post('/api/tokens/scan', { chain, contract_address: address }),
  
  // Get token stats
  getStats: () => api.get('/api/tokens/stats/overview'),
};

// Signal/Scoring service
export const signalService = {
  getAll: () => api.get('/api/signals'),
  getByToken: (chain: string, address: string) => 
    api.get(`/api/signals/${chain}/${address}`),
};

// Wallet intelligence service
export const walletService = {
  // Get developer profile
  getDeveloper: (address: string) => 
    api.get(`/api/wallets/developer/${address}`),
  
  // Get trader profile  
  getTrader: (address: string) => 
    api.get(`/api/wallets/trader/${address}`),
  
  // Get wallet cluster analysis
  getCluster: (address: string) => 
    api.get(`/api/wallets/cluster/${address}`),
  
  // Analyze developer (async task)
  analyzeDeveloper: (address: string, chain: string = 'solana') => 
    api.post(`/api/wallets/developer/${address}/analyze`, null, { params: { chain } }),
  
  // Analyze trader (async task)
  analyzeTrader: (address: string, chain: string = 'solana') => 
    api.post(`/api/wallets/trader/${address}/analyze`, null, { params: { chain } }),
};

// Alert service
export const alertService = {
  // Get alerts with filters
  getAll: (params?: { chain?: string; alert_type?: string; severity?: string; limit?: number }) => 
    api.get('/api/alerts', { params }),
  
  // Create alert
  create: (data: {
    alert_type: string;
    chain: string;
    title: string;
    message?: string;
    severity?: string;
    contract_address?: string;
    wallet_address?: string;
    threshold_value?: number;
  }) => api.post('/api/alerts', data),
  
  // Mark alert as read
  markRead: (alertId: string) => 
    api.patch(`/api/alerts/${alertId}/read`),
};

// Auth service
export const authService = {
  // Register new user
  register: (username: string, email: string, password: string, deviceId?: string) => 
    api.post('/api/auth/register', { username, email, password, device_id: deviceId }),
  
  // Login
  login: (username: string, password: string, totpCode?: string, deviceId?: string) => 
    api.post('/api/auth/login', { username, password, totp_code: totpCode, device_id: deviceId }),
  
  // Get current user
  getMe: () => api.get('/api/auth/me'),
  
  // Setup 2FA
  setup2FA: () => api.post('/api/auth/2fa/setup'),
  
  // Enable 2FA
  enable2FA: (code: string) => api.post('/api/auth/2fa/enable', { code }),
  
  // Generate API key
  generateApiKey: () => api.post('/api/auth/api-key/generate'),
};

// Profile service (using auth/me for now)
export const profileService = {
  get: () => authService.getMe(),
  update: (data: any) => api.patch('/api/auth/profile', data),
};

// Subscription/usage services (placeholders for future endpoints)
export const subscriptionService = {
  get: () => api.get('/api/subscription'),
  subscribe: (data: any) => api.post('/api/subscribe', data),
};

export const usageService = {
  get: () => api.get('/api/usage'),
};

// Whale watch service (using wallet and alert services)
export const whaleService = {
  getWallets: () => walletService.getTrader('tracked').catch(() => ({ data: [] })),
  getAlerts: () => alertService.getAll({ alert_type: 'wallet_movement' }),
};

// Meme trend service (using tokens with specific filters)
export const trendService = {
  getList: () => api.get('/api/tokens', { params: { sort_by: 'volume_24h', limit: 50 } }),
};

export default api;
