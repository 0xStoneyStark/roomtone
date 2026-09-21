// One pattern lifecycle: current pattern, optional queued next, off-screen warm-up,
// and the ease in-out crossfade between them. app.js instantiates this twice (figure,
// ground) instead of keeping current/next/fade/blend as inline module state.

export const CROSSFADE_S = 2.2; // pattern, motion and look all cross over together
export const WARM_STEPS = 30; // coarse simulated steps a new pattern gets before it starts fading in
export const WARM_DT = 1 / 15;

/** One pattern instance: its own field buffer, generator, and warm-up budget still owed.
 * The special name "none" has no generator — its field stays all zeros — so a layer can
 * fade in from, or out to, black. */
function makeInstance(patterns, name, cols, rows, aspect) {
  const field = new Float32Array(cols * rows);
  const gen = name === "none" ? null : patterns[name](cols, rows, field, aspect);
  return { name, field, gen, warm: WARM_STEPS };
}

export class Layer {
  constructor(patterns, cols, rows, aspect, name = "none") {
    this.patterns = patterns;
    this.cols = cols;
    this.rows = rows;
    this.aspect = aspect;
    this.current = makeInstance(patterns, name, cols, rows, aspect);
    this.next = null;
    this.fade = 0;
    this.blend = new Float32Array(cols * rows);
  }

  /** The pattern this layer is settling to: next's name mid-switch, else current's. */
  get name() {
    return this.next ? this.next.name : this.current.name;
  }

  /** True while warming up a queued pattern or crossfading into it. */
  get transitioning() {
    return this.next !== null;
  }

  /** Queue a new pattern for warm-up then crossfade. No-op if already current or already queued. */
  switchTo(name) {
    if (this.current.name === name || this.next?.name === name) return;
    this.next = makeInstance(this.patterns, name, this.cols, this.rows, this.aspect);
    this.fade = 0;
  }

  /** Grid size changed: restart the current pattern at the new size and drop any queued one. */
  rebuild(cols, rows, aspect) {
    this.cols = cols;
    this.rows = rows;
    this.aspect = aspect;
    this.current = makeInstance(this.patterns, this.current.name, cols, rows, aspect);
    this.next = null;
    this.fade = 0;
    this.blend = new Float32Array(cols * rows);
  }

  /** Advance the current pattern and, if one is queued, warm it up then cross over to it. */
  step(dt, t, live, params, frozen = false) {
    if (!frozen && this.current.gen) this.current.gen.step(dt, t, live, params);
    if (!this.next) return this.current.field;
    if (this.next.warm > 0) {
      // Let the queued pattern populate off-screen before it fades in: one coarse step per frame.
      this.next.warm--;
      if (this.next.gen) this.next.gen.step(WARM_DT, t - this.next.warm * WARM_DT, live, params);
      return this.current.field;
    }
    if (!frozen && this.next.gen) this.next.gen.step(dt, t, live, params);
    this.fade = Math.min(1, this.fade + dt / CROSSFADE_S);
    const k = this.fade * this.fade * (3 - 2 * this.fade); // ease in-out
    for (let i = 0; i < this.blend.length; i++) this.blend[i] = this.current.field[i] * (1 - k) + this.next.field[i] * k;
    if (this.fade >= 1) {
      this.current = this.next;
      this.next = null;
      return this.current.field;
    }
    return this.blend;
  }
}
