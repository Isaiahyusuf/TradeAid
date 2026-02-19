# Run as Administrator
# Installs WSL2 (if needed) and Docker Desktop via winget.
# Usage: Open PowerShell as Administrator and run:
#   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process; .\scripts\install-docker.ps1

function Ensure-Admin {
    $current = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not $current.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Error "This script must be run as Administrator. Right-click PowerShell and run as administrator."
        exit 1
    }
}

Ensure-Admin

Write-Host "1) Enabling required Windows features for WSL/Virtualization..."
try {
    dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart | Out-Null
    dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart | Out-Null
} catch {
    Write-Warning "Failed enabling Windows features (you may need to enable them manually)."
}

Write-Host "2) Setting WSL default version to 2 and updating kernel..."
try {
    wsl --set-default-version 2 2>$null
    wsl --update 2>$null
} catch {
    Write-Warning "`wsl` command failed — if you do not have the WSL utility yet, run wsl --install and reboot then re-run this script."
}

Write-Host "3) Checking existing WSL distros..."
wsl -l -v

Write-Host "If you want a fresh Ubuntu distro and one already exists, use: wsl --unregister <DistroName>"

# Install Docker Desktop using winget if available
Write-Host "4) Installing Docker Desktop (requires internet)."
$hasWinget = Get-Command winget -ErrorAction SilentlyContinue
if ($hasWinget) {
    Write-Host "Installing Docker Desktop via winget..."
    winget install --id Docker.DockerDesktop -e --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "winget install failed. Please download Docker Desktop from https://www.docker.com/products/docker-desktop and run the installer manually."
    }
} else {
    Write-Warning "winget not found. Please download Docker Desktop from https://www.docker.com/products/docker-desktop and run the installer manually."
}

Write-Host "5) Finished. Start Docker Desktop, enable 'Use the WSL 2 based engine' and WSL integration for your distro (Settings -> Resources -> WSL Integration)."
Write-Host "After Docker Desktop is running, verify with: docker --version`n`ndocker compose version"
Write-Host "Then run the repo setup script: .\scripts\setup-and-run.ps1 (not as Admin is fine)"

exit 0
