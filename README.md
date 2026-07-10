# Codex completion ringtone (Windows)

This is a preserve-first, portable implementation of a local ringtone that starts **only when Codex reports `turn-ended`**. It contains hook sources, a backup-first installer, isolated verification, production checks, and continuation documentation.

The repository is separate from the live `%USERPROFILE%\.codex` installation. Building and testing it does not overwrite a working Codex configuration.

## Trigger path

```text
Codex finishes a turn
  -> config.toml `notify` receives `turn-ended`
  -> codex-finish-ringtone-notify.mjs (detached, stable Node executable)
  -> codex-final-stop-ringtone.mjs
  -> local PowerShell player starts immediately (3 seconds)
```

The direct local player is the primary behavior. Android and ntfy notifications are secondary and cannot suppress local playback. The final hook deduplicates repeated events for 60 seconds.

## Contents and boundaries

| Path | Purpose | Copy to a live system? |
| --- | --- | --- |
| `src/codex-finish-ringtone-notify.mjs` | Stable notify wrapper | Yes, after backup and path review |
| `src/codex-final-stop-ringtone.mjs` | Completion gate and player | Yes, after backup and path review |
| `src/ensure-finish-ringtone-wiring.mjs` | Optional repair guard | Yes, only when its paths match your installation |
| `src/hook-lib.mjs` | JSON stdin helper required by final hook | Yes |
| `scripts/Install-CodexCompletionRingtone.ps1` | Backup-first installer with `-WhatIf` | Run from this repository |
| `tests/verify-package.ps1` | Static package checks; no sound | Run before deployment |
| `tests/Test-Installer.ps1` | Isolated temporary-home installer test | Run before deployment |
| `tests/Test-ProductionRingtone.ps1` | Read-only production wiring check | Run after deployment |
| `docs/` | Architecture, installation, operations, implementation, and continuation guides | Read before changing behavior |

No audio file, local audio-path file, runtime state, ntfy topic, or ntfy token is published. The reference source intentionally obtains optional ntfy settings from environment variables.

## Requirements

- Windows with Windows PowerShell 5.1.
- Node.js at `C:\Program Files\nodejs\node.exe` (or adapt all documented paths consistently).
- Write access to `%USERPROFILE%\.codex`.
- A WAV ringtone. `System.Media.SoundPlayer` reliably plays WAV; an unavailable audio file falls back to an audible Windows beep melody.

## Quick start

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\verify-package.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\Test-Installer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\Test-WiringGuard.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-CodexCompletionRingtone.ps1 `
  -AudioPath 'C:\absolute\path\to\ringtone.wav' `
  -WhatIf
```

After reviewing the preview, rerun the installer without `-WhatIf`, restart Codex, and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\Test-ProductionRingtone.ps1
```

See [`docs/INSTALLATION.md`](docs/INSTALLATION.md) for every option, backup behavior, manual installation, path overrides, and rollback.

## Manual installation procedure

1. Back up the live files before touching them:

```powershell
$backup = Join-Path $env:USERPROFILE (".codex\\backups\\completion-ringtone-" + (Get-Date -Format yyyyMMdd-HHmmss))
New-Item -ItemType Directory -Force $backup | Out-Null
Copy-Item "$env:USERPROFILE\.codex\config.toml", "$env:USERPROFILE\.codex\hooks.json" $backup
Copy-Item "$env:USERPROFILE\.codex\hooks\codex-finish-ringtone-notify.mjs", "$env:USERPROFILE\.codex\hooks\codex-final-stop-ringtone.mjs", "$env:USERPROFILE\.codex\hooks\hook-lib.mjs" $backup -ErrorAction SilentlyContinue
```

2. Copy the four `src/*.mjs` files into `%USERPROFILE%\.codex\hooks\`. Do not copy this repository's `.git`, test output, or ignored files.

3. Put a WAV somewhere private, for example `%USERPROFILE%\.codex\sounds\your-ringtone.wav`. The current code chooses `%USERPROFILE%\.codex\du_bist_gut_genug_zedge.wav` first, then `%USERPROFILE%\.codex\sounds\du_bist_gut_genug_zedge.wav`, then `%USERPROFILE%\.codex\hooks\completion-alert-state\ringtone-audio-path.txt`. To use the configurable third option, create that text file with one absolute WAV path. Keep audio private and out of Git.

4. Set the exact stable notification line in `%USERPROFILE%\.codex\config.toml` (replace an existing `notify = ...` line; do not add a second one):

```toml
notify = [ "C:\\Program Files\\nodejs\\node.exe", "C:\\Users\\YOUR_USER\\.codex\\hooks\\codex-finish-ringtone-notify.mjs", "turn-ended" ]
```

For the original account, `YOUR_USER` is `micha`. The use of the system Node executable is intentional: it avoids obsolete, version-specific Codex/computer-use runtime paths.

5. Disable the legacy delayed watcher so it cannot create early or duplicate sound:

```powershell
schtasks /Change /TN "CodexTranscriptFinishRingtoneWatcher" /Disable
```

6. Optional phone push: define private user environment variables `CODEX_NTFY_TOPIC` and `CODEX_NTFY_FINISH_TOKEN`, then restart Codex. Without both, phone publishing is skipped; local sound continues normally.

7. Restart Codex, then run the checks below.

## Verification

From this project directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\verify-package.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\Test-Installer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\Test-WiringGuard.ps1
```

On the target machine after installation:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\Test-ProductionRingtone.ps1
```

To exercise the actual local player deliberately, this sends a synthetic completion payload. It starts sound and writes logs; use it only when you are ready to hear it.

```powershell
'{"turn_id":"manual-ringtone-test"}' | & 'C:\Program Files\nodejs\node.exe' "$env:USERPROFILE\.codex\hooks\codex-final-stop-ringtone.mjs" --from-notify turn-ended
```

Check `completion-alert-state\final-stop-ringtone.jsonl` for `local_player_started` and `ringtone_dispatched`, and `ringtone-playback.jsonl` for `playback_complete`. The wrapper log should contain `ringtone-dispatched-notify-turn-ended` after a normal completed turn.

## Troubleshooting and continuation

- **No sound:** confirm the exact `notify` line has `turn-ended`, the system Node path exists, then inspect the two logs above. `local_player_started` with `played:false` means the WAV was unavailable and fallback should have run.
- **Sound before completion or twice:** inspect `hooks.json` for old commands containing `start-codex-transcript-finish-ringtone-watcher.mjs` or `codex-final-stop-ringtone.mjs`; remove/disable those old hook entries only after backup. Confirm the scheduled watcher is disabled.
- **Runtime missing:** the wrapper must invoke `process.execPath`, and config must invoke `C:\Program Files\nodejs\node.exe`; never point either at a versioned package cache/runtime directory.
- **Audio differs from expected:** the first existing path wins. Remove or rename an unintended default WAV, or update the state-file path. Keep `PLAYBACK_DURATION_MS` at `3000` unless deliberately changing the established setting.
- **Phone push fails:** this is non-blocking. Its log status does not prove or disprove local audio. Verify environment variables separately.

For a future change, copy the production files to a timestamped backup, reproduce the bug using the synthetic command, modify only the copied/reference source, run both test scripts, then apply the smallest matching production edit. Preserve the `turn-ended` gate and the disabled legacy watcher unless deliberately redesigning completion semantics.

## Documentation map

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): event flow, deduplication, audio selection, optional channels, and invariants.
- [`docs/INSTALLATION.md`](docs/INSTALLATION.md): automated/manual setup, backups, rollback, and validation.
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md): logs, health checks, tests, and failure diagnosis.
- [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md): from-scratch guide for another developer.
- [`docs/CONTINUATION.md`](docs/CONTINUATION.md): exact repository/live-system boundary and future-session checklist.

## License

MIT. See [`LICENSE`](LICENSE).

## Current evidence

The captured implementation was checked by invoking the final hook with a synthetic `turn-ended` completion payload. It logged local player start using the configured direct WAV, Android primary completion, player process completion, and ringtone dispatch. An ntfy request timed out in that run; it is optional and did not prevent the local player. A separate `ensure-finish-ringtone-wiring.mjs` check reported the stable notify wiring present and the legacy watcher disabled.
