#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { parseHookInput } from "./hook-lib.mjs";

const USER_HOME = process.env.USERPROFILE || process.env.HOME || "";
const CODEX_HOME = process.env.CODEX_HOME || path.join(USER_HOME, ".codex");
const STATE_DIR = path.join(CODEX_HOME, "hooks", "completion-alert-state");
const SESSIONS_DIR = path.join(CODEX_HOME, "sessions");
const PS1_PATH = path.join(STATE_DIR, "Play-CodexCompletionRingtone.ps1");
// Keep the device transport selector outside generated state so cleanup cannot
// erase it between Codex sessions.
const ANDROID_ALERT_PS1 = path.join(CODEX_HOME, "hooks", "Play-CodexAndroidCompletionRingtone.ps1");
const AUDIO_CONFIG_PATH = path.join(STATE_DIR, "ringtone-audio-path.txt");
const LOG_PATH = path.join(STATE_DIR, "final-stop-ringtone.jsonl");
const DEDUPE_PATH = path.join(STATE_DIR, "final-stop-ringtone-dedupe.json");
const DEFAULT_WAV_PATH = path.join(CODEX_HOME, "du_bist_gut_genug_zedge.wav");
const LEGACY_WAV_PATH = path.join(CODEX_HOME, "sounds", "du_bist_gut_genug_zedge.wav");
const POWERSHELL_EXE = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const DEDUPE_WINDOW_MS = 60_000;
const PLAYBACK_DURATION_MS = 3000;
// Deliberately environment-backed in this public reference package.  The live
// installation may use its own private values; never publish those values.
const NTFY_TOPIC = process.env.CODEX_NTFY_TOPIC || "";
const NTFY_URL = NTFY_TOPIC ? `https://ntfy.sh/${NTFY_TOPIC}` : "";
const FINISH_TOKEN = process.env.CODEX_NTFY_FINISH_TOKEN || "";

const PS_SCRIPT = String.raw`param(
  [string]$Reason = "Codex session finished",
  [string]$AudioPath = "",
  [int]$DurationMs = 3000
)

$ErrorActionPreference = "SilentlyContinue"
$LogPath = Join-Path $PSScriptRoot "ringtone-playback.jsonl"

function Write-PlaybackLog {
  param([hashtable]$Payload)
  try {
    $Payload["time"] = (Get-Date).ToUniversalTime().ToString("o")
    Add-Content -LiteralPath $LogPath -Value (($Payload | ConvertTo-Json -Compress -Depth 6) + [Environment]::NewLine) -Encoding UTF8
  } catch {}
}

function Play-WaveOrMediaFile {
  param([string]$Path, [int]$DurationMs)
  if (-not $Path -or -not (Test-Path -LiteralPath $Path)) {
    return $false
  }

  $player = New-Object System.Media.SoundPlayer
  $player.SoundLocation = $Path
  $player.Load()
  $player.Play()
  Start-Sleep -Milliseconds ([Math]::Max(1, $DurationMs))
  $player.Stop()
  return $true
}

function Play-FallbackRingtone {
  $notes = @(
    @(659, 180), @(784, 180), @(880, 260), @(784, 160),
    @(659, 180), @(587, 180), @(659, 320),
    @(784, 180), @(880, 180), @(988, 300), @(880, 160),
    @(784, 180), @(659, 180), @(784, 420)
  )

  foreach ($note in $notes) {
    [Console]::Beep([int]$note[0], [int]$note[1])
    Start-Sleep -Milliseconds 45
  }
}

try {
  Write-PlaybackLog @{ event = "playback_started"; audioPath = $AudioPath; reason = $Reason; durationMs = $DurationMs }
  $played = Play-WaveOrMediaFile -Path $AudioPath -DurationMs $DurationMs
  if (-not $played) {
    Play-FallbackRingtone
  }
  Write-PlaybackLog @{ event = "playback_complete"; audioPath = $AudioPath; reason = $Reason; played = [bool]$played; durationMs = $DurationMs }
} catch {
  Write-PlaybackLog @{ event = "playback_failed"; audioPath = $AudioPath; reason = $Reason; error = [string]$_ }
  try { [System.Media.SystemSounds]::Exclamation.Play() } catch {}
}
`;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function appendLog(payload) {
  ensureDir(STATE_DIR);
  fs.appendFileSync(LOG_PATH, `${JSON.stringify({ time: new Date().toISOString(), ...payload })}\n`, "utf8");
}

function pickString(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

function getSessionId(data) {
  return pickString(
    data?.session_id,
    data?.sessionId,
    data?.session?.id,
    data?.conversation_id,
    data?.conversationId,
    data?.thread_id,
    data?.threadId,
    process.env.CODEX_SESSION_ID
  );
}

function getCwd(data) {
  return pickString(data?.cwd, data?.workspace?.cwd, data?.workspace_dir, process.cwd());
}

function findRolloutPath(sessionId) {
  if (!sessionId || !fs.existsSync(SESSIONS_DIR)) {
    return "";
  }

  const stack = [SESSIONS_DIR];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(`${sessionId}.jsonl`)) {
        return fullPath;
      }
    }
  }
  return "";
}

function latestGoalStatus(rolloutPath) {
  if (!rolloutPath || !fs.existsSync(rolloutPath)) {
    return { status: "unknown", objective: "", turnId: "" };
  }

  let latest = null;
  const lines = fs.readFileSync(rolloutPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    try {
      const record = JSON.parse(line);
      if (record?.type === "event_msg" && record?.payload?.type === "thread_goal_updated") {
        latest = record.payload;
      }
    } catch {
      // Ignore malformed rollout lines.
    }
  }

  return {
    status: latest?.goal?.status || "none",
    objective: latest?.goal?.objective || "",
    turnId: latest?.turnId || "",
  };
}

function spawnDetached(command, args) {
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

function runPlayer(command, args) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
      stdout = stdout.slice(-1600);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
      stderr = stderr.slice(-1600);
    });
    child.on("error", (error) => {
      const result = {
        event: "player_process_finished",
        status: null,
        signal: "",
        error: String(error?.message || error),
        elapsedMs: Date.now() - startedAt,
        stdout: stdout.slice(-800),
        stderr: stderr.slice(-800),
      };
      appendLog(result);
      resolve(result);
    });
    child.on("exit", (status, signal) => {
      const result = {
        event: "player_process_finished",
        status,
        signal: signal || "",
        error: "",
        elapsedMs: Date.now() - startedAt,
        stdout: stdout.slice(-800),
        stderr: stderr.slice(-800),
      };
      appendLog(result);
      resolve(result);
    });
  });
}

function runAndroidAlert(reason) {
  if (!fs.existsSync(ANDROID_ALERT_PS1)) {
    appendLog({ event: "android_primary_missing", script: ANDROID_ALERT_PS1 });
    return { ok: false, status: null };
  }
  const result = spawnSync(POWERSHELL_EXE, [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    ANDROID_ALERT_PS1,
    "-Reason",
    reason,
  ], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
  });
  appendLog({
    event: "android_primary_finished",
    status: result.status,
    signal: result.signal || "",
    error: result.error ? String(result.error.message || result.error) : "",
    stdout: String(result.stdout || "").slice(-800),
    stderr: String(result.stderr || "").slice(-800),
  });
  return { ok: result.status === 0, status: result.status };
}

function publishPhoneFinish({ reason, sessionId, turnId, cwd, rolloutPath, source }) {
  if (!NTFY_URL || !FINISH_TOKEN) {
    return Promise.resolve({ ok: false, status: null, skipped: true, error: "ntfy not configured" });
  }
  return new Promise((resolve) => {
    const body = [
      "codex-finish",
      `source=${source || "notify-turn-ended"}`,
      `token=${FINISH_TOKEN}`,
      new Date().toISOString(),
      reason,
      sessionId ? `session=${sessionId}` : "",
      turnId ? `turn=${turnId}` : "",
      cwd ? `cwd=${cwd}` : "",
      rolloutPath ? `rollout=${rolloutPath}` : "",
    ].filter(Boolean).join(" ");

    const request = https.request(NTFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Length": Buffer.byteLength(body, "utf8"),
        "Title": "Codex finish",
        "Priority": "urgent",
        "Tags": "bell",
      },
      timeout: 15000,
    }, (response) => {
      response.resume();
      response.on("end", () => {
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          body,
        });
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error("ntfy publish timeout"));
    });
    request.on("error", (error) => {
      resolve({ ok: false, status: null, error: String(error.message || error), body });
    });
    request.end(body);
  });
}

function readConfiguredAudioPath() {
  if (fs.existsSync(DEFAULT_WAV_PATH)) {
    return DEFAULT_WAV_PATH;
  }
  if (fs.existsSync(LEGACY_WAV_PATH)) {
    return LEGACY_WAV_PATH;
  }
  try {
    const configured = fs.readFileSync(AUDIO_CONFIG_PATH, "utf8").trim();
    return configured && fs.existsSync(configured) ? configured : "";
  } catch {
    return "";
  }
}

function ensureRingtoneScript() {
  ensureDir(STATE_DIR);
  fs.writeFileSync(PS1_PATH, PS_SCRIPT, "utf8");
}

function parseArgData() {
  const args = process.argv.slice(2);
  const jsonArg = args.find((arg) => {
    const trimmed = String(arg || "").trim();
    return trimmed.startsWith("{") && trimmed.endsWith("}");
  });
  if (!jsonArg) {
    return { args, data: null };
  }
  try {
    return { args, data: JSON.parse(jsonArg) };
  } catch {
    return { args, data: null };
  }
}

function getTurnId(data) {
  return pickString(data?.turn_id, data?.turnId, data?.["turn-id"]);
}

function makeDedupeKeys({ sessionId, turnId, rolloutPath, cwd }) {
  if (turnId) {
    return [`turn:${turnId}`];
  }
  if (sessionId) {
    return [`session:${sessionId}`];
  }
  if (rolloutPath) {
    return [`rollout:${rolloutPath}`];
  }
  if (cwd) {
    return [`cwd:${cwd}`];
  }
  return ["global-finish"];
}

function shouldSuppressDuplicate(keys) {
  if (process.argv.includes("--force")) {
    return false;
  }

  const now = Date.now();
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(DEDUPE_PATH, "utf8"));
  } catch {
    state = {};
  }

  const previous = Math.max(...keys.map((key) => Number(state[key] || 0)));
  for (const key of keys) {
    state[key] = now;
  }

  for (const [storedKey, value] of Object.entries(state)) {
    if (now - Number(value || 0) > DEDUPE_WINDOW_MS * 4) {
      delete state[storedKey];
    }
  }

  try {
    ensureDir(STATE_DIR);
    fs.writeFileSync(DEDUPE_PATH, JSON.stringify(state, null, 2), "utf8");
  } catch {
    // Logging should never block the ringtone path.
  }

  return previous > 0 && now - previous < DEDUPE_WINDOW_MS;
}

async function main() {
  const hookInput = parseHookInput();
  const argInput = parseArgData();
  const data = hookInput.data || argInput.data || {};
  const args = argInput.args;
  const sessionId = getSessionId(data);
  const turnId = getTurnId(data);
  const cwd = getCwd(data);
  const rolloutPath = pickString(data?.transcript_path, data?.transcriptPath, findRolloutPath(sessionId));
  const goal = latestGoalStatus(rolloutPath);
  const dedupeKeys = makeDedupeKeys({ sessionId, turnId, rolloutPath, cwd });
  const audioPath = readConfiguredAudioPath();
  const canStartAndroid = fs.existsSync(ANDROID_ALERT_PS1);
  const fromTranscriptWatcher = args.includes("--from-transcript-watcher") || data?.transcript_watcher === true;
  const fromSessionEnd = args.includes("--from-session-end") || data?.hook_event_name === "SessionEnd";
  const fromStop = args.includes("--from-stop") || data?.hook_event_name === "Stop";
  const fromNotifyTurnEnded = (
    (args.includes("--from-notify") && args.includes("turn-ended")) ||
    data?.type === "agent-turn-complete"
  );
  const fromTaskComplete = args.includes("--from-task-complete") && data?.task_complete === true;
  const exactCompletionEvent = fromNotifyTurnEnded || fromTaskComplete;

  if (!exactCompletionEvent) {
    appendLog({
      event: "ignored_non_completion_source",
      args,
      sessionId,
      turnId,
      cwd,
      rolloutPath,
      pcDirect: false,
      phonePushPrimary: false,
      transcriptWatcherSource: fromTranscriptWatcher,
      sessionEndSource: fromSessionEnd,
      stopSource: fromStop,
      notifyTurnEndedSource: fromNotifyTurnEnded,
      taskCompleteSource: fromTaskComplete,
      reason: "ringtone requires an exact completion event",
    });
    return;
  }

  if (process.env.CODEX_RINGTONE_DRY_RUN === "1") {
    appendLog({
      event: "dry_run_would_ring",
      args,
      sessionId,
      turnId,
      cwd,
      rolloutPath,
      goalStatus: goal.status,
      pcDirect: true,
      phonePushPrimary: true,
      stopPrimary: false,
      notifyTurnEndedPrimary: fromNotifyTurnEnded,
      taskCompletePrimary: fromTaskComplete,
      notifyTurnEndedPrimary: fromNotifyTurnEnded,
      sessionEndPrimary: false,
      androidFallbackAvailable: canStartAndroid,
      audioPath: audioPath || null,
    });
    return;
  }

  // notify is the sole enabled completion source. Some Codex builds provide
  // only "turn-ended", so a cwd/time dedupe would drop distinct completions.
  if (!fromNotifyTurnEnded && shouldSuppressDuplicate(dedupeKeys)) {
    appendLog({
      event: "duplicate_suppressed",
      args,
      sessionId,
      turnId,
      cwd,
      rolloutPath,
      dedupeKeys,
    });
    return;
  }

  const reason = "Codex session finished or stopped working";
  ensureRingtoneScript();
  const playerArgs = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    PS1_PATH,
    "-Reason",
    reason,
    "-AudioPath",
    audioPath,
    "-DurationMs",
    String(PLAYBACK_DURATION_MS),
  ];
  appendLog({
    event: "local_player_started",
    args,
    sessionId,
    turnId,
    cwd,
    rolloutPath,
    pcDirect: true,
    notifyTurnEndedPrimary: fromNotifyTurnEnded,
    taskCompletePrimary: fromTaskComplete,
    playbackDurationMs: PLAYBACK_DURATION_MS,
    audioPath: audioPath || null,
  });

  const playerPromise = runPlayer(POWERSHELL_EXE, playerArgs);

  let android = { ok: null, status: null };
  if (canStartAndroid && process.env.CODEX_ANDROID_DIRECT_FALLBACK !== "0") {
    android = runAndroidAlert(reason);
  }

  const playerResult = await playerPromise;

  const phonePush = await publishPhoneFinish({
    reason,
    sessionId,
    turnId,
    cwd,
    rolloutPath,
    source: fromNotifyTurnEnded ? "notify-turn-ended" : "task-complete",
  });
  appendLog({
    event: "phone_push_finished",
    provider: "ntfy",
    topic: NTFY_TOPIC,
    status: phonePush.status,
    ok: phonePush.ok,
    error: phonePush.error || "",
  });

  appendLog({
    event: "ringtone_dispatched",
    args,
    sessionId,
    turnId,
    cwd,
    rolloutPath,
    dedupeKeys,
    goalStatus: goal.status,
    pcDirect: true,
    phonePushPrimary: true,
    stopPrimary: false,
    notifyTurnEndedPrimary: fromNotifyTurnEnded,
    taskCompletePrimary: fromTaskComplete,
    sessionEndPrimary: false,
    phonePushOk: phonePush.ok,
    phonePushStatus: phonePush.status,
    androidPrimary: android.ok !== null,
    androidFallbackUsed: false,
    androidOk: android.ok,
    androidStatus: android.status,
    playerStatus: playerResult.status,
    playerElapsedMs: playerResult.elapsedMs,
    playbackDurationMs: PLAYBACK_DURATION_MS,
    audioPath: audioPath || null,
  });
}

main().catch((error) => {
  appendLog({ event: "fatal_error", error: String(error?.stack || error) });
  process.exitCode = 1;
});
