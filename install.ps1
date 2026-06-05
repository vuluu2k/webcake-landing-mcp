# ═══════════════════════════════════════════════════════════
#  Webcake Landing MCP Server - Trình cài đặt tự động (Windows)
#  Hỗ trợ: Claude Desktop, Claude Code, Cursor, Windsurf, Augment, Codex
#
#  Dùng sau khi clone:
#    .\install.ps1
#  Từ xa:
#    irm https://raw.githubusercontent.com/vuluu2k/webcake-landing-mcp/main/install.ps1 | iex
#  Gỡ cài đặt:
#    .\install.ps1 -Uninstall
# ═══════════════════════════════════════════════════════════

param([switch]$Uninstall)
$ErrorActionPreference = "Stop"

function Write-Info    { param($m) Write-Host "[INFO] $m" -ForegroundColor Blue }
function Write-Success { param($m) Write-Host "[OK] $m" -ForegroundColor Green }
function Write-Warn    { param($m) Write-Host "[CANH BAO] $m" -ForegroundColor Yellow }
function Write-Err     { param($m) Write-Host "[LOI] $m" -ForegroundColor Red }

function Print-Banner {
  Write-Host ""
  Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan
  Write-Host "║  Webcake Landing MCP - Cai dat (Windows)         ║" -ForegroundColor Cyan
  Write-Host "║  Sinh & sua landing page Webcake tu yeu cau      ║" -ForegroundColor Cyan
  Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan
  Write-Host ""
}

$script:NAME = "webcake-landing"
$REPO_URL = "https://github.com/vuluu2k/webcake-landing-mcp.git"
$DEFAULT_INSTALL_DIR = "$env:USERPROFILE\.webcake-landing-mcp"

# ── Node.js ──
function Install-NodeJS {
  Write-Info "Dang cai Node.js 20 LTS..."
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  } elseif (Get-Command choco -ErrorAction SilentlyContinue) {
    choco install nodejs-lts -y
  } elseif (Get-Command scoop -ErrorAction SilentlyContinue) {
    scoop install nodejs-lts
  } else {
    $nodeUrl = "https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi"
    $installer = "$env:TEMP\node-installer.msi"
    Invoke-WebRequest -Uri $nodeUrl -OutFile $installer -UseBasicParsing
    Start-Process msiexec.exe -ArgumentList "/i", $installer, "/qn" -Wait -Verb RunAs
    Remove-Item $installer -Force -ErrorAction SilentlyContinue
  }
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Err "Cai Node.js that bai. https://nodejs.org/"; exit 1 }
  Write-Success "Da cai Node.js $(node -v)"
}

function Check-NodeJS {
  $need = $false
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Warn "Chua cai Node.js."; $need = $true }
  else {
    $major = ((node -v) -replace "v","" -split "\.")[0]
    if ([int]$major -lt 18) { Write-Warn "Can Node.js >= 18. Hien tai: $(node -v)"; $need = $true }
  }
  if ($need) {
    $a = Read-Host "  Tu dong cai Node.js 20 LTS? (C/k)"; if (-not $a) { $a = "C" }
    if ($a -match "^[CcYy]$") { Install-NodeJS } else { Write-Err "Can Node.js >= 18. Cai xong chay lai."; exit 1 }
  }
  $script:NODE_BIN = (Get-Command node).Source
  Write-Success "Node.js $(node -v) tai $script:NODE_BIN"
}
function Check-Npm { if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Write-Err "Chua cai npm."; exit 1 }; Write-Success "npm $(npm -v)" }

# ── Cai MCP server (local hoac clone) ──
function Install-MCP {
  $localPkg = Join-Path $PSScriptRoot "package.json"
  if ((Test-Path $localPkg) -and (Select-String -Path $localPkg -Pattern "webcake-landing-mcp" -Quiet)) {
    $script:INSTALL_DIR = $PSScriptRoot
    Write-Info "Chay tu repo da clone: $script:INSTALL_DIR"
  } else {
    Write-Info "Cai MCP server vao dau?"; Write-Host "  Mac dinh: $DEFAULT_INSTALL_DIR"
    $d = Read-Host "  Duong dan (Enter de dung mac dinh)"; if (-not $d) { $d = $DEFAULT_INSTALL_DIR }
    $script:INSTALL_DIR = $d
    if (Test-Path "$($script:INSTALL_DIR)\.git") {
      Write-Info "Cap nhat code..."; Push-Location $script:INSTALL_DIR; git pull origin main 2>$null; Pop-Location
    } elseif (-not (Test-Path $script:INSTALL_DIR)) {
      Write-Info "Dang clone repository..."; git clone $REPO_URL $script:INSTALL_DIR
    }
  }
  Push-Location $script:INSTALL_DIR
  Write-Info "Cai dependencies..."; npm install
  Write-Info "Build TypeScript..."; npm run build
  Pop-Location
  $script:MCP_INDEX = "$($script:INSTALL_DIR)\dist\index.js"
  Write-Success "MCP server san sang: $script:MCP_INDEX"
}

# ── Thu thap cau hinh (tat ca tuy chon) ──
function Collect-Env {
  $envFile = "$($script:INSTALL_DIR)\.env"
  $def = @{ WEBCAKE_API_BASE = $env:WEBCAKE_API_BASE; WEBCAKE_JWT = $env:WEBCAKE_JWT; WEBCAKE_ORG_ID = $env:WEBCAKE_ORG_ID; WEBCAKE_HOST = $env:WEBCAKE_HOST; WEBCAKE_APP_BASE = $env:WEBCAKE_APP_BASE }
  if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
      if ($line -match "^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$" -and $line -notmatch "^\s*#") {
        $v = $Matches[2].Trim('"').Trim("'"); if ($v -and -not $def[$Matches[1]]) { $def[$Matches[1]] = $v }
      }
    }
  }
  Write-Host ""; Write-Host "-- Cau hinh (Enter de bo qua — nhom tool tham chieu chay khong can creds) --" -ForegroundColor White; Write-Host ""
  $dApi = if ($def.WEBCAKE_API_BASE) { $def.WEBCAKE_API_BASE } else { "http://localhost:5800" }
  $a = Read-Host "  WEBCAKE_API_BASE [$dApi]"; $script:API_BASE = if ($a) { $a } else { $dApi }
  $j = Read-Host "  WEBCAKE_JWT (token tai khoan, Enter de bo qua)"; $script:JWT = if ($j) { $j } else { $def.WEBCAKE_JWT }
  $o = Read-Host "  WEBCAKE_ORG_ID (Enter de bo qua)"; $script:ORG_ID = if ($o) { $o } else { $def.WEBCAKE_ORG_ID }
  $script:HOSTV = $def.WEBCAKE_HOST; $script:APP_BASE = $def.WEBCAKE_APP_BASE
  Write-Host ""; Write-Success "Cau hinh:"
  Write-Host "  API base : $script:API_BASE"
  if ($script:JWT) { Write-Host "  JWT      : $($script:JWT.Substring(0,[Math]::Min(8,$script:JWT.Length)))…" } else { Write-Host "  JWT      : (chua set)" -ForegroundColor Yellow }
  if ($script:ORG_ID) { Write-Host "  Org id   : $script:ORG_ID" }
}

function Build-Server {
  $envh = @{}
  if ($script:API_BASE) { $envh["WEBCAKE_API_BASE"] = $script:API_BASE }
  if ($script:JWT)      { $envh["WEBCAKE_JWT"]      = $script:JWT }
  if ($script:ORG_ID)   { $envh["WEBCAKE_ORG_ID"]   = $script:ORG_ID }
  if ($script:HOSTV)    { $envh["WEBCAKE_HOST"]     = $script:HOSTV }
  if ($script:APP_BASE) { $envh["WEBCAKE_APP_BASE"] = $script:APP_BASE }
  $s = @{ command = $script:NODE_BIN; args = @($script:MCP_INDEX) }
  if ($envh.Count -gt 0) { $s["env"] = $envh }
  return $s
}

function Write-OrMerge {
  param($File)
  $dir = Split-Path $File -Parent
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $server = Build-Server
  if ((Test-Path $File) -and (Get-Item $File).Length -gt 0) {
    try { $config = Get-Content $File -Raw | ConvertFrom-Json } catch { Write-Warn "Khong doc duoc $File — bo qua."; return }
    if ($config.PSObject.Properties.Name -notcontains "mcpServers") { $config | Add-Member -NotePropertyName "mcpServers" -NotePropertyValue ([PSCustomObject]@{}) }
    $config.mcpServers | Add-Member -NotePropertyName $script:NAME -NotePropertyValue $server -Force
    $config | ConvertTo-Json -Depth 8 | Set-Content -Path $File -Encoding UTF8
  } else {
    @{ mcpServers = @{ $script:NAME = $server } } | ConvertTo-Json -Depth 8 | Set-Content -Path $File -Encoding UTF8
  }
}

function Configure-ClaudeDesktop {
  Write-Info "Dang cau hinh Claude Desktop..."
  Write-OrMerge "$env:APPDATA\Claude\claude_desktop_config.json"
  Write-Success "Da cau hinh Claude Desktop"; Write-Warn "Khoi dong lai Claude Desktop"
}
function Configure-ClaudeCode {
  Write-Info "Dang cau hinh Claude Code..."
  if (Get-Command claude -ErrorAction SilentlyContinue) {
    $a = @("mcp","add",$script:NAME)
    if ($script:API_BASE) { $a += @("-e","WEBCAKE_API_BASE=$($script:API_BASE)") }
    if ($script:JWT)      { $a += @("-e","WEBCAKE_JWT=$($script:JWT)") }
    if ($script:ORG_ID)   { $a += @("-e","WEBCAKE_ORG_ID=$($script:ORG_ID)") }
    if ($script:HOSTV)    { $a += @("-e","WEBCAKE_HOST=$($script:HOSTV)") }
    if ($script:APP_BASE) { $a += @("-e","WEBCAKE_APP_BASE=$($script:APP_BASE)") }
    $a += @("--",$script:NODE_BIN,$script:MCP_INDEX)
    claude mcp remove $script:NAME 2>$null | Out-Null
    & claude @a 2>$null
    Write-Success "Da cau hinh Claude Code (qua CLI)"
  } else {
    Write-OrMerge "$env:USERPROFILE\.claude.json"; Write-Success "Da cau hinh Claude Code ($env:USERPROFILE\.claude.json)"
  }
}
function Configure-Cursor   { Write-Info "Dang cau hinh Cursor...";   Write-OrMerge "$env:USERPROFILE\.cursor\mcp.json"; Write-Success "Da cau hinh Cursor" }
function Configure-Windsurf { Write-Info "Dang cau hinh Windsurf..."; Write-OrMerge "$env:USERPROFILE\.codeium\windsurf\mcp_config.json"; Write-Success "Da cau hinh Windsurf" }
function Configure-Augment  {
  Write-Info "Dang cau hinh Augment / VS Code..."
  $dir = "$env:APPDATA\Code\User"; if (-not (Test-Path $dir)) { $dir = "$env:USERPROFILE\.vscode" }
  Write-OrMerge "$dir\mcp.json"; Write-Success "Da cau hinh Augment/VS Code ($dir\mcp.json)"
}
function Configure-Codex {
  Write-Info "Dang cau hinh Codex (OpenAI)..."
  $dir = "$env:USERPROFILE\.codex"; if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $parts = @()
  $pairs = @(
    ,@("WEBCAKE_API_BASE", $script:API_BASE)
    ,@("WEBCAKE_JWT",      $script:JWT)
    ,@("WEBCAKE_ORG_ID",   $script:ORG_ID)
    ,@("WEBCAKE_HOST",     $script:HOSTV)
    ,@("WEBCAKE_APP_BASE", $script:APP_BASE)
  )
  foreach ($p in $pairs) {
    if ($p[1]) { $parts += ('"' + $p[0] + '" = "' + $p[1] + '"') }
  }
  $envLine = if ($parts.Count -gt 0) { "env = { " + ($parts -join ", ") + " }" } else { "" }
  $block = @"

[mcp_servers.$($script:NAME)]
command = "$($script:NODE_BIN)"
args = ["$($script:MCP_INDEX)"]
$envLine
"@
  $cfg = "$dir\config.toml"
  if (Test-Path $cfg) {
    $content = Get-Content $cfg -Raw
    $content = $content -replace "(?s)\n?\[mcp_servers\.$($script:NAME)\].*?(?=\n\[|$)", ""
    Set-Content -Path $cfg -Value ($content.TrimEnd() + "`n") -NoNewline
    Add-Content -Path $cfg -Value $block
  } else {
    Set-Content -Path $cfg -Value "# Webcake Landing MCP`n$block"
  }
  Write-Success "Da cau hinh Codex ($cfg)"
}

function Select-IDEs {
  Write-Host ""; Write-Host "-- Chon IDE/Tool de cau hinh --" -ForegroundColor White; Write-Host ""
  Write-Host "  1) Claude Desktop"; Write-Host "  2) Claude Code (CLI)"; Write-Host "  3) Cursor"
  Write-Host "  4) Windsurf"; Write-Host "  5) Augment (VS Code)"; Write-Host "  6) Codex (OpenAI)"
  Write-Host "  7) Tat ca"; Write-Host "  0) Bo qua"; Write-Host ""
  $choice = Read-Host "  Chon (phan cach bang dau phay, vd 1,2)"
  foreach ($c in ($choice -split "," | ForEach-Object { $_.Trim() })) {
    switch ($c) {
      "1" { Configure-ClaudeDesktop }
      "2" { Configure-ClaudeCode }
      "3" { Configure-Cursor }
      "4" { Configure-Windsurf }
      "5" { Configure-Augment }
      "6" { Configure-Codex }
      "7" { Configure-ClaudeDesktop; Configure-ClaudeCode; Configure-Cursor; Configure-Windsurf; Configure-Augment; Configure-Codex }
      "0" { Write-Info "Bo qua cau hinh IDE." }
      default { Write-Warn "Lua chon khong hop le: $c" }
    }
  }
}

function Verify-Install {
  Write-Host ""; Write-Info "Kiem tra cai dat..."
  if (Test-Path $script:MCP_INDEX) { node --check $script:MCP_INDEX 2>$null; Write-Success "MCP server: $script:MCP_INDEX" }
  else { Write-Err "Khong tim thay $script:MCP_INDEX" }
}

function Print-Summary {
  Write-Host ""; Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
  Write-Host "  Cai dat hoan tat!" -ForegroundColor Green
  Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan; Write-Host ""
  Write-Host "  Node.js    : $script:NODE_BIN"
  Write-Host "  MCP Server : $script:MCP_INDEX"
  Write-Host "  API base   : $script:API_BASE"; Write-Host ""
  Write-Host "  Buoc tiep theo: khoi dong lai IDE, roi yeu cau AI: `"Tao landing page Webcake`"" -ForegroundColor Green
  Write-Host "  Kiem tra (Claude Code): claude mcp list"; Write-Host ""
}

function Uninstall-MCP {
  Print-Banner; Write-Host "-- Go cai dat Webcake Landing MCP --" -ForegroundColor White; Write-Host ""
  if (Get-Command claude -ErrorAction SilentlyContinue) { claude mcp remove $script:NAME 2>$null; Write-Success "Da xoa khoi Claude Code" }
  $files = @(
    "$env:USERPROFILE\.claude.json",
    "$env:APPDATA\Claude\claude_desktop_config.json",
    "$env:USERPROFILE\.cursor\mcp.json",
    "$env:USERPROFILE\.codeium\windsurf\mcp_config.json",
    "$env:APPDATA\Code\User\mcp.json"
  )
  foreach ($f in $files) {
    if (Test-Path $f) {
      try {
        $c = Get-Content $f -Raw | ConvertFrom-Json
        if ($c.mcpServers -and ($c.mcpServers.PSObject.Properties.Name -contains $script:NAME)) {
          $c.mcpServers.PSObject.Properties.Remove($script:NAME)
          $c | ConvertTo-Json -Depth 8 | Set-Content -Path $f -Encoding UTF8
          Write-Success "Da don $(Split-Path $f -Leaf)"
        }
      } catch { Write-Warn "Khong the sua $f" }
    }
  }
  $codex = "$env:USERPROFILE\.codex\config.toml"
  if (Test-Path $codex) {
    $content = Get-Content $codex -Raw
    $content = $content -replace "(?s)\n?\[mcp_servers\.$($script:NAME)\].*?(?=\n\[|$)", ""
    Set-Content -Path $codex -Value ($content.TrimEnd() + "`n") -NoNewline
    Write-Success "Da don Codex config.toml"
  }
  Write-Host ""; Write-Success "Go cai dat xong. Khoi dong lai IDE."
}

function Main {
  Print-Banner
  if ($Uninstall) { Uninstall-MCP; exit 0 }
  Check-NodeJS; Check-Npm
  Install-MCP; Collect-Env; Select-IDEs; Verify-Install; Print-Summary
}
Main
