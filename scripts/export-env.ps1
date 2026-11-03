# Source this script in Windows PowerShell to route your terminal session:
#   . .\scripts\export-env.ps1

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
$tokenFile = Join-Path $rootDir ".data\token"

if (-not (Test-Path $tokenFile)) {
    Write-Error "[!] Error: No token file found at $tokenFile. Start the daemon first via: pnpm dev:core"
    return
}

$token = (Get-Content $tokenFile -Raw).Trim()
$daemonUrl = if ($env:UDI_DAEMON_URL) { $env:UDI_DAEMON_URL } else { "http://127.0.0.1:4317" }

$env:OPENAI_BASE_URL = "$daemonUrl/v1"
$env:OPENAI_API_KEY = $token
$env:ANTHROPIC_BASE_URL = "$daemonUrl/v1"
$env:ANTHROPIC_API_KEY = $token
$env:UDI_TOKEN = $token
$env:UDI_DAEMON_URL = $daemonUrl

Write-Host "✓ Routed environment to Universal Developer Intelligence (Windows PowerShell):" -ForegroundColor Green
Write-Host "  OPENAI_BASE_URL    = $env:OPENAI_BASE_URL"
Write-Host "  ANTHROPIC_BASE_URL = $env:ANTHROPIC_BASE_URL"
Write-Host "  All OpenAI and Anthropic compatible agent CLIs will now hit the proxy."
