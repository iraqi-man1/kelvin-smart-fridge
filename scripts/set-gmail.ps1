# Saves the Gmail account Kelvin sends sign-in codes from into .env.
# The app password (16 letters from Google) is typed hidden and never printed.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'
if (-not (Test-Path $envFile)) { Copy-Item (Join-Path $root '.env.example') $envFile }

Write-Host ''
$gmail = (Read-Host 'Gmail address that will send the codes (for example name@gmail.com)').Trim()
if ($gmail -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { Write-Host 'That is not an email address. Nothing was changed.' -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host 'On Google''s page, click the copy button next to the 16-letter App password.'
Write-Host 'Then come back here and just press Enter (or paste it, then Enter). Nothing will show.'
$secure = Read-Host -AsSecureString 'App password'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $pass = ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) -replace '\s', '') }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
$fromClipboard = $false
if (-not $pass) {
  # Nothing typed: take it from the clipboard (Google's copy button puts it there).
  $pass = ((Get-Clipboard -Raw) -replace '\s', '')
  $fromClipboard = $true
}
if ($pass -notmatch '^[A-Za-z]{16}$') {
  Write-Host "That is not a 16-letter App password (found $($pass.Length) characters). Nothing was changed." -ForegroundColor Red
  Write-Host 'Click the copy button on Google''s page first, then run this again.'
  exit 1
}
if ($fromClipboard) { Set-Clipboard -Value ' ' } # do not leave the password on the clipboard

$values = @{ 'GMAIL_USER' = $gmail; 'GMAIL_APP_PASSWORD' = $pass }
$seen = @{}
$lines = Get-Content $envFile | ForEach-Object {
  $line = $_
  foreach ($key in $values.Keys) { if ($line -match "^#?\s*$key=") { $seen[$key] = $true; $line = "$key=$($values[$key])" } }
  $line
}
foreach ($key in $values.Keys) { if (-not $seen[$key]) { $lines += "$key=$($values[$key])" } }
[IO.File]::WriteAllLines($envFile, [string[]]$lines, (New-Object Text.UTF8Encoding $false))
$pass = $null
Write-Host 'Saved to .env. Go back to the chat and say done.' -ForegroundColor Green
