# MemeScannerAI - Crypto Token Scanner

## Overview
A comprehensive crypto token scanner that monitors Telegram, Twitter, and DEXes for new token launches. The system calculates safety scores, identifies high-potential tokens, provides entry/exit signals using AI analysis, sends notifications, and tracks charts/trading activity in real-time.

## Current State
- **Alpha Scanner** is the main feature - discovers and analyzes NEW hot tokens automatically
- **Multi-chain scanner** covers Solana (Pump.fun), Ethereum, BSC, and Base
- Background scanner runs every 5 minutes to continuously discover tokens
- AI-powered analysis using OpenAI GPT-4.1-mini for entry/exit signals
- Safety scoring with holder analysis (top 10 holders %, dev wallet %)

## Key Features
1. **Multi-Chain Token Discovery**: Pump.fun (Solana), DexScreener (ETH/BSC/Base)
2. **Holder Analysis**: Top 10 holders % and dev wallet % using Helius, Alchemy, BscScan APIs
3. **Safety Filtering**: Only shows tokens with top holders <=30%, dev wallet <=10%
4. **AI Analysis**: Deep analysis with entry/target/stop-loss recommendations
5. **Real-time Updates**: Auto-refresh every 30 seconds for tokens, signals
6. **User Account System**: Editable profiles with username, bio, favorite chain, notification preferences, risk tolerance

## Project Architecture

### Frontend (React + Vite)
- `client/src/pages/AlphaScanner.tsx` - Main token scanner dashboard
- `client/src/pages/Dashboard.tsx` - Overview dashboard
- `client/src/pages/RugShield.tsx` - Token safety analyzer
- `client/src/pages/WhaleWatch.tsx` - Whale activity tracker
- `client/src/pages/MemeTrend.tsx` - Trending meme analysis
- `client/src/pages/Account.tsx` - User profile and settings management

### Backend (Express)
- `server/services/dexscreener.ts` - DexScreener API integration
- `server/services/multichain-scanner.ts` - Multi-chain launchpad scanner with holder analysis
- `server/services/safety-analyzer.ts` - Safety score calculation
- `server/services/ai-analyzer.ts` - OpenAI-powered token analysis
- `server/services/token-scanner.ts` - Background scanning service
- `server/routes/scanner.ts` - Scanner API endpoints

### Database (PostgreSQL with Drizzle)
- `scannedTokens` - Discovered tokens with metadata
- `tokenSignals` - AI-generated trading signals
- `userAlerts` - User notification preferences
- `watchlists` - User watchlists

## API Endpoints
- `GET /api/tokens` - List all scanned tokens
- `GET /api/tokens/hot` - Get hot tokens (sorted by score)
- `GET /api/tokens/:address` - Get token details
- `GET /api/tokens/by-chain/:chain` - Get tokens filtered by chain
- `GET /api/tokens/safe-launchpad` - Get safe launchpad tokens only
- `POST /api/tokens/scan` - Manually scan a token address
- `POST /api/tokens/:address/deep-analyze` - AI deep analysis
- `GET /api/signals` - Get all trading signals
- `GET /api/signals/:address` - Get signals for token
- `POST /api/scanner/scan-now` - Trigger immediate scan
- `POST /api/scanner/multichain` - Trigger multi-chain scan
- `GET /api/profile` - Get user profile (authenticated)
- `PATCH /api/profile` - Update user profile with Zod validation (authenticated)

## Technical Notes
- DexScreener API endpoints use `/latest/v1` format (e.g., `/token-profiles/latest/v1`)
- OpenAI client uses lazy initialization to ensure env vars are loaded
- Background scanner interval: 300 seconds (5 minutes)
- Frontend bound to 0.0.0.0:5000
- Safety thresholds: Top holders <=30%, Dev wallet <=10%, Min liquidity $10k
- Holder analysis returns -1% when unavailable (filtered out as unsafe)

## Required API Keys (for holder analysis)
- `HELIUS_API_KEY` - Solana holder analysis
- `ALCHEMY_API_KEY` - Ethereum/Base holder analysis
- `BSCSCAN_API_KEY` - BSC holder analysis

## Integrations
- **OpenAI**: AI-powered token analysis (javascript_openai_ai_integrations)
- **Replit Auth**: User authentication (javascript_log_in_with_replit)
