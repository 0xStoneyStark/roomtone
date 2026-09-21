// Composition masks must stay a well-behaved 0..1 soft mask for every placement Jev can pick,
// and applyMask/mixMasks must follow the exact blend formulas the integrator codes against.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLACEMENTS as PLACEMENT_OPTIONS } from "../questions.mjs";
import { PLACEMENTS, applyMask, makeMask, mixMasks, reseed } from "../public/composition.js";

const SIZES = [
  { cols: 40, rows: 20, aspect: 2 },
  { cols: 96, rows: 58, aspect: 1.9 },
];

function mean(arr, pick) {
  let sum = 0, n = 0;
  for (let i = 0; i < arr.length; i++) {
    if (!pick(i)) continue;
    sum += arr[i];
    n++;
  }
  return n ? sum / n : 0;
}

test("PLACEMENTS matches the keys of questions.mjs PLACEMENTS, in order", () => {
  assert.deepEqual(PLACEMENTS, Object.keys(PLACEMENT_OPTIONS));
});

test("every mask stays within [0, 1] at a couple of grid sizes", () => {
  for (const { cols, rows, aspect } of SIZES) {
    const out = new Float32Array(cols * rows);
    for (const kind of PLACEMENTS) {
      makeMask(kind, cols, rows, aspect, 1.23, out);
      for (let i = 0; i < out.length; i++) {
        assert.ok(out[i] >= 0 && out[i] <= 1, `${kind} @ ${cols}x${rows}: out[${i}]=${out[i]}`);
      }
    }
  }
});

test("bleed is all 1", () => {
  const { cols, rows, aspect } = SIZES[0];
  const out = new Float32Array(cols * rows);
  makeMask("bleed", cols, rows, aspect, 5, out);
  for (const v of out) assert.equal(v, 1);
});

test("island centre is brighter than an island corner", () => {
  const { cols, rows, aspect } = SIZES[0];
  const out = new Float32Array(cols * rows);
  makeMask("island", cols, rows, aspect, 0, out);
  const centre = out[Math.floor(rows / 2) * cols + Math.floor(cols / 2)];
  const corner = out[0];
  assert.ok(centre > corner, `centre ${centre} should exceed corner ${corner}`);
});

test("horizon bottom row is brighter on average than the top row", () => {
  const { cols, rows, aspect } = SIZES[0];
  const out = new Float32Array(cols * rows);
  makeMask("horizon", cols, rows, aspect, 3, out);
  const topMean = mean(out, (i) => i < cols);
  const bottomMean = mean(out, (i) => i >= cols * (rows - 1));
  assert.ok(bottomMean > topMean, `bottom mean ${bottomMean} should exceed top mean ${topMean}`);
});

test("diagonal: a cell on the bottom-left/top-right line beats a cell near the top-left corner", () => {
  const { cols, rows, aspect } = SIZES[0];
  const out = new Float32Array(cols * rows);
  makeMask("diagonal", cols, rows, aspect, 0, out);
  const onLine = out[Math.floor(rows / 2) * cols + Math.floor(cols / 2)];
  const topLeftCorner = out[0];
  assert.ok(onLine > topLeftCorner, `on-line ${onLine} should exceed corner ${topLeftCorner}`);
});

test("edge: one side's mean is brighter than the other's", () => {
  const { cols, rows, aspect } = SIZES[0];
  const out = new Float32Array(cols * rows);
  makeMask("edge", cols, rows, aspect, 0, out);
  const half = Math.floor(cols / 2);
  const leftMean = mean(out, (i) => (i % cols) < half);
  const rightMean = mean(out, (i) => (i % cols) >= half);
  assert.notEqual(leftMean, rightMean);
});

test("reseed changes the constellation/edge session without breaking the [0, 1] contract", () => {
  const { cols, rows, aspect } = SIZES[0];
  const before = new Float32Array(cols * rows);
  const after = new Float32Array(cols * rows);
  makeMask("edge", cols, rows, aspect, 0, before);
  reseed();
  makeMask("edge", cols, rows, aspect, 0, after);
  for (const v of after) assert.ok(v >= 0 && v <= 1);
});

test("applyMask: strength 0 leaves the field unchanged, strength 1 gives field * mask", () => {
  const field = Float32Array.from([1, 0.5, 0.2, 0.8]);
  const mask = Float32Array.from([0.1, 0.9, 0.4, 0.6]);
  const out = new Float32Array(4);

  applyMask(field, mask, 0, out);
  assert.deepEqual(Array.from(out), Array.from(field));

  applyMask(field, mask, 1, out);
  for (let i = 0; i < field.length; i++) assert.ok(Math.abs(out[i] - field[i] * mask[i]) < 1e-6);
});

test("mixMasks: k=0 reproduces a, k=1 reproduces b", () => {
  const a = Float32Array.from([1, 0, 0.5, 0.25]);
  const b = Float32Array.from([0, 1, 0.2, 0.75]);
  const out = new Float32Array(4);

  mixMasks(a, b, 0, out);
  assert.deepEqual(Array.from(out), Array.from(a));

  mixMasks(a, b, 1, out);
  assert.deepEqual(Array.from(out), Array.from(b));
});
