# Usage (run from repo root):
#   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process; .\scripts\setup-and-run.ps1

Write-Host "Starting repo setup: docker compose, npm install, db push, build, start"

# 1) Start Docker services (Postgres + Redis)
Write-Host "Bringing up Docker services (docker compose up -d)"
try {
    docker compose up -d
} catch {
    Write-Warning "docker compose failed. Ensure Docker Desktop is running and WSL integration is enabled."
}

# 2) Install Node deps
Write-Host "Installing Node dependencies (npm install)"
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Warning "npm install failed. Fix errors and re-run this script."
}

# 3) Apply DB schema (drizzle)
Write-Host "Applying DB schema (npm run db:push). This may retry until Postgres is healthy..."
$maxAttempts = 6
$attempt = 0
while ($attempt -lt $maxAttempts) {
    $attempt++
    Write-Host "db:push attempt $attempt/$maxAttempts"
    npm run db:push
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds (10 * $attempt)
}
if ($LASTEXITCODE -ne 0) {
    Write-Warning "db:push failed after multiple attempts. Check Postgres container logs and connection string in .env.local"
}

# 4) Build the project
Write-Host "Building the project (npm run build)"
npm run build
if ($LASTEXITCODE -ne 0) { Write-Warning "Build failed." }

# 5) Start the server
Write-Host "Starting server (npm start). Press Ctrl+C to stop."
Write-Host "If you prefer to run in background use a process manager or run 'Start-Process -NoNewWindow -FilePath npm -ArgumentList 'start'" -ForegroundColor Yellow
npm start

# End
Write-Host "Setup script finished (or exited)."
