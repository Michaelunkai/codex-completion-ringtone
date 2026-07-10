# Installation and rollback

## Prerequisites

- Windows 10 or 11.
- Codex under `%USERPROFILE%\.codex`, or a directory supplied with `-CodexHome`.
- Windows PowerShell 5.1.
- Node.js; default: `C:\Program Files\nodejs\node.exe`.
- An optional WAV file. The fallback beep works without one.

## Validate the package

```powershell
git clone https://github.com/Michaelunkai/codex-completion-ringtone.git
Set-Location .\codex-completion-ringtone
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\verify-package.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\Test-Installer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\Test-WiringGuard.ps1
```

These checks do not modify the live Codex home or play audio.

## What the installer does

`scripts\Install-CodexCompletionRingtone.ps1`:

1. validates Node, `config.toml`, packaged sources, and the optional WAV;
2. syntax-checks every JavaScript module;
3. creates `%CODEX_HOME%\backups\completion-ringtone-YYYYMMDD-HHMMSS`;
4. backs up config, `hooks.json` when present, and existing ringtone modules;
5. copies the four modules into `%CODEX_HOME%\hooks`;
6. writes the optional private audio path;
7. installs one stable `turn-ended` command directly, or updates only `--previous-notify` when a managed wrapper owns the outer command;
8. disables `CodexTranscriptFinishRingtoneWatcher` when present;
9. reports installed paths and the restart requirement.

It does not install Node, alter unrelated hook entries, publish credentials, or delete backups.

If one unrelated notify owner exists and does not expose `--previous-notify`, the installer refuses before copying anything. `-ForceReplaceNotify` exists for an intentional replacement, but should not be used merely to bypass that ownership check.

## Preview and install

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-CodexCompletionRingtone.ps1 `
  -AudioPath 'C:\Media\completion.wav' `
  -WhatIf
```

After reviewing the preview:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-CodexCompletionRingtone.ps1 `
  -AudioPath 'C:\Media\completion.wav'
```

Restart Codex, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\Test-ProductionRingtone.ps1
```

## Non-default paths

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-CodexCompletionRingtone.ps1 `
  -CodexHome 'D:\Profiles\me\.codex' `
  -NodeExe 'D:\Tools\nodejs\node.exe' `
  -AudioPath 'D:\Audio\completion.wav'
```

Set matching user environment variables before launching Codex:

```powershell
[Environment]::SetEnvironmentVariable('CODEX_HOME', 'D:\Profiles\me\.codex', 'User')
[Environment]::SetEnvironmentVariable('CODEX_NODE_EXE', 'D:\Tools\nodejs\node.exe', 'User')
```

## Optional ntfy

Store values in the user environment, never source:

```powershell
[Environment]::SetEnvironmentVariable('CODEX_NTFY_TOPIC', 'your-private-topic', 'User')
[Environment]::SetEnvironmentVariable('CODEX_NTFY_FINISH_TOKEN', 'your-private-token', 'User')
```

Restart Codex. Omit either value to disable ntfy.

## Manual installation

1. Back up `config.toml`, `hooks.json`, and existing ringtone modules.
2. Copy all four `src\*.mjs` files to `%USERPROFILE%\.codex\hooks`.
3. Add one top-level line:

```toml
notify = [ "C:\\Program Files\\nodejs\\node.exe", "C:\\Users\\YOUR_USER\\.codex\\hooks\\codex-finish-ringtone-notify.mjs", "turn-ended" ]
```

4. Optionally write one absolute WAV path to `hooks\completion-alert-state\ringtone-audio-path.txt`.
5. Disable the old watcher:

```powershell
schtasks /Change /TN "CodexTranscriptFinishRingtoneWatcher" /Disable
```

6. Restart Codex and run the production test.

## Rollback

Stop Codex. Select and inspect the newest backup:

```powershell
$codexHome = Join-Path $env:USERPROFILE '.codex'
$backup = Get-ChildItem (Join-Path $codexHome 'backups') -Directory |
  Where-Object Name -Like 'completion-ringtone-*' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
$backup.FullName
```

Restore only files present in that backup:

```powershell
Copy-Item (Join-Path $backup.FullName 'config.toml') (Join-Path $codexHome 'config.toml') -Force
if (Test-Path (Join-Path $backup.FullName 'hooks.json')) {
  Copy-Item (Join-Path $backup.FullName 'hooks.json') (Join-Path $codexHome 'hooks.json') -Force
}
Get-ChildItem $backup.FullName -Filter '*.mjs' | ForEach-Object {
  Copy-Item $_.FullName (Join-Path $codexHome "hooks\$($_.Name)") -Force
}
```

Restart Codex and rerun the production check.
