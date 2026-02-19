param(
    [string]$Service = ''
)

# Check for Railway CLI
$railwayCmd = Get-Command railway -ErrorAction SilentlyContinue
if (-not $railwayCmd) {
    Write-Host "Railway CLI not found. Install with: npm i -g @railway/cli" -ForegroundColor Yellow
    exit 2
}

if ([string]::IsNullOrWhiteSpace($Service)) {
    Write-Host "Following Railway logs for the default project (press Ctrl+C to stop)..." -ForegroundColor Green
    & railway logs -f
} else {
    Write-Host "Following Railway logs for service '$Service' (press Ctrl+C to stop)..." -ForegroundColor Green
    & railway logs -f --service $Service
}
