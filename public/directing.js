// The listener directs Jev in words while it listens: a row of quick chips ("darker",
// "slower, calmer", ...) plus the free-text note, combined into one sentence Jev is handed
// alongside the sound. composeDirection is kept pure and DOM-free so it can be unit tested
// in plain Node; Directing is the thin DOM layer app.js drives.

export const CHIPS = [
  { id: "darker", label: "darker", phrase: "darker" },
  { id: "slower", label: "slower", phrase: "slower, calmer" },
  { id: "emptier", label: "emptier", phrase: "emptier, more space" },
  { id: "warmer", label: "warmer", phrase: "warmer colours" },
  { id: "break", label: "break it", phrase: "break it, make it harsh" },
];

const MAX_LENGTH = 200;

function normalize(text) {
  return typeof text === "string" ? text.trim().replace(/\s+/g, " ") : "";
}

/** Pure: the single sentence Jev is handed. Active chip phrases join in CHIPS order,
 * then the note is appended last behind an em dash. Trimmed, whitespace-collapsed,
 * capped at MAX_LENGTH (the server caps there too). "" when nothing is set. */
export function composeDirection(activeIds, note) {
  const ids = new Set(Array.isArray(activeIds) ? activeIds : []);
  const chipPhrase = CHIPS.filter((chip) => ids.has(chip.id))
    .map((chip) => chip.phrase)
    .join(", ");
  const noteText = normalize(note);

  const combined = chipPhrase && noteText ? `${chipPhrase} — ${noteText}` : chipPhrase || noteText;

  return normalize(combined).slice(0, MAX_LENGTH);
}

export class Directing {
  #chipsEl;
  #noteEl;
  #onChange;
  #active = new Set();
  #buttons = new Map();

  constructor({ chipsEl, noteEl, onChange } = {}) {
    this.#chipsEl = chipsEl ?? null;
    this.#noteEl = noteEl ?? null;
    this.#onChange = typeof onChange === "function" ? onChange : () => {};
    this.#buildChips();
    this.#noteEl?.addEventListener("input", () => this.#onChange());
  }

  get direction() {
    return composeDirection(this.active, this.note);
  }

  get note() {
    return this.#noteEl ? this.#noteEl.value : "";
  }

  get active() {
    return CHIPS.map((chip) => chip.id).filter((id) => this.#active.has(id));
  }

  toggle(id) {
    if (!this.#buttons.has(id)) return;
    if (this.#active.has(id)) this.#active.delete(id);
    else this.#active.add(id);
    this.#syncButton(id);
    this.#onChange();
  }

  clear() {
    this.#active.clear();
    for (const chip of CHIPS) this.#syncButton(chip.id);
    this.#onChange();
  }

  #buildChips() {
    if (!this.#chipsEl) return;
    this.#chipsEl.innerHTML = "";
    this.#buttons.clear();
    for (const chip of CHIPS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.textContent = chip.label;
      btn.setAttribute("aria-pressed", "false");
      btn.addEventListener("click", () => this.toggle(chip.id));
      this.#chipsEl.appendChild(btn);
      this.#buttons.set(chip.id, btn);
    }
  }

  #syncButton(id) {
    const btn = this.#buttons.get(id);
    if (!btn) return;
    const isActive = this.#active.has(id);
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
  }
}
