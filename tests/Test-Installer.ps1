[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$tempRoot = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
$sandbox = Join-Path $tempRoot ("codex-completion-ringtone-test-" + [guid]::NewGuid().ToString('N'))
$codexHome = Join-Path $sandbox '.codex'
$audio = Join-Path $sandbox 'test.wav'
$node = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path -LiteralPath $node)) { $node = (Get-Command node -ErrorAction Stop).Source }

try {
  New-Item -ItemType Directory -Force -Path $codexHome | Out-Null
  Set-Content -LiteralPath (Join-Path $codexHome 'config.toml') -Value @(
    'model = "example"',
    'notify = [ "managed-wrapper.exe", "turn-ended", "--previous-notify", "[\"obsolete.exe\"]" ]'
  ) -Encoding UTF8
  Set-Content -LiteralPath $audio -Value 'test-only' -Encoding ASCII

  & (Join-Path $root 'scripts\Install-CodexCompletionRingtone.ps1') `
    -CodexHome $codexHome `
    -NodeExe $node `
    -AudioPath $audio `
    -SkipLegacyWatcherDisable

  $config = Get-Content -LiteralPath (Join-Path $codexHome 'config.toml') -Raw
  $notifyLines = @($config -split '\r?\n' | Where-Object { $_ -match '^\s*notify\s*=' })
  if ($notifyLines.Count -ne 1) { throw "Expected one notify line, found $($notifyLines.Count)." }
  if ($notifyLines[0] -notmatch 'codex-finish-ringtone-notify\.mjs.*turn-ended') {
    throw 'Installed notify line does not target the turn-ended wrapper.'
  }
  if ($notifyLines[0] -notmatch 'managed-wrapper\.exe.*--previous-notify') {
    throw 'Installer failed to preserve the existing managed outer notify wrapper.'
  }

  foreach ($name in @('hook-lib.mjs','codex-finish-ringtone-notify.mjs','codex-final-stop-ringtone.mjs','ensure-finish-ringtone-wiring.mjs')) {
    $installed = Join-Path $codexHome "hooks\$name"
    if (-not (Test-Path -LiteralPath $installed -PathType Leaf)) { throw "Installer omitted $name." }
    & $node --check $installed
    if ($LASTEXITCODE -ne 0) { throw "Installed syntax check failed: $name" }
  }

  $audioConfig = Get-Content -LiteralPath (Join-Path $codexHome 'hooks\completion-alert-state\ringtone-audio-path.txt') -Raw
  if ($audioConfig.Trim() -ne $audio) { throw 'Installer did not preserve the selected audio path.' }

  $backup = Get-ChildItem -LiteralPath (Join-Path $codexHome 'backups') -Directory |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $backup -or -not (Test-Path -LiteralPath (Join-Path $backup.FullName 'config.toml'))) {
    throw 'Installer did not create a restorable config backup.'
  }

  $refusalHome = Join-Path $sandbox 'refusal\.codex'
  New-Item -ItemType Directory -Force -Path $refusalHome | Out-Null
  $refusalConfig = Join-Path $refusalHome 'config.toml'
  $refusalText = "notify = [ `"unrelated-owner.exe`" ]"
  Set-Content -LiteralPath $refusalConfig -Value $refusalText -Encoding UTF8
  $refused = $false
  try {
    & (Join-Path $root 'scripts\Install-CodexCompletionRingtone.ps1') `
      -CodexHome $refusalHome `
      -NodeExe $node `
      -SkipLegacyWatcherDisable
  } catch {
    $refused = $_.Exception.Message -match 'unrelated notify command'
  }
  if (-not $refused) { throw 'Installer did not refuse an unrelated notify owner.' }
  if ((Get-Content -LiteralPath $refusalConfig -Raw).Trim() -ne $refusalText) {
    throw 'Refused installation changed the unrelated notify configuration.'
  }
  if (Test-Path -LiteralPath (Join-Path $refusalHome 'hooks\codex-final-stop-ringtone.mjs')) {
    throw 'Refused installation copied hook files before ownership validation.'
  }

  Write-Host 'Installer test passed in an isolated temporary Codex home.' -ForegroundColor Green
}
finally {
  $resolvedSandbox = [System.IO.Path]::GetFullPath($sandbox)
  $safePrefix = $tempRoot + 'codex-completion-ringtone-test-'
  if ((Test-Path -LiteralPath $resolvedSandbox) -and $resolvedSandbox.StartsWith($safePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    # ALLOW_DESTRUCTIVE: remove only this test's verified GUID-named directory under the resolved temp root.
    Remove-Item -LiteralPath $resolvedSandbox -Recurse -Force
  }
}
