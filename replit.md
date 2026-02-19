# Trade Aid - Crypto Trading Intelligence Platform

## Overview
A comprehensive cryptocurrency trading intelligence platform that provides token scanning, risk scoring, wallet intelligence, and alerts for trading across multiple blockchains (Solana, Ethereum, BSC, Base, etc.).

## Current State (Feb 2026)
- **Frontend**: React + Vite app running on Replit, connects to Railway backend via JWT auth
- **Backend**: FastAPI Python app deployed on Railway at `https://tradeaid-4e908.up.railway.app/`
- **Database**: PostgreSQL on Railway
- **Auth**: JWT-based (login/register via Railway API)
- **PWA**: Manifest configured for mobile "Add to Home Screen"

## Architecture

### Frontend (React + Vite + TailwindCSS)
- `client/src/pages/AuthPage.tsx` - Login/register page with JWT auth
- `client/src/pages/Dashboard.tsx` - Main dashboard with token/alert stats
- `client/src/pages/AlphaScanner.tsx` - Token discovery with quick-score
- `client/src/pages/RugShield.tsx` - Token risk scanner (scoring API)
- `client/src/pages/WhaleWatch.tsx` - Wallet intelligence (developer/trader profiles)
- `client/src/pages/MemeTrend.tsx` - Token explorer with chain filter
- `client/src/pages/Account.tsx` - User account details

### API Client Layer
- `client/src/lib/api.ts` - Railway API client with JWT Bearer token auth
- `client/src/lib/queryClient.ts` - React Query client configured for Railway API
- `client/src/hooks/use-auth.ts` - JWT login/register/logout hook
- `client/src/hooks/use-memetrend.ts` - Token listing and stats hooks
- `client/src/hooks/use-rugcheck.ts` - Token scoring hooks
- `client/src/hooks/use-whalewatch.ts` - Wallet analysis hooks (developer/trader)
- `client/src/hooks/use-alerts.ts` - Alerts CRUD hooks

### Backend (Railway - Python/FastAPI)
Located in `trade_aid/` directory:
- `/api/auth/` - JWT authentication (login, register, me)
- `/api/tokens/` - Token CRUD and stats
- `/api/scoring/` - Token risk scoring
- `/api/wallets/` - Wallet intelligence (developer/trader profiles)
- `/api/alerts/` - Alert management

### Local Express Backend (Legacy Scanner)
- `server/` directory - Express server with DexScreener scanning
- Auto-discovers tokens from Pump.fun, DexScreener
- AI analysis via OpenAI GPT-4.1-mini
- Background scanner runs every 60 seconds

## Environment Variables
- `VITE_API_URL` - Railway backend URL (shared)
- `DATABASE_URL` - Local PostgreSQL (for Express scanner)

## Key Design Decisions
- JWT tokens stored in localStorage with Bearer auth
- All Railway API calls go through `api.ts` with auto-auth headers
- Mobile-first responsive design with bottom nav bar
- PWA manifest for "Add to Home Screen" on iOS/Android
- Dark theme by default with green (#22c55e) primary color

## User Preferences
- Mobile-friendly design priority
- Dark theme
- Multi-chain support (SOL, ETH, BSC, Base)
