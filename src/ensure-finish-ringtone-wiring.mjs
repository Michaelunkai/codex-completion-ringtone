#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const USER_HOME = process.env.USERPROFILE || process.env.HOME || "";
const CODEX_HOME = process.env.CODEX_HOME || path.join(USER_HOME, ".codex");
const CONFIG_PATH = path.join(CODEX_HOME, "config.toml");
const HOOKS_PATH = path.join(CODEX_HOME, "hooks.json");
const STATE_DIR = path.join(CODEX_HOME, "hooks", "completion-alert-state");
const LOG_PATH = path.join(STATE_DIR, "finish-ringtone-wiring-guard.jsonl");
const NODE_EXE = process.env.CODEX_NODE_EXE || "C:\\Program Files\\nodejs\\node.exe";
const NOTIFY_WRAPPER_PATH = path.join(CODEX_HOME, "hooks", "codex-finish-ringtone-notify.mjs");
const escapeTomlBasicString = (value) => String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
const NOTIFY_WRAPPER_LINE =
  `notify = [ "${escapeTomlBasicString(NODE_EXE)}", "${escapeTomlBasicString(NOTIFY_WRAPPER_PATH)}", "turn-ended" ]`;
const PREVIOUS_NOTIFY_JSON = JSON.stringify([NODE_EXE, NOTIFY_WRAPPER_PATH, "turn-ended"]);
const SKIP_TASK_CHANGES = process.env.CODEX_RINGTONE_SKIP_TASK_CHANGES === "1";
const WATCHDOG_TASK_NAME = "CodexTranscriptFinishRingtoneWatcher";
const DISABLED_WATCHER_COMMAND =
  `node "${path.join(CODEX_HOME, "hooks", "async-node-hook.mjs")}" "${path.join(CODEX_HOME, "hooks", "kill-stale-email-watchers.mjs")}" session-completion-alert-disabled`;

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
  const notifyMatches = [...text.matchAll(/^(?:\uFEFF)?\s*notify\s*=.*$/gm)];
  if (notifyMatches.length > 1) {
    return { changed: false, mode: "multiple-notify-lines-preserved" };
  }
  if (notifyMatches.length === 0) {
    text = `${NOTIFY_WRAPPER_LINE}\n${text}`;
  } else {
    const current = notifyMatches[0][0];
    let replacement = current;
    if (/"--previous-notify"\s*,\s*"(?:\\.|[^"])*"/.test(current)) {
      replacement = current.replace(
        /"--previous-notify"\s*,\s*"(?:\\.|[^"])*"/,
        `"--previous-notify", "${escapeTomlBasicString(PREVIOUS_NOTIFY_JSON)}"`
      );
    } else if (current.includes("codex-finish-ringtone-notify.mjs")) {
      replacement = NOTIFY_WRAPPER_LINE;
    } else {
      return { changed: false, mode: "unrelated-notify-owner-preserved" };
    }
    text = text.replace(current, replacement);
  }
  if (text !== before) {
    fs.writeFileSync(CONFIG_PATH, text, "utf8");
    return {
      changed: true,
      mode: notifyMatches.length === 0
        ? "direct-added"
        : (notifyMatches[0][0].includes("--previous-notify") ? "outer-wrapper-preserved" : "direct-updated"),
    };
  }
  return { changed: false, mode: "already-correct" };
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
  if (SKIP_TASK_CHANGES) {
    return null;
  }
  const result = spawnSync("schtasks.exe", ["/Change", "/TN", WATCHDOG_TASK_NAME, "/Disable"], {
    encoding: "utf8", windowsHide: true, timeout: 10000,
  });
  return result.status === 0;
}

function hardenWatchdogTaskSettings() {
  if (SKIP_TASK_CHANGES) {
    return;
  }
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

const configResult = updateConfig();
const hooksChanged = updateHooks();
const watchdogDisabled = disableWatchdogTask();
appendLog({
  event: "checked",
  configChanged: configResult.changed,
  configMode: configResult.mode,
  hooksChanged,
  watchdogDisabled,
  taskChangesSkipped: SKIP_TASK_CHANGES,
  notifyTurnEndedRingtone: true,
  taskCompleteWatcher: false,
  hookRingtone: true,
  ringtoneTrigger: "turn_ended_only",
});
