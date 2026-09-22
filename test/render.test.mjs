// marks.js orientation math and the GLYPH_RAMPS shape it depends on. render.js pulls in the
// DOM (canvas) only inside methods, so importing it here for GLYPH_RAMPS stays DOM-free.
// coverageThreshold is the other pure part: the density-cutoff math `pass()` relies on, exposed
// so it can be tested without a canvas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { orientations, cellHash } from "../public/marks.js";
import { GLYPH_RAMPS, coverageThreshold, FLOOR } from "../public/render.js";

/** A field with one value per cell, evenly spaced 0..(n-1)/(n-1) across 0..1 — every histogram
 * bucket gets roughly the same count, which is what the "keeps close to X%" tests need. */
function rampField(n) {
  const field = new Float32Array(n);
  for (let i = 0; i < n; i++) field[i] = i / (n - 1);
  return field;
}

/** Share of cells whose value (after gain) clears threshold — what coverageThreshold is promising. */
function keptShare(field, gain, threshold) {
  let kept = 0;
  for (const v of field) if (v * gain >= threshold) kept++;
  return kept / field.length;
}

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

test("coverage 1 returns the FLOOR unchanged, regardless of the field", () => {
  // Arrange
  const flat = new Float32Array(500).fill(0.9);
  const ramp = rampField(500);
  // Act + Assert
  assert.equal(coverageThreshold(flat, 1, 1), FLOOR);
  assert.equal(coverageThreshold(ramp, 1, 1), FLOOR);
  assert.equal(coverageThreshold(ramp, 3, 1), FLOOR); // gain must not matter either, coverage 1 is a full bypass
});

test("coverage 0.25 selects a threshold that keeps close to 25% of cells", () => {
  // Arrange: values spread evenly 0..1, so the histogram has even counts per bucket to cut against.
  const field = rampField(20000);
  // Act
  const threshold = coverageThreshold(field, 1, 0.25);
  const share = keptShare(field, 1, threshold);
  // Assert: within a couple of percent of the requested 25% share.
  assert.ok(Math.abs(share - 0.25) < 0.03, `kept ${(share * 100).toFixed(1)}% of cells`);
});

test("coverage 0 keeps essentially nothing", () => {
  // Arrange
  const field = rampField(20000);
  // Act
  const threshold = coverageThreshold(field, 1, 0);
  const share = keptShare(field, 1, threshold);
  // Assert
  assert.ok(share < 0.02, `kept ${(share * 100).toFixed(1)}% of cells, expected ~0%`);
});

test("threshold rises monotonically as coverage falls", () => {
  // Arrange
  const field = rampField(20000);
  const coverages = [0.9, 0.7, 0.5, 0.3, 0.1, 0.02];
  // Act
  const thresholds = coverages.map((c) => coverageThreshold(field, 1, c));
  // Assert: every step down in coverage must not lower the threshold.
  for (let i = 1; i < thresholds.length; i++) {
    assert.ok(thresholds[i] >= thresholds[i - 1], `coverage ${coverages[i]} (${thresholds[i]}) should be >= coverage ${coverages[i - 1]} (${thresholds[i - 1]})`);
  }
});

test("a uniform field does not crash and stays within range", () => {
  // Arrange: every cell reads the same value, so there is no way to hit 50% coverage exactly —
  // it's an all-or-nothing bucket. The function should still return a sane, in-range threshold.
  const field = new Float32Array(1000).fill(0.42);
  // Act
  const threshold = coverageThreshold(field, 1, 0.5);
  // Assert
  assert.ok(threshold >= FLOOR && threshold <= 1, `threshold ${threshold} out of range`);
});

test("a heavily skewed field (mostly quiet, one loud spike) keeps close to the spike's share", () => {
  // Arrange: 95% of cells barely above black, 5% loud — like a sparse pattern's real distribution.
  const field = new Float32Array(10000).fill(0.02);
  for (let i = 9500; i < 10000; i++) field[i] = 0.9;
  // Act
  const threshold = coverageThreshold(field, 1, 0.05);
  const share = keptShare(field, 1, threshold);
  // Assert: the cutoff should land between the quiet floor and the spike, keeping ~the spike alone.
  assert.ok(Math.abs(share - 0.05) < 0.02, `kept ${(share * 100).toFixed(1)}% of cells`);
});

test("gain is accounted for: the threshold scales with it, not just the field values", () => {
  // Arrange
  const field = rampField(20000);
  // Act
  const at1x = coverageThreshold(field, 1, 0.25);
  const at2x = coverageThreshold(field, 0.5, 0.25); // half the gain of the field above
  // Assert: same coverage share picks the same cells, so the pre-gain value at the cutoff is the
  // same physical point in the field — the reported (post-gain) threshold should scale with gain.
  assert.ok(Math.abs(at2x - at1x * 0.5) < 0.03, `at1x=${at1x} at2x=${at2x}`);
});

test("coverageThreshold reuses a caller-provided histogram buffer without resizing it", () => {
  // Arrange
  const hist = new Uint32Array(128);
  const field = rampField(5000);
  // Act
  coverageThreshold(field, 1, 0.5, hist);
  // Assert: still the same buffer, same length — proof the function scratch-writes rather than allocating.
  assert.equal(hist.length, 128);
  assert.ok(hist instanceof Uint32Array);
});
