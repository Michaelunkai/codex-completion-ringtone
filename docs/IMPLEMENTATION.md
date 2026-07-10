# From-scratch implementation guide

## 1. Choose one authoritative event

Use Codex `config.toml` `notify` with `turn-ended`. Do not use transcript polling, process-idle guesses, Stop, or SessionEnd as the primary event; they can be early or overlap.

## 2. Use a stable executable

```toml
notify = [ "C:\\Program Files\\nodejs\\node.exe", "C:\\Users\\YOUR_USER\\.codex\\hooks\\your-wrapper.mjs", "turn-ended" ]
```

Never reference a versioned runtime inside an app package or cache.

If another integration owns the outer notify command and exposes a `--previous-notify` argument, preserve the outer command and place the stable ringtone command in that nested JSON value. Refuse unknown notify owners by default instead of silently replacing them.

## 3. Keep the wrapper small

The wrapper should validate `turn-ended`, locate the full hook, spawn it detached with `process.execPath`, log dispatch, and return. This prevents notification work from blocking Codex.

## 4. Gate the full hook again

Require an exact completion source independently. Accept JSON from stdin and optionally a JSON argument. Extract turn ID, session ID, transcript path, and working directory when available.

## 5. Deduplicate

Persist the strongest available event key and timestamp. Suppress the same key inside 60 seconds. Provide an explicit force flag for tests, never normal configuration.

## 6. Resolve audio deterministically

Use a documented precedence list and verify existence. Keep audio outside Git. Windows PowerShell 5.1 can play WAV with:

```powershell
$player = New-Object System.Media.SoundPlayer
$player.SoundLocation = $AudioPath
$player.Load()
$player.Play()
Start-Sleep -Milliseconds 3000
$player.Stop()
```

Provide an audible fallback when the WAV is absent.

## 7. Start local playback before network work

Local feedback is primary. Optional phone or Android delivery must never gate or cancel it.

## 8. Log structured events

Use append-only JSONL with UTC timestamps. Record wrapper outcome, accepted/ignored source, duplicate suppression, selected audio, player completion, optional-channel results, and final status. Never log secrets.

## 9. Separate package and installation

The repository contains portable source and tests. The live Codex home contains deployed copies, private audio, environment-backed credentials, logs, state, and machine-specific helpers. Never commit the live directory.

## 10. Test in layers

Static package:

- parse every JavaScript module;
- parse every PowerShell file under Windows PowerShell 5.1;
- assert trigger, dedupe, stable-runtime, and credential invariants;
- scan for secrets and hard-coded user profiles.

Installer:

- create a GUID-named temporary Codex home;
- seed duplicate obsolete notify lines;
- install there;
- verify one correct notify line, files, audio path, and backup;
- delete only the verified temporary directory.

Production:

- verify live paths and syntax;
- verify exact notify wiring;
- verify the legacy watcher is disabled.

End to end:

- use a unique synthetic turn ID;
- verify sound and expected log events.

## 11. Preserve rollback

Back up every file that deployment may overwrite. Timestamp the backup directory and never delete it automatically.

## 12. Security rules

- Keep ntfy values in environment variables.
- Ignore `.env`, audio, logs, state, locks, and machine-local paths.
- Scan the staged diff before committing.
- Publish only after verifying no private literal values remain.
