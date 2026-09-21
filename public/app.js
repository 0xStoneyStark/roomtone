// Roomtone: the loop that ties the ear, Jev, and the renderer together.
// Code keeps the clock, the beat, and the crossfades; Jev supplies taste on
// two clocks: the scene ("taste") every few seconds, the feel ("pulse") as
// fast as calls return.
import { Ear, micSource } from "./audio.js";
import { demoSource } from "./demo-source.js";
import { Ledger } from "./ledger.js";
import { PATTERNS } from "./patterns.js";
import { AsciiRenderer, PALETTES } from "./render.js";

const TASTE_WINDOW_S = 6;
const PULSE_WINDOW_S = 2;
const PULSE_MIN_GAP_MS = 400; // caps the live loop at 2.5 calls a second
const PULSE_ERROR_BACKOFF_MS = 2500; // doubles per consecutive failure, up to MAX_BACKOFF_MS
const MAX_BACKOFF_MS = 60_000;
const BUDGET_BACKOFF_MS = 60_000; // the server said this hour's Jev budget is spent
const PULSE_EASE_S = 0.5; // how fast live params chase Jev's latest answer
const CROSSFADE_S = 2.2; // pattern, motion and look all cross over together
const WARM_STEPS = 30; // coarse simulated steps a new pattern gets before it starts fading in
const WARM_DT = 1 / 15;
const FLASH_DECAY = 2.5;
const DROP_CHARGE_MIN = 0.65; // Jev's drop_soon probability needed to arm a release
const DROP_BEAT_MIN = 0.7;
const DROP_ENERGY_JUMP = 1.5; // energy vs the last few seconds' average
const DROP_BASELINE_MS = 4000;
const DROP_COOLDOWN_MS = 10000;
const DEFAULT_CADENCE_S = 6;
const SILENCE_RETRY_MS = 500;
const ROLL_SHARPNESS = 1.5; // 1 = roll straight from Jev's odds; higher favours its stronger options
const STATUS_HZ = 4;
// Quality governor: shrink the glyph grid when frames run long, never grow it back mid-session.
const GOVERNOR_INTERVAL_MS = 1500;
const GOVERNOR_WORK_MS = 9; // CPU time per frame we are willing to spend
const GOVERNOR_MIN_FPS = 48;
const GOVERNOR_STRIKES = 2; // consecutive slow checks before the grid shrinks
const GOVERNOR_SHRINK = 0.7;
const GOVERNOR_MIN_CELLS = 1200;
const RESIZE_DEBOUNCE_MS = 250;

const isPhone = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600;
const params = { density: 0.35, turbulence: 0.35, arc: 0.3, drop: 0, speed: 0.5 };
const targets = { density: 0.35, turbulence: 0.35, arc: 0.3 };
const motions = { from: "drift", to: "drift", mix: 1 }; // blended over CROSSFADE_S so speed never jumps
let beatEnv = 0;
let surgePhase = 0;
let stutterHold = 0;

const canvas = document.getElementById("stage");
const renderer = new AsciiRenderer(canvas, 5500); // phones too: the governor steps down if frames run long
const ledgerEl = document.getElementById("ledger");
const ledger = new Ledger(ledgerEl);
const statusCells = Object.fromEntries([...document.querySelectorAll("#status [data-k]")].map((n) => [n.dataset.k, n]));
const noteInput = document.getElementById("note");
const cadenceInput = document.getElementById("cadence");
const cadenceLabel = document.getElementById("cadence-label");
const liveInput = document.getElementById("live");
const ear = new Ear();

let current = null; // { name, field, gen }
let next = null; // same shape, plus warm: steps still owed before the fade starts
let fade = 0;
let blend = null;
let flash = 0;
let lastFrame = 0;
let startedAt = 0;
let fps = 60;
let workMs = 0;
let nextStatusAt = 0;
let nextGovernorAt = 0;
let governorStrikes = 0;
let resizeTimer = 0;
let tasteInFlight = false;
let nextTasteAt = 0;
let pulseRunning = false;
let judgeCount = 0;
let sessionTokens = 0;
let energyTrail = [];
let lastReleaseAt = -Infinity;
let idle = true; // before Start: a quiet picture plays behind the intro with no audio
let lastField = null; // the field drawn in the most recent frame, for exports
let lastTaste = null; // Jev's most recent scene answers, re-rolled while Jev is unreachable
let tasteFailures = 0;
let pulseFailures = 0;

// Calm starter odds for when Jev has not answered yet at all.
const STARTER_TASTE = {
  pattern: { probabilities: { embers: 0.4, plasma: 0.3, flow: 0.3 }, choice: "embers" },
  glyphs: { probabilities: { dots: 0.5, classic: 0.3, braille: 0.2 }, choice: "dots" },
  palette: { probabilities: { bone: 0.4, glacier: 0.3, dusk: 0.3 }, choice: "bone" },
  motion: { probabilities: { drift: 0.6, breathe: 0.4 }, choice: "drift" },
};

/** Plain words for a failed Jev call. */
function failureText(err) {
  if (err.status === 529) return "Jev is overloaded right now (TypeSafe 529)";
  if (err.status === 503 && /budget/i.test(err.message)) return err.message;
  if (err.status >= 500) return `Jev is unreachable (${err.status})`;
  return err.message;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makePattern(name) {
  const field = new Float32Array(renderer.cols * renderer.rows);
  return { name, field, gen: PATTERNS[name](renderer.cols, renderer.rows, field, renderer.aspect), warm: WARM_STEPS };
}

function switchPattern(name) {
  if (current?.name === name || next?.name === name) return;
  next = makePattern(name);
  fade = 0;
}

/** Rebuild the grid after a size or budget change; the picture restarts, so this is kept rare. */
function rebuildGrid() {
  current = makePattern(current.name);
  next = null;
  blend = new Float32Array(renderer.cols * renderer.rows);
}

/** The HUD takes its accent from the palette Jev chose: the chrome obeys the art director too. */
function setAccent(palette) {
  const [r, g, b] = PALETTES[palette][10];
  document.documentElement.style.setProperty("--accent", `${r | 0}, ${g | 0}, ${b | 0}`);
}

/** Roll one option from Jev's distribution: the randomness is Jev's own probabilities. */
function roll(probabilities) {
  const weights = Object.entries(probabilities).map(([name, p]) => [name, p ** ROLL_SHARPNESS]);
  let r = Math.random() * weights.reduce((sum, [, w]) => sum + w, 0);
  for (const [name, w] of weights) {
    r -= w;
    if (r <= 0) return name;
  }
  return weights.at(-1)[0];
}

function scoreUnit(answer) {
  return answer.score / (Object.keys(answer.legend).length - 1);
}

function localTime() {
  const d = new Date();
  const h = d.getHours();
  const phase = h < 5 ? "late night" : h < 9 ? "early morning" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night";
  const day = d.toLocaleDateString(undefined, { weekday: "long" });
  return `${day} ${String(h).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}, ${phase}`;
}

async function postJudge(payload) {
  const res = await fetch("/api/judge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) {
    const err = new Error(body.error ?? `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  judgeCount += 1;
  sessionTokens += body.usage.input_tokens;
  ledger.meta(body.model, body.ms, sessionTokens);
  return body;
}

/** The scene: picture, glyphs, colour, motion. Rolled from Jev's odds every cadence. */
async function judgeTaste() {
  if (tasteInFlight) return;
  const sound = ear.describe(TASTE_WINDOW_S);
  if (!sound) {
    ledger.say("Nothing to hear yet — play something near the mic.", "wait");
    nextTasteAt = performance.now() + SILENCE_RETRY_MS;
    return;
  }
  tasteInFlight = true;
  ledger.say("Asking Jev for the next picture…", "wait");
  const cadenceMs = Number(cadenceInput.value) * 1000;
  try {
    // With the live loop off, the pulse questions ride along on this call instead.
    const body = await postJudge({ sound, set: liveInput.checked ? "taste" : "all", note: noteInput.value, local_time: localTime() });
    tasteFailures = 0;
    lastTaste = body;
    applyTaste(body);
    if (body.answers.density) applyPulse(body);
    ledger.say("");
    nextTasteAt = performance.now() + cadenceMs;
  } catch (err) {
    // Keep the show moving: roll again from Jev's last odds (or the starter set) and retry later.
    tasteFailures += 1;
    const wait = Math.min(MAX_BACKOFF_MS, cadenceMs * 2 ** tasteFailures);
    const replay = lastTaste ?? { answers: STARTER_TASTE, state: { sound, listener_note: "(none)" }, replayed: true };
    applyTaste({ ...replay, replayed: true });
    ledger.say(`${failureText(err)} — re-rolling ${lastTaste ? "its last odds" : "a starter set"}; retrying in ${Math.round(wait / 1000)} s`, "error");
    nextTasteAt = performance.now() + wait;
  } finally {
    tasteInFlight = false;
  }
}

function applyTaste(body) {
  const { answers } = body;
  const rolled = {
    pattern: roll(answers.pattern.probabilities),
    glyphs: roll(answers.glyphs.probabilities),
    palette: roll(answers.palette.probabilities),
    motion: roll(answers.motion.probabilities),
  };
  switchPattern(rolled.pattern);
  renderer.setLook(rolled.glyphs, rolled.palette);
  setAccent(rolled.palette);
  if (rolled.motion !== motions.to) {
    motions.from = motions.to;
    motions.to = rolled.motion;
    motions.mix = 0;
  }
  ledger.showTaste({ ...body, rolled });
}

/** The feel: fill, order, arc, drop-soon. The next call fires as soon as the previous one returns. */
async function pulseLoop() {
  if (pulseRunning) return;
  pulseRunning = true;
  while (liveInput.checked) {
    const sound = document.hidden ? null : ear.describe(PULSE_WINDOW_S); // a background tab spends no tokens
    if (!sound) {
      await sleep(SILENCE_RETRY_MS);
      continue;
    }
    const started = performance.now();
    try {
      applyPulse(await postJudge({ sound, set: "pulse" }));
      pulseFailures = 0;
    } catch (err) {
      pulseFailures += 1;
      const wait = err.status === 503 ? BUDGET_BACKOFF_MS : Math.min(MAX_BACKOFF_MS, PULSE_ERROR_BACKOFF_MS * 2 ** (pulseFailures - 1));
      ledger.say(`${failureText(err)} — live feel paused, retrying in ${Math.round(wait / 1000)} s`, "error");
      await sleep(wait);
    }
    const gap = PULSE_MIN_GAP_MS - (performance.now() - started);
    if (gap > 0) await sleep(gap);
  }
  pulseRunning = false;
}

function applyPulse(body) {
  const { answers } = body;
  targets.density = scoreUnit(answers.density);
  targets.turbulence = scoreUnit(answers.turbulence);
  targets.arc = scoreUnit(answers.arc);
  params.drop = answers.drop_soon.noul;
  ledger.showPulse(body);
}

/** Speed multiplier for one motion mode. The mode state machines run every frame so blending stays continuous. */
function motionSpeed(mode, t, live) {
  switch (mode) {
    case "pulse":
      return 0.15 + 1.2 * beatEnv;
    case "surge":
      return 0.2 + 1.3 * surgePhase;
    case "stutter":
      // A brief freeze on every hit, then a lurch: rhythmic, not a dropped frame.
      return stutterHold > 0 ? 0 : 0.4 + 1.4 * beatEnv;
    case "breathe":
      return 0.55 + 0.45 * Math.sin((t * Math.PI * 2) / 4);
    default:
      return 0.5;
  }
}

function updateMotion(dt, t, live) {
  beatEnv = live.beat ? 1 : beatEnv * Math.exp(-dt * 6);
  const bar = 4 * (60 / (live.bpm || 120));
  surgePhase = (surgePhase + dt / bar) % 1;
  if (live.beat >= 0.5) stutterHold = 0.05 + 0.04 * live.beat;
  else stutterHold = Math.max(0, stutterHold - dt);
  motions.mix = Math.min(1, motions.mix + dt / CROSSFADE_S);
  const from = motionSpeed(motions.from, t, live);
  const to = motionSpeed(motions.to, t, live);
  params.speed = from + (to - from) * motions.mix;
  return motions.to === "stutter" && motions.mix > 0.5 && stutterHold > 0;
}

/** Jev predicted a drop; a confirmed hard hit with an energy jump releases it, at most once per cooldown. */
function checkDropRelease(live, now) {
  energyTrail.push({ t: now, e: live.energy });
  energyTrail = energyTrail.filter((x) => now - x.t < DROP_BASELINE_MS);
  const baseline = energyTrail.filter((x) => now - x.t > 500);
  if (baseline.length < 30 || now - lastReleaseAt < DROP_COOLDOWN_MS) return;
  const avg = baseline.reduce((a, x) => a + x.e, 0) / baseline.length;
  if (params.drop >= DROP_CHARGE_MIN && live.beat >= DROP_BEAT_MIN && live.energy > avg * DROP_ENERGY_JUMP) {
    flash = 1;
    params.drop = 0;
    lastReleaseAt = now;
    nextTasteAt = 0; // re-roll the picture on the drop itself
  }
}

/** Advance the current picture and, if one is queued, warm it up then cross over to it. */
function stepPatterns(dt, t, live, frozen) {
  if (!frozen) current.gen.step(dt, t, live, params);
  if (!next) return current.field;
  if (next.warm > 0) {
    // Let rain, embers, particles and cells populate off-screen before they fade in: one coarse step per frame.
    next.warm--;
    next.gen.step(WARM_DT, t - next.warm * WARM_DT, live, params);
    return current.field;
  }
  if (!frozen) next.gen.step(dt, t, live, params);
  fade = Math.min(1, fade + dt / CROSSFADE_S);
  const k = fade * fade * (3 - 2 * fade); // ease in-out
  for (let i = 0; i < blend.length; i++) blend[i] = current.field[i] * (1 - k) + next.field[i] * k;
  if (fade >= 1) {
    current = next;
    next = null;
    return current.field;
  }
  return blend;
}

/** Download the frame on screen right now as a high-resolution PNG of the art alone. */
function saveFrame() {
  if (!lastField) return;
  const when = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}-${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`;
  const out = renderer.exportFrame(lastField);
  out.toBlob((blob) => {
    if (!blob) {
      ledger.say("Could not export the frame (canvas too large for this browser).", "error");
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `roomtone-${stamp}-${out.width}x${out.height}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, "image/png");
}

const GOVERNOR_OFF = new URLSearchParams(location.search).has("nogov"); // for recordings, where capture throttles rAF

function govern(now) {
  if (GOVERNOR_OFF || now < nextGovernorAt) return;
  nextGovernorAt = now + GOVERNOR_INTERVAL_MS;
  if (document.hidden || next || renderer.budget <= GOVERNOR_MIN_CELLS) return; // transitions double the work briefly
  const slow = workMs > GOVERNOR_WORK_MS || fps < GOVERNOR_MIN_FPS;
  governorStrikes = slow ? governorStrikes + 1 : 0;
  if (governorStrikes < GOVERNOR_STRIKES) return;
  governorStrikes = 0;
  if (renderer.setBudget(Math.max(GOVERNOR_MIN_CELLS, renderer.budget * GOVERNOR_SHRINK))) rebuildGrid();
  workMs = 0;
  fps = 60;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastFrame) / 1000 || 0.016);
  lastFrame = now;
  fps += (1 / dt - fps) * 0.05;
  const t = (now - startedAt) / 1000;
  const work0 = performance.now();
  const live = ear.frame(now);

  for (const k of Object.keys(targets)) params[k] += (targets[k] - params[k]) * Math.min(1, dt / PULSE_EASE_S);
  const frozen = updateMotion(dt, t, live);
  const field = stepPatterns(dt, t, live, frozen);

  checkDropRelease(live, now);
  flash *= Math.exp(-dt * FLASH_DECAY);
  renderer.draw(field, dt, flash);
  lastField = field;
  workMs += (performance.now() - work0 - workMs) * 0.05;

  if (now >= nextStatusAt) {
    nextStatusAt = now + 1000 / STATUS_HZ;
    const mm = Math.floor(t / 60), ss = String(Math.floor(t % 60)).padStart(2, "0");
    statusCells.state.textContent = live.silent ? "quiet" : "listening";
    statusCells.time.textContent = `${mm}:${ss}`;
    statusCells.bpm.textContent = live.bpm ? `${live.bpm} bpm` : "no beat";
    statusCells.judgments.textContent = `${judgeCount} judgments`;
    statusCells.perf.textContent = `${Math.round(fps)} fps · ${workMs.toFixed(1)} ms · ${renderer.cols}×${renderer.rows}`;
  }
  govern(now);
  if (now >= nextTasteAt) judgeTaste();
}

/** Before Start: embers drifting slowly behind the intro, driven by a gentle synthetic swell instead of audio. */
function idleFrame(now) {
  if (!idle) return;
  requestAnimationFrame(idleFrame);
  const dt = Math.min(0.1, (now - lastFrame) / 1000 || 0.016);
  lastFrame = now;
  const t = now / 1000;
  const live = { energy: 0.35 + 0.15 * Math.sin(t * 0.7), bass: 0.2, beat: 0, bpm: 0, silent: true };
  params.speed = 0.4;
  current.gen.step(dt, t, live, params);
  renderer.draw(current.field, dt, 0);
}

async function start(source) {
  const intro = document.getElementById("intro");
  const note = intro.querySelector("[data-intro-message]");
  try {
    await ear.start(source);
  } catch (err) {
    note.textContent = err.name === "NotAllowedError" ? "Microphone blocked. Allow the mic for this page, or play the demo loop." : `Could not start audio: ${err.message}`;
    return;
  }
  idle = false;
  intro.hidden = true;
  document.getElementById("hud").hidden = false;
  if (isPhone) ledgerEl.classList.add("is-collapsed");
  const health = await fetch("/api/health").then((r) => r.json()).catch(() => ({ hasKey: false }));
  if (!health.hasKey) ledger.say("TYPESAFE_API_KEY is not set on the server. Add it to .env and restart.", "error");
  blend = new Float32Array(renderer.cols * renderer.rows);
  startedAt = performance.now();
  lastFrame = startedAt;
  nextTasteAt = startedAt + 2500;
  nextGovernorAt = startedAt + 4000;
  requestAnimationFrame(frame);
  pulseLoop();
}

current = makePattern("embers");
current.warm = 0;
params.density = 0.25;
setAccent("bone");
document.fonts.ready.then(() => renderer.resize()).finally(() => {
  current = makePattern("embers");
  current.warm = 0;
  requestAnimationFrame(idleFrame);
});

document.getElementById("start-mic").addEventListener("click", () => start(micSource));
document.getElementById("start-demo").addEventListener("click", () => start(demoSource));
document.getElementById("judge-now").addEventListener("click", () => {
  nextTasteAt = 0;
});
document.getElementById("ledger-toggle").addEventListener("click", () => ledgerEl.classList.toggle("is-collapsed"));
document.getElementById("ledger-head").addEventListener("click", (e) => {
  if (isPhone && e.target.id !== "ledger-toggle") ledgerEl.classList.toggle("is-collapsed");
});
document.getElementById("ledger-show").addEventListener("click", () => ledgerEl.classList.remove("is-hidden"));
document.getElementById("save-frame").addEventListener("click", saveFrame);
cadenceInput.value = DEFAULT_CADENCE_S;
cadenceLabel.textContent = `${DEFAULT_CADENCE_S} s`;
cadenceInput.addEventListener("input", () => {
  cadenceLabel.textContent = `${cadenceInput.value} s`;
});
liveInput.addEventListener("change", () => {
  if (liveInput.checked && startedAt) pulseLoop();
});
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const { cols, rows } = renderer;
    renderer.resize();
    if (current && (cols !== renderer.cols || rows !== renderer.rows)) rebuildGrid();
  }, RESIZE_DEBOUNCE_MS);
});
window.addEventListener("keydown", (e) => {
  if (idle && (e.key === "Enter") && document.activeElement?.tagName !== "BUTTON") document.getElementById("start-mic").click();
});
window.addEventListener("keydown", (e) => {
  if (e.target === noteInput) return;
  if (e.key === "h" || e.key === "H") ledgerEl.classList.toggle("is-hidden");
  if (e.key === "n" || e.key === "N") nextTasteAt = 0;
  if (e.key === "s" || e.key === "S") saveFrame();
});
