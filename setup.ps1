# BLE-Attendance-Pivot: One-click server/prereq setup
# Run this as Administrator on a fresh machine before touching the project.
# Right-click PowerShell -> "Run as Administrator" -> paste this file path.

Write-Host "=== Installing Prerequisites ===" -ForegroundColor Cyan

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host "winget not found. Downloading the App Installer from Microsoft..."
    $url = "https://aka.ms/getwinget"
    $msix = "$env:TEMP\Microsoft.DesktopAppInstaller_8wekyb3d8bbwe.msixbundle"
    Invoke-WebRequest -Uri $url -OutFile $msix
    Add-AppxPackage -Path $msix
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Node.js LTS via winget..." -ForegroundColor Yellow
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    $env:Path += ";$env:ProgramFiles\nodejs"
} else {
    Write-Host "Node.js already installed: $(node --version)" -ForegroundColor Green
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Git via winget..." -ForegroundColor Yellow
    winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements
} else {
    Write-Host "Git already installed: $(git --version)" -ForegroundColor Green
}

if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Supabase CLI via winget..." -ForegroundColor Yellow
    winget install -e --id supabase.cli --accept-source-agreements --accept-package-agreements
} else {
    Write-Host "Supabase CLI already installed: $(supabase --version)" -ForegroundColor Green
}

# Install pnpm (fast, disk-efficient package manager)
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "Installing pnpm via corepack..." -ForegroundColor Yellow
    corepack enable
    corepack prepare pnpm@9.1.0 --activate
} else {
    Write-Host "pnpm already installed: $(pnpm --version)" -ForegroundColor Green
}

# Install web-app dependencies
Write-Host "`n=== Installing web app dependencies ===" -ForegroundColor Cyan

$root = "C:\Users\corte\Desktop\projects NOT DELETE\qr code scanner for attendance"

if (Test-Path "$root\web-app\package.json") {
    Set-Location "$root\web-app"
    pnpm install
}

Set-Location $root

# Copy .env
if (Test-Path "$root\web-app\.env.example") {
    if (-not (Test-Path "$root\web-app\.env")) {
        Copy-Item "$root\web-app\.env.example" "$root\web-app\.env"
        Write-Host "Created web-app\.env — edit it with your Supabase Cloud keys." -ForegroundColor Yellow
    }
}

Write-Host "`n=== Setup complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "NEXT STEPS:" -ForegroundColor Green
Write-Host ""
Write-Host "  1. EDIT web-app\.env with your Supabase Project URL + anon key"
Write-Host "     (supabase.com -> Project Settings -> API)"
Write-Host ""
Write-Host "  2. APPLY DATABASE SCHEMA" -ForegroundColor White
Write-Host "     supabase.com -> SQL Editor -> paste supabase\schema.sql -> Run"
Write-Host ""
Write-Host "  3. LOGIN & LINK SUPABASE CLI" -ForegroundColor White
Write-Host "     supabase login"
Write-Host "     supabase link --project-ref YOUR_PROJECT_ID"
Write-Host ""
Write-Host "  4. DEPLOY EDGE FUNCTIONS" -ForegroundColor White
Write-Host "     supabase functions deploy issue-session-tokens"
Write-Host "     supabase functions deploy validate-attendance"
Write-Host "     supabase functions deploy request-device-change"
Write-Host "     supabase functions deploy approve-device-change"
Write-Host ""
Write-Host "  5. ENABLE REALTIME" -ForegroundColor White
Write-Host "     supabase.com -> Database -> Replication -> toggle attendance ON"
Write-Host ""
Write-Host "  6. CREATE TEACHER ACCOUNT" -ForegroundColor White
Write-Host "     supabase.com -> Authentication -> Add User"
Write-Host "     Then SQL Editor: INSERT INTO teachers (auth_user_id, name) VALUES ('<uuid>', 'Name');"
Write-Host ""
Write-Host "  7. RUN LOCALLY" -ForegroundColor White
Write-Host "     cd web-app ; pnpm dev"
Write-Host ""
Write-Host "  8. DEPLOY TO RENDER" -ForegroundColor White
Write-Host "     Create a Static Site on render.com from this repo"
Write-Host "     Build command: cd web-app && pnpm install && pnpm build"
Write-Host "     Publish directory: web-app/dist"
Write-Host "     Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY as environment variables"
Write-Host ""
Write-Host "Edge Function secrets are auto-injected by Supabase Cloud. No manual setup needed."
