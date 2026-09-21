// marks.js orientation math and the GLYPH_RAMPS shape it depends on. render.js pulls in the
// DOM (canvas) only inside methods, so importing it here for GLYPH_RAMPS stays DOM-free.
import { test } from "node:test";
import assert from "node:assert/strict";
import { orientations, cellHash } from "../public/marks.js";
import { GLYPH_RAMPS } from "../public/render.js";

const DIRECTIONAL_FAMILIES = ["strokes", "hatching"];

test("orientations() returns only 0-3 and is deterministic on a flat field", () => {
  const cols = 6, rows = 5;
  const field = new Float32Array(cols * rows).fill(0.5);
  const out1 = new Uint8Array(cols * rows);
  const out2 = new Uint8Array(cols * rows);
  orientations(field, cols, rows, 1, out1);
  orientations(field, cols, rows, 1, out2);
  for (const v of out1) assert.ok(v >= 0 && v <= 3);
  assert.deepEqual(Array.from(out1), Array.from(out2));
});

// Convention: a mark runs ALONG the iso-line, perpendicular to the gradient. A field that only
// varies left-to-right has vertical iso-lines (each column is at a constant value), so it reads
// as vertical marks.
test("a field that only varies in x (a horizontal gradient) yields vertical marks", () => {
  const cols = 8, rows = 6;
  const field = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) field[y * cols + x] = x / (cols - 1);
  const out = new Uint8Array(cols * rows);
  orientations(field, cols, rows, 1, out);
  for (const v of out) assert.equal(v, 1);
});

// Same convention, checked with the axes swapped: a field that only varies top-to-bottom has
// horizontal iso-lines, so the aspect-corrected gradient should read as horizontal marks.
test("a field that only varies in y (a vertical gradient) yields horizontal marks", () => {
  const cols = 6, rows = 8;
  const field = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) field[y * cols + x] = y / (rows - 1);
  const out = new Uint8Array(cols * rows);
  orientations(field, cols, rows, 1.25, out); // a non-1 aspect must not change the axis, only the angle math
  for (const v of out) assert.equal(v, 0);
});

test("cellHash is deterministic for the same cell", () => {
  assert.equal(cellHash(3, 4), cellHash(3, 4));
  assert.equal(cellHash(3, 4), cellHash(3, 4));
});

test("every GLYPH_RAMPS family has a blank glyph at index 0", () => {
  for (const [name, ramp] of Object.entries(GLYPH_RAMPS)) assert.equal(ramp[0], " ", name);
});

test("directional glyph families expose h/v/d1/d2 at every level above 0", () => {
  for (const name of DIRECTIONAL_FAMILIES) {
    const ramp = GLYPH_RAMPS[name];
    assert.ok(ramp, `${name} ramp missing`);
    for (let i = 1; i < ramp.length; i++) {
      const entry = ramp[i];
      for (const k of ["h", "v", "d1", "d2"]) assert.ok(k in entry, `${name}[${i}].${k}`);
    }
  }
});
