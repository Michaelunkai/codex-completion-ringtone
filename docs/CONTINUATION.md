# Continuation handoff

## Canonical locations

Repository:

```text
F:\study\Platforms\windows\system\codex\completion-notifications\ringtone\codex-completion-ringtone
```

GitHub:

```text
https://github.com/Michaelunkai/codex-completion-ringtone
```

Originating machine live installation:

```text
C:\Users\micha\.codex
```

The repository is the sanitized portable implementation. The live directory can contain private credentials, audio, broader shared helpers, and machine-specific Android integration. Never bulk-copy it into Git.

## Current decisions

- Primary trigger: the `config.toml` notify chain with `turn-ended`.
- Managed notify owner: preserve an outer wrapper that chains the ringtone through `--previous-notify`.
- Stable runtime: `C:\Program Files\nodejs\node.exe`.
- Child runtime: `process.execPath`.
- Local audio: primary outcome, 3000 milliseconds.
- Format: WAV through `System.Media.SoundPlayer`.
- Duplicate window: 60 seconds.
- Transcript watcher: disabled.
- Stop and SessionEnd: invalid completion sources.
- ntfy and Android: optional, non-blocking.
- Runtime logs/state: excluded from Git.

## Live/package differences

Packaged `hook-lib.mjs` intentionally contains only `parseHookInput`. The live file may be a larger shared helper used by unrelated hooks. Never overwrite a broader live helper without checking its importers.

The packaged final hook removes literal private ntfy values and reads `CODEX_NTFY_TOPIC` and `CODEX_NTFY_FINISH_TOKEN`. Its hash may differ from the live hook. Compare behavior and sanitized diffs, not hashes alone.

## Historical failure

An update removed version-pinned Codex/computer-use runtime paths. The durable fix is:

```text
notify -> stable system node.exe -> wrapper -> process.execPath -> final hook
```

Never reintroduce WindowsApps, package-cache, or plugin-cache runtime paths.

On the originating machine, Codex Computer Use may temporarily own the outer notify command with a versioned executable while preserving this project as the nested previous-notify command. Do not replace that outer integration. Verify that the nested command still contains stable system Node, the ringtone wrapper, and `turn-ended`.

## Future-session start

1. Read `README.md`, `docs/ARCHITECTURE.md`, and this file.
2. Confirm this exact Git top-level.
3. Run `git status --short --branch`.
4. Run `tests\verify-package.ps1`.
5. Run `tests\Test-Installer.ps1`.
6. Run `tests\Test-WiringGuard.ps1`.
7. Run `tests\Test-ProductionRingtone.ps1` before live changes.
8. Inspect only the top-level `notify =` line and ringtone-related hook entries.
9. Back up live files before deployment.

## Change checklist

1. Add or tighten a test for the intended invariant.
2. Edit repository source.
3. Run all tests and parser checks.
4. Scan for secrets, audio, logs, user-profile literals, and runtime artifacts.
5. Preview installation with `-WhatIf`.
6. Compare deployment impact, especially shared `hook-lib.mjs`.
7. Install only after backup.
8. Restart Codex.
9. Run production verification.
10. Use a unique synthetic turn ID for one sound test.
11. Confirm expected JSONL events.
12. Commit and push `main` without force.

## Never do

- Never stage `%USERPROFILE%\.codex`.
- Never publish WAV files, ntfy values, Android helpers, or JSONL logs.
- Never overwrite live `hook-lib.mjs` blindly.
- Never add a second top-level `notify =` line.
- Never replace a managed outer notify wrapper when it exposes `--previous-notify`.
- Never enable transcript polling beside the exact `turn-ended` trigger.
- Never claim deployment success from syntax checks alone.

## Proof commands

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\verify-package.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\Test-Installer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\Test-WiringGuard.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\Test-ProductionRingtone.ps1
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
```
