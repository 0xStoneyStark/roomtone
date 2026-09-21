// Colour moods, keyed by the option names Jev chooses between (questions.mjs PALETTES).
// Each palette: 16 glyph colour levels (dark → bright), one contrasting accent for the loudest
// marks, the canvas ground colour, and whether it is a light "paper" palette (ink on paper).
//
// Dark palettes ramp two-tone: darkest → mid in the mood's primary hue, mid → brightest drifting
// toward a second hue (phosphor and bone stay single-hue, per their descriptions in questions.mjs).
// The darkest stop sits at 40–48% lightness: most cells of a picture land in the lower half of the
// ramp, and anything darker than that vanishes on the black ground (especially on a phone).
// Paper palettes run the other way — level 0 is a faint ink tint just off the paper colour, level
// 15 is full ink — so the renderer's "brighter field value → higher index" mapping still reads as
// "more ink" instead of "more light".

export const LEVELS = 16;

// Three HSL stops (dark → mid → bright, or faint → mid → full ink for paper) per colour mood,
// plus a contrasting accent for the loudest marks and the canvas ground colour.
const STOPS = {
  // Deep red through orange to pale gold, like coals.
  ember: { stops: [[0, 80, 42], [18, 95, 58], [45, 100, 78]], accent: [190, 90, 60], bg: [6, 6, 7], paper: false },
  // Navy through cyan to a near-white with a hint of green.
  glacier: { stops: [[225, 70, 46], [200, 90, 62], [170, 25, 95]], accent: [30, 100, 60], bg: [6, 6, 7], paper: false },
  // Single-hue green, like an old terminal — no hue drift.
  phosphor: { stops: [[130, 85, 40], [130, 90, 58], [130, 95, 82]], accent: [330, 100, 65], bg: [6, 6, 7], paper: false },
  // Indigo through magenta to hot pink.
  violet: { stops: [[260, 70, 48], [300, 85, 62], [330, 100, 80]], accent: [60, 100, 60], bg: [6, 6, 7], paper: false },
  // Olive through chartreuse to lemon.
  acid: { stops: [[70, 70, 42], [75, 100, 56], [58, 100, 82]], accent: [285, 100, 65], bg: [6, 6, 7], paper: false },
  // Plum through rose to peach.
  dusk: { stops: [[290, 45, 46], [345, 65, 64], [25, 90, 82]], accent: [170, 80, 55], bg: [6, 6, 7], paper: false },
  // Warm off-white and grey only, no colour drift.
  bone: { stops: [[40, 12, 44], [40, 15, 66], [45, 25, 94]], accent: [10, 90, 60], bg: [6, 6, 7], paper: false },
  // Crimson and near-black only.
  blood: { stops: [[350, 85, 40], [355, 95, 54], [0, 100, 66]], accent: [45, 100, 60], bg: [6, 6, 7], paper: false },

  // Blue-black ink on warm bone paper, like a print.
  ink: { stops: [[215, 15, 82], [220, 40, 50], [225, 60, 14]], accent: [12, 85, 45], bg: [239, 233, 220], paper: true },
  // Umber ink on cream paper, like an old photograph.
  sepia: { stops: [[35, 30, 75], [30, 45, 45], [25, 55, 18]], accent: [185, 55, 28], bg: [246, 236, 216], paper: true },
  // Riso-print blue ink on warm paper white, with a fluorescent pink accent.
  riso: { stops: [[215, 20, 80], [220, 45, 50], [225, 70, 20]], accent: [326, 100, 64], bg: [248, 246, 241], paper: true },
};

export function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function rampFromStops(stops) {
  const out = [];
  for (let i = 0; i < LEVELS; i++) {
    const v = i / (LEVELS - 1);
    const seg = v < 0.5 ? 0 : 1;
    const k = (v - seg * 0.5) * 2;
    const a = stops[seg], b = stops[seg + 1];
    const dh = ((b[0] - a[0] + 540) % 360) - 180; // shortest way round the hue wheel (355° → 0° is 5°, not 355°)
    out.push(hslToRgb((a[0] + dh * k + 360) % 360, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k));
  }
  return out;
}

/** { name: { levels: [[r,g,b] × 16], accent: [r,g,b], bg: [r,g,b], paper: boolean } } */
export const PALETTES = Object.fromEntries(
  Object.entries(STOPS).map(([name, p]) => [name, { levels: rampFromStops(p.stops), accent: hslToRgb(...p.accent), bg: p.bg, paper: p.paper }]),
);

export const PALETTE_NAMES = Object.keys(PALETTES);
