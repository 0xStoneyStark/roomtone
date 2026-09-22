// The art director's ledger: what the mic said, what Jev answered, and which
// option the dice landed on. Taste rows are rebuilt per scene; pulse rows are
// updated in place because they change a couple of times a second. Built with
// DOM nodes (no innerHTML) because the listener's note is user text.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A segmented meter: ten cells (or five for scores), filled to `fraction` via a CSS variable. */
function meter(cells = 10) {
  const node = el("span", "meter" + (cells === 5 ? " meter--5" : ""));
  node.append(el("i"));
  return node;
}

function fill(meterNode, fraction) {
  meterNode.style.setProperty("--p", Math.max(0, Math.min(1, fraction)).toFixed(3));
}

function topOptions(probabilities, n) {
  return Object.entries(probabilities).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function row(label, picked = false, cellsInMeter = 10, index = 0) {
  const node = el("div", "row" + (picked ? " row--picked" : ""));
  node.style.setProperty("--i", index);
  const cells = {
    label: el("span", "row__label", label),
    name: el("span", "row__name"),
    bar: meter(cellsInMeter),
    pct: el("span", "row__pct"),
    mark: el("span", "row__mark"),
  };
  node.append(...Object.values(cells));
  return { node, cells };
}

export class Ledger {
  constructor(root) {
    this.root = root;
    this.heard = root.querySelector("[data-heard]");
    this.now = root.querySelector("[data-now]");
    this.tasteRows = root.querySelector("[data-taste]");
    this.pulseRows = root.querySelector("[data-pulse]");
    this.metaLine = root.querySelector("[data-meta]");
    this.note = root.querySelector("[data-note]");
    this.message = root.querySelector("[data-message]");
    // Two more optional listener-driven lines, built the same way the note is (no
    // innerHTML, both can carry user text) and slotted in right after it.
    this.direction = el("p", "ledger__note");
    this.rejected = el("p", "ledger__heard");
    this.note.after(this.direction, this.rejected);
    this.pulse = null; // live rows, created on the first pulse answer
  }

  /** A line of direction at the top of the ledger: waiting, error, or nothing. */
  say(text, kind = "info") {
    this.message.textContent = text ?? "";
    this.message.dataset.kind = text ? kind : "";
    this.root.classList.toggle("is-busy", Boolean(text) && kind === "wait");
  }

  meta(model, ms, sessionTokens) {
    this.metaLine.textContent = `${model} · ${ms} ms · ${(sessionTokens / 1000).toFixed(1)}k tokens this session`;
  }

  showTaste({ state, answers, rolled, replayed }) {
    this.heard.textContent = (replayed ? "(replay) " : "") + Object.values(state.sound).join(" · ");
    this.note.textContent = state.listener_note === "(none)" ? "" : `you said: ${state.listener_note}`;
    // listener_direction and already_rejected are newer, listener-driven state: gate on them the
    // same defensive way as the taste answers below, since a replayed answer set can predate them.
    this.direction.textContent =
      !state.listener_direction || state.listener_direction === "(none)" ? "" : `you asked for: ${state.listener_direction}`;
    this.rejected.textContent =
      !state.already_rejected || state.already_rejected === "(none)" ? "" : `avoiding: ${state.already_rejected}`;
    this.tasteRows.replaceChildren();
    this.rowIndex = 0;
    // Defensive: older replays may carry a narrower answer set than the current question set.
    if (answers.pattern) this.choiceRows("picture", answers.pattern, rolled.pattern, 3);
    if (answers.ground) this.choiceRows("ground", answers.ground, rolled.ground, 2);
    if (answers.glyphs) this.choiceRows("glyphs", answers.glyphs, rolled.glyphs, 2);
    if (answers.palette) this.choiceRows("colour", answers.palette, rolled.palette, 2);
    if (answers.motion) this.choiceRows("motion", answers.motion, rolled.motion, 2);
    if (answers.camera) this.choiceRows("camera", answers.camera, rolled.camera, 2);
    if (answers.placement) this.choiceRows("placement", answers.placement, rolled.placement, 2);
    if (answers.emptiness) this.scoreRowOnce("emptiness", answers.emptiness);
    if (answers.accent) this.scoreRowOnce("accent", answers.accent);
  }

  showPulse({ state, answers }) {
    this.now.textContent = `now · ${Object.values(state.sound).join(" · ")}`;
    if (!this.pulse) {
      this.pulse = {
        density: row("fill", false, 5),
        turbulence: row("order", false, 5),
        arc: row("arc", false, 5),
        drop_soon: row("drop", false, 5),
        turned: row("turned", false, 5),
      };
      this.pulseRows.replaceChildren(...Object.values(this.pulse).map((r) => r.node));
    }
    if (answers.density) this.scoreRow(this.pulse.density, answers.density);
    if (answers.turbulence) this.scoreRow(this.pulse.turbulence, answers.turbulence);
    if (answers.arc) this.scoreRow(this.pulse.arc, answers.arc);
    if (answers.drop_soon) this.noulRow(this.pulse.drop_soon, answers.drop_soon);
    if (answers.turned) this.noulRow(this.pulse.turned, answers.turned);
  }

  /** A score row in the taste ledger: built fresh each scene, unlike the persistent pulse rows. */
  scoreRowOnce(label, answer) {
    const r = row(label, false, 5, this.rowIndex++);
    this.scoreRow(r, answer);
    this.tasteRows.append(r.node);
  }

  choiceRows(label, answer, picked, count) {
    const options = topOptions(answer.probabilities, count);
    if (!options.some(([name]) => name === picked)) options.push([picked, answer.probabilities[picked]]);
    const wasFavourite = picked === answer.choice;
    options.forEach(([name, p], i) => {
      const r = row(i === 0 ? label : "", name === picked, 10, this.rowIndex++);
      r.cells.name.textContent = name;
      fill(r.cells.bar, p);
      r.cells.pct.textContent = String(Math.round(p * 100)).padStart(3);
      r.cells.mark.textContent = name === picked ? (wasFavourite ? "rolled" : "rolled the long shot") : "";
      this.tasteRows.append(r.node);
    });
  }

  scoreRow(r, answer) {
    const levels = Object.keys(answer.legend).length;
    r.cells.name.textContent = answer.legend[String(Math.round(answer.score))].split(":")[0].toLowerCase();
    fill(r.cells.bar, answer.score / (levels - 1));
    r.cells.pct.textContent = `${answer.score.toFixed(1)}/${levels - 1}`;
  }

  noulRow(r, answer) {
    r.cells.name.textContent = answer.noul >= 0.5 ? "likely" : "unlikely";
    fill(r.cells.bar, answer.noul);
    r.cells.pct.textContent = answer.noul.toFixed(2);
  }
}
