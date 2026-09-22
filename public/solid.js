// The tenth picture, and the odd one out: every other pattern in patterns.js is a full-screen
// texture field. This one is a single rotating 3-D solid, point-sampled and z-buffered, drawn
// in text. No mesh is authored — the surface comes entirely from the Gielis superformula, a
// single equation whose parameters sweep continuously from sphere to star to blade to urchin
// to twisted shell. FORMS names a handful of points on that continuum; Jev picks one by name.
//
// Same generator interface as patterns.js: solid(cols, rows, field, aspect) -> { step(dt, t, live, p) }.
// `aspect` is cell height / cell width; world-space Y is converted to rows via `/ aspect`
// (and rows*aspect is the world-space height), exactly as composition.js and the other
// patterns do, so the object reads round rather than squashed.

const TAU = Math.PI * 2;

function hash(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(u) {
  return u * u * (3 - 2 * u);
}

/**
 * Cheap 3-D value noise in 0..1 (same trilinear-hash recipe as patterns.js); the third axis is time.
 * Written out straight rather than with inner helpers: this is called once per point per frame, and
 * a closure allocated here would be tens of thousands of short-lived objects a second.
 */
function noise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = smoothstep(x - xi), v = smoothstep(y - yi), w = smoothstep(z - zi);
  const c000 = hash(xi, yi, zi), c100 = hash(xi + 1, yi, zi);
  const c010 = hash(xi, yi + 1, zi), c110 = hash(xi + 1, yi + 1, zi);
  const c001 = hash(xi, yi, zi + 1), c101 = hash(xi + 1, yi, zi + 1);
  const c011 = hash(xi, yi + 1, zi + 1), c111 = hash(xi + 1, yi + 1, zi + 1);
  const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u;
  const x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
  const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a, b, k) {
  return a + (b - a) * k;
}

/** Gielis superformula radius at one angle. `m/n1/n2/n3` shape the lobe count and sharpness.
 * Near-zero denominators (sharp cusps, by design for spiky/bladed forms) are guarded with an
 * epsilon and the result is clamped by the caller, so no NaN/Infinity ever reaches a point. */
function superformulaRadius(angle, m, n1, n2, n3) {
  const t1 = Math.abs(Math.cos((m * angle) / 4)) ** n2;
  const t2 = Math.abs(Math.sin((m * angle) / 4)) ** n3;
  const denom = (t1 + t2 + 1e-9) ** (1 / n1);
  return 1 / denom;
}

// Named parameter sets on the sphere -> star -> blade -> urchin -> twisted-shell continuum.
// m1/n1/n2/n3 shape the longitude profile (r1, swept over theta, the full turn round the
// vertical axis); m2/n4/n5/n6 shape the latitude profile (r2, swept over phi, pole to pole).
// `twist` (radians) shears each latitude band relative to the next, for the "shell" forms.
const smooth = { m1: 4, n1: 2.4, n2: 2.4, n3: 2.4, m2: 4, n4: 2.4, n5: 2.4, n6: 2.4, twist: 0 };
const swollen = { m1: 6, n1: 0.85, n2: 1.6, n3: 1.6, m2: 5, n4: 1.1, n5: 1.7, n6: 1.7, twist: 0 };
const spiky = { m1: 11, n1: 0.22, n2: 1.6, n3: 1.6, m2: 6, n4: 0.3, n5: 1.5, n6: 1.5, twist: 0 };
const bladed = { m1: 5, n1: 0.3, n2: 9, n3: 0.3, m2: 3, n4: 0.55, n5: 4.5, n6: 0.9, twist: 0 };
const twisted = { m1: 5, n1: 0.55, n2: 1.9, n3: 1.9, m2: 4, n4: 1, n5: 1.6, n6: 1.6, twist: 2.6 };
const hollow = { m1: 4, n1: 2.6, n2: 2.6, n3: 2.6, m2: 2, n4: 0.22, n5: 1, n6: 1, twist: 0 };

/** Named characters a form can have. Jev chooses one of these keys by name. */
export const FORMS = { smooth, swollen, spiky, bladed, twisted, hollow };

/** How the surface is drawn. */
export const SHADINGS = ["lit", "wireframe", "points", "dissolving"];

const DEFAULT_FORM = "smooth";
const DEFAULT_SHADING = "lit";
const RADIUS_MIN = 0.12;
const RADIUS_MAX = 2.2; // caps superformula cusps so a spike stays a spike, not a NaN or a screen-filling ray
const MORPH_S = 1; // "about a second" — the shape's own inertia, not tied to the crossfade between patterns

const POINTS_PER_CELL = 4; // with the 2x2 splat closing the gaps, the budget buys coverage rather than fighting aliasing
const MIN_POINTS = 600;
const MAX_POINTS = 42000;
const MIN_THETA = 14;
const MIN_PHI = 9;

const CAMERA_DIST = 4.5; // > RADIUS_MAX * max scale headroom, so the perspective denominator never goes non-positive
const FIT_FRACTION = 0.72; // fraction of the tighter screen dimension the nominal-radius object spans: it is the subject, not a motif
const NOMINAL_RADIUS = 1.3; // rough "typical" radius across FORMS, used only to size the projection

const AMBIENT = 0.14;
const DIFFUSE = 0.82;
const LIGHT = normalize3(0.5, 0.62, 0.68);

const TURBULENCE_AMPLITUDE = 0.55; // fraction of a point's own radius its noise displacement can reach
const NOISE_FREQ = 0.22;
const NOISE_TIME_FREQ = 0.35;
const DENSITY_FLOOR = 0.22; // even at density 0, a quarter of the point budget still draws — never fully blank
const DISSOLVE_MAX_DROP = 0.92; // full turbulence still leaves a few points to read as "disintegrating", not "gone"
const DISSOLVE_JITTER_CELLS = 2.2;
const SPLAT_MIN_WEIGHT = 0.16; // a cell is covered when the point genuinely overlaps it, not merely touches a corner
const KICK_GAIN = 1.1;
const KICK_DECAY = 5; // 1/s, how fast a beat's scale kick relaxes
const SWELL_RATE = 0.8; // 1/s, low-pass rate for live.energy's slow breathing swell
const ROT_RATE_A = 0.22; // rad/s at speed=0.5, axis A
const ROT_RATE_B = 0.22 * 0.6180339887498949; // golden-ratio-scaled axis B rate: incommensurate with A, so the spin never repeats

function normalize3(x, y, z) {
  const len = Math.sqrt(x * x + y * y + z * z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

/** In place: dst[key] eased from a[key] toward b[key] by k (dst and a may be the same object). */
function lerpParams(dst, a, b, k) {
  for (const key in b) dst[key] = lerp(a[key], b[key], k);
}

function copyParams(dst, src) {
  for (const key in src) dst[key] = src[key];
}

export function solid(cols, rows, field, aspect = 1) {
  // --- grid sizing: happens once per generator instance, i.e. once per screen/field size,
  // never inside step(). ---
  const targetPoints = clamp(Math.round(cols * rows * POINTS_PER_CELL), MIN_POINTS, MAX_POINTS);
  const phiSteps = Math.max(MIN_PHI, Math.round(Math.sqrt(targetPoints / 2)));
  const thetaSteps = Math.max(MIN_THETA, Math.round(targetPoints / phiSteps));
  const N = thetaSteps * phiSteps;

  // Per-axis angle tables: theta sweeps a full turn (longitude), phi pole to pole (latitude).
  // r1 depends only on theta and r2 only on phi, so the superformula is evaluated thetaSteps +
  // phiSteps times per frame, not thetaSteps * phiSteps — the combine step below is what's O(N),
  // and it is pure multiply-add, no trig or pow.
  const thetaAngle = new Float32Array(thetaSteps);
  const thetaCos = new Float32Array(thetaSteps);
  const thetaSin = new Float32Array(thetaSteps);
  for (let i = 0; i < thetaSteps; i++) {
    const a = (i / thetaSteps) * TAU;
    thetaAngle[i] = a;
    thetaCos[i] = Math.cos(a);
    thetaSin[i] = Math.sin(a);
  }
  const phiAngle = new Float32Array(phiSteps);
  const phiCos = new Float32Array(phiSteps);
  const phiSin = new Float32Array(phiSteps);
  for (let j = 0; j < phiSteps; j++) {
    const a = -Math.PI / 2 + (j / (phiSteps - 1)) * Math.PI;
    phiAngle[j] = a;
    phiCos[j] = Math.cos(a);
    phiSin[j] = Math.sin(a);
  }

  // Stable per-sample pseudo-random fields (density gate, dissolve gate, dissolve jitter phase).
  // Precomputed once so which points drop/scatter shifts smoothly as p changes, rather than
  // re-rolling (and flickering) every frame.
  const orderDensity = new Float32Array(N);
  const orderDissolve = new Float32Array(N);
  const jitterSeed = new Float32Array(N);
  const lineMask = new Uint8Array(N); // wireframe: meridian/parallel crossings only
  const thetaLineStep = Math.max(1, Math.round(thetaSteps / 16));
  const phiLineStep = Math.max(1, Math.round(phiSteps / 8));
  for (let j = 0; j < phiSteps; j++) {
    for (let i = 0; i < thetaSteps; i++) {
      const idx = j * thetaSteps + i;
      orderDensity[idx] = hash(i, j, 7);
      orderDissolve[idx] = hash(i, j, 13);
      jitterSeed[idx] = hash(i, j, 19);
      lineMask[idx] = i % thetaLineStep === 0 || j % phiLineStep === 0 ? 1 : 0;
    }
  }

  // Reused buffers: positions (pass A), normals (pass B), and the field's own z-buffer.
  const posX = new Float32Array(N), posY = new Float32Array(N), posZ = new Float32Array(N);
  const nrmX = new Float32Array(N), nrmY = new Float32Array(N), nrmZ = new Float32Array(N);
  const r1 = new Float32Array(thetaSteps);
  const r2 = new Float32Array(phiSteps);
  const twistCos = new Float32Array(phiSteps);
  const twistSin = new Float32Array(phiSteps);
  const zbuffer = new Float32Array(cols * rows);

  const baseProjScale = (FIT_FRACTION * Math.min(cols, rows * aspect)) / NOMINAL_RADIUS;
  const focal = baseProjScale * CAMERA_DIST;
  const cx = cols / 2, cy = rows / 2;

  // Morph state: paramsNow is what r1/r2 are computed from each frame; paramsA is the frozen
  // snapshot it's easing away from. Both are fixed-shape objects mutated in place (see
  // lerpParams/copyParams) so switching or re-targeting p.form never allocates.
  let targetFormKey = DEFAULT_FORM;
  let morphT = 1; // starts settled on the default
  const paramsA = { ...FORMS[DEFAULT_FORM] };
  const paramsNow = { ...FORMS[DEFAULT_FORM] };

  let rotA = 0, rotB = 0;
  let kick = 0;
  let energyLP = 0;

  return {
    step(dt, t, live, p) {
      const density = clamp01(p?.density ?? 0.5);
      const turbulence = clamp01(p?.turbulence ?? 0);
      const speed = clamp01(p?.speed ?? 0.5);
      const energy = live?.energy ?? 0;
      const beat = live?.beat ?? 0;
      const formKey = FORMS[p?.form] ? p.form : DEFAULT_FORM;
      const shading = SHADINGS.includes(p?.shading) ? p.shading : DEFAULT_SHADING;

      // --- morph the superformula parameters toward the chosen form, over MORPH_S seconds ---
      if (formKey !== targetFormKey) {
        copyParams(paramsA, paramsNow); // ease from wherever we currently are, not from scratch
        targetFormKey = formKey;
        morphT = 0;
      }
      morphT = Math.min(1, morphT + dt / MORPH_S);
      lerpParams(paramsNow, paramsA, FORMS[targetFormKey], smoothstep(morphT));
      const fp = paramsNow;

      // --- r1(theta), r2(phi): the only superformula evaluations this frame, O(thetaSteps + phiSteps) ---
      for (let i = 0; i < thetaSteps; i++) {
        r1[i] = clamp(superformulaRadius(thetaAngle[i], fp.m1, fp.n1, fp.n2, fp.n3), RADIUS_MIN, RADIUS_MAX);
      }
      for (let j = 0; j < phiSteps; j++) {
        r2[j] = clamp(superformulaRadius(phiAngle[j], fp.m2, fp.n4, fp.n5, fp.n6), RADIUS_MIN, RADIUS_MAX);
        const tw = fp.twist * (j / (phiSteps - 1) - 0.5);
        twistCos[j] = Math.cos(tw);
        twistSin[j] = Math.sin(tw);
      }

      // --- rotation, beat kick, energy swell: object motion driven by the music ---
      rotA += dt * (0.06 + ROT_RATE_A * (0.3 + speed));
      rotB += dt * (0.06 + ROT_RATE_B * (0.3 + speed));
      const cA = Math.cos(rotA), sA = Math.sin(rotA);
      const cB = Math.cos(rotB), sB = Math.sin(rotB);
      kick *= Math.exp(-dt * KICK_DECAY);
      kick += beat * KICK_GAIN;
      energyLP += (energy - energyLP) * Math.min(1, dt * SWELL_RATE);
      const scaleAll = 1 + 0.16 * Math.min(1, kick) + 0.14 * energyLP;

      const tz = t * NOISE_TIME_FREQ;
      const wantWireframe = shading === "wireframe";
      const wantDissolve = shading === "dissolving";
      const needsNormal = shading === "lit" || wantWireframe || wantDissolve;
      const densityCutoff = DENSITY_FLOOR + (1 - DENSITY_FLOOR) * density;
      const dropShare = wantDissolve ? DISSOLVE_MAX_DROP * turbulence : -1;

      // --- pass A: local surface position per sample (combine + twist + turbulence) ---
      for (let j = 0; j < phiSteps; j++) {
        const r2j = r2[j], cpj = phiCos[j], spj = phiSin[j], twc = twistCos[j], tws = twistSin[j];
        const rowBase = j * thetaSteps;
        for (let i = 0; i < thetaSteps; i++) {
          const idx = rowBase + i;
          const r1i = r1[i];
          let x = r1i * thetaCos[i] * r2j * cpj;
          let y = r1i * thetaSin[i] * r2j * cpj;
          const z = r2j * spj;
          if (twc !== 1 || tws !== 0) {
            const rx = x * twc - y * tws;
            const ry = x * tws + y * twc;
            x = rx; y = ry;
          }
          if (turbulence > 0) {
            const nz = noise(i * NOISE_FREQ, j * NOISE_FREQ, tz) * 2 - 1;
            const s = 1 + turbulence * TURBULENCE_AMPLITUDE * nz; // scales the point along its own radius, so it stays a "little noise", not a spike
            posX[idx] = x * s; posY[idx] = y * s; posZ[idx] = z * s;
          } else {
            posX[idx] = x; posY[idx] = y; posZ[idx] = z;
          }
        }
      }

      // --- pass B: normal (central difference on the sample grid), rotate, project, shade, z-test ---
      field.fill(0);
      zbuffer.fill(-Infinity);
      for (let j = 0; j < phiSteps; j++) {
        const jPrev = j > 0 ? j - 1 : 0;
        const jNext = j < phiSteps - 1 ? j + 1 : phiSteps - 1;
        const rowBase = j * thetaSteps;
        const rowPrev = jPrev * thetaSteps;
        const rowNext = jNext * thetaSteps;
        for (let i = 0; i < thetaSteps; i++) {
          const idx = rowBase + i;

          // density gate applies to every mode: it is "how much of the point budget draws"
          if (orderDensity[idx] > densityCutoff) continue;
          if (wantWireframe && !lineMask[idx]) continue;
          if (wantDissolve && orderDissolve[idx] < dropShare) continue;

          const x = posX[idx], y = posY[idx], z = posZ[idx];

          let nx = 0, ny = 0, nz = 1;
          if (needsNormal) {
            const iPrev = i > 0 ? i - 1 : thetaSteps - 1;
            const iNext = i < thetaSteps - 1 ? i + 1 : 0;
            const tThetaX = posX[rowBase + iNext] - posX[rowBase + iPrev];
            const tThetaY = posY[rowBase + iNext] - posY[rowBase + iPrev];
            const tThetaZ = posZ[rowBase + iNext] - posZ[rowBase + iPrev];
            const tPhiX = posX[rowNext + i] - posX[rowPrev + i];
            const tPhiY = posY[rowNext + i] - posY[rowPrev + i];
            const tPhiZ = posZ[rowNext + i] - posZ[rowPrev + i];
            let cxn = tThetaY * tPhiZ - tThetaZ * tPhiY;
            let cyn = tThetaZ * tPhiX - tThetaX * tPhiZ;
            let czn = tThetaX * tPhiY - tThetaY * tPhiX;
            const clen = Math.sqrt(cxn * cxn + cyn * cyn + czn * czn);
            if (clen > 1e-8) {
              cxn /= clen; cyn /= clen; czn /= clen;
              if (cxn * x + cyn * y + czn * z < 0) { cxn = -cxn; cyn = -cyn; czn = -czn; } // keep normals outward
              nx = cxn; ny = cyn; nz = czn;
            }
          }

          // rotate position (axis A = Y, axis B = X) then scale by the beat/energy breathing
          let rx = x * cA + z * sA;
          let rz = -x * sA + z * cA;
          let ry = y * cB - rz * sB;
          rz = y * sB + rz * cB;
          rx *= scaleAll; ry *= scaleAll; rz *= scaleAll;

          // same rotation for the normal, no scale — rotation alone keeps it unit length
          let rnx = nx * cA + nz * sA;
          let rnz = -nx * sA + nz * cA;
          let rny = ny * cB - rnz * sB;
          rnz = ny * sB + rnz * cB;

          const perspective = focal / (CAMERA_DIST - rz);
          let screenX = cx + rx * perspective;
          let screenY = cy + (ry * perspective) / aspect;
          if (wantDissolve) {
            const jr = jitterSeed[idx];
            const amt = turbulence * DISSOLVE_JITTER_CELLS;
            screenX += (jr - 0.5) * 2 * amt;
            screenY += (noise(i * 0.31, j * 0.31, t * 0.6 + jr) - 0.5) * 2 * amt;
          }
          // Rounding each point to one cell aliases: neighbouring samples land 1-2 cells apart and
          // leave every other cell dark, which reads as dither rather than as a surface. Splatting
          // the point across the four cells it actually straddles closes those gaps. The shade is
          // written at full strength (not weighted) so the surface stays evenly lit; the weight only
          // decides whether a cell is covered at all, which keeps the silhouette to within a cell.
          const fx = Math.floor(screenX), fy = Math.floor(screenY);
          const gx = screenX - fx, gy = screenY - fy;

          let value;
          if (shading === "points") {
            const depthT = clamp01((rz + NOMINAL_RADIUS) / (2 * NOMINAL_RADIUS));
            value = 0.35 + 0.55 * depthT;
          } else {
            const litDot = rnx * LIGHT.x + rny * LIGHT.y + rnz * LIGHT.z;
            value = AMBIENT + DIFFUSE * Math.max(0, litDot);
          }
          value = clamp01(value * (1 + 0.18 * Math.min(1, kick)));

          for (let k = 0; k < 4; k++) {
            const col = fx + (k & 1), row = fy + (k >> 1);
            if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
            const weight = ((k & 1) ? gx : 1 - gx) * ((k >> 1) ? gy : 1 - gy);
            if (weight < SPLAT_MIN_WEIGHT) continue;
            const cell = row * cols + col;
            if (rz <= zbuffer[cell]) continue; // farther than (or tied with) what is already drawn there
            zbuffer[cell] = rz;
            field[cell] = value;
          }
        }
      }
    },
  };
}
