// The art director's brief. Two question sets run on different clocks:
//   taste – picture, glyphs, colour, motion: the scene. Asked every few seconds
//           over a six-second description, rolled from Jev's probabilities.
//   pulse – fill, order, arc, drop-soon: the live feel. Asked continuously
//           (the next call fires as the previous returns) over the last two seconds.
// Code turns the audio into words (Jev is text-only and reads numbers poorly);
// Jev supplies the taste.
import { choice, noul, score } from "@typesafe-ai/sdk";

const PULSE_CONTEXT = "`sound` describes the last two seconds heard by a microphone in the room, in the middle of a piece of music.";

const CONTEXT =
  "`sound` describes the last six seconds heard by a microphone in the room. " +
  "`listener_note` is what the listener typed about the music or the setting, or \"(none)\". " +
  "`local_time` is the listener's clock.";

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

export const GLYPHS = {
  blocks: "Solid block shades ░ ▒ ▓ █. Heavy, bold, loud, physical.",
  dots: "Small dots and circles · ∙ • ●. Delicate, sparse, quiet, gentle.",
  braille: "Braille cells ⠁ ⠃ ⡇ ⣿ that read as a fine woven texture. Intricate, detailed, restless, busy.",
  lines: "Box-drawing strokes ─ │ ╱ ╲ ┼. Structured, architectural, precise, angular.",
  katakana: "Half-width Japanese katakana ﾊ ﾐ ﾋ ｰ ｳ ｼ. Cyber, futuristic, digital, synth, anime.",
  symbols: "Mathematical and mystical marks ∴ ∵ ≡ ≈ ∞ ◊. Mysterious, cosmic, spiritual, psychedelic, ritual.",
  classic: "The classic ASCII shade ramp . : - = + * # % @. Retro computing, raw, lo-fi, playful, chiptune.",
};

export const PALETTES = {
  ember: "Deep red through orange to gold, like coals. Warm, passionate, intense, soulful, brass.",
  glacier: "Midnight blue through cyan to white. Cold, clean, spacious, melancholic, electronic.",
  phosphor: "A single green on black, like an old terminal. Retro, hacker, nocturnal, minimal.",
  violet: "Indigo through magenta to hot pink. Dreamy, romantic, synthwave, sensual, neon.",
  acid: "Chartreuse and yellow, harsh and bright. Euphoric, rave, aggressive, sunny, ecstatic.",
  dusk: "Plum through rose to peach. Soft, nostalgic, evening, acoustic, folk.",
  bone: "Warm off-white and grey only, no colour. Austere, classical, contemplative, spoken word, piano.",
  blood: "Crimson and near-black only. Dark, heavy, menacing, doom, metal, drone.",
};

export const MOTIONS = {
  drift: "Continuous slow movement with no accents, like clouds. For music with no clear beat.",
  pulse: "Movement locks to the beat: a kick on every hit, still in between. For steady dance music.",
  surge: "Movement keeps accelerating in waves that swell and reset. For music that builds and releases.",
  stutter: "Freeze-frames and sudden jumps, stop-start. For broken beats, glitch, trap hi-hats, dubstep.",
  breathe: "A slow in-and-out swell every few seconds regardless of the beat. For ambient, ballads, calm.",
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

export const TASTE_QUESTIONS = {
  pattern: choice(
    { context: CONTEXT, question: "Which moving ASCII picture best fits the music in `sound`, taking `listener_note` into account when it says what is playing or where the listener is?" },
    PATTERNS,
  ),
  glyphs: choice(
    { context: CONTEXT, question: "Which family of characters should the picture be drawn with, to match the feel of the music in `sound` and `listener_note`?" },
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
