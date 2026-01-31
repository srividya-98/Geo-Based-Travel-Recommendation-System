# Push this project to GitHub
# Run this in PowerShell from the project folder after Git is installed.
# Usage: .\push-to-github.ps1

$ErrorActionPreference = "Stop"
$repoUrl = "https://github.com/srividya-98/Local-Travel-Place-Recommendation-System.git"

# Ensure we're in the script's directory
Set-Location $PSScriptRoot

# Check for Git
$git = $null
if (Get-Command git -ErrorAction SilentlyContinue) { $git = "git" }
elseif (Test-Path "C:\Program Files\Git\bin\git.exe") { $git = "C:\Program Files\Git\bin\git.exe" }
elseif (Test-Path "C:\Program Files (x86)\Git\bin\git.exe") { $git = "C:\Program Files (x86)\Git\bin\git.exe" }

if (-not $git) {
    Write-Host "Git is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Install from: https://git-scm.com/download/win" -ForegroundColor Yellow
    Write-Host "Then restart PowerShell and run this script again." -ForegroundColor Yellow
    exit 1
}

Write-Host "Using Git: $git" -ForegroundColor Cyan
& $git --version

# Initialize if needed
if (-not (Test-Path ".git")) {
    Write-Host "`nInitializing git repository..." -ForegroundColor Cyan
    & $git init
}

# Set remote
& $git remote remove origin 2>$null
& $git remote add origin $repoUrl
Write-Host "`nRemote set to: $repoUrl" -ForegroundColor Cyan

# Stage all
Write-Host "`nStaging all files..." -ForegroundColor Cyan
& $git add .

# Status
Write-Host "`nStatus:" -ForegroundColor Cyan
& $git status --short

# Commit
$msg = "Add Next.js travel place recommendation app (Overpass, ranking, map, Vercel-ready)"
Write-Host "`nCommitting: $msg" -ForegroundColor Cyan
& $git commit -m $msg 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Nothing to commit (already clean) or commit failed." -ForegroundColor Yellow
}

# Branch
& $git branch -M main

# Push
Write-Host "`nPushing to origin main..." -ForegroundColor Cyan
& $git push -u origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "`nIf the remote has existing content (e.g. README), try:" -ForegroundColor Yellow
    Write-Host "  git pull origin main --allow-unrelated-histories" -ForegroundColor White
    Write-Host "  git push -u origin main" -ForegroundColor White
    Write-Host "`nOr to overwrite remote (use only if you intend to replace repo content):" -ForegroundColor Yellow
    Write-Host "  git push -u origin main --force" -ForegroundColor White
    exit 1
}

Write-Host "`nDone. Repository: https://github.com/srividya-98/Local-Travel-Place-Recommendation-System" -ForegroundColor Green
