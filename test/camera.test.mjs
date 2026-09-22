// Camera picks a window of the overscanned field for each layer; sampleThrough resamples the
// field through that window. These tests check the two invariants the rest of the app leans
// on without seeing them directly: the zoom/offset the camera ever hands out stays inside its
// contract (bounds, overscan), and sampleThrough's bilinear math matches the exact formula
// app.js and this module agree on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Camera, MAX_ZOOM, MIN_ZOOM, MOVE_EASE_S, MOVES, sampleThrough } from "../public/camera.js";

const SILENT = { energy: 0, bass: 0, beat: 0, bpm: 0, silent: true };

/** Steps a fresh camera on `move` for `seconds`, in `dt`-sized frames, from t=0. */
function run(move, seconds, dt = 1 / 60, overscan = 1.35) {
  const camera = new Camera(overscan);
  if (move) camera.setMove(move);
  let t = 0;
  while (t < seconds) {
    camera.step(dt, t, SILENT);
    t += dt;
  }
  return camera;
}

test("zoom stays inside [MIN_ZOOM, MAX_ZOOM] for every move, at both depth extremes, under a swinging charge", () => {
  for (const move of MOVES) {
    const camera = new Camera();
    camera.setMove(move);
    let t = 0;
    const dt = 1 / 30;
    while (t < 150) {
      // Sweep charge from 0 to 1 and back, with the occasional release, so anticipation and
      // the kick are both stressed alongside whatever the move itself is doing.
      camera.setCharge(0.5 + 0.5 * Math.sin(t * 0.7));
      if (Math.floor(t * 10) % 47 === 0) camera.release();
      camera.step(dt, t, SILENT);
      for (const depth of [0, 0.5, 1]) {
        const { zoom } = camera.view(depth);
        assert.ok(zoom >= MIN_ZOOM - 1e-9 && zoom <= MAX_ZOOM + 1e-9, `${move} @ t=${t.toFixed(2)} depth=${depth}: zoom ${zoom} out of bounds`);
      }
      t += dt;
    }
  }
});

test("push increases zoom monotonically once settled; pull decreases it", () => {
  // Burn past the initial hold->move crossfade first so only the move's own curve is sampled.
  const push = run("push", MOVE_EASE_S + 0.5);
  let prevZoom = push.view(1).zoom;
  let t = MOVE_EASE_S + 0.5;
  for (let i = 0; i < 300; i++) {
    push.step(1 / 30, t, SILENT);
    const { zoom } = push.view(1);
    assert.ok(zoom >= prevZoom - 1e-9, `push zoom should not decrease: ${zoom} < ${prevZoom} at t=${t}`);
    prevZoom = zoom;
    t += 1 / 30;
  }
  assert.ok(prevZoom > 1, "push should have moved zoom above 1");

  const pull = run("pull", MOVE_EASE_S + 0.5);
  prevZoom = pull.view(1).zoom;
  t = MOVE_EASE_S + 0.5;
  for (let i = 0; i < 300; i++) {
    pull.step(1 / 30, t, SILENT);
    const { zoom } = pull.view(1);
    assert.ok(zoom <= prevZoom + 1e-9, `pull zoom should not increase: ${zoom} > ${prevZoom} at t=${t}`);
    prevZoom = zoom;
    t += 1 / 30;
  }
  assert.ok(prevZoom < 1, "pull should have moved zoom below 1");
});

test("a move change crosses over rather than jumping: no per-frame zoom step exceeds a small epsilon", () => {
  const camera = new Camera();
  camera.setMove("push"); // starts from the constructed default ("hold") straight into a very different curve
  const dt = 1 / 60;
  let prev = camera.view(1).zoom;
  let t = 0;
  const EPS = 0.01;
  for (let i = 0; i < Math.round((MOVE_EASE_S + 2) / dt); i++) {
    camera.step(dt, t, SILENT);
    const { zoom } = camera.view(1);
    assert.ok(Math.abs(zoom - prev) < EPS, `frame ${i}: zoom jumped from ${prev} to ${zoom}`);
    prev = zoom;
    t += dt;
  }
});

test("setMove is a no-op when the name is already the current target", () => {
  const untouched = new Camera();
  const repeated = new Camera();
  untouched.setMove("sway");
  repeated.setMove("sway");
  let t = 0;
  const dt = 1 / 30;
  for (let i = 0; i < 200; i++) {
    untouched.step(dt, t, SILENT);
    repeated.step(dt, t, SILENT);
    if (i === 50) repeated.setMove("sway"); // already the target: should not restart the crossfade
    t += dt;
  }
  const a = untouched.view(1);
  const b = repeated.view(1);
  assert.ok(Math.abs(a.zoom - b.zoom) < 1e-9, "re-selecting the same move should not perturb zoom");
  assert.ok(Math.abs(a.dx - b.dx) < 1e-9, "re-selecting the same move should not perturb dx");
  assert.ok(Math.abs(a.dy - b.dy) < 1e-9, "re-selecting the same move should not perturb dy");
});

test("view(0) moves strictly less than view(1): zoom deviation under push, dx under drift", () => {
  const push = run("push", 30);
  const d0 = push.view(0);
  const d1 = push.view(1);
  assert.ok(Math.abs(d1.zoom - 1) > Math.abs(d0.zoom - 1), "far layer should carry less of the push than the near layer");

  // Quarter of drift's period puts dx near its amplitude, away from the sine's zero crossing.
  // (drift's period is internal to camera.js; 50s here just needs to match it well enough to
  // land away from a zero crossing, which a quarter-period always does regardless of the exact value.)
  const DRIFT_PERIOD_S = 50;
  const drift = run("drift", MOVE_EASE_S + DRIFT_PERIOD_S / 4);
  const dd0 = drift.view(0);
  const dd1 = drift.view(1);
  assert.ok(Math.abs(dd1.dx) > Math.abs(dd0.dx), "far layer should carry less lateral drift than the near layer");
});

test("dx/dy never push the window outside the overscanned field, even at extreme zoom or a tight overscan", () => {
  // A tight overscan (barely more than the screen) forces the clamp to actually bind.
  const camera = run("sway", 60, 1 / 30, 1.05);
  let t = 60;
  for (let i = 0; i < 120; i++) {
    camera.step(1 / 30, t, SILENT);
    for (const depth of [0, 1]) {
      const { zoom, dx, dy } = camera.view(depth);
      const maxOffset = Math.max(0, (camera.overscan * zoom - 1) / 2);
      assert.ok(Math.abs(dx) <= maxOffset + 1e-9, `dx ${dx} exceeds maxOffset ${maxOffset} at zoom ${zoom}`);
      assert.ok(Math.abs(dy) <= maxOffset + 1e-9, `dy ${dy} exceeds maxOffset ${maxOffset} at zoom ${zoom}`);
    }
    t += 1 / 30;
  }

  // overscan = 1 (no overscan at all): at zoom 1 the window IS the field, so any offset must clamp to exactly 0.
  // Settle past the move crossfade first (run() steps from t=0) so zoom is exactly sway's own
  // (== 1), not a blend that still carries a sliver of hold's breathing.
  const noOverscan = run("sway", MOVE_EASE_S + 1, 1 / 30, 1);
  const v = noOverscan.view(1);
  assert.equal(v.zoom, 1, "sway's own zoom is exactly 1 once settled"); // sanity check on the premise
  assert.equal(v.dx, 0, "dx must clamp to exactly 0 when the window already fills the unscanned field");
  assert.equal(v.dy, 0, "dy must clamp to exactly 0 when the window already fills the unscanned field");
});

test("sampleThrough is an identity when src and dst are the same size, zoom 1, no offset", () => {
  const cols = 6, rows = 5;
  const field = Float32Array.from({ length: cols * rows }, (_, i) => Math.fround(i * 0.37 - 4));
  const out = new Float32Array(cols * rows);
  sampleThrough(field, cols, rows, { zoom: 1, dx: 0, dy: 0 }, out, cols, rows);
  for (let i = 0; i < field.length; i++) {
    assert.ok(Math.abs(out[i] - field[i]) < 1e-5, `index ${i}: ${out[i]} !== ${field[i]}`);
  }
});

test("sampleThrough bilinear-interpolates correctly on a known horizontal ramp", () => {
  const cols = 10, rows = 4;
  const field = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) field[y * cols + x] = x; // field[y,x] = x

  // zoom 2 magnifies: dst is half the source window, so dst pixel i maps to source x = cx - dstCols/(2*2) + (i+0.5)/2.
  const dstCols = 8, dstRows = 4;
  const out = new Float32Array(dstCols * dstRows);
  const view = { zoom: 2, dx: 0, dy: 0 };
  sampleThrough(field, cols, rows, view, out, dstCols, dstRows);

  const cx = cols / 2; // 5, since dx=0
  const halfDstCols = dstCols / 2;
  for (let i = 0; i < dstCols; i++) {
    let sx = cx + (i - halfDstCols + 0.5) / 2 - 0.5;
    sx = sx < 0 ? 0 : sx > cols - 1 ? cols - 1 : sx;
    // field[y,x] = x, so the bilinear value at fractional sx is exactly sx.
    assert.ok(Math.abs(out[i] - sx) < 1e-4, `col ${i}: expected ${sx}, got ${out[i]}`);
  }
});

test("sampleThrough clamps source coordinates instead of reading out of bounds at extreme zoom/offset", () => {
  const cols = 4, rows = 4;
  const field = Float32Array.from({ length: cols * rows }, (_, i) => i + 1); // no zeros, so an out-of-bounds read (0) would stand out
  const dstCols = 4, dstRows = 4;
  const out = new Float32Array(dstCols * dstRows);
  // zoom far below MIN_ZOOM and a huge dx: pushes the sampled window way off the field on one side.
  sampleThrough(field, cols, rows, { zoom: 0.05, dx: 50, dy: -50 }, out, dstCols, dstRows);
  for (const v of out) {
    assert.ok(Number.isFinite(v) && v >= 1 && v <= cols * rows, `sample ${v} looks like an out-of-bounds read`);
  }
});

test("module imports cleanly with no DOM: no document/window reference at module scope", () => {
  assert.equal(typeof document, "undefined");
  assert.equal(typeof window, "undefined");
});
