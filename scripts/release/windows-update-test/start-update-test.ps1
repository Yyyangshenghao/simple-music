$ErrorActionPreference = 'Stop'
try {
  $key = 'Software\471bdb5e-fa80-570a-baed-3340b3ce08c1'
  $folders = @()
  foreach ($hive in @('HKCU:', 'HKLM:')) {
    $entry = Get-ItemProperty -LiteralPath "$hive\$key" -ErrorAction SilentlyContinue
    if ($entry -and $entry.InstallLocation) { $folders += $entry.InstallLocation }
  }
  $folders = @($folders | Select-Object -Unique)
  if ($folders.Count -ne 1) { throw 'Install the ORIGINAL 2.6.2 Setup first. Exactly one registered installation is required.' }
  $exe = Join-Path $folders[0] 'Simple Music.exe'
  if (!(Test-Path -LiteralPath $exe)) { throw "Missing application: $exe" }
  $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($exe).ProductVersion
  if ($version -notmatch '^2\.6\.2(?:\D|$)') { throw "Expected 2.6.2 before the test, found $version. Restore your VM snapshot first." }
  $running = @(Get-Process -Name 'Simple Music' -ErrorAction SilentlyContinue)
  if ($running.Count) { throw 'Exit Simple Music completely, including the tray, then retry. No process was stopped.' }
  $health = $null
  try { $health = (Invoke-WebRequest 'http://127.0.0.1:38927/health' -UseBasicParsing -TimeoutSec 2).Content } catch {}
  if ($health -and $health -ne 'simple-music-update-test-v1') { throw 'Port 38927 belongs to another service.' }
  if (!$health) {
    $server = Join-Path $PSScriptRoot 'serve.ps1'
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $server + '"'))
    for ($i = 0; $i -lt 30; $i++) {
      Start-Sleep -Milliseconds 200
      try { $health = (Invoke-WebRequest 'http://127.0.0.1:38927/health' -UseBasicParsing -TimeoutSec 1).Content; break } catch {}
    }
    if ($health -ne 'simple-music-update-test-v1') { throw 'Could not start the local update source.' }
  }
  $localManifest = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'update-manifest.json') | ConvertFrom-Json
  $servedManifest = Invoke-RestMethod 'http://127.0.0.1:38927/update.json' -TimeoutSec 3
  if ($servedManifest.release.asset.sha256 -ne $localManifest.release.asset.sha256) { throw 'Another test kit is already serving updates. Stop it first.' }
  $env:SIMPLEMUSIC_VERSION = $null
  # A non-URL override disables mirror expansion, including in the original 2.6.2 updater.
  $env:SIMPLEMUSIC_UPDATE_MIRRORS = 'disabled-local-test'
  $env:SIMPLEMUSIC_UPDATE_MANIFEST = 'http://127.0.0.1:38927/update.json'
  # Process-scoped only: no permanent environment changes, no fake version override.
  Start-Process -FilePath $exe
  Write-Output '2.6.2 started with the local update source. Check for updates inside the app.'
  Write-Output 'Expected result: download 2.7.0 TEST, restart, then verify version 2.7.0.'
} catch {
  Write-Error $_ -ErrorAction Continue
  Read-Host 'Press Enter to close'
  exit 1
}
