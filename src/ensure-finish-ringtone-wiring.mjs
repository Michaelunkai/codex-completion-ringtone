#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const CODEX_HOME = "C:\\Users\\micha\\.codex";
const CONFIG_PATH = path.join(CODEX_HOME, "config.toml");
const HOOKS_PATH = path.join(CODEX_HOME, "hooks.json");
const STATE_DIR = path.join(CODEX_HOME, "hooks", "completion-alert-state");
const LOG_PATH = path.join(STATE_DIR, "finish-ringtone-wiring-guard.jsonl");
const NODE_EXE = "C:\\Program Files\\nodejs\\node.exe";
const NOTIFY_WRAPPER_LINE =
  'notify = [ "C:\\\\Program Files\\\\nodejs\\\\node.exe", "C:\\\\Users\\\\micha\\\\.codex\\\\hooks\\\\codex-finish-ringtone-notify.mjs", "turn-ended" ]';
const WATCHDOG_TASK_NAME = "CodexTranscriptFinishRingtoneWatcher";
const DISABLED_WATCHER_COMMAND =
  'node "C:\\Users\\micha\\.codex\\hooks\\async-node-hook.mjs" "C:\\Users\\micha\\.codex\\hooks\\kill-stale-email-watchers.mjs" session-completion-alert-disabled';

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function appendLog(payload) {
  ensureDir(STATE_DIR);
  fs.appendFileSync(LOG_PATH, `${JSON.stringify({ time: new Date().toISOString(), ...payload })}\n`, "utf8");
}

function updateConfig() {
  let text = fs.readFileSync(CONFIG_PATH, "utf8");
  const before = text;
  if (/^notify\s*=.*$/m.test(text)) {
    text = text.replace(/^notify\s*=.*$/m, NOTIFY_WRAPPER_LINE);
  } else {
    text = `${NOTIFY_WRAPPER_LINE}\n${text}`;
  }
  if (text !== before) {
    fs.writeFileSync(CONFIG_PATH, text, "utf8");
    return true;
  }
  return false;
}

function walkHooks(value, visitor) {
  if (Array.isArray(value)) {
    for (const item of value) {
      walkHooks(item, visitor);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  visitor(value);
  for (const child of Object.values(value)) {
    walkHooks(child, visitor);
  }
}

function commandStartsTranscriptWatcher(command) {
  return typeof command === "string" && command.includes("start-codex-transcript-finish-ringtone-watcher.mjs");
}

function commandRunsStopRingtone(command) {
  return typeof command === "string" && command.includes("codex-final-stop-ringtone.mjs") && command.includes("--from-stop");
}

function commandIsObsoleteRingtonePath(command) {
  return typeof command === "string" && (
    (command.includes("local-completion-alert.mjs") && command.includes("--session-end")) ||
    command.includes("codex-final-stop-ringtone.mjs")
  );
}

function removeMatchingCommandHooks(hooksList, predicate) {
  let changed = false;

  function filterEntry(entry) {
    if (Array.isArray(entry)) {
      return entry.map(filterEntry).filter(Boolean);
    }
    if (!entry || typeof entry !== "object") {
      return entry;
    }
    if (Array.isArray(entry.hooks)) {
      entry.hooks = entry.hooks.filter((hook) => {
        if (!predicate(hook?.command)) {
          return true;
        }
        changed = true;
        return false;
      });
      if (entry.hooks.length === 0) {
        changed = true;
        return null;
      }
    }
    return entry;
  }

  const filtered = hooksList.map(filterEntry).filter(Boolean);
  hooksList.length = 0;
  hooksList.push(...filtered);
  return changed;
}

function updateHooks() {
  const root = JSON.parse(fs.readFileSync(HOOKS_PATH, "utf8").replace(/^\uFEFF/, ""));
  const hooks = root.hooks || {};
  let changed = false;

  walkHooks(hooks, (node) => {
    if (typeof node.command !== "string") {
      return;
    }
    if (node.command.includes("start-task-complete-alert-watcher.mjs")) {
      node.command = DISABLED_WATCHER_COMMAND;
      node.statusMessage = "Background Ensuring non-session completion alert watcher is disabled";
      changed = true;
    }
  });

  hooks.Stop ||= [];
  hooks.SessionEnd ||= [];
  hooks.SessionStart ||= [];

  for (const eventHooks of Object.values(hooks)) {
    if (Array.isArray(eventHooks) && removeMatchingCommandHooks(eventHooks, commandIsObsoleteRingtonePath)) {
      changed = true;
    }
    if (Array.isArray(eventHooks) && removeMatchingCommandHooks(eventHooks, commandStartsTranscriptWatcher)) {
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(HOOKS_PATH, `${JSON.stringify(root, null, 2)}\n`, "utf8");
  }
  return changed;
}

function disableWatchdogTask() {
  const result = spawnSync("schtasks.exe", ["/Change", "/TN", WATCHDOG_TASK_NAME, "/Disable"], {
    encoding: "utf8", windowsHide: true, timeout: 10000,
  });
  return result.status === 0;
}

function hardenWatchdogTaskSettings() {
  const exported = spawnSync("schtasks.exe", ["/Query", "/TN", WATCHDOG_TASK_NAME, "/XML"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10000,
  });
  if (exported.status !== 0 || !exported.stdout) {
    return;
  }

  let xml = String(exported.stdout);
  xml = xml
    .replace(/<Command>"C:\\Program Files\\nodejs\\node\.exe"<\/Command>/g, "<Command>C:\\Program Files\\nodejs\\node.exe</Command>")
    .replace(/<DisallowStartIfOnBatteries>true<\/DisallowStartIfOnBatteries>/g, "<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>")
    .replace(/<StopIfGoingOnBatteries>true<\/StopIfGoingOnBatteries>/g, "<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>")
    .replace(/<ExecutionTimeLimit>PT72H<\/ExecutionTimeLimit>/g, "<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");

  const tempPath = path.join(STATE_DIR, "CodexTranscriptFinishRingtoneWatcher.xml");
  fs.writeFileSync(tempPath, xml, "utf8");
  const imported = spawnSync("schtasks.exe", ["/Create", "/TN", WATCHDOG_TASK_NAME, "/XML", tempPath, "/F"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10000,
  });
  if (imported.status !== 0) {
    appendLog({
      event: "watchdog_task_harden_failed",
      status: imported.status,
      stdout: String(imported.stdout || "").slice(-500),
      stderr: String(imported.stderr || "").slice(-500),
    });
  }
}

const configChanged = updateConfig();
const hooksChanged = updateHooks();
const watchdogDisabled = disableWatchdogTask();
appendLog({ event: "checked", configChanged, hooksChanged, watchdogDisabled, notifyTurnEndedRingtone: true, taskCompleteWatcher: false, hookRingtone: true, ringtoneTrigger: "turn_ended_only" });
