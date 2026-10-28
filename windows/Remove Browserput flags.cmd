<# : Batch launcher; the PowerShell script starts after the closing comment marker.
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ((Get-Content -LiteralPath '%~f0') -join [Environment]::NewLine)"
echo.
pause
exit /b
#>

# Removes every Browserput launch flag from every Brave shortcut on this PC,
# removes the old banner policy, and restarts Brave without the flags.

$patterns = @('--allowlisted-extension-id=\S*', '--test-type')
$shell = New-Object -ComObject WScript.Shell

Write-Host ''
Write-Host '  Browserput - remove launch flags' -ForegroundColor Cyan
Write-Host '  Searching all shortcuts. This can take a minute...'
Write-Host ''

$roots = @(
  $env:USERPROFILE,
  $env:PUBLIC,
  (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

$files = foreach ($root in $roots) {
  Get-ChildItem -LiteralPath $root -Filter *.lnk -Recurse -Force -ErrorAction SilentlyContinue
}

$fixed = 0; $denied = @()
foreach ($file in $files) {
  try { $lnk = $shell.CreateShortcut($file.FullName) } catch { continue }
  $current = $lnk.Arguments
  if (-not $current) { continue }
  $cleaned = $current
  foreach ($p in $patterns) { $cleaned = $cleaned -replace $p, '' }
  $cleaned = ($cleaned -replace '\s{2,}', ' ').Trim()
  if ($cleaned -eq $current) { continue }
  $lnk.Arguments = $cleaned
  try {
    $lnk.Save()
    $fixed++
    Write-Host "  Cleaned: $($file.FullName)" -ForegroundColor Green
  } catch {
    $denied += $file.FullName
  }
}

if ($denied.Count -gt 0) {
  Write-Host ''
  Write-Host '  These shortcuts need administrator rights. Windows will ask for permission:' -ForegroundColor Yellow
  $denied | ForEach-Object { Write-Host "    $_" }
  $list = ($denied | ForEach-Object { "'" + ($_ -replace "'", "''") + "'" }) -join ','
  $elevated = @"
`$shell = New-Object -ComObject WScript.Shell
foreach (`$path in @($list)) {
  `$lnk = `$shell.CreateShortcut(`$path)
  `$a = `$lnk.Arguments -replace '--allowlisted-extension-id=\S*', '' -replace '--test-type', ''
  `$lnk.Arguments = (`$a -replace '\s{2,}', ' ').Trim()
  `$lnk.Save()
}
"@
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($elevated))
  try {
    Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded
    $fixed += $denied.Count
    Write-Host '  Cleaned those too.' -ForegroundColor Green
  } catch {
    Write-Host '  Permission was not given; those shortcuts still have the flag.' -ForegroundColor Yellow
  }
}

# Old banner policy from an earlier setup script.
$policyKey = 'HKCU:\Software\Policies\BraveSoftware\Brave'
if (Test-Path -LiteralPath $policyKey) {
  Remove-ItemProperty -LiteralPath $policyKey -Name 'CommandLineFlagSecurityWarningsEnabled' -ErrorAction SilentlyContinue
  if (-not (Get-Item -LiteralPath $policyKey).Property -and -not (Get-ChildItem -LiteralPath $policyKey)) {
    Remove-Item -LiteralPath $policyKey -ErrorAction SilentlyContinue
  }
}

Write-Host ''
if ($fixed -eq 0) {
  Write-Host '  No shortcuts had the flags any more.' -ForegroundColor Green
} else {
  Write-Host "  Removed the flags from $fixed shortcut(s)." -ForegroundColor Green
}

# A running Brave keeps the flags until it fully closes, and Windows may
# reopen it with the old flags after a restart. Close it and start it clean.
$brave = Join-Path ${env:ProgramFiles} 'BraveSoftware\Brave-Browser\Application\brave.exe'
if (-not (Test-Path -LiteralPath $brave)) { $brave = Join-Path $env:LOCALAPPDATA 'BraveSoftware\Brave-Browser\Application\brave.exe' }

Write-Host ''
$answer = Read-Host '  Close Brave now and reopen it without the flags? (Y/N)'
if ($answer.Trim() -match '^[Yy]') {
  Get-Process -Name brave -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() | Out-Null }
  Start-Sleep -Seconds 3
  Get-Process -Name brave -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  if (Test-Path -LiteralPath $brave) {
    Start-Process -FilePath $brave
    Write-Host '  Brave restarted without the flags. The banner should be gone.' -ForegroundColor Green
  } else {
    Write-Host '  Brave is closed. Open it from your desktop or taskbar.' -ForegroundColor Green
  }
} else {
  Write-Host '  Fully close Brave (Task Manager > Details > end every brave.exe) and reopen it.' -ForegroundColor Yellow
}
