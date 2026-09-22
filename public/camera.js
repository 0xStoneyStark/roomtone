// A directed camera over the overscanned glyph field. Patterns render into a field larger
// than the screen grid (see layer.js's OVERSCAN); the camera picks a window of that field and
// a zoom, and sampleThrough resamples the FIELD into the screen-sized output. Transforming the
// window rather than the draw positions is what keeps the monospace glyph lattice perfectly
// intact while the picture still slowly pushes, pulls, drifts or sways — the whole point of
// this module.

export const MOVES = ["hold", "push", "pull", "drift", "sway"];
export const MOVE_EASE_S = 3.5; // how long one directed move takes to cross over into the next
export const MIN_ZOOM = 0.78;
export const MAX_ZOOM = 1.6;

const TAU = Math.PI * 2;

// A far layer should read as sitting further back: it gets a fraction of the near layer's
// zoom and offset (35-45% asked for), which is what makes the two layers read as depth rather
// than as one flat picture moving in lockstep.
const PARALLAX_FAR = 0.4;

// Each move's own shape. Push/pull ease toward the zoom limit exponentially (never fully
// arriving, so there is nothing to "snap" to); hold/drift/sway are periodic so a sine wave
// always turns around smoothly rather than cutting back to its start.
const HOLD_BREATH_AMP = 0.003; // a fraction of a percent of zoom
const HOLD_BREATH_PERIOD_S = 17;
const PUSH_TAU_S = 20; // time constant; ~40-60s to read as "nearly arrived" without ever snapping
const PULL_TAU_S = 20;
const DRIFT_PERIOD_S = 50; // one full there-and-back traverse
const DRIFT_DX_AMP = 0.14; // fraction of the visible window
const SWAY_PERIOD_S = 25; // within the asked-for 20-30s
const SWAY_DX_AMP = 0.11;
const SWAY_DY_AMP = 0.07; // narrower than dx so the orbit reads as elliptical, not circular

// Anticipation and release, both zoom-only (the frame opens up or kicks in; it does not pan).
const CHARGE_ZOOM_BACK = 0.12;
const CHARGE_SMOOTH_TAU_S = 0.35; // rejects a noisy frame-to-frame drop_soon without feeling laggy
const KICK_ZOOM_IN = 0.1;
const KICK_DECAY_TAU_S = 0.2; // ~3 time constants, so the kick has faded by ~0.6s
const BEAT_FLUTTER_ZOOM = 0.01;
const BEAT_ENV_DECAY_PER_S = 6; // same decay rate app.js uses for its own beat envelope

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** One move's raw (zoom, dx, dy) at `elapsed` seconds since it became the active target.
 * Unrecognised names fall through to "hold" rather than throwing: app.js only ever passes
 * names it got from MOVES, so this is a calm default, not silent error-swallowing. */
function moveOutput(name, elapsed) {
  switch (name) {
    case "push":
      return { zoom: 1 + (MAX_ZOOM - 1) * (1 - Math.exp(-elapsed / PUSH_TAU_S)), dx: 0, dy: 0 };
    case "pull":
      return { zoom: 1 - (1 - MIN_ZOOM) * (1 - Math.exp(-elapsed / PULL_TAU_S)), dx: 0, dy: 0 };
    case "drift":
      return { zoom: 1, dx: DRIFT_DX_AMP * Math.sin((elapsed * TAU) / DRIFT_PERIOD_S), dy: 0 };
    case "sway": {
      const phase = (elapsed * TAU) / SWAY_PERIOD_S;
      return { zoom: 1, dx: SWAY_DX_AMP * Math.cos(phase), dy: SWAY_DY_AMP * Math.sin(phase) };
    }
    default:
      return { zoom: 1 + HOLD_BREATH_AMP * Math.sin((elapsed * TAU) / HOLD_BREATH_PERIOD_S), dx: 0, dy: 0 };
  }
}

export class Camera {
  constructor(overscan = 1.35) {
    this.overscan = overscan;
    this._t = 0; // most recent absolute time seen by step(), so setMove() can stamp a start time
    this.moveFrom = { name: "hold", startT: 0 };
    this.moveTo = { name: "hold", startT: 0 };
    this.mix = 1; // settled on `to` until the first setMove()
    this.chargeTarget = 0;
    this.charge = 0; // smoothed anticipation, 0..1
    this.kick = 0; // release's decaying "in" nudge
    this.beatEnv = 0;
    this.zoomRaw = 1; // this frame's zoom/offset before per-layer depth scaling
    this.dxRaw = 0;
    this.dyRaw = 0;
  }

  /** Queue a cross over to `name` over MOVE_EASE_S. No-op if it is already the target. */
  setMove(name) {
    if (this.moveTo.name === name) return;
    this.moveFrom = this.moveTo; // keeps its own accumulated phase, so the outgoing move doesn't jump either
    this.moveTo = { name, startT: this._t };
    this.mix = 0;
  }

  /** Jev's drop_soon probability, 0..1. Smoothed inside step() so a noisy call doesn't jitter the frame. */
  setCharge(p) {
    this.chargeTarget = clamp(p, 0, 1);
  }

  /** The drop landed: arm a short kick in, decaying back to the move's own path over ~0.6s. */
  release() {
    this.kick = KICK_ZOOM_IN;
  }

  step(dt, t, live) {
    this._t = t;
    this.mix = Math.min(1, this.mix + dt / MOVE_EASE_S);
    const from = moveOutput(this.moveFrom.name, t - this.moveFrom.startT);
    const to = moveOutput(this.moveTo.name, t - this.moveTo.startT);
    const k = this.mix;
    let zoom = from.zoom + (to.zoom - from.zoom) * k;
    const dx = from.dx + (to.dx - from.dx) * k;
    const dy = from.dy + (to.dy - from.dy) * k;

    const chargeAlpha = 1 - Math.exp(-dt / CHARGE_SMOOTH_TAU_S);
    this.charge += (this.chargeTarget - this.charge) * chargeAlpha;
    zoom -= CHARGE_ZOOM_BACK * this.charge; // the frame opening up before a drop lands

    this.kick *= Math.exp(-dt / KICK_DECAY_TAU_S);
    zoom += this.kick;

    // live.beat is a single-frame onset strength (0 most frames); holding it in a decaying
    // envelope turns that spike into a small pulse instead of a one-frame stutter.
    this.beatEnv = live.beat ? Math.max(this.beatEnv, live.beat) : this.beatEnv * Math.exp(-dt * BEAT_ENV_DECAY_PER_S);
    zoom += BEAT_FLUTTER_ZOOM * this.beatEnv;

    this.zoomRaw = zoom;
    this.dxRaw = dx;
    this.dyRaw = dy;
  }

  /** The view for a layer at `depth` (0 = furthest, 1 = nearest): its share of this frame's
   * camera motion, clamped to stay on the overscanned field and within [MIN_ZOOM, MAX_ZOOM]. */
  view(depth) {
    const df = PARALLAX_FAR + (1 - PARALLAX_FAR) * clamp(depth, 0, 1);
    const zoom = clamp(1 + (this.zoomRaw - 1) * df, MIN_ZOOM, MAX_ZOOM);
    const maxOffset = Math.max(0, (this.overscan * zoom - 1) / 2);
    const dx = clamp(this.dxRaw * df, -maxOffset, maxOffset);
    const dy = clamp(this.dyRaw * df, -maxOffset, maxOffset);
    return { zoom, dx, dy };
  }
}

/** Resamples `field` (srcCols x srcRows) into `out` (dstCols x dstRows) through `view`, bilinear
 * and allocation-free so a few thousand cells cost nothing at 60fps. A slow push must not
 * shimmer, so this is never nearest-neighbour. */
export function sampleThrough(field, srcCols, srcRows, view, out, dstCols, dstRows) {
  const { zoom, dx, dy } = view;
  const invZoom = 1 / zoom;
  const cx = srcCols / 2 + dx * (dstCols / zoom);
  const cy = srcRows / 2 + dy * (dstRows / zoom);
  const halfDstCols = dstCols / 2;
  const halfDstRows = dstRows / 2;
  const maxX = srcCols - 1;
  const maxY = srcRows - 1;

  for (let j = 0; j < dstRows; j++) {
    let sy = cy + (j - halfDstRows + 0.5) * invZoom - 0.5;
    sy = sy < 0 ? 0 : sy > maxY ? maxY : sy;
    const y0 = sy | 0;
    const y1 = y0 < maxY ? y0 + 1 : y0;
    const fy = sy - y0;
    const row0 = y0 * srcCols;
    const row1 = y1 * srcCols;
    const outRow = j * dstCols;
    for (let i = 0; i < dstCols; i++) {
      let sx = cx + (i - halfDstCols + 0.5) * invZoom - 0.5;
      sx = sx < 0 ? 0 : sx > maxX ? maxX : sx;
      const x0 = sx | 0;
      const x1 = x0 < maxX ? x0 + 1 : x0;
      const fx = sx - x0;
      const top = field[row0 + x0] + (field[row0 + x1] - field[row0 + x0]) * fx;
      const bot = field[row1 + x0] + (field[row1 + x1] - field[row1 + x0]) * fx;
      out[outRow + i] = top + (bot - top) * fy;
    }
  }
}
