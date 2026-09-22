// Roomtone: the loop that ties the ear, Jev, and the renderer together.
// Code keeps the clock, the beat, and the crossfades; Jev supplies taste on
// two clocks: the scene ("taste") when the music turns, the feel ("pulse") as
// fast as calls return.
import { Ear, micSource, tabSource, canCaptureTab } from "./audio.js";
import { demoSource } from "./demo-source.js";
import { Ledger } from "./ledger.js";
import { PATTERNS } from "./patterns.js";
import { AsciiRenderer } from "./render.js";
import { PALETTES } from "./palettes.js";
import { Layer, CROSSFADE_S } from "./layer.js";
import { makeMask, applyMask, mixMasks } from "./composition.js";
import { Camera, sampleThrough } from "./camera.js";
import { Directing, composeDirection } from "./directing.js";

const TASTE_WINDOW_S = 6;
const PULSE_WINDOW_S = 2;
const PULSE_MIN_GAP_MS = 400; // caps the live loop at 2.5 calls a second
const PULSE_ERROR_BACKOFF_MS = 2500; // doubles per consecutive failure, up to MAX_BACKOFF_MS
const MAX_BACKOFF_MS = 60_000;
const BUDGET_BACKOFF_MS = 60_000; // the server said this hour's Jev budget is spent
const PULSE_EASE_S = 0.5; // how fast live params chase Jev's latest answer
const SCENE_EASE_S = 2.2; // emptiness and accent settle over the same span as the crossfades
const FLASH_DECAY = 2.5;
const DROP_CHARGE_MIN = 0.65; // Jev's drop_soon probability needed to arm a release
const DROP_BEAT_MIN = 0.7;
const DROP_ENERGY_JUMP = 1.5; // energy vs the last few seconds' average
const DROP_BASELINE_MS = 4000;
const DROP_COOLDOWN_MS = 10000;
// Scenes end when Jev judges the music has turned (twice running, to ride out one noisy answer),
// or after the hold the slider sets.
const TURN_MIN = 0.75;
const TURN_STREAK = 2;
const MIN_HOLD_MS = 8000;
const BASELINE_SETTLE_MS = 3000; // the "sound at the picture" keeps updating this long, so a crossfade or intro is not the baseline
const DEFAULT_HOLD_S = 45;
// Jev listens this long per press of Start. The site is public, so every start bounds the spend;
// the picture keeps moving afterwards, and another press starts Jev again.
const SESSION_S = 150; // the server's default; the real length arrives with each session
const SESSION_LABEL = "2½ minutes";
const SILENCE_RETRY_MS = 500;
const ROLL_SHARPNESS = 1.5; // 1 = roll straight from Jev's odds; higher favours its stronger options
const STATUS_HZ = 4;
// Jev's energy arc sets the overall brightness (quiet opening dim, peak bright); an armed
// drop-soon adds a beat-synced shimmer so the prediction is visible before the hit lands.
const ARC_GAIN_MIN = 0.8;
const ARC_GAIN_MAX = 1.2;
const DROP_SHIMMER = 0.4;
const GROUND_GAIN = 0.6; // the ground layer stays an under-painting: thinner (gain) and translucent (alpha)
const GROUND_ALPHA = 0.45;
// Parallax: the ground sits further away, so the camera moves it less. This is the whole depth cue.
const GROUND_DEPTH = 0.35;
const FIGURE_DEPTH = 1;
// Directing: chips and the note are debounced into one re-judgment, so tapping three in a row
// costs one call rather than three.
const DIRECT_DEBOUNCE_MS = 700;
const HOLD_MS = 450; // press and hold this long to keep the picture Jev has chosen
const SWIPE_PX = 70; // a flick this far across rejects it
const REJECT_MEMORY = 6; // how many turned-down pictures Jev is told about
const ACCENT_SHARE = [0, 0.06, 0.25]; // share of the loudest marks in the accent colour, per Jev level
const GOVERNOR_OFF = new URLSearchParams(location.search).has("nogov"); // for recordings, where capture throttles rAF
// Quality governor: shrink the glyph grid when frames run long, never grow it back mid-session.
const GOVERNOR_INTERVAL_MS = 1500;
const GOVERNOR_WORK_MS = 9; // CPU time per frame we are willing to spend
const GOVERNOR_MIN_FPS = 48;
const GOVERNOR_STRIKES = 2; // consecutive slow checks before the grid shrinks
const GOVERNOR_SHRINK = 0.7;
const GOVERNOR_MIN_CELLS = 1200;
const RESIZE_DEBOUNCE_MS = 250;

// Same breakpoint as the stylesheet's phone layout, checked when it matters rather than at load.
const phoneLayout = () => matchMedia("(pointer: coarse)").matches || matchMedia("(max-width: 720px)").matches;
const params = { density: 0.35, turbulence: 0.35, arc: 0.3, drop: 0, speed: 0.5, emptiness: 0, accent: 0 };
const targets = { density: 0.35, turbulence: 0.35, arc: 0.3, emptiness: 0, accent: 0 };
const groundParams = { ...params };
const motions = { from: "drift", to: "drift", mix: 1 }; // blended over CROSSFADE_S so speed never jumps
const placement = { from: "bleed", to: "bleed", mix: 1 }; // composition masks crossfade the same way
let beatEnv = 0;
let surgePhase = 0;
let stutterHold = 0;

const canvas = document.getElementById("stage");
const renderer = new AsciiRenderer(canvas, 5500); // phones too: the governor steps down if frames run long
const ledgerEl = document.getElementById("ledger");
const ledger = new Ledger(ledgerEl);
const statusCells = Object.fromEntries([...document.querySelectorAll("#status [data-k]")].map((n) => [n.dataset.k, n]));
const noteInput = document.getElementById("note");
const holdInput = document.getElementById("cadence");
const holdLabel = document.getElementById("cadence-label");
const liveInput = document.getElementById("live");
const restEl = document.getElementById("rest");
const restBody = document.getElementById("rest-body");
const heldEl = document.getElementById("held");
const restDefault = restBody.textContent;
const ear = new Ear();

const figure = new Layer(PATTERNS, renderer.cols, renderer.rows, renderer.aspect, "embers");
const ground = new Layer(PATTERNS, renderer.cols, renderer.rows, renderer.aspect, "none");
const figureLook = renderer.createLook("dots", "bone");
const groundLook = renderer.createLook("dots", "bone");
const camera = new Camera();
let directing = null; // the chips and the note, composed into one sentence for Jev
let rejected = []; // pictures the listener has just swiped away
let lastRolled = null; // what the current scene rolled, so a rejection can name it
let held = false; // the listener is holding this picture: no new scene until they let go
let directTimer = 0;
let masks = null; // { from, to, mixed, figure, ground } Float32Arrays sized to the grid
let views = null; // the camera's window onto each layer's larger field, at screen size
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
let lastSceneAt = 0;
let sceneSound = null; // a pulse-window description from when the current picture was asked for
let turnStreak = 0;
let sessionEndsAt = 0;
let jevResting = false;
let session = null; // the server's token for this start; every judgment carries it
let sourceName = "demo";
let pulseRunning = false;
let judgeCount = 0;
let sessionTokens = 0;
let energyTrail = [];
let lastReleaseAt = -Infinity;
let idle = true; // before Start: a quiet picture plays behind the intro with no audio
let lastLayers = null; // what the most recent frame drew, for exports
let lastGain = 1;
let lastTaste = null; // Jev's most recent scene answers, re-rolled while Jev is unreachable
let tasteFailures = 0;
let pulseFailures = 0;

// Calm starter odds for when Jev has not answered yet at all.
const STARTER_TASTE = {
  pattern: { probabilities: { embers: 0.4, plasma: 0.3, flow: 0.3 }, choice: "embers" },
  ground: { probabilities: { none: 0.7, flow: 0.3 }, choice: "none" },
  glyphs: { probabilities: { dots: 0.5, classic: 0.3, braille: 0.2 }, choice: "dots" },
  palette: { probabilities: { bone: 0.4, glacier: 0.3, dusk: 0.3 }, choice: "bone" },
  motion: { probabilities: { drift: 0.6, breathe: 0.4 }, choice: "drift" },
  camera: { probabilities: { hold: 0.5, drift: 0.3, push: 0.2 }, choice: "hold" },
  placement: { probabilities: { bleed: 0.5, island: 0.3, horizon: 0.2 }, choice: "bleed" },
  emptiness: { score: 0.5, confidence: 0.5, legend: { 0: "No reserved emptiness", 1: "A little breathing room", 2: "Generous emptiness", 3: "Mostly silence" }, probabilities: { 0: 0.5, 1: 0.5, 2: 0, 3: 0 } },
  accent: { score: 0.5, confidence: 0.5, legend: { 0: "No accent", 1: "A few sparks", 2: "Bold counterpoint" }, probabilities: { 0: 0.5, 1: 0.5, 2: 0 } },
};

/** Plain words for a failed Jev call. */
function failureText(err) {
  if (err.status === 529) return "Jev is overloaded right now (TypeSafe 529)";
  if (err.status === 503 && /budget/i.test(err.message)) return err.message;
  if (err.status >= 500) return `Jev is unreachable (${err.status})`;
  return err.message;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function allocMasks() {
  const n = renderer.cols * renderer.rows;
  masks = { from: new Float32Array(n), to: new Float32Array(n), mixed: new Float32Array(n), figure: new Float32Array(n), ground: new Float32Array(n) };
  // Each layer's pattern field is larger than the screen; these hold the part the camera is showing.
  views = { figure: new Float32Array(n), ground: new Float32Array(n) };
}

/** Rebuild the grid after a size or budget change; the picture restarts, so this is kept rare. */
function rebuildGrid() {
  figure.rebuild(renderer.cols, renderer.rows, renderer.aspect);
  ground.rebuild(renderer.cols, renderer.rows, renderer.aspect);
  allocMasks();
}

/** The HUD takes its accent from the palette Jev chose, and turns to ink on paper for paper palettes. */
function setAccent(palette) {
  const p = PALETTES[palette] ?? PALETTES.bone;
  const [r, g, b] = p.levels[10];
  document.documentElement.style.setProperty("--accent", `${r | 0}, ${g | 0}, ${b | 0}`);
  if (p.paper) document.documentElement.dataset.paper = "1";
  else delete document.documentElement.dataset.paper;
}

/** The ground is an under-painting: a quiet family, never the same as the figure's. */
function groundFamily(figureFamily) {
  return figureFamily === "dots" ? "braille" : "dots";
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

/** Piecewise-linear lookup of a per-level table by a Score's expectation. */
function byScore(table, answer) {
  const s = Math.max(0, Math.min(table.length - 1, answer.score));
  const i = Math.floor(s);
  const k = s - i;
  return i + 1 < table.length ? table[i] + (table[i + 1] - table[i]) * k : table[i];
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
    body: JSON.stringify({ ...payload, session }),
  });
  const body = await res.json();
  if (!res.ok) {
    const err = new Error(body.error ?? `HTTP ${res.status}`);
    err.status = res.status;
    err.code = body.code;
    // The server closed this start (time up, or this address has had its starts for the hour).
    if (err.code === "session_expired" || err.code === "sessions_exhausted") restJev(err.code === "sessions_exhausted" ? body.error : null);
    throw err;
  }
  judgeCount += 1;
  sessionTokens += body.usage.input_tokens;
  ledger.meta(body.model, body.ms, sessionTokens);
  return body;
}

/** The scene: figure, ground, glyphs, colour, motion, placement, emptiness, accent. Rolled from Jev's odds. */
async function judgeTaste() {
  if (tasteInFlight || jevResting) return;
  if (held) {
    // The listener is holding this picture. The feel keeps breathing; the scene does not change.
    nextTasteAt = performance.now() + 500;
    return;
  }
  const sound = ear.describe(TASTE_WINDOW_S);
  if (!sound) {
    ledger.say("Nothing to hear yet — play something near the mic.", "wait");
    nextTasteAt = performance.now() + SILENCE_RETRY_MS;
    return;
  }
  tasteInFlight = true;
  ledger.say("Asking Jev for the next picture…", "wait");
  const holdMs = Number(holdInput.value) * 1000;
  // The pulse loop later asks whether the music has turned since this moment, comparing like with
  // like: a two-second description now against two-second descriptions then.
  const soundNow = ear.describe(PULSE_WINDOW_S) ?? sound;
  try {
    // With the live loop off, the pulse questions ride along on this call instead.
    const body = await postJudge({
      sound,
      set: liveInput.checked ? "taste" : "all",
      note: directing.note,
      // The chips alone: the note already travels as listener_note and does not need saying twice.
      direction: composeDirection(directing.active, ""),
      rejected,
      local_time: localTime(),
    });
    tasteFailures = 0;
    lastTaste = body;
    applyTaste(body);
    if (body.answers.density) applyPulse(body);
    ledger.say("");
    sceneSound = soundNow;
    turnStreak = 0;
    lastSceneAt = performance.now();
    nextTasteAt = lastSceneAt + holdMs;
  } catch (err) {
    if (err.code) return; // resting now; nothing to retry
    // Keep the show moving: roll again from Jev's last odds (or the starter set) and retry later.
    tasteFailures += 1;
    const wait = Math.min(MAX_BACKOFF_MS, 6000 * 2 ** tasteFailures);
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
    ground: roll(answers.ground.probabilities),
    glyphs: roll(answers.glyphs.probabilities),
    palette: roll(answers.palette.probabilities),
    motion: roll(answers.motion.probabilities),
    placement: roll(answers.placement.probabilities),
    // An answer set replayed from before the camera existed has no camera question to roll.
    camera: answers.camera ? roll(answers.camera.probabilities) : null,
  };
  lastRolled = rolled;
  if (rolled.camera) camera.setMove(rolled.camera);
  figure.switchTo(rolled.pattern);
  ground.switchTo(rolled.ground === rolled.pattern ? "none" : rolled.ground); // a ground identical to the figure adds nothing
  renderer.setLook(figureLook, rolled.glyphs, rolled.palette);
  renderer.setLook(groundLook, groundFamily(rolled.glyphs), rolled.palette);
  setAccent(rolled.palette);
  if (rolled.motion !== motions.to) {
    motions.from = motions.to;
    motions.to = rolled.motion;
    motions.mix = 0;
  }
  if (rolled.placement !== placement.to) {
    placement.from = placement.to;
    placement.to = rolled.placement;
    placement.mix = 0;
  }
  targets.emptiness = scoreUnit(answers.emptiness);
  targets.accent = byScore(ACCENT_SHARE, answers.accent);
  ledger.showTaste({ ...body, rolled });
}

/** The feel: fill, order, arc, drop-soon, turned. The next call fires as soon as the previous one returns. */
async function pulseLoop() {
  if (pulseRunning) return;
  pulseRunning = true;
  while (liveInput.checked && !jevResting) {
    const sound = document.hidden ? null : ear.describe(PULSE_WINDOW_S); // a background tab spends no tokens
    if (!sound) {
      await sleep(SILENCE_RETRY_MS);
      continue;
    }
    const started = performance.now();
    try {
      applyPulse(await postJudge({ sound, set: "pulse", before: sceneSound ?? undefined }));
      pulseFailures = 0;
      if (performance.now() - lastSceneAt < BASELINE_SETTLE_MS) sceneSound = sound;
    } catch (err) {
      if (err.code) continue; // resting now: the loop condition ends it
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
  // The music turned: end the scene early, once the current picture has had a moment to be seen.
  turnStreak = answers.turned && answers.turned.noul >= TURN_MIN ? turnStreak + 1 : 0;
  if (turnStreak >= TURN_STREAK && performance.now() - lastSceneAt >= MIN_HOLD_MS && !tasteInFlight) nextTasteAt = 0;
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
    camera.release();
    nextTasteAt = 0; // re-roll the picture on the drop itself
  }
}

/** The composition mask for this frame: Jev's placement, crossfaded, weighted by its emptiness. */
function currentMask(dt, t) {
  placement.mix = Math.min(1, placement.mix + dt / CROSSFADE_S);
  makeMask(placement.to, renderer.cols, renderer.rows, renderer.aspect, t, masks.to);
  if (placement.mix >= 1) return masks.to;
  makeMask(placement.from, renderer.cols, renderer.rows, renderer.aspect, t, masks.from);
  mixMasks(masks.from, masks.to, placement.mix, masks.mixed);
  return masks.mixed;
}

/**
 * Both layers for this frame: figure over ground, each seen through the camera and composed by
 * the mask. The camera resamples the field rather than moving the glyphs, so the character
 * lattice never shifts off its grid — the picture moves, the text does not.
 */
function composeLayers(dt, t, live, frozen) {
  Object.assign(groundParams, params, { density: params.density * 0.6, speed: params.speed * 0.6 });
  const figureField = figure.step(dt, t, live, params, frozen);
  const groundField = ground.step(dt, t, live, groundParams, frozen);
  sampleThrough(figureField, figure.cols, figure.rows, camera.view(FIGURE_DEPTH), views.figure, renderer.cols, renderer.rows);
  sampleThrough(groundField, ground.cols, ground.rows, camera.view(GROUND_DEPTH), views.ground, renderer.cols, renderer.rows);
  const mask = currentMask(dt, t);
  applyMask(views.figure, mask, params.emptiness, masks.figure);
  applyMask(views.ground, mask, params.emptiness * 0.6, masks.ground);
  return [
    { field: masks.ground, look: groundLook, gain: lastGain * GROUND_GAIN, accent: 0, alpha: GROUND_ALPHA },
    { field: masks.figure, look: figureLook, gain: lastGain, accent: params.accent },
  ];
}

function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Download the frame on screen right now as a high-resolution PNG of the art alone. */
function saveFrame() {
  if (!lastLayers) return;
  const when = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}-${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`;
  const out = renderer.exportFrame(lastLayers);
  out.toBlob(async (blob) => {
    if (!blob) {
      ledger.say("Could not export the frame (canvas too large for this browser).", "error");
      return;
    }
    const name = `roomtone-${stamp}-${out.width}x${out.height}.png`;
    // Phones: the share sheet ("Save Image") is far more reliable than a download link for a blob.
    const file = new File([blob], name, { type: "image/png" });
    if (phoneLayout() && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Roomtone" });
        return;
      } catch (err) {
        if (err.name === "AbortError") return; // the user closed the sheet
      }
    }
    downloadBlob(blob, name);
  }, "image/png");
}

function govern(now) {
  if (GOVERNOR_OFF || now < nextGovernorAt) return;
  nextGovernorAt = now + GOVERNOR_INTERVAL_MS;
  if (document.hidden || figure.transitioning || ground.transitioning || renderer.budget <= GOVERNOR_MIN_CELLS) return; // transitions double the work briefly
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

  for (const k of ["density", "turbulence", "arc"]) params[k] += (targets[k] - params[k]) * Math.min(1, dt / PULSE_EASE_S);
  for (const k of ["emptiness", "accent"]) params[k] += (targets[k] - params[k]) * Math.min(1, dt / SCENE_EASE_S);
  const frozen = updateMotion(dt, t, live);
  checkDropRelease(live, now);
  flash *= Math.exp(-dt * FLASH_DECAY);
  const charge = Math.max(0, Math.min(1, (params.drop - 0.4) / 0.4));
  // The frame opens up while Jev expects a drop and snaps in when one lands: the picture
  // anticipates the music instead of only reacting to it.
  camera.setCharge(charge);
  camera.step(dt, t, live);
  lastGain = ARC_GAIN_MIN + (ARC_GAIN_MAX - ARC_GAIN_MIN) * params.arc + DROP_SHIMMER * charge * beatEnv;
  lastLayers = composeLayers(dt, t, live, frozen);
  renderer.draw(lastLayers, dt, flash);
  workMs += (performance.now() - work0 - workMs) * 0.05;

  if (now >= nextStatusAt) {
    nextStatusAt = now + 1000 / STATUS_HZ;
    const mm = Math.floor(t / 60), ss = String(Math.floor(t % 60)).padStart(2, "0");
    statusCells.state.textContent = jevResting ? "jev resting" : live.silent ? "quiet" : "listening";
    statusCells.time.textContent = `${mm}:${ss}`;
    statusCells.bpm.textContent = live.bpm ? `${live.bpm} bpm` : "no beat";
    statusCells.judgments.textContent = `${judgeCount} judgments`;
    statusCells.perf.textContent = `${Math.round(fps)} fps · ${workMs.toFixed(1)} ms · ${renderer.cols}×${renderer.rows}`;
  }
  govern(now);
  if (!jevResting && now >= sessionEndsAt) restJev();
  if (now >= nextTasteAt) judgeTaste();
}

/** Ask the server for a session: SESSION_S seconds of Jev on this start. False when this address is out of starts. */
async function openSession() {
  try {
    const res = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: sourceName }) });
    const body = await res.json();
    if (!res.ok) {
      session = null;
      restJev(body.error ?? `Could not start a Jev session (${res.status}).`);
      return false;
    }
    session = body.session;
    sessionEndsAt = performance.now() + (body.seconds || SESSION_S) * 1000;
    return true;
  } catch (err) {
    session = null;
    restJev(`Could not reach the server to start Jev: ${err.message}`);
    return false;
  }
}

/** The per-start budget is spent: stop asking Jev, keep the picture moving, offer another start. */
function restJev(message = null) {
  jevResting = true;
  restEl.hidden = false;
  restBody.textContent = message ?? restDefault;
  ledger.say(message ?? `Jev has listened for ${SESSION_LABEL} — press Start Jev again to keep going.`, "wait");
}

async function resumeJev() {
  if (!jevResting) return;
  if (!(await openSession())) return;
  jevResting = false;
  restEl.hidden = true;
  ledger.say("");
  nextTasteAt = 0;
  pulseLoop();
}

/** A new picture on request; while Jev rests, the request is the second start. */
function askNow() {
  if (jevResting) resumeJev();
  else nextTasteAt = 0;
}

/** Holding keeps the current picture: the feel still breathes, but no new scene is asked for. */
function setHeld(on) {
  if (held === on) return;
  held = on;
  heldEl.hidden = !on;
  if (!on) nextTasteAt = Math.max(nextTasteAt, performance.now() + 1500); // a moment to look before it moves
}

/**
 * Swiped away: name what was turned down and ask for something else. Jev is told about the last
 * few rejections, so it stops offering them — taste that accumulates inside a stateless model,
 * with the browser carrying the memory.
 */
function rejectCurrent() {
  if (!lastRolled) return;
  const descriptor = `${lastRolled.pattern} in ${lastRolled.palette} with ${lastRolled.glyphs}`;
  rejected = [descriptor, ...rejected.filter((x) => x !== descriptor)].slice(0, REJECT_MEMORY);
  setHeld(false);
  askNow();
}

/** Chips and the note are a direction, not a search box: settle briefly, then re-judge once. */
function directed() {
  clearTimeout(directTimer);
  directTimer = setTimeout(() => {
    if (!idle) askNow();
  }, DIRECT_DEBOUNCE_MS);
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
  camera.step(dt, t, live);
  // The layer's field is overscanned, so even the intro has to look at it through the camera.
  sampleThrough(figure.step(dt, t, live, params), figure.cols, figure.rows, camera.view(FIGURE_DEPTH), views.figure, renderer.cols, renderer.rows);
  renderer.draw([{ field: views.figure, look: figureLook, gain: 1, accent: 0 }], dt, 0);
}

/** Plain words for a source that would not start; each one has a different thing to do about it. */
function sourceFailure(err, name) {
  if (err.name === "NotAllowedError") {
    return name === "tab"
      ? "Nothing shared. Press “Listen to a tab” again and pick the tab playing music."
      : "Microphone blocked. Allow the mic for this page, or play the demo loop.";
  }
  if (err.name === "NoAudioTrackError") return err.message;
  return `Could not start audio: ${err.message}`;
}

async function start(source, name) {
  const intro = document.getElementById("intro");
  const note = intro.querySelector("[data-intro-message]");
  try {
    await ear.start(source);
  } catch (err) {
    note.textContent = sourceFailure(err, name);
    return;
  }
  sourceName = name;
  idle = false;
  intro.hidden = true;
  document.getElementById("hud").hidden = false;
  if (phoneLayout()) ledgerEl.classList.add("is-collapsed");
  const health = await fetch("/api/health").then((r) => r.json()).catch(() => ({ hasKey: false }));
  if (!health.hasKey) ledger.say("TYPESAFE_API_KEY is not set on the server. Add it to .env and restart.", "error");
  startedAt = performance.now();
  lastFrame = startedAt;
  lastSceneAt = startedAt;
  nextTasteAt = startedAt + 2500;
  nextGovernorAt = startedAt + 4000;
  sessionEndsAt = startedAt + SESSION_S * 1000;
  requestAnimationFrame(frame);
  if (await openSession()) pulseLoop();
}

allocMasks();
params.density = 0.25;
setAccent("bone");
directing = new Directing({ chipsEl: document.getElementById("direction-chips"), noteEl: noteInput, onChange: directed });
document.fonts.ready.then(() => renderer.resize()).finally(() => {
  rebuildGrid();
  requestAnimationFrame(idleFrame);
});

document.getElementById("start-mic").addEventListener("click", () => start(micSource, "mic"));
document.getElementById("start-demo").addEventListener("click", () => start(demoSource, "demo"));
// Tab audio is desktop Chrome and Edge only; elsewhere the button would promise what cannot work.
if (canCaptureTab()) {
  for (const id of ["start-tab", "start-tab-hint"]) document.getElementById(id).hidden = false;
  document.getElementById("start-tab").addEventListener("click", () => {
    start((ctx) => tabSource(ctx, () => ledger.say("Sharing ended — the picture keeps moving on what it last heard.", "wait")), "tab");
  });
}
document.getElementById("judge-now").addEventListener("click", askNow);
document.getElementById("resume").addEventListener("click", resumeJev);
document.getElementById("ledger-toggle").addEventListener("click", () => ledgerEl.classList.toggle("is-collapsed"));
document.getElementById("ledger-head").addEventListener("click", (e) => {
  if (phoneLayout() && e.target.id !== "ledger-toggle") ledgerEl.classList.toggle("is-collapsed");
});
document.getElementById("ledger-show").addEventListener("click", () => ledgerEl.classList.remove("is-hidden"));
document.getElementById("save-frame").addEventListener("click", saveFrame);
holdInput.value = DEFAULT_HOLD_S;
holdLabel.textContent = `${DEFAULT_HOLD_S} s`;
holdInput.addEventListener("input", () => {
  holdLabel.textContent = `${holdInput.value} s`;
});
liveInput.addEventListener("change", () => {
  if (liveInput.checked && startedAt) pulseLoop();
});
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const { cols, rows } = renderer;
    renderer.resize();
    if (cols !== renderer.cols || rows !== renderer.rows) rebuildGrid();
  }, RESIZE_DEBOUNCE_MS);
});
noteInput.addEventListener("keydown", (e) => {
  // Enter applies the note straight away: Jev re-judges with the new context.
  if (e.key === "Enter") {
    e.preventDefault();
    noteInput.blur();
    askNow();
  }
});

// Press and hold the picture to keep it; flick it aside to turn it down.
let pointerFrom = null;
let holdTimer = 0;
canvas.addEventListener("pointerdown", (e) => {
  if (idle) return;
  pointerFrom = { x: e.clientX, y: e.clientY };
  holdTimer = setTimeout(() => setHeld(true), HOLD_MS);
});
canvas.addEventListener("pointermove", (e) => {
  if (!pointerFrom) return;
  const dx = e.clientX - pointerFrom.x;
  if (Math.abs(dx) < SWIPE_PX || Math.abs(e.clientY - pointerFrom.y) > Math.abs(dx)) return;
  clearTimeout(holdTimer);
  pointerFrom = null;
  rejectCurrent();
});
for (const event of ["pointerup", "pointercancel", "pointerleave"]) {
  canvas.addEventListener(event, () => {
    clearTimeout(holdTimer);
    pointerFrom = null;
    setHeld(false);
  });
}
window.addEventListener("keydown", (e) => {
  if (e.target === noteInput) return;
  if (idle) {
    if (e.key === "Enter" && document.activeElement?.tagName !== "BUTTON") document.getElementById("start-mic").click();
    return;
  }
  if (e.key === "h" || e.key === "H") ledgerEl.classList.toggle("is-hidden");
  if (e.key === "n" || e.key === "N") askNow();
  if (e.key === "s" || e.key === "S") saveFrame();
});
