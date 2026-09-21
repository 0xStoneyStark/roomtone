// Summarise data/sessions.jsonl: what people tried, in words. Usage: node scripts/sessions.mjs [file]
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? new URL("../data/sessions.jsonl", import.meta.url);
const events = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const starts = events.filter((e) => e.type === "session");
const tastes = events.filter((e) => e.type === "taste");
const ends = events.filter((e) => e.type === "end");

function counted(items) {
  const m = new Map();
  for (const item of items) if (item != null && item !== "") m.set(item, (m.get(item) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
}
function top(label, items, n = 8) {
  const rows = counted(items).slice(0, n);
  if (rows.length) console.log(`\n${label}\n${rows.map(([k, c]) => `${String(c).padStart(5)}  ${k}`).join("\n")}`);
}

const sum = (key) => ends.reduce((a, e) => a + (e[key] ?? 0), 0);
console.log(`${starts.length} sessions from ${new Set(starts.map((e) => e.ip)).size} addresses · ${tastes.length} pictures · ${sum("calls")} calls · ${sum("tokens").toLocaleString()} tokens`);
top("sessions by day", starts.map((e) => e.t.slice(0, 10)), 31);
top("source", starts.map((e) => e.source));
top("device", starts.map((e) => e.device));
top("country", starts.map((e) => e.country));
top("notes — what's playing, or where they are", tastes.map((e) => e.note).filter((n) => n && n !== "(none)"), 30);
for (const key of ["tempo", "loudness", "bass", "brightness", "rhythm", "texture", "dynamics"]) top(`sound · ${key}`, tastes.map((e) => e.sound?.[key]));
top("pictures Jev picked", tastes.map((e) => e.picks?.pattern));
top("palettes", tastes.map((e) => e.picks?.palette));
top("glyphs", tastes.map((e) => e.picks?.glyphs));
top("session length", ends.map((e) => `${Math.round(e.seconds / 30) * 30} s (${e.reason})`), 10);
