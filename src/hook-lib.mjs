import fs from "node:fs";

// Minimal dependency used by the final-stop hook.  It accepts Codex's JSON
// hook payload without making the ringtone depend on a versioned Codex runtime.
export function parseHookInput() {
  let raw = "";
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch {
    return { raw, data: null };
  }
  if (!raw.trim()) return { raw, data: null };
  try {
    return { raw, data: JSON.parse(raw) };
  } catch {
    return { raw, data: null };
  }
}
