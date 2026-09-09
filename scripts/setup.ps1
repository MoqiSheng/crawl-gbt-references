$ErrorActionPreference = "Stop"

$SkillRoot = Split-Path $PSScriptRoot -Parent
$Node = Get-Command node -ErrorAction SilentlyContinue
$Npm = Get-Command npm -ErrorAction SilentlyContinue
$Python = Get-Command python -ErrorAction SilentlyContinue

if (-not $Node -or -not $Npm) {
  throw "Node.js and npm are required. Install an active Node.js LTS release, then run this script again."
}
if (-not $Python) {
  throw "Python 3 is required. Install Python 3 and enable its PATH option, then run this script again."
}

Push-Location $SkillRoot
try {
  $NpmCache = Join-Path $SkillRoot ".runtime\npm-cache"
  New-Item -ItemType Directory -Force -Path $NpmCache | Out-Null
  & $Npm.Source install --ignore-scripts --cache $NpmCache
  if ($LASTEXITCODE -ne 0) { throw "npm dependency installation failed." }
  & $Python.Source -m pip install -r requirements.txt
  if ($LASTEXITCODE -ne 0) { throw "Python dependency installation failed." }
} finally {
  Pop-Location
}

Write-Host "Setup complete. Chrome or Edge is also required for Scholar/CNKI crawling."
