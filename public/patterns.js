// The ten pictures Jev can choose between. Each returns { step(dt, t, live, p) }
// and writes brightness values 0..1 into `field` (cols × rows, row-major).
//   live: { energy, bass, beat, bpm }        – per-frame numbers from the ear
//   p:    { density, turbulence, arc, drop, speed } – Jev's judgments as 0..1 plus the motion envelope
// `aspect` is cell height / cell width so circles look round in glyph space.

import { solid } from "./solid.js";

const TAU = Math.PI * 2;

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

/** Lifts the dark floor so `density` decides how much of a full-field picture shows. */
function threshold(v, density) {
  const lo = 0.8 * (1 - density);
  return clamp01((v - lo) / (1 - lo + 1e-6));
}

function decay(field, dt, rate) {
  const k = Math.exp(-dt * rate);
  for (let i = 0; i < field.length; i++) field[i] *= k;
}

function beatsPerSecond(live) {
  return live.bpm ? live.bpm / 60 : 2;
}

/** Grids range from ~60 columns on a phone to 160+ on a wide screen; spawn rates and wavelengths follow. */
const REF_COLS = 80;
const REF_CELLS = 5000;

export function rain(cols, rows, field) {
  const drops = [];
  const width = cols / REF_COLS;
  return {
    step(dt, t, live, p) {
      decay(field, dt, 3 + 4 * p.turbulence);
      const spawn = ((0.4 + 6 * p.density) * dt + live.beat * 4) * width;
      for (let n = spawn; n > 0; n -= 1) {
        if (Math.random() < n) drops.push({ x: Math.floor(Math.random() * cols), y: -1, v: 0.6 + Math.random() * (0.4 + p.turbulence) });
      }
      const speed = rows * 0.35 * (0.5 + p.speed) * (1 + 0.6 * live.energy);
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        d.y += d.v * speed * dt;
        const y = Math.floor(d.y);
        if (y >= rows) {
          drops.splice(i, 1);
          continue;
        }
        if (y >= 0) field[y * cols + d.x] = 1;
        if (y > 0 && p.turbulence > 0.6 && Math.random() < 0.05) field[(y - 1) * cols + d.x] = 0;
      }
    },
  };
}

export function life(cols, rows, field) {
  let cells = new Uint8Array(cols * rows);
  let next = new Uint8Array(cols * rows);
  let acc = 0;
  const seed = (cx, cy, r) => {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (x >= 0 && x < cols && y >= 0 && y < rows && Math.random() < 0.5) cells[y * cols + x] = 1;
    }
  };
  for (let i = 0; i < 6; i++) seed(Math.floor(Math.random() * cols), Math.floor(Math.random() * rows), 3);
  return {
    step(dt, t, live, p) {
      if (live.beat) seed(Math.floor(Math.random() * cols), Math.floor(Math.random() * rows), 2 + Math.round(live.beat * 3));
      acc += dt * beatsPerSecond(live) * 2 * (0.4 + p.speed);
      if (acc < 1) return;
      acc = 0;
      let alive = 0;
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (dx || dy) n += cells[((y + dy + rows) % rows) * cols + ((x + dx + cols) % cols)];
        }
        const i = y * cols + x;
        let v = cells[i] ? (n === 2 || n === 3 ? 1 : 0) : n === 3 ? 1 : 0;
        if (Math.random() < p.turbulence * 0.004) v = 1 - v;
        next[i] = v;
        alive += v;
        field[i] = v ? 1 : field[i] * 0.72;
      }
      [cells, next] = [next, cells];
      if (alive < cols * rows * p.density * 0.12) seed(Math.floor(Math.random() * cols), Math.floor(Math.random() * rows), 4);
    },
  };
}

export function flow(cols, rows, field, aspect) {
  const parts = [];
  const area = (cols * rows) / REF_CELLS;
  return {
    step(dt, t, live, p) {
      decay(field, dt, 2.5);
      const want = Math.round((150 + 2200 * p.density) * area);
      while (parts.length < want) parts.push({ x: Math.random() * cols, y: Math.random() * rows });
      parts.length = want;
      const scale = 0.02 + 0.05 * p.turbulence;
      const speed = (5 + 30 * p.speed * (0.4 + live.energy)) * dt;
      const tz = t * 0.15 * (0.3 + p.turbulence);
      for (const q of parts) {
        const a = noise(q.x * scale, q.y * scale * aspect, tz) * TAU * (1 + 2 * p.turbulence);
        q.x = (q.x + Math.cos(a) * speed + cols) % cols;
        q.y = (q.y + (Math.sin(a) * speed) / aspect + rows) % rows;
        const i = Math.floor(q.y) * cols + Math.floor(q.x);
        field[i] = Math.min(1, field[i] + 0.45);
      }
    },
  };
}

export function plasma(cols, rows, field, aspect) {
  const cx = cols / 2, cy = rows / 2;
  const width = cols / REF_COLS;
  return {
    step(dt, t, live, p) {
      const f = (0.05 + 0.2 * p.turbulence) / width;
      const ts = t * (0.3 + 1.5 * p.speed);
      const k = 1 + 0.7 * live.bass;
      for (let y = 0; y < rows; y++) {
        const yy = y * aspect;
        for (let x = 0; x < cols; x++) {
          const r = Math.hypot(x - cx, (y - cy) * aspect);
          const v = Math.sin(x * f + ts) + Math.sin(yy * f * 0.8 - ts * 0.7) + Math.sin((x + yy) * f * 0.5 + ts * 0.4) + Math.sin(r * f * k - ts);
          field[y * cols + x] = threshold(0.5 + v / 8, p.density);
        }
      }
    },
  };
}

export function tunnel(cols, rows, field, aspect) {
  const cx = cols / 2, cy = rows / 2;
  let phase = 0;
  return {
    step(dt, t, live, p) {
      phase += dt * (1 + 7 * p.speed) + live.beat * 1.5;
      const spokes = 3 + Math.round(p.turbulence * 9);
      const k = 6 + 6 * live.bass;
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const dx = (x - cx) / cols * 2, dy = ((y - cy) * aspect) / cols * 2;
        const r = Math.hypot(dx, dy);
        const a = Math.atan2(dy, dx);
        const rings = 0.5 + 0.5 * Math.sin(k / (r + 0.12) - phase);
        const spoke = 0.75 + 0.25 * Math.sin(a * spokes + phase * 0.3 * p.turbulence);
        field[y * cols + x] = threshold(rings * spoke * Math.min(1, r * 2.5 + 0.2), p.density);
      }
    },
  };
}

export function lattice(cols, rows, field, aspect) {
  const cx = cols / 2, cy = rows / 2;
  let breath = 0;
  return {
    step(dt, t, live, p) {
      breath += dt * (0.5 + 2 * p.speed);
      const size = 5 + (1 - p.density) * 7;
      const radius = 0.35 + 0.35 * live.energy + 0.25 * live.beat;
      const tilt = p.turbulence * 0.35 * Math.sin(breath * 0.7);
      const c = Math.cos(tilt), s = Math.sin(tilt);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const px = x - cx, py = (y - cy) * aspect;
        const u = ((px * c - py * s) / size) % 1, v = ((px * s + py * c) / size) % 1;
        const du = Math.abs((u + 1) % 1 - 0.5), dv = Math.abs((v + 1) % 1 - 0.5);
        const bump = clamp01(1 - Math.max(du, dv) / radius);
        field[y * cols + x] = threshold(bump * (0.6 + 0.4 * Math.sin(breath + (px + py) * 0.05)), p.density);
      }
    },
  };
}

export function glitch(cols, rows, field) {
  const bands = [];
  let rebuildIn = 0;
  const rebuild = () => {
    bands.length = 0;
    for (let y = 0; y < rows;) {
      const h = 1 + Math.floor(Math.random() * 6);
      bands.push({ y0: y, y1: Math.min(rows, y + h), shift: (Math.random() - 0.5) * 40, invert: Math.random() < 0.15 });
      y += h;
    }
  };
  rebuild();
  return {
    step(dt, t, live, p) {
      rebuildIn -= dt * (0.5 + 4 * p.turbulence) + live.beat * 3;
      if (rebuildIn <= 0) {
        rebuild();
        rebuildIn = 0.4 + Math.random();
      }
      const tz = t * (1 + 6 * p.speed);
      const fill = 0.25 + 0.6 * p.density;
      for (const b of bands) {
        const tear = live.beat > 0 ? (Math.random() - 0.5) * 60 * live.beat : 0;
        for (let y = b.y0; y < b.y1; y++) for (let x = 0; x < cols; x++) {
          let v = noise((x + b.shift + tear) * 0.08, y * 0.5, tz);
          v = v < 1 - fill ? 0 : (v - (1 - fill)) / fill;
          if (b.invert) v = 1 - v;
          field[y * cols + x] = clamp01(v * (0.5 + 0.5 * live.energy) + (Math.random() < 0.02 * p.turbulence ? 1 : 0));
        }
      }
    },
  };
}

const RIPPLE_IDLE_S = 1.6; // without hits, a soft ring falls on its own, like rain on a pond

export function ripple(cols, rows, field, aspect) {
  let drops = [];
  let lastDrop = -Infinity;
  const width = cols / REF_COLS;
  return {
    step(dt, t, live, p) {
      if (live.beat) {
        const central = live.bass > 0.6;
        drops.push({ x: central ? cols / 2 : Math.random() * cols, y: central ? rows / 2 : Math.random() * rows, t0: t, s: live.beat });
        lastDrop = t;
      } else if (t - lastDrop > RIPPLE_IDLE_S) {
        drops.push({ x: Math.random() * cols, y: Math.random() * rows, t0: t, s: 0.35 + 0.3 * live.energy });
        lastDrop = t;
      }
      drops = drops.filter((d) => t - d.t0 < 4).slice(-8); // faded rings cost as much as fresh ones
      const wave = 12 * (0.5 + p.speed) * width;
      const base = 0.12 * p.density;
      const k = (0.5 + 0.6 * p.turbulence) / width;
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        let v = base * noise(x * 0.1, y * 0.2, t * 0.3);
        for (const d of drops) {
          const age = t - d.t0;
          const reach = age * wave + 2;
          const dx = x - d.x, dy = (y - d.y) * aspect;
          if (dx > reach || dx < -reach || dy > reach || dy < -reach) continue;
          const dist = Math.hypot(dx, dy);
          if (dist > reach) continue;
          v += d.s * Math.max(0, Math.sin(dist * k - age * wave * 0.5)) * Math.exp(-dist * 0.06 / width - age * 0.8);
        }
        field[y * cols + x] = clamp01(v);
      }
    },
  };
}

export function embers(cols, rows, field) {
  const sparks = [];
  const width = cols / REF_COLS;
  return {
    step(dt, t, live, p) {
      decay(field, dt, 2.5);
      const spawn = ((4 + 45 * p.density) * dt + live.beat * 10) * width;
      for (let n = spawn; n > 0; n -= 1) {
        if (Math.random() < n) sparks.push({ x: Math.random() * cols, y: rows - 1, vx: (Math.random() - 0.5) * 2, vy: -(2 + Math.random() * 6), heat: 1 });
      }
      const rise = 0.5 + p.speed;
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.vx += (Math.random() - 0.5) * 8 * p.turbulence * dt;
        s.x += s.vx * dt * 2;
        s.y += s.vy * rise * dt * (0.6 + live.energy);
        s.heat -= dt * (0.12 + 0.15 * Math.random());
        if (s.heat <= 0 || s.y < 0 || s.x < 0 || s.x >= cols) {
          sparks.splice(i, 1);
          continue;
        }
        const i0 = Math.floor(s.y) * cols + Math.floor(s.x);
        field[i0] = Math.max(field[i0], s.heat);
      }
    },
  };
}

export const PATTERNS = { rain, life, flow, plasma, tunnel, lattice, glitch, ripple, embers, solid };
