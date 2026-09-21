// Draws a 0..1 field as coloured glyphs on a canvas. Every glyph × colour level
// is rasterised once into an atlas, so a frame is one drawImage per lit cell
// instead of a fillText. Glyph families and palettes are keyed by the option
// names Jev chooses between (questions.mjs).

const MIN_FONT_PX = 8; // phones: small glyphs read as texture, and exports re-rasterise them large
const MAX_FONT_PX = 34;
export const MAX_CELLS = 7000;
const MAX_DPR = 1.5;
const LINE_HEIGHT = 1.25;
const CHAR_ASPECT = 0.6; // IBM Plex Mono advance width / font size
const LEVELS = 16; // colour quantisation steps per palette
const LOOK_FADE_S = 2.2; // glyph family + palette crossfade, matched to the pattern crossfade
const GAMMA = 0.7; // lifts mid-brightness cells so faint structure stays legible
const EXPORT_MAX_PIXELS = 15.5e6; // just under iOS Safari's 16.78 MP canvas ceiling; desktops allow far more
const EXPORT_MAX_EDGE = 8192;
const FONT_FAMILY = `"IBM Plex Mono", "Cascadia Mono", Consolas, monospace`;

// Level 0 is always blank. An array entry means "pick one by cell", for families
// that read better as varied characters than as a weight ramp.
export const GLYPH_RAMPS = {
  blocks: [" ", "░", "▒", "▓", "█"],
  dots: [" ", "·", "∙", "•", "●"],
  braille: [" ", "⠁", "⠃", "⠇", "⡇", "⣇", "⣧", "⣷", "⣿"],
  lines: [" ", "╌", "─", "┼", "╪", "╬", "█"],
  katakana: [" ", ["ｰ", "ｲ", "ｸ"], ["ｼ", "ﾂ", "ﾆ"], ["ﾊ", "ﾐ", "ﾋ"], ["ｳ", "ﾓ", "ﾅ"], ["ﾎ", "ﾜ", "ﾒ"], ["ｹ", "ﾏ", "ｻ"]],
  symbols: [" ", "·", "∘", "∴", "∷", "≡", "≈", "∞", "◊"],
  classic: [" ", ".", ":", "-", "=", "+", "*", "#", "%", "@"],
};

// Three HSL stops (dark → mid → bright) per colour mood.
const PALETTE_STOPS = {
  ember: [[0, 80, 28], [18, 95, 50], [45, 100, 78]],
  glacier: [[225, 70, 34], [200, 90, 55], [190, 40, 95]],
  phosphor: [[130, 80, 24], [130, 90, 48], [110, 100, 82]],
  violet: [[260, 70, 36], [300, 85, 55], [330, 100, 80]],
  acid: [[80, 90, 30], [72, 100, 50], [55, 100, 82]],
  dusk: [[290, 40, 32], [345, 60, 58], [25, 90, 82]],
  bone: [[40, 12, 30], [40, 15, 58], [45, 25, 94]],
  blood: [[350, 85, 22], [355, 95, 42], [0, 100, 64]],
};

function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function buildPalette(stops) {
  const out = [];
  for (let i = 0; i < LEVELS; i++) {
    const v = i / (LEVELS - 1);
    const seg = v < 0.5 ? 0 : 1;
    const k = (v - seg * 0.5) * 2;
    const a = stops[seg], b = stops[seg + 1];
    out.push(hslToRgb(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k));
  }
  return out;
}

export const PALETTES = Object.fromEntries(Object.entries(PALETTE_STOPS).map(([k, s]) => [k, buildPalette(s)]));

function cellHash(x, y) {
  return ((x * 73856093) ^ (y * 19349663)) >>> 0;
}

/** For a ramp, the glyph variants shown at each of the LEVELS colour steps. */
function variantsPerLevel(ramp) {
  const top = ramp.length - 1;
  return Array.from({ length: LEVELS }, (_, level) => {
    const entry = ramp[Math.max(1, Math.round((level / (LEVELS - 1)) * top))];
    return Array.isArray(entry) ? entry : [entry];
  });
}

export class AsciiRenderer {
  constructor(canvas, budget = MAX_CELLS) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.budget = budget;
    this.lookFrom = { glyphs: "dots", palette: "bone" };
    this.lookTo = { glyphs: "dots", palette: "bone" };
    this.lookMix = 1;
    this.atlases = new Map();
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
  }

  /** Crossfade from the current glyph family + palette to a new pair. */
  setLook(glyphs, palette) {
    const to = { glyphs: GLYPH_RAMPS[glyphs] ? glyphs : "classic", palette: PALETTES[palette] ? palette : "bone" };
    if (to.glyphs === this.lookTo.glyphs && to.palette === this.lookTo.palette) return;
    // Snap any fade in progress to its destination rather than blending three looks.
    this.lookFrom = this.lookTo;
    this.lookTo = to;
    this.lookMix = 0;
  }

  /**
   * One rasterised tile per (colour level, glyph variant), cached per family × palette × font size.
   * `geo` describes the tile grid; it defaults to the screen's, and exports pass a larger one.
   */
  atlas({ glyphs: family, palette: paletteName }, geo = this) {
    const key = `${family}|${paletteName}|${geo.fontPx}|${geo.dpr}`;
    let atlas = this.atlases.get(key);
    if (atlas) return atlas;
    const variants = variantsPerLevel(GLYPH_RAMPS[family]);
    const palette = PALETTES[paletteName];
    const { dpr, tileW, tileH, fontPx } = geo;
    const slotBase = new Int32Array(LEVELS);
    const slotCount = new Int32Array(LEVELS);
    let slots = 0;
    for (let level = 0; level < LEVELS; level++) {
      slotBase[level] = slots;
      slotCount[level] = variants[level].length;
      slots += variants[level].length;
    }
    const canvas = document.createElement("canvas");
    canvas.width = tileW * slots;
    canvas.height = tileH;
    const g = canvas.getContext("2d");
    g.scale(dpr, dpr);
    g.font = `${fontPx}px ${FONT_FAMILY}`;
    g.textBaseline = "top";
    for (let level = 0; level < LEVELS; level++) {
      const [r, gr, b] = palette[level];
      g.fillStyle = `rgb(${r | 0},${gr | 0},${b | 0})`;
      variants[level].forEach((ch, i) => g.fillText(ch, ((slotBase[level] + i) * tileW) / dpr, 0));
    }
    atlas = { canvas, slotBase, slotCount };
    this.atlases.set(key, atlas);
    return atlas;
  }

  pass(field, atlas, alpha, ctx = this.ctx, geo = this, gain = 1) {
    const { cols, cellW, cellH, tileW, tileH, colX, rowY } = geo;
    const { canvas, slotBase, slotCount } = atlas;
    ctx.globalAlpha = alpha;
    for (let i = 0, x = 0, y = 0; i < field.length; i++, x++) {
      if (x === cols) {
        x = 0;
        y++;
      }
      const v = field[i] * gain;
      if (v < 0.04) continue;
      const level = Math.min(LEVELS - 1, Math.floor(v ** GAMMA * LEVELS));
      const slot = slotBase[level] + (slotCount[level] > 1 ? cellHash(x, y) % slotCount[level] : 0);
      ctx.drawImage(canvas, slot * tileW, 0, tileW, tileH, colX[x], rowY[y], cellW, cellH);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * The field as glyphs, with the current look (or the two looks mid-fade), onto any context/grid.
   * `gain` scales brightness before quantisation: Jev's energy arc and drop charge come in here.
   */
  paint(field, ctx, geo, gain = 1) {
    ctx.fillStyle = "#060607";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (this.lookMix < 1) this.pass(field, this.atlas(this.lookFrom, geo), 1 - this.lookMix, ctx, geo, gain);
    this.pass(field, this.atlas(this.lookTo, geo), this.lookMix < 1 ? this.lookMix : 1, ctx, geo, gain);
  }

  /** `flash` 0..1 washes the whole frame toward white (used for the drop release). */
  draw(field, dt, flash = 0, gain = 1) {
    this.lookMix = Math.min(1, this.lookMix + dt / LOOK_FADE_S);
    this.paint(field, this.ctx, this, gain);
    if (flash > 0.01) {
      this.ctx.fillStyle = `rgba(255,250,240,${flash * 0.85})`;
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  /**
   * The same grid re-rasterised at a much larger font size: a print-quality frame of only the art,
   * no HUD, no flash. Sized to the biggest canvas that stays inside browser limits.
   */
  exportFrame(field, gain = 1) {
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
      fontPx = Math.floor(fontPx / Math.sqrt(over) * 0.995);
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
    this.paint(field, out.getContext("2d"), geo, gain);
    // Export atlases are large and one-off; drop them so the screen cache stays small.
    for (const key of this.atlases.keys()) if (key.endsWith(`|${fontPx}|${dpr}`)) this.atlases.delete(key);
    return out;
  }
}
