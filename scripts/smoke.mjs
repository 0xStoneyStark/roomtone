import { TypeSafeClient } from "@typesafe-ai/sdk";
import { QUESTION_SETS } from "../questions.mjs";
const questions = QUESTION_SETS.all;
const client = new TypeSafeClient({ model: "jev-latest" });
const cases = {
  techno: { sound: { tempo: "fast, around 140 beats per minute, steady", loudness: "loud", loudness_trend: "getting louder over the last few seconds", bass: "heavy, sustained sub-bass", brightness: "bright, lots of high-frequency sizzle", rhythm: "dense, relentless hits locked to the beat", texture: "mostly noise-like: percussive or distorted", dynamics: "flat and compressed, constant level" }, listener_note: "(none)", local_time: "Saturday 01:10, late night" },
  piano: { sound: { tempo: "no steady beat", loudness: "quiet", loudness_trend: "holding steady", bass: "hardly any bass", brightness: "warm, soft top end", rhythm: "occasional gentle hits", texture: "clearly pitched tones, melodic or harmonic", dynamics: "big swings between notes and near-silence" }, listener_note: "solo piano, raining outside", local_time: "Sunday 22:40, evening" },
};
for (const [name, state] of Object.entries(cases)) {
  const t = performance.now();
  const r = await client.systemOne({ state, questions });
  const ms = Math.round(performance.now() - t);
  console.log(`\n=== ${name}  (${r.model}, ${r.usage.input_tokens} in, ${ms} ms)`);
  for (const [id, a] of Object.entries(r.answers)) {
    if (a.type === "choice") {
      const top = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, p]) => `${k} ${(p * 100).toFixed(0)}%`).join(" · ");
      console.log(`${id.padEnd(11)} ${a.choice.padEnd(9)} conf ${a.confidence.toFixed(2)}  [${top}]`);
    } else if (a.type === "score") {
      console.log(`${id.padEnd(11)} ${a.score.toFixed(2)} / ${Object.keys(a.legend).length - 1}  conf ${a.confidence.toFixed(2)}  → ${a.legend[String(Math.round(a.score))].slice(0, 40)}`);
    } else console.log(`${id.padEnd(11)} noul ${a.noul.toFixed(2)}`);
  }
}
