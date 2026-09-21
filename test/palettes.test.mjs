// Verifies the palette contract palettes.js promises the renderer and app: every entry has a
// full 16-level ramp of valid colours, a distinct accent and ground colour, and paper palettes
// read light-paper-with-dark-ink while the rest read dark-ground-with-bright-marks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LEVELS, PALETTES, PALETTE_NAMES } from "../public/palettes.js";
import { PALETTES as PALETTE_OPTIONS } from "../questions.mjs";

function isByte(n) {
  return typeof n === "number" && n >= 0 && n <= 255;
}

function isRgb(triple) {
  return Array.isArray(triple) && triple.length === 3 && triple.every(isByte);
}

/** HSL lightness of an [r,g,b] triple, 0..1 — hue/sat don't matter for a contrast check. */
function lightness([r, g, b]) {
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
}

test("every palette has a full 16-level ramp of valid RGB triples", () => {
  for (const [name, p] of Object.entries(PALETTES)) {
    assert.equal(p.levels.length, LEVELS, `${name}: level count`);
    for (const level of p.levels) assert.ok(isRgb(level), `${name}: level is not a valid RGB triple`);
  }
});

test("every palette has an accent, a bg, and a paper flag", () => {
  for (const [name, p] of Object.entries(PALETTES)) {
    assert.ok(isRgb(p.accent), `${name}: accent is not a valid RGB triple`);
    assert.ok(isRgb(p.bg), `${name}: bg is not a valid RGB triple`);
    assert.equal(typeof p.paper, "boolean", `${name}: paper flag`);
  }
});

test("paper palettes are light ground with dark ink; the rest are the reverse", () => {
  for (const [name, p] of Object.entries(PALETTES)) {
    const bgL = lightness(p.bg);
    const inkL = lightness(p.levels[LEVELS - 1]);
    if (p.paper) assert.ok(bgL > inkL, `${name}: paper bg should be lighter than its darkest (level 15) ink`);
    else assert.ok(bgL < inkL, `${name}: dark bg should be darker than its brightest (level 15) mark`);
  }
});

test("PALETTE_NAMES matches the palette option set Jev chooses between", () => {
  assert.deepEqual(PALETTE_NAMES.slice().sort(), Object.keys(PALETTE_OPTIONS).sort());
  assert.deepEqual(Object.keys(PALETTES).sort(), Object.keys(PALETTE_OPTIONS).sort());
});

test("hue ramps that cross 0° take the short way round (blood stays red, never blue)", () => {
  for (const [r, g, b] of PALETTES.blood.levels) assert.ok(r >= b, `blood level ${[r | 0, g | 0, b | 0]} is bluer than it is red`);
  for (const [r, g, b] of PALETTES.dusk.levels.slice(8)) assert.ok(r > b, `dusk upper level ${[r | 0, g | 0, b | 0]} should be rose/peach`);
});
