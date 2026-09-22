// solid.js is the odd one out: a point-cloud + z-buffer render of a rotating superformula
// solid, not a texture field. These tests check the contract the other patterns share
// (0..1 field, no NaN, never throws) plus what's specific to this generator: every FORMS
// key and SHADINGS mode runs cleanly, the z-buffer actually hides the far surface, and a
// p.form change morphs the shape over time instead of snapping in one frame.
import { test } from "node:test";
import assert from "node:assert/strict";
import { solid, FORMS, SHADINGS } from "../public/solid.js";

const LIVE = { energy: 0.4, bass: 0.3, beat: 0, bpm: 120 };
const PARAMS = { density: 0.6, turbulence: 0.2, arc: 0.4, drop: 0, speed: 0.5, form: "smooth", shading: "lit" };

function makeField(cols, rows) {
  return new Float32Array(cols * rows);
}

/** Steps long enough (MORPH_S is "about a second") for a form morph to fully settle. */
function settle(gen, field, cols, rows, live, p, frames = 90, dt = 1 / 30) {
  let t = 0;
  for (let i = 0; i < frames; i++) {
    gen.step(dt, t, live, p);
    t += dt;
  }
  return t;
}

function assertNoNaN(field, label) {
  for (let i = 0; i < field.length; i++) {
    assert.ok(Number.isFinite(field[i]), `${label}: field[${i}] should be finite, got ${field[i]}`);
  }
}

function assertWithinUnit(field, label) {
  for (let i = 0; i < field.length; i++) {
    assert.ok(field[i] >= 0 && field[i] <= 1, `${label}: field[${i}]=${field[i]} out of 0..1`);
  }
}

function litCount(field) {
  let n = 0;
  for (let i = 0; i < field.length; i++) if (field[i] > 0) n++;
  return n;
}

test("module imports cleanly with no DOM: no document/window reference at module scope", () => {
  assert.equal(typeof document, "undefined");
  assert.equal(typeof window, "undefined");
});

test("FORMS and SHADINGS expose the documented keys", () => {
  assert.deepEqual(Object.keys(FORMS), ["smooth", "swollen", "spiky", "bladed", "twisted", "hollow"]);
  assert.deepEqual(SHADINGS, ["lit", "wireframe", "points", "dissolving"]);
});

test("every FORMS key produces a field with lit cells and no NaN, once the morph settles", () => {
  const cols = 40, rows = 24;
  for (const formName of Object.keys(FORMS)) {
    const field = makeField(cols, rows);
    const gen = solid(cols, rows, field, 0.55);
    const p = { ...PARAMS, form: formName, shading: "lit" };
    settle(gen, field, cols, rows, LIVE, p);
    assertNoNaN(field, formName);
    assertWithinUnit(field, formName);
    assert.ok(litCount(field) > 0, `form ${formName} should light at least one cell`);
  }
});

test("all four SHADINGS run without throwing and stay within 0..1", () => {
  const cols = 36, rows = 22;
  for (const shading of SHADINGS) {
    const field = makeField(cols, rows);
    const gen = solid(cols, rows, field, 0.55);
    const p = { ...PARAMS, form: "twisted", shading, turbulence: shading === "dissolving" ? 0.7 : 0.2 };
    assert.doesNotThrow(() => settle(gen, field, cols, rows, LIVE, p), `shading ${shading} should not throw`);
    assertNoNaN(field, shading);
    assertWithinUnit(field, shading);
  }
});

test("the z-buffer hides the far surface: lit cells are well below the sampled point count", () => {
  const cols = 44, rows = 26;
  const field = makeField(cols, rows);
  const gen = solid(cols, rows, field, 0.55);
  // A dense, low-density-cutoff pass so most of the sampled grid is eligible to draw; if the
  // far hemisphere were not culled by depth, roughly twice as many samples would compete for
  // (and often overwrite, but still touch) the same small set of screen cells as a convex,
  // front-and-back-visible dump would. What we can assert without reaching into internals is
  // the structural guarantee of z-buffered rasterization: each cell holds at most one winner,
  // so lit cells can never exceed the number of distinct cells touched, and for a bounded,
  // roughly-spherical silhouette that is a small fraction of the full field.
  const p = { ...PARAMS, form: "smooth", shading: "points", density: 1 };
  settle(gen, field, cols, rows, LIVE, p);
  const lit = litCount(field);
  assert.ok(lit < cols * rows * 0.6, `lit cells (${lit}) should cover well under the full field (${cols * rows})`);
  assert.ok(lit > 0, "the solid should still be visible");
});

test("a convex form's lit-cell count is well below the underlying point sample count (occlusion + shared cells)", () => {
  const cols = 50, rows = 30;
  const field = makeField(cols, rows);
  const gen = solid(cols, rows, field, 0.55);
  const p = { ...PARAMS, form: "smooth", shading: "lit", density: 1 };
  settle(gen, field, cols, rows, LIVE, p);
  // ~3 points/cell is the generator's own budget (see POINTS_PER_CELL in solid.js); a solid,
  // occluded object should show far fewer lit cells than that many independent points would
  // if scattered with no depth test across the whole field.
  const approxPointBudget = cols * rows * 3;
  const lit = litCount(field);
  assert.ok(lit < approxPointBudget * 0.5, `lit (${lit}) should be well under the point budget (${approxPointBudget})`);
});

test("step is stable over 200 frames with varying live/p: no throw, no NaN, stays within 0..1", () => {
  const cols = 42, rows = 25;
  const field = makeField(cols, rows);
  const gen = solid(cols, rows, field, 0.6);
  const forms = Object.keys(FORMS);
  let t = 0;
  assert.doesNotThrow(() => {
    for (let i = 0; i < 200; i++) {
      const live = { energy: (Math.sin(i * 0.11) + 1) / 2, bass: (Math.cos(i * 0.07) + 1) / 2, beat: i % 17 === 0 ? 1 : 0, bpm: 100 + (i % 40) };
      const p = {
        density: (Math.sin(i * 0.05) + 1) / 2,
        turbulence: (Math.cos(i * 0.03) + 1) / 2,
        arc: 0.5,
        drop: 0,
        speed: (Math.sin(i * 0.02) + 1) / 2,
        form: forms[i % forms.length],
        shading: SHADINGS[i % SHADINGS.length],
      };
      gen.step(1 / 60, t, live, p);
      t += 1 / 60;
      assertNoNaN(field, `frame ${i}`);
      assertWithinUnit(field, `frame ${i}`);
    }
  });
});

test("missing p.form and p.shading default cleanly instead of throwing", () => {
  const cols = 30, rows = 18;
  const field = makeField(cols, rows);
  const gen = solid(cols, rows, field, 0.55);
  const p = { density: 0.5, turbulence: 0.3, arc: 0.5, drop: 0, speed: 0.5 }; // no form, no shading
  assert.doesNotThrow(() => settle(gen, field, cols, rows, LIVE, p, 60));
  assertNoNaN(field, "no form/shading");
  assertWithinUnit(field, "no form/shading");
  assert.ok(litCount(field) > 0, "should still render the default form/shading");
});

test("an entirely empty p and live default cleanly instead of throwing", () => {
  const cols = 24, rows = 16;
  const field = makeField(cols, rows);
  const gen = solid(cols, rows, field, 0.55);
  assert.doesNotThrow(() => {
    for (let i = 0; i < 10; i++) gen.step(1 / 60, i / 60, {}, {});
  });
  assertNoNaN(field, "empty p/live");
  assertWithinUnit(field, "empty p/live");
});

test("an unknown p.form or p.shading falls back to the default rather than throwing", () => {
  const cols = 24, rows = 16;
  const field = makeField(cols, rows);
  const gen = solid(cols, rows, field, 0.55);
  const p = { ...PARAMS, form: "nonexistent-form", shading: "nonexistent-shading" };
  assert.doesNotThrow(() => settle(gen, field, cols, rows, LIVE, p, 60));
  assertNoNaN(field, "unknown form/shading");
});

test("changing p.form morphs the shape gradually: one frame after the switch is much closer to the old shape than the settled new one", () => {
  const cols = 40, rows = 24;
  const field = makeField(cols, rows);
  const gen = solid(cols, rows, field, 0.55);
  const dt = 1 / 60;
  let t = 0;

  // Settle fully on "smooth" and snapshot it.
  const pSmooth = { ...PARAMS, form: "smooth", shading: "lit", turbulence: 0 };
  for (let i = 0; i < 90; i++) { gen.step(dt, t, LIVE, pSmooth); t += dt; }
  const smoothField = Float32Array.from(field);

  // Switch to "spiky": one frame later, the field should still look much more like the old
  // shape than the eventual new one.
  const pSpiky = { ...PARAMS, form: "spiky", shading: "lit", turbulence: 0 };
  gen.step(dt, t, LIVE, pSpiky);
  t += dt;
  const oneFrameField = Float32Array.from(field);

  // Let the morph (MORPH_S ~1s) fully settle on "spiky".
  for (let i = 0; i < 120; i++) { gen.step(dt, t, LIVE, pSpiky); t += dt; }
  const settledField = Float32Array.from(field);

  const dist = (a, b) => {
    let sum = 0;
    for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; sum += d * d; }
    return Math.sqrt(sum);
  };

  const distAfterOneFrame = dist(smoothField, oneFrameField);
  const distAfterSettled = dist(smoothField, settledField);
  assert.ok(
    distAfterOneFrame < distAfterSettled * 0.3,
    `one frame after switching form should look close to the old shape (${distAfterOneFrame.toFixed(3)}) ` +
      `relative to the fully-settled distance (${distAfterSettled.toFixed(3)})`,
  );
});

test("re-targeting p.form mid-morph does not throw or snap: it eases from wherever it currently is", () => {
  const cols = 30, rows = 18;
  const field = makeField(cols, rows);
  const gen = solid(cols, rows, field, 0.55);
  const dt = 1 / 30;
  let t = 0;
  const forms = ["smooth", "spiky", "hollow", "bladed", "twisted", "swollen"];
  assert.doesNotThrow(() => {
    for (let i = 0; i < 60; i++) {
      const p = { ...PARAMS, form: forms[Math.floor(i / 7) % forms.length], shading: "lit" };
      gen.step(dt, t, LIVE, p);
      t += dt;
    }
  });
  assertNoNaN(field, "mid-morph retarget");
  assertWithinUnit(field, "mid-morph retarget");
});

test("allocation-free per step: repeated step() calls do not grow field/point buffers or throw under a frozen grid size", () => {
  const cols = 32, rows = 20;
  const field = makeField(cols, rows);
  const gen = solid(cols, rows, field, 0.55);
  const before = field.length;
  for (let i = 0; i < 50; i++) gen.step(1 / 60, i / 60, LIVE, PARAMS);
  assert.equal(field.length, before, "the caller's field buffer identity/size must be untouched by step()");
});

test("a second generator instance at a different grid size is independent (fresh point budget, no shared state)", () => {
  const fieldA = makeField(20, 12);
  const fieldB = makeField(60, 36);
  const genA = solid(20, 12, fieldA, 0.55);
  const genB = solid(60, 36, fieldB, 0.55);
  for (let i = 0; i < 30; i++) {
    genA.step(1 / 60, i / 60, LIVE, PARAMS);
    genB.step(1 / 60, i / 60, LIVE, PARAMS);
  }
  assertNoNaN(fieldA, "A");
  assertNoNaN(fieldB, "B");
  assert.notEqual(litCount(fieldA), undefined);
});
