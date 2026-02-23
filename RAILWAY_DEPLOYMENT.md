# Railway Deployment Guide - Complete Setup

This guide covers deploying all TradeAid services to Railway.

## Architecture Overview

TradeAid consists of 3 main deployable components:

1. **Python Backend (Trade Aid)** - FastAPI backend with token scanning, wallet intelligence
2. **Web Frontend** - Node.js/Express serving React SPA
3. **Mobile App** - React Native (deployed to App Stores, not Railway)

## Railway Services Setup

You'll create **4 services** in Railway:

1. PostgreSQL database (Railway template)
2. Redis (Railway template)
3. Python Backend (Trade Aid)
4. Web Frontend (Node.js)

---

## Step 1: Create Railway Project

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Create new project
railway init
```

Choose a project name: `tradeaid`

---

## Step 2: Add PostgreSQL Database

**Option A: Via Railway Dashboard**
1. Go to your Railway project
2. Click "+ New"
3. Select "Database" → "PostgreSQL"
4. Railway automatically provisions and connects it

**Option B: Via CLI**
```bash
railway add --database postgresql
```

**Get Connection String:**
```bash
railway variables
```

Copy the `DATABASE_URL` - you'll need it for both backends.

---

## Step 3: Add Redis

**Via Dashboard:**
1. Click "+ New"
2. Select "Database" → "Redis"

**Via CLI:**
```bash
railway add --database redis
```

Copy the `REDIS_URL` from variables.

---

## Step 4: Deploy Python Backend (Trade Aid)

### 4.1 Create Service

```bash
# Navigate to root directory
cd C:\Users\DELL PC\TradeAid

# Create new service
railway service create trade-aid-backend
```

### 4.2 Configure Build

Railway will use the `railway.json` in root (already configured for Python backend).

### 4.3 Set Environment Variables

```bash
railway variables set DATABASE_URL="postgresql://..." \
  REDIS_URL="redis://..." \
  JWT_SECRET_KEY="your-secret-key-here" \
  MASTER_ACCESS_KEY="your-master-access-key-here" \
  ENCRYPTION_KEY="your-32-plus-char-encryption-key" \
  ENABLED_CHAINS="solana,ethereum,bsc,base,arbitrum,avalanche,polygon" \
  CORS_ORIGINS="https://your-frontend.railway.app,https://tradeaid.app"
```

**Required Variables for Python Backend:**
```env
# Database
DATABASE_URL=postgresql://user:pass@host:port/dbname

# Redis
REDIS_URL=redis://default:pass@host:port

# Security
JWT_SECRET_KEY=your-super-secret-jwt-key-change-this
MASTER_ACCESS_KEY=your-master-access-key-change-this
ENCRYPTION_KEY=your-32-plus-char-encryption-key

# API Keys (optional but recommended)
DEXSCREENER_API_KEY=your-key
BIRDEYE_API_KEY=your-key
HELIUS_API_KEY=your-key

# CORS
CORS_ORIGINS=https://your-frontend.railway.app,https://tradeaid.app

# App Config
APP_NAME=Trade Aid
APP_VERSION=1.0.0
DEBUG=false
LOG_LEVEL=INFO
ENABLED_CHAINS=solana,ethereum,bsc,base,arbitrum,avalanche,polygon
```

### 4.4 Deploy

```bash
railway up --service trade-aid-backend
```

Or push to GitHub and connect Railway to your repo with root path `trade_aid/`.

### 4.5 Get Backend URL

```bash
railway domain --service trade-aid-backend
```

Example: `https://trade-aid-backend-production.up.railway.app`

---

## Step 5: Deploy Web Frontend

### 5.1 Create Service

```bash
railway service create web-frontend
```

### 5.2 Set Environment Variables

```bash
railway variables set NODE_ENV="production" \
  DATABASE_URL="postgresql://..." \
  SESSION_SECRET="your-session-secret"
```

**Required Variables for Web Frontend:**
```env
# Node Environment
NODE_ENV=production

# Database (shares same PostgreSQL)
DATABASE_URL=postgresql://user:pass@host:port/dbname

# Session
SESSION_SECRET=your-session-secret-change-this

# API Integration (connects to Python backend)
VITE_API_URL=https://trade-aid-backend-production.up.railway.app
```

### 5.3 Deploy

Railway will auto-detect `package.json` and use Nixpacks to build.

```bash
railway up --service web-frontend
```

Or connect GitHub repo with root path `/` (Railway will build from package.json).

### 5.4 Generate Domain

```bash
railway domain --service web-frontend
```

Example: `https://tradeaid.up.railway.app`

---

## Step 6: Mobile App Configuration

Mobile app connects to the Railway backends but is **distributed via App Stores**, not hosted on Railway.

### 6.1 Update Mobile App Config

Edit `mobile/app.config.js`:

```javascript
export default {
  expo: {
    extra: {
      apiUrl: "https://trade-aid-backend-production.up.railway.app"
    }
  }
}
```

Or set environment variable:
```bash
export EXPO_PUBLIC_API_URL=https://trade-aid-backend-production.up.railway.app
```

### 6.2 Build Mobile App

```bash
cd mobile

# Build for iOS and Android
eas build --platform all

# Submit to stores
eas submit --platform ios
eas submit --platform android
```

See `mobile/README.md` for complete mobile deployment guide.

---

## Step 7: Database Migrations

### 7.1 Run Python Backend Migrations

```bash
# SSH into Railway service
railway run --service trade-aid-backend bash

# Run Alembic migrations
alembic upgrade head
```

Or set up automatic migrations in `railway.json`:
```json
{
  "build": {
    "builder": "DOCKERFILE"
  },
  "deploy": {
    "startCommand": "alembic upgrade head && gunicorn app.main:app ..."
  }
}
```

### 7.2 Run Node Backend Migrations

```bash
railway run --service web-frontend npm run db:push
```

---

## Railway Dashboard Configuration

### Python Backend Service Settings

- **Service Name:** `trade-aid-backend`
- **Root Directory:** `trade_aid/`
- **Build Command:** Auto (uses Dockerfile)
- **Start Command:** `gunicorn app.main:app --worker-class uvicorn.workers.UvicornWorker --workers 2 --bind 0.0.0.0:$PORT`
- **Port:** 8000 (Railway auto-assigns $PORT)
- **Health Check:** `/health`

### Web Frontend Service Settings

- **Service Name:** `web-frontend`
- **Root Directory:** `/` (root)
- **Build Command:** `npm run build`
- **Start Command:** `npm run start`
- **Port:** Railway auto-detects from Express
- **Health Check:** `/api/health` or `/`

---

## Environment Variables Summary

### PostgreSQL (Shared)
- Automatically created by Railway
- `DATABASE_URL` shared across services

### Redis (Shared)
- Automatically created by Railway
- `REDIS_URL` used by Python backend

### Python Backend (`trade-aid-backend`)
```env
DATABASE_URL=<from Railway PostgreSQL>
REDIS_URL=<from Railway Redis>
JWT_SECRET_KEY=<generate strong secret>
MASTER_ACCESS_KEY=<generate strong secret>
ENCRYPTION_KEY=<32+ char secret>
CORS_ORIGINS=<your-frontend-url>
APP_NAME=Trade Aid
DEBUG=false
LOG_LEVEL=INFO
ENABLED_CHAINS=solana,ethereum,bsc,base,arbitrum,avalanche,polygon
PORT=8000
```

### Web Frontend (`web-frontend`)
```env
NODE_ENV=production
DATABASE_URL=<from Railway PostgreSQL>
SESSION_SECRET=<generate strong secret>
VITE_API_URL=<python-backend-url>
PORT=<Railway auto-assigns>
```

---

## Post-Deployment Checklist

- [ ] PostgreSQL database created and connected
- [ ] Redis created and connected
- [ ] Python backend deployed and healthy (`/health` endpoint returns 200)
- [ ] Web frontend deployed and accessible
- [ ] Database migrations ran successfully
- [ ] CORS configured correctly (frontend can call backend)
- [ ] Environment variables set for all services
- [ ] Custom domains configured (optional)
- [ ] Mobile app updated with production API URL
- [ ] Mobile app built and submitted to stores

---

## Testing Deployments

### Test Python Backend
```bash
curl https://trade-aid-backend-production.up.railway.app/health
# Should return: {"status":"healthy"}

curl https://trade-aid-backend-production.up.railway.app/
# Should return app info
```

### Test Web Frontend
```bash
curl https://tradeaid.up.railway.app/
# Should return HTML page

curl https://tradeaid.up.railway.app/api/health
# Should return 200
```

### Test Database Connection
```bash
railway run --service trade-aid-backend python -c "from app.database import test_connection; test_connection()"
```

---

## Monitoring & Logs

### View Logs
```bash
# Python backend
railway logs --service trade-aid-backend

# Web frontend
railway logs --service web-frontend

# Follow logs
railway logs --service trade-aid-backend --follow
```

### Metrics
- Visit Railway dashboard → Your service → Metrics tab
- Monitor CPU, Memory, Network usage
- Set up alerts for downtime

---

## Scaling

### Vertical Scaling (More Resources)
Railway Pro plan allows more CPU/RAM per service.

### Horizontal Scaling (More Instances)
Update `railway.json`:
```json
{
  "deploy": {
    "numReplicas": 2
  }
}
```

---

## Custom Domains

### Add Custom Domain

**Via Dashboard:**
1. Go to service settings
2. Click "Networking" → "Custom Domain"
3. Add your domain (e.g., `api.tradeaid.app`)
4. Update DNS with provided CNAME

**Via CLI:**
```bash
railway domain add api.tradeaid.app --service trade-aid-backend
railway domain add app.tradeaid.app --service web-frontend
```

Update DNS:
```
CNAME api.tradeaid.app -> <railway-assigned-domain>
CNAME app.tradeaid.app -> <railway-assigned-domain>
```

---

## Cost Estimation

Railway pricing (as of 2024):
- **Free Tier:** $5 credit/month, limited resources
- **Pro Plan:** $20/month, more resources + $0.000463/GB-hour

Estimated monthly cost:
- PostgreSQL: ~$5-10
- Redis: ~$5
- Python Backend: ~$10-20
- Web Frontend: ~$10-20
- **Total: ~$30-55/month**

---

## Troubleshooting

### Build Fails

**Python Backend:**
- Check Dockerfile syntax
- Ensure all requirements in `requirements.txt`
- Verify Python version compatibility

**Web Frontend:**
- Clear build cache: `railway clear-cache`
- Check `package.json` scripts
- Verify Node version in `package.json` engines

### Database Connection Issues

```bash
# Test connection
railway run --service trade-aid-backend -- python -c "import psycopg2; print('OK')"

# Check DATABASE_URL format
railway variables | grep DATABASE_URL
```

### CORS Errors

Update Python backend CORS_ORIGINS:
```bash
railway variables set CORS_ORIGINS="https://your-frontend.railway.app,https://tradeaid.app" --service trade-aid-backend
```

### High Memory Usage

- Reduce worker count in gunicorn
- Enable database connection pooling
- Add Redis caching

---

## Continuous Deployment

### GitHub Integration

1. Connect Railway to GitHub repo
2. Select branch (e.g., `main`)
3. Set root directory per service:
   - Python backend: `trade_aid/`
   - Web frontend: `/`
4. Auto-deploy on push

### Manual Deploy
```bash
# Deploy specific service
railway up --service trade-aid-backend

# Deploy all services
railway up
```

---

## Backup & Recovery

### Database Backups

Railway Pro automatically backs up PostgreSQL daily.

**Manual Backup:**
```bash
railway run --service trade-aid-backend -- pg_dump $DATABASE_URL > backup.sql
```

**Restore:**
```bash
railway run --service trade-aid-backend -- psql $DATABASE_URL < backup.sql
```

---

## Security Best Practices

1. **Generate Strong Secrets:**
   ```bash
  openssl rand -hex 32  # For JWT_SECRET_KEY, MASTER_ACCESS_KEY, SESSION_SECRET
   ```

2. **Enable HTTPS Only** (Railway provides SSL automatically)

3. **Restrict CORS Origins** (don't use `*` in production)

4. **Use Environment Variables** for all secrets (never commit to git)

5. **Regular Updates:**
   ```bash
   # Update dependencies
   pip install --upgrade -r requirements.txt
   npm update
   ```

6. **Rate Limiting:** Already configured in Python backend

---

## Support & Resources

- **Railway Docs:** https://docs.railway.app
- **Railway CLI:** https://docs.railway.app/develop/cli
- **Trade Aid Backend Docs:** `/trade_aid/README.md`
- **Web Frontend Docs:** `/SETUP.md`
- **Mobile App Docs:** `/mobile/README.md`

---

## Quick Deploy Script

Save as `deploy-railway.sh`:

```bash
#!/bin/bash

echo "🚀 Deploying TradeAid to Railway..."

# Deploy Python backend
echo "📦 Deploying Python backend..."
railway up --service trade-aid-backend

# Run migrations
echo "🔄 Running database migrations..."
railway run --service trade-aid-backend -- alembic upgrade head

# Deploy web frontend
echo "🌐 Deploying web frontend..."
railway up --service web-frontend

echo "✅ Deployment complete!"
echo "📊 Check status: railway status"
echo "📝 View logs: railway logs --follow"
```

Make executable: `chmod +x deploy-railway.sh`

---

**Next Steps:**
1. Follow steps 1-7 above to deploy all services
2. Test each service endpoint
3. Update mobile app with production URLs
4. Build and submit mobile app to stores
5. Set up monitoring and alerts

🎉 Your TradeAid platform is now fully deployed on Railway!
