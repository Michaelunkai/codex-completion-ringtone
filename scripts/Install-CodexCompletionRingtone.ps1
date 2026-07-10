[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$CodexHome = (Join-Path $env:USERPROFILE '.codex'),
  [string]$NodeExe = 'C:\Program Files\nodejs\node.exe',
  [string]$AudioPath = '',
  [switch]$SkipLegacyWatcherDisable,
  [switch]$ForceReplaceNotify
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceDir = Join-Path $projectRoot 'src'
$hooksDir = Join-Path $CodexHome 'hooks'
$stateDir = Join-Path $hooksDir 'completion-alert-state'
$configPath = Join-Path $CodexHome 'config.toml'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$backupDir = Join-Path $CodexHome "backups\completion-ringtone-$timestamp"
$hookFiles = @(
  'hook-lib.mjs',
  'codex-finish-ringtone-notify.mjs',
  'codex-final-stop-ringtone.mjs',
  'ensure-finish-ringtone-wiring.mjs'
)

function ConvertTo-TomlBasicString {
  param([Parameter(Mandatory)][string]$Value)
  return $Value.Replace('\', '\\').Replace('"', '\"')
}

if (-not (Test-Path -LiteralPath $NodeExe -PathType Leaf)) {
  throw "Stable Node executable not found: $NodeExe"
}
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
  throw "Codex config not found: $configPath"
}
foreach ($name in $hookFiles) {
  $source = Join-Path $sourceDir $name
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Package source missing: $source"
  }
  & $NodeExe --check $source
  if ($LASTEXITCODE -ne 0) {
    throw "Node syntax check failed: $source"
  }
}
if ($AudioPath -and -not (Test-Path -LiteralPath $AudioPath -PathType Leaf)) {
  throw "Audio file not found: $AudioPath"
}

$wrapperPath = Join-Path $hooksDir 'codex-finish-ringtone-notify.mjs'
$directNotifyLine = 'notify = [ "{0}", "{1}", "turn-ended" ]' -f (
  ConvertTo-TomlBasicString $NodeExe
), (
  ConvertTo-TomlBasicString $wrapperPath
)
$configText = Get-Content -LiteralPath $configPath -Raw
$notifyMatches = [regex]::Matches($configText, '(?m)^\s*notify\s*=.*$')
if ($notifyMatches.Count -gt 1) {
  throw "Multiple top-level notify lines found in $configPath. Resolve them before installation."
}

$notifyMode = 'direct'
$notifyLine = $directNotifyLine
if ($notifyMatches.Count -eq 1) {
  $existingNotify = $notifyMatches[0].Value
  if ($existingNotify -match '"--previous-notify"\s*,\s*"(?:\\.|[^"])*"') {
    $previousNotifyJson = ConvertTo-Json @($NodeExe, $wrapperPath, 'turn-ended') -Compress
    $encodedPreviousNotify = ConvertTo-TomlBasicString $previousNotifyJson
    $notifyLine = [regex]::Replace(
      $existingNotify,
      '"--previous-notify"\s*,\s*"(?:\\.|[^"])*"',
      '"--previous-notify", "' + $encodedPreviousNotify + '"',
      1
    )
    $notifyMode = 'preserved-outer-wrapper'
  } elseif ($existingNotify -match 'codex-finish-ringtone-notify\.mjs') {
    $notifyLine = $directNotifyLine
  } elseif (-not $ForceReplaceNotify) {
    throw "An unrelated notify command already owns $configPath. Re-run with -ForceReplaceNotify only if replacing it is intentional."
  } else {
    $notifyMode = 'forced-replacement'
  }
}

$newConfig = if ($notifyMatches.Count -eq 1) {
  $configText.Remove($notifyMatches[0].Index, $notifyMatches[0].Length).Insert($notifyMatches[0].Index, $notifyLine)
} else {
  $notifyLine + [Environment]::NewLine + $configText.TrimStart("`r", "`n")
}

if ($PSCmdlet.ShouldProcess($CodexHome, "Back up current Codex ringtone configuration to $backupDir")) {
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  Copy-Item -LiteralPath $configPath -Destination $backupDir
  $hooksJson = Join-Path $CodexHome 'hooks.json'
  if (Test-Path -LiteralPath $hooksJson) {
    Copy-Item -LiteralPath $hooksJson -Destination $backupDir
  }
  foreach ($name in $hookFiles) {
    $existing = Join-Path $hooksDir $name
    if (Test-Path -LiteralPath $existing) {
      Copy-Item -LiteralPath $existing -Destination $backupDir
    }
  }
}

if ($PSCmdlet.ShouldProcess($hooksDir, 'Install completion-ringtone hook files')) {
  New-Item -ItemType Directory -Force -Path $hooksDir, $stateDir | Out-Null
  foreach ($name in $hookFiles) {
    Copy-Item -LiteralPath (Join-Path $sourceDir $name) -Destination (Join-Path $hooksDir $name) -Force
  }
}

if ($AudioPath -and $PSCmdlet.ShouldProcess($stateDir, "Configure ringtone audio path $AudioPath")) {
  [System.IO.File]::WriteAllText(
    (Join-Path $stateDir 'ringtone-audio-path.txt'),
    $AudioPath + [Environment]::NewLine,
    (New-Object System.Text.UTF8Encoding($false))
  )
}

if ($PSCmdlet.ShouldProcess($configPath, 'Set one stable turn-ended notify command')) {
  [System.IO.File]::WriteAllText(
    $configPath,
    $newConfig,
    (New-Object System.Text.UTF8Encoding($false))
  )
}

$watcherResult = 'skipped'
if (-not $SkipLegacyWatcherDisable) {
  & schtasks.exe /Query /TN 'CodexTranscriptFinishRingtoneWatcher' *> $null
  if ($LASTEXITCODE -eq 0) {
    if ($PSCmdlet.ShouldProcess('CodexTranscriptFinishRingtoneWatcher', 'Disable legacy duplicate ringtone watcher')) {
      & schtasks.exe /Change /TN 'CodexTranscriptFinishRingtoneWatcher' /Disable | Out-Null
      if ($LASTEXITCODE -ne 0) {
        throw 'Failed to disable CodexTranscriptFinishRingtoneWatcher.'
      }
      $watcherResult = 'disabled'
    }
  } else {
    $watcherResult = 'not-present'
  }
}

[pscustomobject]@{
  CodexHome = $CodexHome
  BackupDir = $backupDir
  NotifyLine = $notifyLine
  NotifyMode = $notifyMode
  AudioConfigured = [bool]$AudioPath
  LegacyWatcher = $watcherResult
  RestartRequired = $true
}
