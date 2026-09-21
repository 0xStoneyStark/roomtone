// The art director's brief. Two question sets run on different clocks:
//   taste – the scene: figure, ground, glyphs, colour, motion, placement, emptiness, accent.
//           Asked when the music turns (or after a maximum hold) over a six-second description,
//           rolled from Jev's probabilities.
//   pulse – the live feel: fill, order, arc, drop-soon, and whether the passage has turned.
//           Asked continuously (the next call fires as the previous returns) over the last two seconds.
// Code turns the audio into words (Jev is text-only and reads numbers poorly);
// Jev supplies the taste.
import { choice, noul, score } from "@typesafe-ai/sdk";

const CONTEXT =
  "`sound` describes the last six seconds heard by a microphone in the room. " +
  "`listener_note` is what the listener typed about the music or the setting, or \"(none)\". " +
  "`local_time` is the listener's clock.";

const PULSE_CONTEXT =
  "`sound` describes the last two seconds heard by a microphone in the room, in the middle of a piece of music. " +
  "`sound_at_last_picture` describes the sound at the moment the current picture was chosen.";

// The figure: the foreground picture.
export const PATTERNS = {
  rain: "Columns of glyphs falling from the top of the screen like digital rain. Feels like: electronic, cyber, nocturnal, a steady pulse.",
  life: "A cellular automaton: cells switch on and off by neighbourhood rules, forming gliders and colonies. Feels like: intricate, glitchy, evolving, mathematical, IDM.",
  flow: "Thousands of particles drifting along an invisible wind, drawn as soft streaks. Feels like: airy, flowing, wistful, organic, acoustic, strings.",
  plasma: "Smooth blobs of light rolling and merging across the whole screen. Feels like: warm, dreamy, psychedelic, sustained pads, slow chords.",
  tunnel: "A radial tunnel rushing toward the viewer, rings expanding from the centre. Feels like: driving, hypnotic, building energy, trance, motorik.",
  lattice: "A rigid grid of shapes that breathe and tilt in lockstep. Feels like: precise, minimal, cold, machine-like, techno.",
  glitch: "Torn horizontal bands of static that shear sideways on every hit. Feels like: aggressive, distorted, chaotic, industrial, heavy, noise.",
  ripple: "Concentric rings spreading from the spots where beats land, like drops on water. Feels like: percussive, sparse, playful, swing, hip-hop, jazz.",
  embers: "A few slow sparks rising and fading in darkness. Feels like: quiet, intimate, ambient, sad, late-night, a solo voice or instrument.",
};

// The ground: an optional slow layer behind the figure, drawn dimmer and in a quieter glyph family.
export const GROUNDS = {
  none: "No background layer: the figure stands alone on the empty ground. For sparse, intimate, or very clear music.",
  plasma: "Slow rolling blobs of light behind the figure. For warm, dreamy, sustained music with depth.",
  flow: "A faint drifting wind of particles behind the figure. For airy, flowing, wistful music.",
  lattice: "A dim breathing grid behind the figure. For precise, machine-like, architectural music.",
  tunnel: "A slow radial tunnel behind the figure. For hypnotic, driving, building music.",
  embers: "A few faint sparks rising behind the figure. For quiet, late-night, smouldering music.",
};

export const GLYPHS = {
  blocks: "Solid block shades ░ ▒ ▓ █. Heavy, bold, loud, physical.",
  dots: "Small dots and circles · ∙ • ●. Delicate, sparse, quiet, gentle.",
  braille: "Braille cells ⠁ ⠃ ⡇ ⣿ that read as a fine woven texture. Intricate, detailed, restless, busy.",
  lines: "Box-drawing strokes ─ │ ╱ ╲ ┼. Structured, architectural, precise, angular.",
  katakana: "Half-width Japanese katakana ﾊ ﾐ ﾋ ｰ ｳ ｼ. Cyber, futuristic, digital, synth, anime.",
  symbols: "Mathematical and mystical marks ∴ ∵ ≡ ≈ ∞ ◊. Mysterious, cosmic, spiritual, psychedelic, ritual.",
  classic: "The classic ASCII shade ramp . : - = + * # % @. Retro computing, raw, lo-fi, playful, chiptune.",
  strokes: "Box-drawing strokes ─ │ ╱ ╲ that turn to follow the direction of the movement, like brush strokes or engraving lines. Calligraphic, drawn, deliberate, elegant.",
  hatching: "Pen hatching / \\ | - that follows the direction of the movement, like an etching or a quick sketch. Hand-made, scratchy, nervous, intimate.",
};

export const PALETTES = {
  ember: "Deep red through orange to gold, like coals, on black. Warm, passionate, intense, soulful, brass.",
  glacier: "Midnight blue through cyan to white, on black. Cold, clean, spacious, melancholic, electronic.",
  phosphor: "A single green on black, like an old terminal. Retro, hacker, nocturnal, minimal.",
  violet: "Indigo through magenta to hot pink, on black. Dreamy, romantic, synthwave, sensual, neon.",
  acid: "Chartreuse and yellow, harsh and bright, on black. Euphoric, rave, aggressive, sunny, ecstatic.",
  dusk: "Plum through rose to peach, on black. Soft, nostalgic, evening, acoustic, folk.",
  bone: "Warm off-white and grey only, no colour, on black. Austere, classical, contemplative, spoken word, piano.",
  blood: "Crimson and near-black only. Dark, heavy, menacing, doom, metal, drone.",
  ink: "Blue-black ink on warm bone paper, like a print. Classical, literary, acoustic, daytime, calm, a reading room.",
  sepia: "Umber ink on cream paper, like an old photograph. Nostalgic, folk, vintage, warm, a slow afternoon.",
  riso: "Riso print: deep blue ink with a fluorescent pink accent on paper. Playful, indie, pop, zine, sunny, bright.",
};

export const MOTIONS = {
  drift: "Continuous slow movement with no accents, like clouds. For music with no clear beat.",
  pulse: "Movement locks to the beat: a kick on every hit, still in between. For steady dance music.",
  surge: "Movement keeps accelerating in waves that swell and reset. For music that builds and releases.",
  stutter: "Freeze-frames and sudden jumps, stop-start. For broken beats, glitch, trap hi-hats, dubstep.",
  breathe: "A slow in-and-out swell every few seconds regardless of the beat. For ambient, ballads, calm.",
};

// Where the mass of the picture sits: composition, applied as a soft mask over any figure.
export const PLACEMENTS = {
  bleed: "Full bleed: the picture fills the whole frame edge to edge. Big, immersive, wall-of-sound music.",
  horizon: "A low horizon: the mass sits in the bottom third with open dark sky above. Grounded, calm, wide, landscape-like music.",
  island: "A centred island: one figure in the middle with emptiness all around it. Focused, intimate, a single voice or instrument.",
  diagonal: "A rising diagonal: the mass sweeps from bottom-left up to top-right. Momentum, lift, music that is going somewhere.",
  constellation: "A scattered constellation: a few separate clusters with dark between them. Sparse, playful, pointillist, jazz-like music.",
  edge: "Lit from one edge: the mass clings to one side and fades across the frame. Tension, asymmetry, unresolved, anxious music.",
};

export const DENSITY_LEVELS = [
  "Almost empty: a handful of characters in darkness, the screen is mostly black",
  "Sparse: scattered characters with plenty of dark space between them",
  "Balanced: roughly half the screen carries characters",
  "Dense: most of the screen is covered, little dark space remains",
  "Packed: a solid wall of characters from edge to edge",
];

export const TURBULENCE_LEVELS = [
  "Clockwork: symmetric, repeating, perfectly regular motion",
  "Mostly orderly, with small irregularities",
  "Lively: clear structure that keeps shifting",
  "Unruly: the structure barely holds, frequent disruptions",
  "Chaotic: violent and unpredictable, no visible order",
];

export const ARC_LEVELS = [
  "Quiet opening or aftermath: sparse, hushed, holding back",
  "Steady groove: cruising at a settled level",
  "Building: energy accumulating, tension rising, something is coming",
  "Peak: at the climax, everything released at full force",
];

export const EMPTINESS_LEVELS = [
  "No reserved emptiness: marks may fall anywhere in the frame",
  "A little breathing room: soft dark margins around the mass",
  "Generous emptiness: the mass holds about half the frame, the rest stays dark",
  "Mostly silence: one small figure, the frame otherwise empty",
];

export const ACCENT_LEVELS = [
  "No accent: one colour family throughout",
  "A few sparks: only the loudest marks pick up one contrasting colour, sparingly",
  "Bold counterpoint: the contrasting colour is a clear second voice in the picture",
];

export const TASTE_QUESTIONS = {
  pattern: choice(
    { context: CONTEXT, question: "Which moving ASCII figure, the foreground picture, best fits the music in `sound`, taking `listener_note` into account when it says what is playing or where the listener is?" },
    PATTERNS,
  ),
  ground: choice(
    { context: CONTEXT, question: "Which slow background layer, if any, should sit behind the figure for the music in `sound`?" },
    GROUNDS,
  ),
  glyphs: choice(
    { context: CONTEXT, question: "Which family of characters should the figure be drawn with, to match the feel of the music in `sound` and `listener_note`?" },
    GLYPHS,
  ),
  palette: choice(
    { context: CONTEXT, question: "Which colour mood suits the music in `sound` and the setting in `listener_note` and `local_time`?" },
    PALETTES,
  ),
  motion: choice(
    { context: CONTEXT, question: "How should the picture move, given the rhythm and tempo described in `sound`?" },
    MOTIONS,
  ),
  placement: choice(
    { context: CONTEXT, question: "Where should the mass of the picture sit in the frame, for the music in `sound` and the setting in `listener_note`?" },
    PLACEMENTS,
  ),
  emptiness: score(
    { context: CONTEXT, question: "How much of the frame should be kept as reserved dark space around the picture, for the music in `sound`?" },
    EMPTINESS_LEVELS,
  ),
  accent: score(
    { context: CONTEXT, question: "How much contrasting accent colour should the picture carry, for the music in `sound`?" },
    ACCENT_LEVELS,
  ),
};

export const PULSE_QUESTIONS = {
  density: score(
    { context: PULSE_CONTEXT, question: "How much of the screen should be filled with characters right now, to match how full or sparse the music in `sound` is?" },
    DENSITY_LEVELS,
  ),
  turbulence: score(
    { context: PULSE_CONTEXT, question: "How orderly or chaotic should the movement be right now, to match the music in `sound`?" },
    TURBULENCE_LEVELS,
  ),
  arc: score(
    { context: PULSE_CONTEXT, question: "Where in its energy arc is the music in `sound` right now?" },
    ARC_LEVELS,
  ),
  drop_soon: noul(
    { context: PULSE_CONTEXT, question: "Is the music in `sound` about to hit a drop or climax within the next few seconds?" },
    {
      true: "The loudness is rising, hits are getting denser or faster, or the passage is building toward an imminent big hit",
      false: "No sign of an imminent hit: the passage is steady, fading out, or already at its peak",
    },
  ),
  turned: noul(
    { context: PULSE_CONTEXT, question: "Comparing `sound` now with `sound_at_last_picture`, has the music changed enough that a new picture is warranted?" },
    {
      true: "A clear change: a new section, a drop or breakdown, a tempo or energy shift, or a different feel from before",
      false: "The same passage continuing: only small variations from before",
    },
  ),
};

export const QUESTION_SETS = {
  taste: TASTE_QUESTIONS,
  pulse: PULSE_QUESTIONS,
  all: { ...TASTE_QUESTIONS, ...PULSE_QUESTIONS },
};

// Sound fields each set expects, in the order they are presented to Jev.
// The pulse window is too short for a tempo estimate, so it is left out there.
const FEEL_FIELDS = ["loudness", "loudness_trend", "bass", "brightness", "rhythm", "texture", "dynamics"];
export const SOUND_FIELDS = {
  taste: ["tempo", ...FEEL_FIELDS],
  pulse: FEEL_FIELDS,
  all: ["tempo", ...FEEL_FIELDS],
};
