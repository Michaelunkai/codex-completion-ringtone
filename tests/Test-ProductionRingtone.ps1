[CmdletBinding()]
param([string]$CodexHome = (Join-Path $env:USERPROFILE '.codex'))

$ErrorActionPreference = 'Stop'
$node = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path -LiteralPath $node)) { throw "Stable Node executable missing: $node" }
$config = Join-Path $CodexHome 'config.toml'
$wrapper = Join-Path $CodexHome 'hooks\codex-finish-ringtone-notify.mjs'
$final = Join-Path $CodexHome 'hooks\codex-final-stop-ringtone.mjs'
foreach ($path in @($config, $wrapper, $final)) { if (-not (Test-Path -LiteralPath $path)) { throw "Missing production path: $path" } }

$expected = 'codex-finish-ringtone-notify.mjs", "turn-ended" ]'
if (-not (Select-String -LiteralPath $config -Pattern ([regex]::Escape($expected)) -Quiet)) { throw 'config.toml is not wired to notify turn-ended.' }
& $node --check $wrapper; if ($LASTEXITCODE -ne 0) { throw 'Wrapper syntax check failed.' }
& $node --check $final; if ($LASTEXITCODE -ne 0) { throw 'Final hook syntax check failed.' }
$task = schtasks /Query /TN 'CodexTranscriptFinishRingtoneWatcher' /FO LIST 2>$null
if ($LASTEXITCODE -eq 0 -and ($task -match 'Status:\s+Ready|Status:\s+Running')) { throw 'Legacy watcher is enabled.' }
Write-Host 'Production wiring check passed; no audio was played and no file was changed.' -ForegroundColor Green
