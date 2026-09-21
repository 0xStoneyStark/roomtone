// Every option Jev can choose must be something the browser can actually draw. A palette or
// picture added to questions.mjs without a renderer counterpart would otherwise fall back silently.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GLYPHS, MOTIONS, PALETTES as PALETTE_OPTIONS, PATTERNS as PATTERN_OPTIONS, QUESTION_SETS, SOUND_FIELDS } from "../questions.mjs";
import { PATTERNS } from "../public/patterns.js";
import { GLYPH_RAMPS, PALETTES } from "../public/render.js";

const appSource = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("every picture Jev can choose has a generator", () => {
  assert.deepEqual(Object.keys(PATTERN_OPTIONS).sort(), Object.keys(PATTERNS).sort());
});

test("every glyph family Jev can choose has a ramp whose level 0 is blank", () => {
  assert.deepEqual(Object.keys(GLYPHS).sort(), Object.keys(GLYPH_RAMPS).sort());
  for (const ramp of Object.values(GLYPH_RAMPS)) assert.equal(ramp[0], " ");
});

test("every colour mood Jev can choose has a palette", () => {
  assert.deepEqual(Object.keys(PALETTE_OPTIONS).sort(), Object.keys(PALETTES).sort());
  for (const palette of Object.values(PALETTES)) assert.equal(palette.length, 16);
});

test("every motion Jev can choose is handled by the motion envelope", () => {
  for (const motion of Object.keys(MOTIONS)) {
    if (motion === "drift") continue; // the default branch
    assert.match(appSource, new RegExp(`case "${motion}":`), `motion "${motion}" has no case in app.js`);
  }
});

test("question sets carry the questions the browser reads", () => {
  assert.deepEqual(Object.keys(QUESTION_SETS.taste).sort(), ["glyphs", "motion", "palette", "pattern"]);
  assert.deepEqual(Object.keys(QUESTION_SETS.pulse).sort(), ["arc", "density", "drop_soon", "turbulence"]);
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
