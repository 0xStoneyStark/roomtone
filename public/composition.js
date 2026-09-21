// Composition: where the mass of the picture sits in the frame. Jev's `placement` picks one of
// these soft masks (see PLACEMENTS in questions.mjs); `emptiness` sets how strongly the
// integrator blends it over the figure/ground field via applyMask. Same noise/hash style as
// patterns.js: cheap 3-D value noise, aspect-corrected distances so circles read round on screen.

const TAU = Math.PI * 2;
const FLOOR = 0.03; // a mask is never fully dark, so a held picture can still breathe

function hash(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(u) {
  return u * u * (3 - 2 * u);
}

/** Cheap 3-D value noise in 0..1; the third axis is time. */
function noise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = smooth(x - xi), v = smooth(y - yi), w = smooth(z - zi);
  const lerp = (a, b, k) => a + (b - a) * k;
  const c = (dx, dy, dz) => hash(xi + dx, yi + dy, zi + dz);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0 + 1e-6));
  return t * t * (3 - 2 * t);
}

/** Lifts a 0..1 shape value onto the [FLOOR, 1] range the integrator expects. */
function lift(v) {
  return FLOOR + (1 - FLOOR) * v;
}

// Reused across calls so a frame costs no allocations; grown lazily if the grid gets wider.
let colScratch = new Float32Array(0);
function getColScratch(n) {
  if (colScratch.length < n) colScratch = new Float32Array(n);
  return colScratch;
}

// --- Session state for constellation and edge: fixed for the session, re-rollable for tests. ---
const MAX_CLUSTERS = 5;
const clusters = Array.from({ length: MAX_CLUSTERS }, () => ({ cx: 0.5, cy: 0.5, driftFreq: 0.3, driftPhase: 0 }));
const ccx = new Float64Array(MAX_CLUSTERS);
const ccy = new Float64Array(MAX_CLUSTERS);
let clusterCount = 3;
let edgeSide = -1; // -1 = mass clings left, 1 = mass clings right
let seedInt = 0;

function rollSession() {
  seedInt = Math.floor(Math.random() * 1_000_000);
  clusterCount = 3 + Math.floor(hash(seedInt, 7, 0) * 3); // 3..5
  for (let c = 0; c < MAX_CLUSTERS; c++) {
    clusters[c].cx = 0.2 + 0.6 * hash(seedInt, c, 1); // keep clusters off the very edge
    clusters[c].cy = 0.2 + 0.6 * hash(seedInt, c, 2);
    clusters[c].driftFreq = TAU / (14 + 8 * hash(seedInt, c, 3)); // slow wander, ~14-22s period
    clusters[c].driftPhase = hash(seedInt, c, 4) * TAU;
  }
  edgeSide = hash(seedInt, 42, 0) < 0.5 ? -1 : 1;
}
rollSession();

/** Re-rolls the session's constellation layout and edge side; exported for tests. */
export function reseed() {
  rollSession();
}

// --- Masks. Each writes cols*rows values 0..1 (before the floor lift) into `out`, row-major. ---

function bleed(cols, rows, aspect, t, out) {
  out.fill(1);
}

function horizon(cols, rows, aspect, t, out) {
  // Per-column jitter (low-frequency noise) plus a slow overall tilt, precomputed once per frame.
  const jitter = getColScratch(cols);
  const tilt = 0.07 * Math.sin(t * (TAU / 24)); // a few degrees, back and forth over ~24s
  const invCols1 = cols > 1 ? 1 / (cols - 1) : 0;
  for (let x = 0; x < cols; x++) {
    const nx = x * invCols1 - 0.5;
    jitter[x] = (noise(x * 0.09 + seedInt, 0, t * 0.04) - 0.5) * 0.14 + tilt * nx;
  }
  const invRows1 = rows > 1 ? 1 / (rows - 1) : 0;
  for (let y = 0; y < rows; y++) {
    const ny = y * invRows1;
    const row = y * cols;
    for (let x = 0; x < cols; x++) {
      out[row + x] = lift(smoothstep(0.22, 0.66, clamp01(ny + jitter[x])));
    }
  }
}

function island(cols, rows, aspect, t, out) {
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  const breathe = 1 + 0.1 * Math.sin(t * (TAU / 9)); // radius breathes +-10% over ~9s
  const r = 0.225 * cols * breathe; // ~45% of width as a diameter
  const invR2 = 1 / (r * r);
  const innerFrac = 0.65; // fraction of the radius where the soft falloff starts
  const inner2 = innerFrac * innerFrac;
  for (let y = 0; y < rows; y++) {
    const dy2 = (y - cy) * aspect * (y - cy) * aspect;
    const row = y * cols;
    for (let x = 0; x < cols; x++) {
      const dx = x - cx;
      const d2 = (dx * dx + dy2) * invR2; // squared distance, aspect-corrected, no sqrt needed
      out[row + x] = lift(1 - smoothstep(inner2, 1, d2));
    }
  }
}

function diagonal(cols, rows, aspect, t, out) {
  // Distance from a point to the bottom-left -> top-right line, in aspect-corrected units.
  const W = cols, H = rows * aspect;
  const len = Math.sqrt(W * W + H * H) || 1;
  const half = 0.15 * cols; // ~30% of the frame wide, edge to edge
  const inner = half * 0.5;
  const drift = 0.05 * len * Math.sin(t * (TAU / 16)); // the band drifts slowly across its line
  for (let y = 0; y < rows; y++) {
    const py = y * aspect;
    const term = W * (py - H) + drift; // per-row constant
    const row = y * cols;
    for (let x = 0; x < cols; x++) {
      const dist = Math.abs(H * x + term) / len;
      out[row + x] = lift(1 - smoothstep(inner, half, dist));
    }
  }
}

function constellation(cols, rows, aspect, t, out) {
  const H = rows * aspect;
  const r = 0.15 * Math.min(cols, H);
  const invR2 = 1 / (r * r);
  for (let c = 0; c < clusterCount; c++) {
    const cl = clusters[c];
    ccx[c] = (cl.cx + 0.05 * Math.sin(t * cl.driftFreq + cl.driftPhase)) * cols;
    ccy[c] = (cl.cy + 0.05 * Math.cos(t * cl.driftFreq * 0.83 + cl.driftPhase)) * H;
  }
  for (let y = 0; y < rows; y++) {
    const py = y * aspect;
    const row = y * cols;
    for (let x = 0; x < cols; x++) {
      let v = 0;
      for (let c = 0; c < clusterCount; c++) {
        const dx = x - ccx[c], dy = py - ccy[c];
        const cv = 1 - smoothstep(0.5, 1, (dx * dx + dy * dy) * invR2);
        if (cv > v) v = cv;
      }
      out[row + x] = lift(v);
    }
  }
}

function edge(cols, rows, aspect, t, out) {
  // Depends only on x, so compute one column and broadcast it down every row.
  const col = getColScratch(cols);
  const invCols1 = cols > 1 ? 1 / (cols - 1) : 0;
  for (let x = 0; x < cols; x++) {
    const nx = x * invCols1;
    const d = edgeSide < 0 ? nx : 1 - nx; // distance from the side the mass clings to
    col[x] = lift(1 - smoothstep(0, 0.85, d));
  }
  for (let y = 0; y < rows; y++) out.set(col.subarray(0, cols), y * cols);
}

const MASKS = { bleed, horizon, island, diagonal, constellation, edge };

export const PLACEMENTS = ["bleed", "horizon", "island", "diagonal", "constellation", "edge"];

/** Fills `out` (Float32Array, cols*rows, row-major) with a 0..1 soft mask; t is seconds, for slow life. */
export function makeMask(kind, cols, rows, aspect, t, out) {
  const fn = MASKS[kind];
  if (!fn) throw new Error(`unknown placement "${kind}"`);
  fn(cols, rows, aspect, t, out);
}

/** out[i] = field[i] * (1 - strength * (1 - mask[i])); strength 0..1. */
export function applyMask(field, mask, strength, out) {
  for (let i = 0; i < field.length; i++) out[i] = field[i] * (1 - strength * (1 - mask[i]));
}

/** Crossfades two masks: out = a*(1-k) + b*k. */
export function mixMasks(a, b, k, out) {
  for (let i = 0; i < a.length; i++) out[i] = a[i] * (1 - k) + b[i] * k;
}
