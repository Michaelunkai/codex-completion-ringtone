# Operations and troubleshooting

## Read-only health check

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\Test-ProductionRingtone.ps1
```

It verifies stable Node, exact notify wiring, deployed module syntax, and that the legacy watcher is not enabled. It changes no file and plays no audio.

## Deliberate end-to-end test

```powershell
'{"turn_id":"manual-ringtone-test-001"}' |
  & 'C:\Program Files\nodejs\node.exe' `
  "$env:USERPROFILE\.codex\hooks\codex-final-stop-ringtone.mjs" `
  --from-notify turn-ended --force
```

Expected:

1. sound starts;
2. `final-stop-ringtone.jsonl` records `local_player_started`;
3. `ringtone-playback.jsonl` records start and completion;
4. the final log records `player_process_finished` and `ringtone_dispatched`.

Use `--force` only for deliberate testing.

## Runtime files

All generated state is under `%USERPROFILE%\.codex\hooks\completion-alert-state`.

| File | Purpose |
| --- | --- |
| `finish-notify-wrapper.jsonl` | wrapper accepted, skipped, or failed dispatch |
| `final-stop-ringtone.jsonl` | completion gate, player, Android, ntfy, and final result |
| `ringtone-playback.jsonl` | local audio start, completion, or failure |
| `final-stop-ringtone-dedupe.json` | recent dedupe keys |
| `ringtone-audio-path.txt` | private absolute WAV path |
| `Play-CodexCompletionRingtone.ps1` | generated local player |
| `finish-ringtone-wiring-guard.jsonl` | optional repair-guard results |

## Diagnosis

### No wrapper log

- Restart Codex after editing `config.toml`.
- Confirm exactly one top-level `notify =` line.
- Confirm stable Node and deployed wrapper paths.
- Run `node --check` against the deployed wrapper.

### Wrapper reports `ringtone-skipped`

It did not receive `turn-ended`, or the final hook is missing. Verify the third notify argument and deployed file.

### Final hook reports `ignored_non_completion_source`

An obsolete Stop, SessionEnd, or transcript watcher invoked it. Keep the gate strict; remove the obsolete invocation only after backup.

### Final hook reports `duplicate_suppressed`

This applies only to optional non-notify fallback sources. `notify ... turn-ended` is never deduped: it is the sole enabled canonical completion source and must play once for every completed turn.

### Android reports a pinned device is not connected

The Android ringtone selector is deliberately kept at `%USERPROFILE%\.codex\hooks\Play-CodexAndroidCompletionRingtone.ps1`, outside `completion-alert-state`. Its companion file `%USERPROFILE%\.codex\hooks\android-ringtone-device-id.txt` contains the physical phone serial reported by `getprop ro.serialno`.

Wireless ADB mDNS transport names can contain spaces and may appear more than once for one physical phone. The selector must:

1. enumerate `adb devices`;
2. query each candidate with `adb -s <candidate> shell getprop ro.serialno`;
3. select a candidate matching the pinned physical serial; and
4. use `adb -s <selected candidate>` for every subsequent command.

Never call bare `adb shell` from the ringtone path. That fails with `more than one device/emulator` when duplicate wireless transports exist. Restore the connection with `aadb connect`, then run the deliberate test above.

### `local_player_started` but no sound

Read `ringtone-playback.jsonl`.

- `played:true`: check Windows output device and mixer routing.
- `played:false`: the WAV was unavailable and fallback ran.
- `playback_failed`: inspect the exception and test the WAV with `System.Media.SoundPlayer`.

### Sound is early or duplicated

- Verify `CodexTranscriptFinishRingtoneWatcher` is disabled.
- Search `hooks.json` for `start-codex-transcript-finish-ringtone-watcher.mjs`.
- Search for direct `codex-final-stop-ringtone.mjs --from-stop`.
- Keep only the stable notify path unless deliberately redesigning triggers.

### Runtime path fails after an update

Never use versioned WindowsApps, Codex package, computer-use package, plugin-cache, or temporary runtime paths. Keep notify on a stable Node installation; the wrapper uses `process.execPath`.

### ntfy fails

Verify its two environment variables and network access independently. ntfy failure does not mean local playback failed.

## Safe maintenance sequence

1. Run the production read-only check.
2. Back up live hook files and configuration.
3. Reproduce with a unique synthetic turn ID.
4. Change repository source, not live files.
5. Run all package tests.
6. Preview installation with `-WhatIf`.
7. Compare deployed impact, especially shared helpers.
8. Install, restart Codex, and rerun production verification.
9. Run one deliberate sound test.
10. Commit only sanitized repository files.
