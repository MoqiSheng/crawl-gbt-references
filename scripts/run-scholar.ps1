param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [string]$OutDir = ".\output\scholar",
  [int]$Limit = 0,
  [int]$Delay = 8,
  [switch]$StripDoiUrl,
  [switch]$KeepOpen,
  [switch]$DryRun,
  [string]$Cdp = "",
  [string]$ExecutablePath = "",
  [double]$MinTitleConfidence = 0.72,
  [int]$ManualTimeout = 600
)

$ErrorActionPreference = "Stop"
$SkillRoot = Split-Path $PSScriptRoot -Parent
$Node = Get-Command node -ErrorAction SilentlyContinue
if (-not $Node) { throw "Node.js is required. Run scripts/setup.ps1 after installing Node.js." }

$Playwright = Join-Path $SkillRoot "node_modules\playwright-core"
if (-not (Test-Path -LiteralPath $Playwright)) { throw "Playwright is not installed. Run scripts/setup.ps1 first." }
$env:PLAYWRIGHT_PACKAGE = $Playwright

if (-not $ExecutablePath) {
  $Candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  )
  $ExecutablePath = $Candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
}

$ArgsList = @(
  (Join-Path $PSScriptRoot "scholar_gbt_exporter.mjs"),
  (Resolve-Path -LiteralPath $InputPath).Path,
  "--out", [IO.Path]::GetFullPath($OutDir),
  "--delay", "$Delay",
  "--manual-timeout", "$ManualTimeout",
  "--min-title-confidence", "$MinTitleConfidence"
)
if ($Limit -gt 0) { $ArgsList += @("--limit", "$Limit") }
if ($StripDoiUrl) { $ArgsList += "--strip-doi-url" }
if ($KeepOpen) { $ArgsList += "--keep-open" }
if ($DryRun) { $ArgsList += "--dry-run" }
if ($Cdp) { $ArgsList += @("--cdp", $Cdp) }
elseif ($ExecutablePath) { $ArgsList += @("--executable-path", $ExecutablePath) }
else { throw "Chrome or Edge was not found. Install one or pass -ExecutablePath." }

& $Node.Source @ArgsList
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
