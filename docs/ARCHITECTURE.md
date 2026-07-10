# Architecture

## Purpose

Play one local Windows ringtone when Codex emits the exact `turn-ended` notification. Local audio must remain independent of optional Android or ntfy delivery, avoid version-pinned Codex runtimes, and suppress duplicate completion events.

## Runtime flow

```text
Codex `turn-ended`
  -> %USERPROFILE%\.codex\config.toml
  -> optional managed outer notify wrapper
  -> nested previous-notify command when a wrapper owns notify
  -> codex-finish-ringtone-notify.mjs
  -> detached codex-final-stop-ringtone.mjs
  -> generated Windows PowerShell player
  -> local WAV or fallback beep
  -> optional Android and ntfy delivery
```

The wrapper validates `turn-ended`, launches the final hook with `process.execPath`, writes a small JSONL record, and returns quickly. The final hook owns event parsing, deduplication, audio selection, playback, optional delivery, and detailed logging.

Some Codex integrations own the outer notify command and preserve the ringtone as a JSON-encoded `--previous-notify` command. This is supported. Installation must update only that nested command and preserve the outer owner.

## Exact completion gate

The final hook rings only for either:

- arguments containing both `--from-notify` and `turn-ended`; or
- `--from-task-complete` with JSON containing `task_complete: true`.

`Stop`, `SessionEnd`, and transcript-watcher sources are logged but ignored. This prevents early sound while Codex is still working.

## Deduplication

The strongest available key is used in this order:

1. turn ID
2. session ID
3. rollout/transcript path
4. working directory
5. global fallback

Keys are persisted in `completion-alert-state\final-stop-ringtone-dedupe.json`. Repeats inside 60 seconds are suppressed. `--force` bypasses this only for deliberate tests.

## Audio selection

The first existing path wins:

1. `%USERPROFILE%\.codex\du_bist_gut_genug_zedge.wav`
2. `%USERPROFILE%\.codex\sounds\du_bist_gut_genug_zedge.wav`
3. the absolute path in `completion-alert-state\ringtone-audio-path.txt`

The generated Windows PowerShell 5.1 player uses `System.Media.SoundPlayer`; WAV is the supported portable format. If no WAV is available, a console-beep melody runs. Playback duration is 3000 milliseconds.

## Optional channels

Android delivery runs only when the private machine-local helper `completion-alert-state\Play-CodexAndroidCompletionRingtone.ps1` exists. Set `CODEX_ANDROID_DIRECT_FALLBACK=0` to disable it.

ntfy requires both `CODEX_NTFY_TOPIC` and `CODEX_NTFY_FINISH_TOKEN`. Missing or failed phone delivery never blocks local sound. Credentials are not stored in this repository.

## Portability

Source resolves Codex home in this order:

1. `CODEX_HOME`
2. `%USERPROFILE%\.codex`
3. `$HOME\.codex`

The wiring guard resolves Node from `CODEX_NODE_EXE`, then `C:\Program Files\nodejs\node.exe`. The wrapper uses `process.execPath` for its child, avoiding a second hard-coded runtime.

## Non-negotiable invariants

- The `config.toml` notify chain remains the primary trigger.
- A managed outer notify wrapper is preserved when it exposes `--previous-notify`.
- `turn-ended` remains the default exact completion event.
- The wrapper remains detached and fast.
- Local playback starts before optional network delivery is awaited.
- Android and ntfy failures remain non-fatal to local playback.
- Audio, credentials, logs, dedupe state, and machine-local paths stay outside Git.
- The legacy transcript watcher remains disabled.
- Package tests never modify `%USERPROFILE%\.codex`.
