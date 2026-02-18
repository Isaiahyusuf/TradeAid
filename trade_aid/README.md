# Trade Aid - Blockchain Intelligence Backend

Production-ready blockchain intelligence system with cross-chain scanning, AI risk scoring, wallet clustering, and real-time alerts.

## Architecture

- **Backend**: FastAPI + SQLAlchemy + PostgreSQL
- **AI Service**: Separate FastAPI microservice (PyTorch/TensorFlow ready)
- **Workers**: Celery + Redis for async task processing
- **WebSocket**: Real-time alerts and chain event streaming
- **Scanner**: Dedicated single-process service for DexScreener polling + chain WebSocket listeners

## Supported Chains

Solana, Ethereum, BSC, Base, Arbitrum, Avalanche, Polygon

## Quick Start (VPS Deployment)

### Prerequisites

- Ubuntu 22.04+ VPS (minimum 4GB RAM, 2 CPU)
- Docker and Docker Compose installed
- Domain name (optional, for SSL)

### 1. Install Docker

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
sudo apt install docker-compose-plugin
```

### 2. Clone and Configure

```bash
git clone <your-repo-url> trade_aid
cd trade_aid
cp .env.example .env
nano .env  # Fill in your values
```

### 3. Launch

```bash
docker compose up --build -d
```

### 4. Verify

```bash
# Check all services are running
docker compose ps

# Check backend health
curl http://localhost/health

# Check AI service health
curl http://localhost:8001/health

# View logs
docker compose logs -f backend
```

### 5. Run Database Migrations

```bash
docker compose exec backend alembic upgrade head
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login (returns JWT)
- `GET /api/auth/me` - Current user profile
- `POST /api/auth/2fa/setup` - Setup 2FA
- `POST /api/auth/2fa/enable` - Enable 2FA
- `POST /api/auth/api-key/generate` - Generate API key

### Tokens
- `GET /api/tokens` - List tokens (filter by chain)
- `GET /api/tokens/{chain}/{contract}` - Token details + liquidity events
- `GET /api/tokens/stats/overview` - Token statistics

### Scoring
- `POST /api/scoring/score-token` - Score a token (sync)
- `POST /api/scoring/score-token/async` - Score a token (async via Celery)
- `GET /api/scoring/history/{chain}/{contract}` - Scoring history

### Wallets
- `GET /api/wallets/developer/{address}` - Developer profile
- `GET /api/wallets/trader/{address}` - Trader profile
- `GET /api/wallets/cluster/{address}` - Wallet cluster analysis
- `POST /api/wallets/developer/{address}/analyze` - Queue developer analysis
- `POST /api/wallets/trader/{address}/analyze` - Queue trader analysis

### Alerts
- `GET /api/alerts` - List alerts (filter by chain, type, severity)
- `POST /api/alerts` - Create custom alert
- `PATCH /api/alerts/{id}/read` - Mark alert as read

### WebSocket
- `ws://your-domain/ws` - General event stream
- `ws://your-domain/ws/alerts` - Alerts channel

### AI Service
- `POST /score-token` (port 8001) - AI-powered token scoring

## API Documentation

Once running, visit:
- Swagger UI: `http://your-domain/docs`
- ReDoc: `http://your-domain/redoc`
- AI Service docs: `http://your-domain:8001/docs`

## SSL Setup (Optional)

1. Install Certbot:
```bash
sudo apt install certbot
sudo certbot certonly --standalone -d yourdomain.com
```

2. Copy certs to nginx/ssl/ and update nginx.conf for HTTPS.

## Monitoring

```bash
# View all logs
docker compose logs -f

# View specific service
docker compose logs -f backend
docker compose logs -f celery_worker

# Restart a service
docker compose restart backend

# Scale workers
docker compose up -d --scale celery_worker=4
```

## Mobile App Integration

This backend is designed to be consumed by iOS and Android mobile apps:

- All endpoints return JSON
- JWT authentication for session management
- WebSocket support for real-time push notifications
- Device binding field for per-device auth
- Telegram bot integration for push alerts outside the app
