[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$tempRoot = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
$sandbox = Join-Path $tempRoot ("codex-ringtone-guard-test-" + [guid]::NewGuid().ToString('N'))
$hooks = Join-Path $sandbox 'hooks'
$node = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path -LiteralPath $node)) { $node = (Get-Command node -ErrorAction Stop).Source }

try {
  New-Item -ItemType Directory -Force -Path $hooks | Out-Null
  Set-Content -LiteralPath (Join-Path $sandbox 'config.toml') -Value `
    'notify = [ "managed-wrapper.exe", "turn-ended", "--previous-notify", "[\"obsolete.exe\"]" ]' -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $sandbox 'hooks.json') -Value '{"hooks":{}}' -Encoding UTF8
  Copy-Item -LiteralPath (Join-Path $root 'src\ensure-finish-ringtone-wiring.mjs') -Destination $hooks

  $oldHome = $env:CODEX_HOME
  $oldNode = $env:CODEX_NODE_EXE
  $oldSkip = $env:CODEX_RINGTONE_SKIP_TASK_CHANGES
  $env:CODEX_HOME = $sandbox
  $env:CODEX_NODE_EXE = $node
  $env:CODEX_RINGTONE_SKIP_TASK_CHANGES = '1'
  try {
    & $node (Join-Path $hooks 'ensure-finish-ringtone-wiring.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Wiring guard exited unsuccessfully.' }
  }
  finally {
    $env:CODEX_HOME = $oldHome
    $env:CODEX_NODE_EXE = $oldNode
    $env:CODEX_RINGTONE_SKIP_TASK_CHANGES = $oldSkip
  }

  $line = (Select-String -LiteralPath (Join-Path $sandbox 'config.toml') -Pattern '^\s*notify\s*=').Line
  foreach ($required in @('managed-wrapper.exe','--previous-notify','nodejs','codex-finish-ringtone-notify.mjs','turn-ended')) {
    if ($line -notmatch [regex]::Escape($required)) { throw "Wiring guard lost required component: $required" }
  }
  $log = Get-Content -LiteralPath (Join-Path $hooks 'completion-alert-state\finish-ringtone-wiring-guard.jsonl') -Raw
  if ($log -notmatch '"configMode":"outer-wrapper-preserved"') {
    throw 'Wiring guard did not report preservation of the outer wrapper.'
  }
  if ($log -notmatch '"taskChangesSkipped":true') {
    throw 'Wiring guard test mode did not suppress scheduled-task mutation.'
  }

  Write-Host 'Wiring guard test passed in an isolated temporary Codex home.' -ForegroundColor Green
}
finally {
  $resolvedSandbox = [System.IO.Path]::GetFullPath($sandbox)
  $safePrefix = $tempRoot + 'codex-ringtone-guard-test-'
  if ((Test-Path -LiteralPath $resolvedSandbox) -and $resolvedSandbox.StartsWith($safePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    # ALLOW_DESTRUCTIVE: remove only this test's verified GUID-named directory under the resolved temp root.
    Remove-Item -LiteralPath $resolvedSandbox -Recurse -Force
  }
}
