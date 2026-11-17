# Writes the Supabase connection link into .env as DATABASE_URL.
#
#   .\scripts\set-database-url.ps1 -Template "postgresql://user:[YOUR-PASSWORD]@host:5432/postgres"
#       asks only for the database password and puts it into the link;
#   .\scripts\set-database-url.ps1
#       asks for the whole link.
#
# What is typed is hidden and never printed.
param([string]$Template)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'
if (-not (Test-Path $envFile)) { Copy-Item (Join-Path $root '.env.example') $envFile }

function Read-Hidden([string]$prompt) {
  $secure = Read-Host -AsSecureString $prompt
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim() }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

Write-Host ''
if ($Template) {
  Write-Host 'Type (or paste) the Supabase DATABASE password you chose, then press Enter.'
  Write-Host 'Nothing will show while you type. That is normal.'
  $password = Read-Hidden 'Database password'
  if (-not $password) { Write-Host 'No password typed. Nothing was changed.' -ForegroundColor Red; exit 1 }
  # Symbols in a password must be escaped inside a link.
  $url = $Template.Replace('[YOUR-PASSWORD]', [Uri]::EscapeDataString($password))
  $password = $null
} else {
  Write-Host 'Paste the Supabase "Session pooler" link (with your password in place of [YOUR-PASSWORD]), then press Enter.'
  Write-Host 'Nothing will show while you paste. That is normal.'
  $url = Read-Hidden 'Link'
}

if (-not ($url -match '^postgres(ql)?://')) { Write-Host 'That does not look like a postgresql:// link. Nothing was changed.' -ForegroundColor Red; exit 1 }
if ($url -match 'YOUR-PASSWORD|\[|\]') { Write-Host 'The link still has [YOUR-PASSWORD] in it. Nothing was changed.' -ForegroundColor Red; exit 1 }

$found = $false
$lines = Get-Content $envFile | ForEach-Object {
  if ($_ -like 'DATABASE_URL=*') { $found = $true; 'DATABASE_URL=' + $url } else { $_ }
}
if (-not $found) { $lines += 'DATABASE_URL=' + $url }
# UTF-8 without a byte-order mark, so Node reads the file cleanly.
[IO.File]::WriteAllLines($envFile, [string[]]$lines, (New-Object Text.UTF8Encoding $false))
$url = $null
Write-Host 'Saved to .env. Go back to the chat and say done.' -ForegroundColor Green
