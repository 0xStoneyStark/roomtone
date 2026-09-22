// Every option Jev can choose must be something the browser can actually draw. A palette or
// picture added to questions.mjs without a renderer counterpart would otherwise fall back silently.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CAMERAS,
  FORMS as FORM_OPTIONS,
  GLYPHS,
  GROUNDS,
  MOTIONS,
  PALETTES as PALETTE_OPTIONS,
  PATTERNS as PATTERN_OPTIONS,
  PLACEMENTS as PLACEMENT_OPTIONS,
  QUESTION_SETS,
  SHADINGS as SHADING_OPTIONS,
  SOUND_FIELDS,
} from "../questions.mjs";
import { PATTERNS } from "../public/patterns.js";
import { GLYPH_RAMPS } from "../public/render.js";
import { PALETTES } from "../public/palettes.js";
import { PLACEMENTS } from "../public/composition.js";
import { MOVES } from "../public/camera.js";
import { FORMS, SHADINGS } from "../public/solid.js";

const appSource = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("every picture Jev can choose has a generator", () => {
  assert.deepEqual(Object.keys(PATTERN_OPTIONS).sort(), Object.keys(PATTERNS).sort());
});

test("every ground Jev can choose (other than 'none') is a pattern", () => {
  const grounds = Object.keys(GROUNDS).filter((name) => name !== "none");
  const patterns = new Set(Object.keys(PATTERNS));
  for (const name of grounds) assert.ok(patterns.has(name), `ground "${name}" has no matching pattern`);
});

test("every glyph family Jev can choose has a ramp whose level 0 is blank", () => {
  assert.deepEqual(Object.keys(GLYPHS).sort(), Object.keys(GLYPH_RAMPS).sort());
  for (const [name, ramp] of Object.entries(GLYPH_RAMPS)) {
    assert.ok(Array.isArray(ramp), `${name}: ramp must be an array`);
    assert.equal(ramp[0], " ", `${name}: level 0 must be blank`);
    for (const entry of ramp.slice(1)) {
      const isString = typeof entry === "string";
      const isVariants = Array.isArray(entry);
      const isDirectional = entry !== null && typeof entry === "object" && !Array.isArray(entry) && ("h" in entry || "v" in entry || "d1" in entry || "d2" in entry);
      assert.ok(isString || isVariants || isDirectional, `${name}: ramp entry must be a string, an array of strings, or a directional h/v/d1/d2 object`);
    }
  }
});

test("every colour mood Jev can choose has a palette shaped { levels, accent, bg, paper }", () => {
  assert.deepEqual(Object.keys(PALETTE_OPTIONS).sort(), Object.keys(PALETTES).sort());
  for (const [name, palette] of Object.entries(PALETTES)) {
    assert.equal(palette.levels.length, 16, `${name}: needs 16 colour levels`);
    for (const level of palette.levels) assert.equal(level.length, 3, `${name}: each level is [r,g,b]`);
    assert.equal(palette.accent.length, 3, `${name}: accent is [r,g,b]`);
    assert.equal(palette.bg.length, 3, `${name}: bg is [r,g,b]`);
    assert.equal(typeof palette.paper, "boolean", `${name}: paper must be boolean`);
  }
});

test("every placement Jev can choose is a composition placement", () => {
  assert.deepEqual(Object.keys(PLACEMENT_OPTIONS), PLACEMENTS);
});

test("every form Jev can choose maps onto solid.js's FORMS, in order", () => {
  assert.deepEqual(Object.keys(FORM_OPTIONS), Object.keys(FORMS));
});

test("every shading Jev can choose matches solid.js's SHADINGS, in order", () => {
  assert.deepEqual(Object.keys(SHADING_OPTIONS), SHADINGS);
});

test("every motion Jev can choose is handled by the motion envelope", () => {
  for (const motion of Object.keys(MOTIONS)) {
    if (motion === "drift") continue; // the default branch
    assert.match(appSource, new RegExp(`case "${motion}":`), `motion "${motion}" has no case in app.js`);
  }
});

test("every camera move Jev can choose matches camera.js's MOVES, in order", () => {
  assert.deepEqual(Object.keys(CAMERAS), MOVES);
});

test("question sets carry the questions the browser reads", () => {
  assert.deepEqual(
    Object.keys(QUESTION_SETS.taste).sort(),
    ["accent", "camera", "emptiness", "form", "glyphs", "ground", "motion", "palette", "pattern", "placement", "shading"],
  );
  assert.deepEqual(
    Object.keys(QUESTION_SETS.pulse).sort(),
    ["arc", "density", "drop_soon", "turbulence", "turned"],
  );
  assert.deepEqual(Object.keys(QUESTION_SETS.all).sort(), [...Object.keys(QUESTION_SETS.taste), ...Object.keys(QUESTION_SETS.pulse)].sort());
  assert.ok(SOUND_FIELDS.taste.includes("tempo") && !SOUND_FIELDS.pulse.includes("tempo"));
});

test("choice criteria stay within the API's limits and each option has a description", () => {
  for (const [id, q] of Object.entries(QUESTION_SETS.all)) {
    if (q.type === "choice") {
      const options = Object.entries(q.criteria);
      assert.ok(options.length >= 2 && options.length <= 255, `${id}: option count`);
      for (const [name, text] of options) assert.ok(typeof text === "string" && text.length > 20, `${id}.${name} needs a real description`);
    }
    if (q.type === "score") assert.ok(q.criteria.length >= 2 && q.criteria.length <= 10, `${id}: level count`);
  }
});
