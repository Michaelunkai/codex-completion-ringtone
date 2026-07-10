[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path -LiteralPath $node)) { $node = (Get-Command node -ErrorAction Stop).Source }

$sources = @('codex-finish-ringtone-notify.mjs','codex-final-stop-ringtone.mjs','ensure-finish-ringtone-wiring.mjs','hook-lib.mjs')
foreach ($source in $sources) {
  $path = Join-Path $root "src\\$source"
  if (-not (Test-Path -LiteralPath $path)) { throw "Missing source: $source" }
  & $node --check $path
  if ($LASTEXITCODE -ne 0) { throw "Node syntax check failed: $source" }
}

$final = Get-Content -LiteralPath (Join-Path $root 'src\codex-final-stop-ringtone.mjs') -Raw
$wrapper = Get-Content -LiteralPath (Join-Path $root 'src\codex-finish-ringtone-notify.mjs') -Raw
$wiring = Get-Content -LiteralPath (Join-Path $root 'src\ensure-finish-ringtone-wiring.mjs') -Raw
foreach ($required in @('fromNotifyTurnEnded || fromTaskComplete','process.env.CODEX_NTFY_TOPIC','process.env.CODEX_NTFY_FINISH_TOKEN','process.env.CODEX_HOME')) {
  if (-not $final.Contains($required)) { throw "Final hook lacks required behavior: $required" }
}
foreach ($required in @('process.execPath','process.env.CODEX_HOME')) {
  if (-not $wrapper.Contains($required)) { throw "Wrapper lacks required portability behavior: $required" }
}
foreach ($required in @('NOTIFY_WRAPPER_LINE','--previous-notify','unrelated-notify-owner-preserved','disableWatchdogTask','process.env.CODEX_HOME','process.env.CODEX_NODE_EXE','CODEX_RINGTONE_SKIP_TASK_CHANGES')) {
  if (-not $wiring.Contains($required)) { throw "Wiring guard lacks required behavior: $required" }
}
if (Select-String -Path (Join-Path $root 'src\*.mjs') -Pattern 'codex-final-only-|codex-phone-finish-|C:\\Users\\micha' -Quiet) {
  throw 'Private ntfy credential material detected in package source.'
}

Write-Host 'Package verification passed: syntax, trigger invariants, and credential scan.' -ForegroundColor Green
