# Copies the variables in .env to the linked Vercel project (Production), without printing
# any value. Run it yourself from the project folder:  .\scripts\vercel-env-import.ps1
# Each variable is replaced if it already exists. Values never appear on screen.
param([string]$File = '.env', [string]$Target = 'production')

if (-not (Test-Path $File)) { Write-Host "No $File here. Run this from the project folder."; exit 1 }
$names = @()
foreach ($line in Get-Content $File) {
  if ($line -notmatch '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$') { continue }
  $name = $Matches[1]; $value = $Matches[2].Trim()
  if ($value -match '^"(.*)"$' -or $value -match "^'(.*)'$") { $value = $Matches[1] }
  if (-not $value) { Write-Host "skip  $name (empty)"; continue }
  $value | npx -y vercel@latest env add $name $Target --force --sensitive *> $null
  if ($LASTEXITCODE -eq 0) { Write-Host "added $name"; $names += $name } else { Write-Host "FAILED $name" }
}
Write-Host "Done: $($names.Count) variable(s) added to $Target. Values were not shown."
