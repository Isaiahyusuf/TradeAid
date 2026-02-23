# 🔧 EXACT Environment Variable Names for Railway

This document shows the **exact variable names** used in your code.

---

## 🐍 Python Backend (Trade Aid) - Required Variables

### **Auto-Provided by Railway** (when you add database/redis)
```bash
DATABASE_URL          # Railway PostgreSQL provides this automatically
REDIS_URL            # Railway Redis provides this automatically
PORT                 # Railway provides this (use $PORT in start command)
```

### **Required - Must Set Manually**
```bash
# Security (CHANGE THESE!)
JWT_SECRET_KEY=your-random-32-char-secret
MASTER_ACCESS_KEY=your-random-master-key
ENCRYPTION_KEY=your-32-char-encryption-key!

# CORS
CORS_ORIGINS=https://your-frontend.railway.app,https://tradeaid.app

# App Config
APP_NAME=Trade Aid
APP_VERSION=1.0.0
DEBUG=false
LOG_LEVEL=INFO
ENABLED_CHAINS=solana,ethereum,bsc,base,arbitrum,avalanche,polygon
```

### **Optional - Celery Background Tasks**
```bash
CELERY_BROKER_URL=$REDIS_URL/1
CELERY_RESULT_BACKEND=$REDIS_URL/2
```

### **Optional - API Keys for Enhanced Features**
```bash
# Blockchain Data APIs
HELIUS_API_KEY=          # Solana RPC
ALCHEMY_API_KEY=         # Ethereum/Base RPC
BSCSCAN_API_KEY=         # BSC blockchain data

# Token Data
DEXSCREENER_API_URL=https://api.dexscreener.com/latest/dex
```

### **Optional - RPC Endpoints** (defaults work but custom are better)
```bash
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
BSC_RPC_URL=https://bsc-dataseed.binance.org/
BASE_RPC_URL=https://mainnet.base.org
POLYGON_RPC_URL=https://polygon-rpc.com/
ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc
AVALANCHE_RPC_URL=https://api.avax.network/ext/bc/C/rpc
```

### **Required for Multi-Chain Token Feed**
```bash
# Controls which chains are scanned and returned by /api/tokens and dashboard feeds
ENABLED_CHAINS=solana,ethereum,bsc,base,arbitrum,avalanche,polygon
```

### **Optional - Notifications**
```bash
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

---

## 🌐 Web Frontend (Node.js) - Required Variables

### **Auto-Provided by Railway**
```bash
DATABASE_URL          # Same PostgreSQL as Python backend
PORT                 # Railway provides this
```

### **Required - Must Set Manually**
```bash
# Node Environment
NODE_ENV=production

# Session Secret (CHANGE THIS!)
SESSION_SECRET=your-random-64-char-secret

# Backend API URL (Python backend URL from Railway)
VITE_API_URL=https://trade-aid-backend-production.up.railway.app
```

### **Optional - AI Features**
```bash
OPENAI_API_KEY=sk-your-openai-key
AI_INTEGRATIONS_OPENAI_API_KEY=sk-your-openai-key
OPENAI_BASE_URL=https://api.openai.com/v1
```

### **Optional - Payment Processing**
```bash
PAYMENT_ADDRESS_SOL=your-solana-wallet-address
PAYMENT_ADDRESS_ETH=your-ethereum-wallet-address
PAYMENT_ADDRESS_BSC=your-bsc-wallet-address
PAYMENT_ADDRESS_BASE=your-base-wallet-address
```

---

## 📋 Quick Copy-Paste for Railway

### Python Backend Service

**Via Railway CLI:**
```bash
railway variables set \
  JWT_SECRET_KEY="$(openssl rand -hex 32)" \
  MASTER_ACCESS_KEY="$(openssl rand -hex 32)" \
  ENCRYPTION_KEY="$(openssl rand -hex 16)" \
  CORS_ORIGINS="https://your-frontend.railway.app" \
  APP_NAME="Trade Aid" \
  APP_VERSION="1.0.0" \
  DEBUG="false" \
  LOG_LEVEL="INFO"
```

**Via Railway Dashboard:**
Go to your service → Variables tab, add:
```
JWT_SECRET_KEY = <generate-random-32-chars>
MASTER_ACCESS_KEY = <generate-random-32-chars>
ENCRYPTION_KEY = <32-chars>
CORS_ORIGINS = https://your-frontend.railway.app
APP_NAME = Trade Aid
APP_VERSION = 1.0.0
DEBUG = false
LOG_LEVEL = INFO
```

### Web Frontend Service

**Via Railway CLI:**
```bash
railway variables set \
  NODE_ENV="production" \
  SESSION_SECRET="$(openssl rand -hex 32)" \
  VITE_API_URL="https://your-python-backend.railway.app"
```

**Via Railway Dashboard:**
```
NODE_ENV = production
SESSION_SECRET = <generate-random-64-chars>
VITE_API_URL = https://trade-aid-backend-production.up.railway.app
```

---

## 🔐 Generate Secrets (PowerShell)

```powershell
# Generate JWT_SECRET_KEY (32 chars)
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})

# Generate MASTER_ACCESS_KEY (32 chars)
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})

# Generate ENCRYPTION_KEY (32 chars)
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})

# Generate SESSION_SECRET (64 chars)
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 64 | % {[char]$_})
```

---

## ✅ Minimal Required Setup

**To get started quickly, you ONLY need these:**

### Python Backend:
```bash
# Railway auto-provides:
DATABASE_URL
REDIS_URL
PORT

# You must set:
JWT_SECRET_KEY=<random-32-chars>
MASTER_ACCESS_KEY=<random-32-chars>
ENCRYPTION_KEY=<random-32-chars>
CORS_ORIGINS=https://your-frontend-url.railway.app
```

### Web Frontend:
```bash
# Railway auto-provides:
DATABASE_URL
PORT

# You must set:
NODE_ENV=production
SESSION_SECRET=<random-64-chars>
=https://your-python-backend-url.railway.app
```

---

## 🎯 Step-by-Step Variable Setup

### Step 1: Add Databases First
```bash
railway add --database postgresql
railway add --database redis
```
This creates `DATABASE_URL` and `REDIS_URL` automatically.

### Step 2: Set Python Backend Variables
```bash
railway variables set JWT_SECRET_KEY="abc123...32chars"
railway variables set MASTER_ACCESS_KEY="xyz789...32chars"
railway variables set ENCRYPTION_KEY="key000...32chars"
railway variables set CORS_ORIGINS="*"
railway variables set APP_NAME="Trade Aid"
```

### Step 3: Set Web Frontend Variables
```bash
# Switch to web-frontend service
railway service

# Set variables
railway variables set NODE_ENV="production"
railway variables set SESSION_SECRET="ses123...64chars"
railway variables set VITE_API_URL="https://trade-aid-backend.railway.app"
```

### Step 4: Verify
```bash
# Check Python backend
railway variables

# Check web frontend  
railway service
railway variables
```

---

## 📝 Notes

1. **`DATABASE_URL`** - Railway generates this when you add PostgreSQL. Both services share the same database.

2. **`REDIS_URL`** - Railway generates this when you add Redis. Only Python backend uses it.

3. **`PORT`** - Railway provides this dynamically. Don't hardcode it. Use `$PORT` in start commands.

4. **`CORS_ORIGINS`** - Start with `*` for testing, then restrict to your frontend URL.

5. **JWT/Session Secrets** - Must be random and secure. Use the PowerShell commands above to generate.

6. **`VITE_API_URL`** - Must point to your deployed Python backend URL (get from Railway after deploying).

---

## 🔍 How to Check What's Missing

After setting variables, check your Railway logs:

```bash
railway logs

# Look for errors like:
# "JWT_SECRET_KEY not set"
# "DATABASE_URL not found"
```

The code will tell you exactly which variables are missing!

---

## 💡 Pro Tips

1. **Use Railway Reference Variables:**
   ```bash
   CELERY_BROKER_URL=${{REDIS_URL}}/1
   CELERY_RESULT_BACKEND=${{REDIS_URL}}/2
   ```

2. **Test locally first:**
   ```bash
   cp .env.example .env
   # Fill in values
   cd trade_aid
   docker-compose up
   ```

3. **Keep secrets in Railway, not in git:**
   - Never commit `.env` files
   - Always use `.env.example` as template

4. **One database, multiple services:**
   - PostgreSQL: Shared by Python + Node backends
   - Redis: Only Python backend needs it
