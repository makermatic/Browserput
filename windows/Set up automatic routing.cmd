<# : Batch launcher; the PowerShell script starts after the closing comment marker.
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ((Get-Content -LiteralPath '%~f0') -join [Environment]::NewLine)"
echo.
pause
exit /b
#>

# Adds (or removes) the flags that let Browserput route saved sites without a
# click, on every Brave shortcut: desktop, Start menu and taskbar.

# The flag that allows automatic tab capture. --test-type was added by an
# earlier version of this script; it is removed again because it hid every
# startup message, not just the flag warning.
$flags = @('--allowlisted-extension-id=nkdalbdkkidbglmmihmdjcmbpliddhpg')
$oldFlags = @('--test-type')
$shell = New-Object -ComObject WScript.Shell

# Returns shortcut arguments with $remove taken out, then $add appended if enabling.
$editArgs = {
  param($current, $enable, $add, $remove)
  $result = $current
  foreach ($f in $remove) { $result = $result -replace ('(^|\s)' + [regex]::Escape($f) + '(?=\s|$)'), ' ' }
  $result = ($result -replace '\s{2,}', ' ').Trim()
  if ($enable) { $result = ($result + ' ' + ($add -join ' ')).Trim() }
  $result
}

# Brave policy that turns off only the "unsupported command-line flag" banner.
# Per-user, so no administrator rights needed.
$policyKey = 'HKCU:\Software\Policies\BraveSoftware\Brave'
$policyName = 'CommandLineFlagSecurityWarningsEnabled'

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
  $updated = & $editArgs $current $enable $flags ($flags + $oldFlags)
  if ($updated -eq $current) { $already++; continue }
  $lnk.Arguments = $updated
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
  Write-Host "  $($flags -join ' ')"
  return
}
$state = if ($enable) { 'ON' } else { 'OFF' }
Write-Host "  Automatic routing is now $state for $($changed + $already) Brave shortcut(s)." -ForegroundColor Green

try {
  if ($enable) {
    if (-not (Test-Path -LiteralPath $policyKey)) { New-Item -Path $policyKey -Force | Out-Null }
    New-ItemProperty -LiteralPath $policyKey -Name $policyName -PropertyType DWord -Value 0 -Force | Out-Null
    Write-Host '  Turned off the "unsupported command-line flag" banner.' -ForegroundColor Green
  } elseif (Test-Path -LiteralPath $policyKey) {
    Remove-ItemProperty -LiteralPath $policyKey -Name $policyName -ErrorAction SilentlyContinue
    Write-Host '  Restored the "unsupported command-line flag" banner setting.' -ForegroundColor Green
  }
} catch {
  Write-Host "  Couldn't change the banner setting: $($_.Exception.Message)" -ForegroundColor Yellow
}
if ($denied.Count -gt 0) {
  Write-Host ''
  Write-Host '  These shortcuts are shared by all users (the Start menu one is also what Windows search opens):' -ForegroundColor Yellow
  $denied | ForEach-Object { Write-Host "    $_" }
  $answer = Read-Host '  Update them too? Windows will ask for permission. (Y/N)'
  if ($answer.Trim() -match '^[Yy]') {
    # Re-run just the shortcut edit for these files with administrator rights.
    $list = ($denied | ForEach-Object { "'" + ($_ -replace "'", "''") + "'" }) -join ','
    $mode = if ($enable) { '$true' } else { '$false' }
    $addList = '@(' + (($flags | ForEach-Object { "'$_'" }) -join ',') + ')'
    $removeList = '@(' + ((($flags + $oldFlags) | ForEach-Object { "'$_'" }) -join ',') + ')'
    $elevated = @"
`$enable = $mode; `$shell = New-Object -ComObject WScript.Shell
`$editArgs = {$($editArgs.ToString())}
foreach (`$path in @($list)) {
  `$lnk = `$shell.CreateShortcut(`$path)
  `$lnk.Arguments = & `$editArgs `$lnk.Arguments `$enable $addList $removeList
  `$lnk.Save()
}
"@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($elevated))
    try {
      $proc = Start-Process powershell -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded
      if ($proc.ExitCode -eq 0) {
        Write-Host '  Updated the shared shortcuts too.' -ForegroundColor Green
      } else {
        Write-Host '  Could not update the shared shortcuts.' -ForegroundColor Yellow
      }
    } catch {
      Write-Host '  Permission was not given, so the shared shortcuts were left as they were.' -ForegroundColor Yellow
    }
  }
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
