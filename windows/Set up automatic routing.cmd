<# : Batch launcher; the PowerShell script starts after the closing comment marker.
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ((Get-Content -LiteralPath '%~f0') -join [Environment]::NewLine)"
echo.
pause
exit /b
#>

# Adds (or removes) the flag that lets Browserput route saved sites without a
# click, on every Brave shortcut: desktop, Start menu and taskbar.

$flag = '--allowlisted-extension-id=nkdalbdkkidbglmmihmdjcmbpliddhpg'
$shell = New-Object -ComObject WScript.Shell

Write-Host ''
Write-Host '  Browserput - automatic routing setup' -ForegroundColor Cyan
Write-Host ''
Write-Host '  1 = Turn ON automatic routing'
Write-Host '  2 = Turn OFF (undo)'
Write-Host ''
$choice = Read-Host '  Type 1 or 2 and press Enter'
$enable = $choice.Trim() -ne '2'

# Shortcuts directly on the desktops, plus everything under the Start menu and taskbar folders.
$shallow = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory'))
$deep = @(
  [Environment]::GetFolderPath('StartMenu'),
  [Environment]::GetFolderPath('CommonStartMenu'),
  (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch')
)
$files = @()
foreach ($dir in $shallow) { if ($dir -and (Test-Path -LiteralPath $dir)) { $files += Get-ChildItem -LiteralPath $dir -Filter *.lnk -ErrorAction SilentlyContinue } }
foreach ($dir in $deep) { if ($dir -and (Test-Path -LiteralPath $dir)) { $files += Get-ChildItem -LiteralPath $dir -Filter *.lnk -Recurse -ErrorAction SilentlyContinue } }

$changed = 0; $already = 0; $found = 0; $denied = @()
foreach ($file in $files) {
  try { $lnk = $shell.CreateShortcut($file.FullName) } catch { continue }
  if ($lnk.TargetPath -notlike '*\brave.exe') { continue }
  $found++
  $current = $lnk.Arguments
  $has = $current -like "*$flag*"
  if ($enable -eq $has) { $already++; continue }
  if ($enable) {
    $lnk.Arguments = ("$current $flag").Trim()
  } else {
    $lnk.Arguments = (($current -replace [regex]::Escape($flag), '') -replace '\s{2,}', ' ').Trim()
  }
  try {
    $lnk.Save()
    $changed++
    Write-Host "  Updated: $($file.FullName)" -ForegroundColor Green
  } catch {
    $denied += $file.FullName
  }
}

Write-Host ''
if ($found -eq 0) {
  Write-Host '  No Brave shortcuts were found.' -ForegroundColor Yellow
  Write-Host "  Add this to your Brave shortcut by hand (Properties > Target, after the closing quote):"
  Write-Host "  $flag"
  return
}
$state = if ($enable) { 'ON' } else { 'OFF' }
Write-Host "  Automatic routing is now $state for $($changed + $already) Brave shortcut(s)." -ForegroundColor Green
if ($denied.Count -gt 0) {
  Write-Host ''
  Write-Host '  These shortcuts belong to all users and need administrator rights:' -ForegroundColor Yellow
  $denied | ForEach-Object { Write-Host "    $_" }
  Write-Host '  Right-click this file and choose "Run as administrator" to update them too.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '  Last step: fully restart Brave.' -ForegroundColor Cyan
Write-Host '  - Close every Brave window, and if Brave has an icon near the clock, right-click it > Exit.'
Write-Host '  - Then open Brave from your desktop, Start menu or taskbar as usual.'
Write-Host '  - Tip: in brave://settings/system, turn off "Continue running background apps"'
Write-Host '    so Brave always fully restarts with the setting.'
if (Get-Process -Name brave -ErrorAction SilentlyContinue) {
  Write-Host ''
  Write-Host '  Brave is running right now, so the change applies after that restart.' -ForegroundColor Yellow
}
