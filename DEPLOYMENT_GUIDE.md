# MemeScannerAI - Complete Deployment Guide

This guide contains everything you need to host the backend elsewhere and build the React Native mobile app.

---

## ENVIRONMENT VARIABLES REQUIRED

### Database (PostgreSQL)
```
DATABASE_URL=postgresql://username:password@host:5432/database_name
PGHOST=your-postgres-host
PGPORT=5432
PGUSER=your-username
PGPASSWORD=your-password
PGDATABASE=your-database-name
```

### Authentication
```
SESSION_SECRET=your-random-session-secret-min-32-chars
```
Generate with: `openssl rand -hex 32`

### OpenAI (for AI Analysis)
```
OPENAI_API_KEY=sk-your-openai-api-key
OPENAI_BASE_URL=https://api.openai.com/v1
```
Get from: https://platform.openai.com/api-keys

### App Configuration
```
NODE_ENV=production
PORT=5000
```

---

## DATABASE SCHEMA (PostgreSQL)

Run this SQL to create all tables:

```sql
-- Scanned Tokens (Main token data)
CREATE TABLE scanned_tokens (
  id SERIAL PRIMARY KEY,
  address TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  chain TEXT NOT NULL DEFAULT 'solana',
  dex_id TEXT,
  pair_address TEXT,
  price_usd TEXT,
  price_native TEXT,
  liquidity REAL DEFAULT 0,
  market_cap REAL DEFAULT 0,
  volume_24h REAL DEFAULT 0,
  price_change_1h REAL DEFAULT 0,
  price_change_24h REAL DEFAULT 0,
  buys_24h INTEGER DEFAULT 0,
  sells_24h INTEGER DEFAULT 0,
  safety_score INTEGER NOT NULL DEFAULT 0,
  is_liquidity_locked BOOLEAN NOT NULL DEFAULT false,
  mint_authority_disabled BOOLEAN NOT NULL DEFAULT false,
  top_holders_percentage INTEGER NOT NULL DEFAULT 0,
  is_honeypot BOOLEAN NOT NULL DEFAULT false,
  risk_level TEXT DEFAULT 'unknown',
  ai_signal TEXT DEFAULT 'hold',
  ai_analysis TEXT,
  social_links JSONB,
  pair_created_at TIMESTAMP,
  last_scanned_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- User Watchlists
CREATE TABLE watchlists (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_address TEXT NOT NULL,
  alert_on_price_up REAL,
  alert_on_price_down REAL,
  alert_on_volume REAL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- User Alerts
CREATE TABLE user_alerts (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_address TEXT,
  alert_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Token Signals
CREATE TABLE token_signals (
  id SERIAL PRIMARY KEY,
  token_address TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  confidence INTEGER DEFAULT 0,
  entry_price TEXT,
  target_price TEXT,
  stop_loss TEXT,
  reasoning TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tracked Wallets (WhaleWatch)
CREATE TABLE tracked_wallets (
  id SERIAL PRIMARY KEY,
  address TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  win_rate INTEGER DEFAULT 0,
  total_profit TEXT DEFAULT '0 SOL'
);

-- Wallet Alerts
CREATE TABLE wallet_alerts (
  id SERIAL PRIMARY KEY,
  wallet_id INTEGER REFERENCES tracked_wallets(id),
  token_symbol TEXT NOT NULL,
  type TEXT NOT NULL,
  amount TEXT NOT NULL,
  price TEXT NOT NULL,
  timestamp TIMESTAMP DEFAULT NOW()
);

-- Trending Coins
CREATE TABLE trending_coins (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  price TEXT NOT NULL,
  volume_24h TEXT NOT NULL,
  hype_score INTEGER NOT NULL,
  trend TEXT NOT NULL,
  last_updated TIMESTAMP DEFAULT NOW()
);

-- Subscriptions
CREATE TABLE subscriptions (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free',
  payment_method TEXT,
  tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- User Usage (Free tier limits)
CREATE TABLE user_usage (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  daily_scans INTEGER DEFAULT 0,
  daily_deep_analyses INTEGER DEFAULT 0,
  daily_signal_views INTEGER DEFAULT 0,
  ads_viewed INTEGER DEFAULT 0,
  last_reset_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Users (Auth)
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  profile_image_url TEXT,
  username TEXT,
  bio TEXT,
  favorite_chain TEXT DEFAULT 'solana',
  notifications_enabled BOOLEAN DEFAULT true,
  email_alerts_enabled BOOLEAN DEFAULT false,
  risk_tolerance TEXT DEFAULT 'medium',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Sessions
CREATE TABLE sessions (
  sid TEXT PRIMARY KEY,
  sess JSONB NOT NULL,
  expire TIMESTAMP NOT NULL
);
CREATE INDEX idx_sessions_expire ON sessions(expire);
```

---

## BACKEND HOSTING OPTIONS

### Option 1: Railway.app (Recommended)
1. Create account at https://railway.app
2. Create new project > Deploy from GitHub
3. Add PostgreSQL service
4. Set environment variables in Railway dashboard
5. Deploy

### Option 2: Render.com
1. Create account at https://render.com
2. Create new Web Service
3. Connect GitHub repo
4. Add PostgreSQL database
5. Set environment variables
6. Deploy

### Option 3: DigitalOcean App Platform
1. Create account at https://digitalocean.com
2. Create new App
3. Add PostgreSQL database
4. Set environment variables
5. Deploy

### Option 4: Heroku
1. Create account at https://heroku.com
2. Create new app
3. Add Heroku Postgres addon
4. Set environment variables via CLI or dashboard
5. Deploy

---

## API ENDPOINTS (for React Native app)

Your mobile app will call these endpoints:

```
Base URL: https://your-backend-url.com

# Auth
GET  /api/auth/user          - Get current user
POST /api/auth/logout        - Logout

# Profile
GET  /api/profile            - Get user profile
PATCH /api/profile           - Update profile

# Tokens
GET  /api/tokens             - List all tokens
GET  /api/tokens/hot         - Get hot tokens
GET  /api/tokens/safe-picks  - Get safe picks
GET  /api/tokens/:address    - Get token details
POST /api/tokens/scan        - Scan new token
POST /api/tokens/:address/deep-analyze - AI analysis

# Signals
GET  /api/signals            - Get all signals
GET  /api/signals/:address   - Get token signals

# Scanner
POST /api/scanner/scan-now   - Trigger immediate scan

# Subscription
GET  /api/subscription       - Get subscription status
POST /api/subscribe          - Subscribe to plan

# Usage
GET  /api/usage              - Get usage stats

# WhaleWatch
GET  /api/whalewatch/wallets - Get tracked wallets
GET  /api/whalewatch/alerts  - Get wallet alerts

# MemeTrend
GET  /api/memetrend/list     - Get trending memes
```

---

## REACT NATIVE APP SETUP

### Prerequisites
- Node.js 18+
- Expo CLI: `npm install -g expo-cli`
- iOS: Xcode (Mac only)
- Android: Android Studio

### Create New React Native Project
```bash
npx create-expo-app MemeScannerAI --template blank-typescript
cd MemeScannerAI
```

### Install Dependencies
```bash
npx expo install @react-navigation/native @react-navigation/bottom-tabs @react-navigation/native-stack
npx expo install react-native-screens react-native-safe-area-context
npx expo install @tanstack/react-query axios
npx expo install expo-secure-store expo-auth-session expo-web-browser
npx expo install react-native-svg
npx expo install expo-linear-gradient
```

### Key Files to Create

See the `mobile/` directory in this project for the complete React Native source code.

---

## APP STORE PUBLISHING

### iOS (App Store)
1. Apple Developer Account: $99/year at https://developer.apple.com
2. Create App ID in Apple Developer Portal
3. Create app in App Store Connect
4. Run: `eas build --platform ios`
5. Submit to TestFlight for beta testing
6. Submit to App Store review

### Android (Google Play)
1. Google Play Developer Account: $25 one-time at https://play.google.com/console
2. Create app in Google Play Console
3. Run: `eas build --platform android`
4. Upload AAB to Google Play Console
5. Submit for review

### Expo EAS Build Setup
```bash
npm install -g eas-cli
eas login
eas build:configure
```

Create `eas.json`:
```json
{
  "cli": {
    "version": ">= 5.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal"
    },
    "production": {}
  },
  "submit": {
    "production": {}
  }
}
```

---

## MOBILE APP ENVIRONMENT VARIABLES

Create `app.config.js` for Expo:
```javascript
export default {
  expo: {
    name: "MemeScannerAI",
    slug: "memescannerai",
    version: "1.0.0",
    extra: {
      apiUrl: process.env.API_URL || "https://your-backend-url.com",
    },
    ios: {
      bundleIdentifier: "com.yourcompany.memescannerai",
      buildNumber: "1"
    },
    android: {
      package: "com.yourcompany.memescannerai",
      versionCode: 1
    }
  }
};
```

---

## SUMMARY CHECKLIST

- [ ] Set up PostgreSQL database (Railway, Supabase, Neon, etc.)
- [ ] Deploy backend to hosting service
- [ ] Set all environment variables
- [ ] Test API endpoints work
- [ ] Create React Native project with Expo
- [ ] Configure API_URL to point to your backend
- [ ] Test on iOS Simulator / Android Emulator
- [ ] Create Apple Developer Account ($99/year)
- [ ] Create Google Play Developer Account ($25)
- [ ] Build and submit to app stores
