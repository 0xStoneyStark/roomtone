// Draws a 0..1 field as coloured glyphs on a canvas. Every glyph × colour level (plus one
// accent row) is rasterised once into an atlas, so a frame is one drawImage per lit cell
// instead of a fillText. Glyph families and palettes are keyed by the option names Jev
// chooses between (questions.mjs). Several layers (ground, figure, ...) can be drawn in one
// frame, each with its own crossfading "look" (glyph family + palette), gain and accent share.
import { PALETTES, LEVELS } from "./palettes.js";
import { orientations, cellHash } from "./marks.js";

const MIN_FONT_PX = 8; // phones: small glyphs read as texture, and exports re-rasterise them large
const MAX_FONT_PX = 34;
export const MAX_CELLS = 7000;
const MAX_DPR = 1.5;
const LINE_HEIGHT = 1.25;
const CHAR_ASPECT = 0.6; // IBM Plex Mono advance width / font size
const LOOK_FADE_S = 2.2; // glyph family + palette crossfade, matched to the pattern crossfade
const GAMMA = 0.7; // lifts mid-brightness cells so faint structure stays legible
const EXPORT_MAX_PIXELS = 15.5e6; // just under iOS Safari's 16.78 MP canvas ceiling; desktops allow far more
const EXPORT_MAX_EDGE = 8192;
const FONT_FAMILY = `"IBM Plex Mono", "Cascadia Mono", Consolas, monospace`;

// Glyph families whose entries above 0 are { h, v, d1, d2 } instead of a plain glyph/variant
// list: the mark's orientation follows the direction of the field (see marks.js).
const DIRECTIONAL_FAMILIES = new Set(["strokes", "hatching"]);
const ORIENTATION_KEYS = ["h", "v", "d1", "d2"]; // index matches marks.js orientation codes 0-3

// Level 0 is always blank. An array entry means "pick one by cell", for families
// that read better as varied characters than as a weight ramp. A directional family's
// entries above 0 are { h, v, d1, d2 }, each itself a glyph or an array of variants.
export const GLYPH_RAMPS = {
  blocks: [" ", "░", "▒", "▓", "█"],
  dots: [" ", "·", "∙", "•", "●"],
  braille: [" ", "⠁", "⠃", "⠇", "⡇", "⣇", "⣧", "⣷", "⣿"],
  lines: [" ", "╌", "─", "┼", "╪", "╬", "█"],
  katakana: [" ", ["ｰ", "ｲ", "ｸ"], ["ｼ", "ﾂ", "ﾆ"], ["ﾊ", "ﾐ", "ﾋ"], ["ｳ", "ﾓ", "ﾅ"], ["ﾎ", "ﾜ", "ﾒ"], ["ｹ", "ﾏ", "ｻ"]],
  symbols: [" ", "·", "∘", "∴", "∷", "≡", "≈", "∞", "◊"],
  classic: [" ", ".", ":", "-", "=", "+", "*", "#", "%", "@"],
  strokes: [
    " ",
    { h: "╌", v: "┊", d1: "╱", d2: "╲" },
    { h: "─", v: "│", d1: "╱", d2: "╲" },
    { h: "━", v: "┃", d1: "╱", d2: "╲" },
    { h: "═", v: "║", d1: "╱", d2: "╲" },
  ],
  hatching: [
    " ",
    { h: "-", v: "|", d1: "/", d2: "\\" },
    { h: "=", v: "|", d1: "/", d2: "\\" },
    { h: "≡", v: "‖", d1: "/", d2: "\\" },
    { h: "#", v: "#", d1: "#", d2: "#" },
  ],
};

// Re-exported so existing imports of PALETTES from render.js keep working; palettes.js owns the data.
export { PALETTES };

function normalizeLook(glyphs, palette) {
  return { glyphs: GLYPH_RAMPS[glyphs] ? glyphs : "classic", palette: PALETTES[palette] ? palette : "bone" };
}

/** The ramp entry for one of the LEVELS colour steps, skipping the blank glyph at index 0. */
function levelEntry(ramp, level) {
  const top = ramp.length - 1;
  return ramp[Math.max(1, Math.round((level / (LEVELS - 1)) * top))];
}

function asVariants(entry) {
  return Array.isArray(entry) ? entry : [entry];
}

export class AsciiRenderer {
  constructor(canvas, budget = MAX_CELLS) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.budget = budget;
    this.atlases = new Map();
    this.orientBufs = new Map(); // per-look orientation buffer, for directional glyph families
    this.resize();
  }

  /** Cell budget: the grid is sized so cols × rows stays under it. Returns true if the grid changed. */
  setBudget(cells) {
    this.budget = Math.max(600, Math.min(MAX_CELLS, Math.round(cells)));
    const { cols, rows } = this;
    this.resize();
    return cols !== this.cols || rows !== this.rows;
  }

  resize() {
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const w = window.innerWidth, h = window.innerHeight;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The smallest font that keeps the grid under the cell budget.
    this.fontPx = Math.round(Math.min(MAX_FONT_PX, Math.max(MIN_FONT_PX, Math.sqrt((w * h) / this.budget / (CHAR_ASPECT * LINE_HEIGHT)))));
    this.ctx.font = `${this.fontPx}px ${FONT_FAMILY}`;
    // Whole physical pixels per cell, so every tile is copied 1:1 with no resampling.
    this.tileW = Math.ceil(this.ctx.measureText("M").width * dpr);
    this.tileH = Math.ceil(this.fontPx * LINE_HEIGHT * dpr);
    this.cellW = this.tileW / dpr;
    this.cellH = this.tileH / dpr;
    this.cols = Math.max(8, Math.floor(w / this.cellW));
    this.rows = Math.max(4, Math.floor(h / this.cellH));
    this.aspect = this.cellH / this.cellW;
    const offsetX = Math.round(((w - this.cols * this.cellW) / 2) * dpr) / dpr;
    const offsetY = Math.round(((h - this.rows * this.cellH) / 2) * dpr) / dpr;
    this.colX = Float32Array.from({ length: this.cols }, (_, x) => offsetX + x * this.cellW);
    this.rowY = Float32Array.from({ length: this.rows }, (_, y) => offsetY + y * this.cellH);
    this.atlases.clear();
    this.orientBufs.clear();
  }

  /** A fresh look, already "settled" (mix 1) on the given glyph family + palette. */
  createLook(glyphs = "dots", palette = "bone") {
    const look = normalizeLook(glyphs, palette);
    return { from: { ...look }, to: { ...look }, mix: 1 };
  }

  /** Crossfade a look to a new glyph family + palette pair. */
  setLook(look, glyphs, palette) {
    const to = normalizeLook(glyphs, palette);
    if (to.glyphs === look.to.glyphs && to.palette === look.to.palette) return;
    // Snap any fade in progress to its destination rather than blending three looks.
    look.from = look.to;
    look.to = to;
    look.mix = 0;
  }

  /** Advances one look's crossfade; called once per layer per frame from draw(). */
  advance(look, dt) {
    look.mix = Math.min(1, look.mix + dt / LOOK_FADE_S);
  }

  /** The target palette object of a look, e.g. for the caller's bg/paper decisions. */
  paletteOf(look) {
    return PALETTES[look?.to?.palette] ?? PALETTES.bone;
  }

  /** The canvas ground for a look mid-fade: black to paper (or back) over the same crossfade as the marks. */
  groundOf(look) {
    const to = this.paletteOf(look).bg;
    if (!look || look.mix >= 1) return to;
    const from = (PALETTES[look.from.palette] ?? PALETTES.bone).bg;
    const k = look.mix;
    return [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, from[2] + (to[2] - from[2]) * k];
  }

  /**
   * One rasterised tile per (colour level, glyph orientation, glyph variant), plus one extra
   * accent row reusing the top level's glyphs in the palette's accent colour. Cached per
   * family × palette × font size. `geo` describes the tile grid; it defaults to the screen's,
   * and exports pass a larger one.
   */
  atlas({ glyphs: family, palette: paletteName }, geo = this) {
    const key = `${family}|${paletteName}|${geo.fontPx}|${geo.dpr}`;
    let atlas = this.atlases.get(key);
    if (atlas) return atlas;
    const ramp = GLYPH_RAMPS[family];
    const directional = DIRECTIONAL_FAMILIES.has(family);
    const orientCount = directional ? ORIENTATION_KEYS.length : 1;
    const palette = PALETTES[paletteName];
    const { dpr, tileW, tileH, fontPx } = geo;
    const rowCount = LEVELS + 1; // + accent row
    const slotBase = new Int32Array(rowCount * orientCount);
    const slotCount = new Int32Array(rowCount * orientCount);
    const draws = []; // { slot, ch, color }, painted once the canvas is sized
    let slots = 0;
    for (let level = 0; level < rowCount; level++) {
      const entry = levelEntry(ramp, level < LEVELS ? level : LEVELS - 1);
      const color = level < LEVELS ? palette.levels[level] : palette.accent;
      for (let o = 0; o < orientCount; o++) {
        const variants = asVariants(directional ? entry[ORIENTATION_KEYS[o]] : entry);
        const idx = level * orientCount + o;
        slotBase[idx] = slots;
        slotCount[idx] = variants.length;
        variants.forEach((ch, i) => draws.push({ slot: slots + i, ch, color }));
        slots += variants.length;
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = tileW * slots;
    canvas.height = tileH;
    const g = canvas.getContext("2d");
    g.scale(dpr, dpr);
    g.font = `${fontPx}px ${FONT_FAMILY}`;
    g.textBaseline = "top";
    for (const { slot, ch, color } of draws) {
      const [r, gr, b] = color;
      g.fillStyle = `rgb(${r | 0},${gr | 0},${b | 0})`;
      g.fillText(ch, (slot * tileW) / dpr, 0);
    }
    atlas = { canvas, slotBase, slotCount, orientCount };
    this.atlases.set(key, atlas);
    return atlas;
  }

  /**
   * One glyph per lit cell, drawn from a pre-rasterised atlas. `orientBuf`, when the family is
   * directional, picks the glyph's orientation per cell. `accent` is the share of the
   * brightest cells (v >= 0.9) that use the palette's accent colour instead of the ramp.
   */
  pass(field, atlas, alpha, ctx, geo, gain, orientBuf, accent) {
    const { cols, cellW, cellH, tileW, tileH, colX, rowY } = geo;
    const { canvas, slotBase, slotCount, orientCount } = atlas;
    ctx.globalAlpha = alpha;
    for (let i = 0, x = 0, y = 0; i < field.length; i++, x++) {
      if (x === cols) {
        x = 0;
        y++;
      }
      const v = field[i] * gain;
      if (v < 0.04) continue;
      const accented = accent > 0 && v >= 0.9 && cellHash(x, y) % 1000 < accent * 1000;
      const level = accented ? LEVELS : Math.min(LEVELS - 1, Math.floor(v ** GAMMA * LEVELS));
      const orient = orientCount > 1 ? orientBuf[i] : 0;
      const idx = level * orientCount + orient;
      const base = slotBase[idx], count = slotCount[idx];
      const slot = base + (count > 1 ? cellHash(x, y) % count : 0);
      ctx.drawImage(canvas, slot * tileW, 0, tileW, tileH, colX[x], rowY[y], cellW, cellH);
    }
    ctx.globalAlpha = 1;
  }

  /** The cached orientation buffer for one layer's look, recomputed every call and resized with the grid. */
  orientationsFor(look, field) {
    const size = this.cols * this.rows;
    let buf = this.orientBufs.get(look);
    if (!buf || buf.length !== size) {
      buf = new Uint8Array(size);
      this.orientBufs.set(look, buf);
    }
    orientations(field, this.cols, this.rows, this.aspect, buf);
    return buf;
  }

  /** One layer's field, with its look (or its two looks mid-fade), onto any context/grid. */
  paintLayer({ field, look, gain = 1, accent = 0 }, ctx, geo) {
    const directional = DIRECTIONAL_FAMILIES.has(look.from.glyphs) || DIRECTIONAL_FAMILIES.has(look.to.glyphs);
    const orientBuf = directional ? this.orientationsFor(look, field) : null;
    if (look.mix < 1) this.pass(field, this.atlas(look.from, geo), 1 - look.mix, ctx, geo, gain, orientBuf, accent);
    this.pass(field, this.atlas(look.to, geo), look.mix < 1 ? look.mix : 1, ctx, geo, gain, orientBuf, accent);
  }

  /**
   * Advances every layer's look, clears to the top layer's target palette ground, then paints
   * layers bottom → top (ground layers first, typically dimmer via a small gain). `flash` 0..1
   * washes the whole frame toward white, used for the drop release.
   */
  draw(layers, dt, flash = 0) {
    for (const layer of layers) this.advance(layer.look, dt);
    const [br, bg, bb] = this.groundOf(layers.at(-1)?.look);
    this.ctx.fillStyle = `rgb(${br | 0},${bg | 0},${bb | 0})`;
    this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    for (const layer of layers) this.paintLayer(layer, this.ctx, this);
    if (flash > 0.01) {
      this.ctx.fillStyle = `rgba(255,250,240,${flash * 0.85})`;
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  /**
   * The same layers re-rasterised at a much larger font size: a print-quality frame of only
   * the art, no HUD, no flash. Sized to the biggest canvas that stays inside browser limits.
   */
  exportFrame(layers) {
    const dpr = 1;
    const probe = document.createElement("canvas").getContext("2d");
    const baseW = this.cols * this.tileW, baseH = this.rows * this.tileH;
    const scale = Math.max(1, Math.min(Math.sqrt(EXPORT_MAX_PIXELS / (baseW * baseH)), EXPORT_MAX_EDGE / Math.max(baseW, baseH)));
    let fontPx = Math.floor(this.fontPx * this.dpr * scale);
    let tileW, tileH;
    const measure = () => {
      probe.font = `${fontPx}px ${FONT_FAMILY}`;
      tileW = Math.ceil(probe.measureText("M").width);
      tileH = Math.ceil(fontPx * LINE_HEIGHT);
    };
    measure();
    // Tile rounding can push a near-limit export over the ceiling, where iOS silently draws nothing.
    const over = (this.cols * tileW * this.rows * tileH) / EXPORT_MAX_PIXELS;
    if (over > 1) {
      fontPx = Math.floor((fontPx / Math.sqrt(over)) * 0.995);
      measure();
    }
    const geo = {
      dpr, fontPx, tileW, tileH,
      cols: this.cols, rows: this.rows,
      cellW: tileW, cellH: tileH,
      colX: Float32Array.from({ length: this.cols }, (_, x) => x * tileW),
      rowY: Float32Array.from({ length: this.rows }, (_, y) => y * tileH),
    };
    const out = document.createElement("canvas");
    out.width = this.cols * tileW;
    out.height = this.rows * tileH;
    const ctx = out.getContext("2d");
    const [br, bg, bb] = this.groundOf(layers.at(-1)?.look);
    ctx.fillStyle = `rgb(${br | 0},${bg | 0},${bb | 0})`;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    for (const layer of layers) this.paintLayer(layer, ctx, geo);
    // Export atlases are large and one-off; drop them so the screen cache stays small.
    for (const key of this.atlases.keys()) if (key.endsWith(`|${fontPx}|${dpr}`)) this.atlases.delete(key);
    return out;
  }
}
