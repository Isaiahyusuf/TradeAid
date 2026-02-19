# Quick setup (Windows) — bring up Docker, Node, and run the repo setup

This file contains the minimal steps to prepare a Windows dev machine and run the repository setup script.

1) Run the installer script (Administrator)

Open PowerShell as Administrator and run:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
.\scripts\install-docker.ps1
```

2) Verify Docker is running

Open a new (non-admin) PowerShell and run:

```powershell
docker --version
docker compose version
```

3) Install Node.js (LTS)

Option A — Winget (recommended if available):

```powershell
winget install --id OpenJS.NodeJS.LTS -e --silent
```

Option B — download from https://nodejs.org and install the LTS package.

Verify:

```powershell
node --version
npm --version
```

4) Create local env file

Copy the local example and edit secrets as needed:

```powershell
Copy-Item .env.local.example .env.local
```

# Edit .env.local in your editor and set real keys for AI and any other services

5) Run the repo setup (non-Administrator)

From the repo root (non-admin PowerShell):

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
.\scripts\setup-and-run.ps1
```

Notes:
- The setup script will attempt to bring up Docker Compose services (Postgres/Redis), install npm deps, push Drizzle schema (`npm run db:push`), build, and start the server.
- If `npm` or `docker` are not found, ensure they are installed and available in PATH, then re-open PowerShell and re-run step 5.
- For production deploys, copy `.env.production.example` to your host secrets store instead of using a plaintext file.
