#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const USER_HOME = process.env.USERPROFILE || process.env.HOME || "";
const CODEX_HOME = process.env.CODEX_HOME || path.join(USER_HOME, ".codex");
const STATE_DIR = path.join(CODEX_HOME, "hooks", "completion-alert-state");
const FINAL_STOP_RINGTONE = path.join(CODEX_HOME, "hooks", "codex-final-stop-ringtone.mjs");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function appendJsonl(payload) {
  ensureDir(STATE_DIR);
  fs.appendFileSync(
    path.join(STATE_DIR, "finish-notify-wrapper.jsonl"),
    JSON.stringify({ time: new Date().toISOString(), ...payload }) + "\n"
  );
}

function spawnDetached(command, args) {
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

const args = process.argv.slice(2);
const effectiveArgs = args.length ? args : ["turn-ended"];
const isTurnEnded = effectiveArgs.includes("turn-ended");

try {
  if (isTurnEnded && fs.existsSync(FINAL_STOP_RINGTONE)) {
    spawnDetached(process.execPath, [FINAL_STOP_RINGTONE, "--from-notify", ...effectiveArgs]);
    appendJsonl({ event: "ringtone-dispatched-notify-turn-ended", scriptPath: FINAL_STOP_RINGTONE, args: effectiveArgs });
  } else {
    appendJsonl({ event: "ringtone-skipped", isTurnEnded, scriptPath: FINAL_STOP_RINGTONE, args: effectiveArgs });
  }
} catch (error) {
  appendJsonl({ event: "ringtone-dispatch-failed", args: effectiveArgs, error: String(error?.message || error) });
}
