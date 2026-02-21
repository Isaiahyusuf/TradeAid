# Quick Deploy to Railway - TradeAid Platform
# This script helps you deploy all services to Railway quickly

Write-Host "🚀 TradeAid Railway Deployment Helper" -ForegroundColor Green
Write-Host ""

# Check if Railway CLI is installed
Write-Host "Checking Railway CLI..." -ForegroundColor Cyan
if (!(Get-Command railway -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Railway CLI not found!" -ForegroundColor Red
    Write-Host "Install it with: npm install -g @railway/cli" -ForegroundColor Yellow
    exit 1
}
Write-Host "✅ Railway CLI found" -ForegroundColor Green
Write-Host ""

# Login check
Write-Host "Checking Railway login status..." -ForegroundColor Cyan
railway whoami 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️  Not logged in to Railway" -ForegroundColor Yellow
    Write-Host "Running railway login..." -ForegroundColor Cyan
    railway login
}
Write-Host "✅ Logged in to Railway" -ForegroundColor Green
Write-Host ""

# Menu
Write-Host "Select deployment option:" -ForegroundColor Cyan
Write-Host "1. Deploy Python Backend (Trade Aid API)"
Write-Host "2. Deploy Web Frontend (React + Node)"
Write-Host "3. Deploy Both"
Write-Host "4. Show Railway Services Status"
Write-Host "5. View Logs (Python Backend)"
Write-Host "6. View Logs (Web Frontend)"
Write-Host "7. Set Environment Variables"
Write-Host "8. Run Database Migrations"
Write-Host "9. Exit"
Write-Host ""

$choice = Read-Host "Enter choice (1-9)"

switch ($choice) {
    "1" {
        Write-Host ""
        Write-Host "🐍 Deploying Python Backend..." -ForegroundColor Cyan
        Write-Host ""
        
        # Check if railway.json exists
        if (!(Test-Path "railway.json")) {
            Write-Host "❌ railway.json not found!" -ForegroundColor Red
            exit 1
        }
        
        Write-Host "Deploying with railway.json configuration..." -ForegroundColor Yellow
        Write-Host "(This uses trade_aid/Dockerfile)" -ForegroundColor Gray
        railway up
        
        Write-Host ""
        Write-Host "✅ Python backend deployed!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Next steps:" -ForegroundColor Yellow
        Write-Host "1. Set environment variables (option 7)"
        Write-Host "2. Run migrations (option 8)"
        Write-Host "3. Generate domain: railway domain" -ForegroundColor Gray
    }
    
    "2" {
        Write-Host ""
        Write-Host "🌐 Deploying Web Frontend..." -ForegroundColor Cyan
        Write-Host ""
        
        if (!(Test-Path "railway-web.json")) {
            Write-Host "❌ railway-web.json not found!" -ForegroundColor Red
            exit 1
        }
        
        Write-Host "Deploying web frontend..." -ForegroundColor Yellow
        railway up --config railway-web.json
        
        Write-Host ""
        Write-Host "✅ Web frontend deployed!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Next steps:" -ForegroundColor Yellow
        Write-Host "1. Set environment variables (option 7)"
        Write-Host "2. Generate domain: railway domain" -ForegroundColor Gray
    }
    
    "3" {
        Write-Host ""
        Write-Host "🚀 Deploying All Services..." -ForegroundColor Cyan
        Write-Host ""
        
        Write-Host "Step 1/2: Deploying Python Backend..." -ForegroundColor Yellow
        railway up
        
        Write-Host ""
        Write-Host "Step 2/2: Deploying Web Frontend..." -ForegroundColor Yellow
        railway up --config railway-web.json
        
        Write-Host ""
        Write-Host "✅ All services deployed!" -ForegroundColor Green
        Write-Host ""
        Write-Host "⚠️  Important next steps:" -ForegroundColor Yellow
        Write-Host "1. Set environment variables for each service"
        Write-Host "2. Add PostgreSQL and Redis databases"
        Write-Host "3. Run database migrations"
        Write-Host "4. Configure domains"
    }
    
    "4" {
        Write-Host ""
        Write-Host "📊 Railway Services Status" -ForegroundColor Cyan
        Write-Host ""
        railway status
        Write-Host ""
        Write-Host "To see more details, visit: https://railway.app/project" -ForegroundColor Gray
    }
    
    "5" {
        Write-Host ""
        Write-Host "📝 Python Backend Logs (Ctrl+C to exit)" -ForegroundColor Cyan
        Write-Host ""
        railway logs --follow
    }
    
    "6" {
        Write-Host ""
        $service = Read-Host "Enter service name (or press Enter for default)"
        if ([string]::IsNullOrWhiteSpace($service)) {
            railway logs --follow
        } else {
            railway logs --follow --service $service
        }
    }
    
    "7" {
        Write-Host ""
        Write-Host "📋 Environment Variables Setup" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Select service:" -ForegroundColor Yellow
        Write-Host "1. Python Backend"
        Write-Host "2. Web Frontend"
        $envChoice = Read-Host "Enter choice (1-2)"
        
        Write-Host ""
        if ($envChoice -eq "1") {
            Write-Host "Python Backend Environment Variables" -ForegroundColor Cyan
            Write-Host "See .env.railway.backend for reference" -ForegroundColor Gray
            Write-Host ""
            Write-Host "Setting critical variables..." -ForegroundColor Yellow
            
            $jwtSecret = Read-Host "Enter JWT_SECRET (or press Enter to generate)"
            if ([string]::IsNullOrWhiteSpace($jwtSecret)) {
                $jwtSecret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})
                Write-Host "Generated: $jwtSecret" -ForegroundColor Gray
            }
            
            $corsOrigins = Read-Host "Enter CORS_ORIGINS (comma-separated URLs)"
            
            railway variables set JWT_SECRET="$jwtSecret" CORS_ORIGINS="$corsOrigins" APP_NAME="TradeAid" ENVIRONMENT="production"
            
            Write-Host ""
            Write-Host "✅ Basic variables set!" -ForegroundColor Green
            Write-Host "Add DATABASE_URL and REDIS_URL from Railway dashboard" -ForegroundColor Yellow
        }
        elseif ($envChoice -eq "2") {
            Write-Host "Web Frontend Environment Variables" -ForegroundColor Cyan
            Write-Host "See .env.railway.web for reference" -ForegroundColor Gray
            Write-Host ""
            
            $sessionSecret = Read-Host "Enter SESSION_SECRET (or press Enter to generate)"
            if ([string]::IsNullOrWhiteSpace($sessionSecret)) {
                $sessionSecret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 64 | ForEach-Object {[char]$_})
                Write-Host "Generated: $sessionSecret" -ForegroundColor Gray
            }
            
            $apiUrl = Read-Host "Enter VITE_API_URL (Python backend URL)"
            
            railway variables set NODE_ENV="production" SESSION_SECRET="$sessionSecret" VITE_API_URL="$apiUrl"
            
            Write-Host ""
            Write-Host "✅ Variables set!" -ForegroundColor Green
        }
    }
    
    "8" {
        Write-Host ""
        Write-Host "🔄 Running Database Migrations" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Select migration:" -ForegroundColor Yellow
        Write-Host "1. Python Backend (Alembic)"
        Write-Host "2. Web Frontend (Drizzle)"
        $migChoice = Read-Host "Enter choice (1-2)"
        
        Write-Host ""
        if ($migChoice -eq "1") {
            Write-Host "Running Python Alembic migrations..." -ForegroundColor Yellow
            railway run alembic upgrade head
            Write-Host "✅ Migrations complete!" -ForegroundColor Green
        }
        elseif ($migChoice -eq "2") {
            Write-Host "Running Drizzle migrations..." -ForegroundColor Yellow
            railway run npm run db:push
            Write-Host "✅ Migrations complete!" -ForegroundColor Green
        }
    }
    
    "9" {
        Write-Host ""
        Write-Host "👋 Goodbye!" -ForegroundColor Green
        exit 0
    }
    
    default {
        Write-Host ""
        Write-Host "❌ Invalid choice" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "Done! 🎉" -ForegroundColor Green
