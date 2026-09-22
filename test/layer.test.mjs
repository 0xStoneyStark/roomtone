// Layer owns the pattern lifecycle app.js used to keep as inline module state
// (current/next, warm-up, crossfade). These tests use fake generators that write a
// constant into their field ("a" -> 0.2, "b" -> 0.8) and count their own step calls,
// so the warm-up and crossfade timing can be checked without a real pattern's noise.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CROSSFADE_S, Layer, OVERSCAN, WARM_STEPS } from "../public/layer.js";
import { PATTERNS } from "../public/patterns.js";

const LIVE = { energy: 0.3, bass: 0.2, beat: 0, bpm: 120 };
const PARAMS = { density: 0.4, turbulence: 0.3, arc: 0.3, drop: 0, speed: 0.5 };

/** A fresh pair of fake generators plus a call counter per name, for one test.
 * Each just fills its field with a constant, so the blend value alone tells current from next. */
function makeFakePatterns() {
  const counts = { a: 0, b: 0 };
  const a = (cols, rows, field) => ({ step: () => { counts.a++; field.fill(0.2); } });
  const b = (cols, rows, field) => ({ step: () => { counts.b++; field.fill(0.8); } });
  return { patterns: { a, b }, counts };
}

test("warm-up performs exactly WARM_STEPS steps on the queued pattern, returning the current field meanwhile", () => {
  const { patterns, counts } = makeFakePatterns();
  const layer = new Layer(patterns, 4, 4, 1, "a");
  layer.switchTo("b");
  for (let i = 0; i < WARM_STEPS; i++) {
    const field = layer.step(0.1, i * 0.1, LIVE, PARAMS);
    // Float32Array can't hold 0.2 exactly, so compare against the same rounding.
    assert.equal(field[0], Math.fround(0.2), `frame ${i} should still show the current pattern`);
  }
  assert.equal(counts.b, WARM_STEPS);
});

test("after warm-up, the crossfade rises monotonically from current to next and settles at next within CROSSFADE_S", () => {
  const { patterns } = makeFakePatterns();
  const layer = new Layer(patterns, 4, 4, 1, "a");
  layer.switchTo("b");
  for (let i = 0; i < WARM_STEPS; i++) layer.step(0.1, 0, LIVE, PARAMS);

  const dt = CROSSFADE_S / 20;
  let prev = -Infinity;
  let field;
  for (let i = 0; i < 25; i++) {
    field = layer.step(dt, 0, LIVE, PARAMS);
    assert.ok(field[0] >= prev - 1e-9, "the visible value should never dip while crossfading in");
    prev = field[0];
  }
  assert.ok(Math.abs(field[0] - 0.8) < 1e-6, "should have fully settled on the incoming pattern");
  assert.equal(layer.transitioning, false);
});

test("frozen skips stepping current and next, but the fade still advances", () => {
  const { patterns, counts } = makeFakePatterns();
  const layer = new Layer(patterns, 4, 4, 1, "a");
  layer.switchTo("b");
  for (let i = 0; i < WARM_STEPS; i++) layer.step(0.1, 0, LIVE, PARAMS); // warm-up always steps, frozen or not
  const before = { ...counts };

  const field = layer.step(CROSSFADE_S / 2, 0, LIVE, PARAMS, true);
  assert.deepEqual(counts, before, "neither pattern should step while frozen");
  assert.ok(field[0] > 0.2 && field[0] < 0.8, "the fade itself should still have moved");
});

test("switchTo the current pattern's name is a no-op", () => {
  const { patterns } = makeFakePatterns();
  const layer = new Layer(patterns, 4, 4, 1, "a");
  layer.switchTo("a");
  assert.equal(layer.transitioning, false);
  assert.equal(layer.name, "a");
});

test("switchTo the already-queued pattern's name is a no-op", () => {
  const { patterns } = makeFakePatterns();
  const layer = new Layer(patterns, 4, 4, 1, "a");
  layer.switchTo("b");
  const queued = layer.next;
  layer.switchTo("b");
  assert.equal(layer.next, queued, "the queued pattern instance should not be replaced");
});

test("rebuild recreates the current pattern at the new overscanned size and drops any queued pattern", () => {
  const { patterns } = makeFakePatterns();
  const layer = new Layer(patterns, 4, 4, 1, "a");
  layer.switchTo("b");
  assert.equal(layer.transitioning, true);

  // rebuild takes SCREEN dimensions; the field it reallocates is those dimensions times overscan.
  layer.rebuild(6, 5, 1);
  assert.equal(layer.transitioning, false);
  const expectedCols = Math.round(6 * OVERSCAN);
  const expectedRows = Math.round(5 * OVERSCAN);
  assert.equal(layer.cols, expectedCols);
  assert.equal(layer.rows, expectedRows);
  const field = layer.step(0.016, 0, LIVE, PARAMS);
  assert.equal(field.length, expectedCols * expectedRows);
});

test("layer.cols/rows report the overscanned field size, not the screen size passed to the constructor", () => {
  const { patterns } = makeFakePatterns();
  const layer = new Layer(patterns, 10, 8, 1, "a");
  assert.equal(layer.cols, Math.round(10 * OVERSCAN));
  assert.equal(layer.rows, Math.round(8 * OVERSCAN));
});

test("step returns a field sized cols*rows for the overscanned dimensions, not the screen dimensions", () => {
  const { patterns } = makeFakePatterns();
  const layer = new Layer(patterns, 10, 8, 1, "a");
  const field = layer.step(0.016, 0, LIVE, PARAMS);
  assert.equal(field.length, layer.cols * layer.rows);
  assert.equal(field.length, Math.round(10 * OVERSCAN) * Math.round(8 * OVERSCAN));
  assert.notEqual(field.length, 10 * 8, "field must be larger than the screen grid, not equal to it");
});

test("a custom overscan passed to the constructor is honoured by cols/rows and the stepped field", () => {
  const { patterns } = makeFakePatterns();
  const layer = new Layer(patterns, 10, 8, 1, "a", 2);
  assert.equal(layer.cols, 20);
  assert.equal(layer.rows, 16);
  const field = layer.step(0.016, 0, LIVE, PARAMS);
  assert.equal(field.length, 320);
});

test("overscan = 1 reproduces today's exact behaviour: the field equals the screen grid", () => {
  const { patterns } = makeFakePatterns();
  const layer = new Layer(patterns, 6, 5, 1, "a", 1);
  assert.equal(layer.cols, 6);
  assert.equal(layer.rows, 5);
  const field = layer.step(0.016, 0, LIVE, PARAMS);
  assert.equal(field.length, 30);
});

test('"none" is an empty layer with an all-zero field, and switching away from it crossfades in from black', () => {
  const { patterns } = makeFakePatterns();
  const layer = new Layer(patterns, 4, 4, 1, "none");
  const zeroField = layer.step(0.016, 0, LIVE, PARAMS);
  assert.ok([...zeroField].every((v) => v === 0));

  layer.switchTo("a");
  for (let i = 0; i < WARM_STEPS; i++) layer.step(0.1, 0, LIVE, PARAMS);
  const field = layer.step(CROSSFADE_S / 2, 0, LIVE, PARAMS);
  assert.ok(field[0] > 0 && field[0] < 0.2, "should be partway between black and the incoming pattern");
});

test('switching to "none" crossfades out to black', () => {
  const { patterns } = makeFakePatterns();
  const layer = new Layer(patterns, 4, 4, 1, "a");
  layer.switchTo("none");
  for (let i = 0; i < WARM_STEPS; i++) layer.step(0.1, 0, LIVE, PARAMS);
  let field = layer.step(CROSSFADE_S / 2, 0, LIVE, PARAMS);
  assert.ok(field[0] > 0 && field[0] < 0.2, "should be partway between the outgoing pattern and black");
  for (let i = 0; i < 25; i++) field = layer.step(CROSSFADE_S / 20, 0, LIVE, PARAMS);
  assert.ok(Math.abs(field[0]) < 1e-6, "should have settled on black");
});

test("every real pattern in patterns.js can drive a Layer without throwing", () => {
  for (const name of Object.keys(PATTERNS)) {
    const layer = new Layer(PATTERNS, 20, 12, 1, name);
    for (let i = 0; i < 5; i++) {
      assert.doesNotThrow(() => layer.step(1 / 60, i / 60, LIVE, PARAMS));
    }
  }
});
