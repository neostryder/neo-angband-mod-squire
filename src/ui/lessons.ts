/**
 * The Lessons tab: the squire's notebook from Knight's Lessons, its rank, and
 * the "Why, sir?" and "Watch this" controls.
 */

import type { Lessons } from "../attach.js";
import { rankOf, WHY_REASONS, type Apprentice, type NotebookEntry } from "../knight.js";
import { fill, h } from "./dom.js";
import { drawRadar, LESSON_SLIDERS } from "../lessons/radar.js";
import { PARAMETERS } from "../persona/catalog.js";

export function mountLessons(body: HTMLElement, lessons: Lessons): () => void {
  const head = h("div");
  const list = h("div");
  const style = h("div");
  const ghost = h("p", { class: "muted" });
  const examButton = h("button", { class: "act", onclick: () => lessons.takeExam() }, "Take an exam");
  const examNote = h("span", { class: "muted" });
  const ghostCheck = h("input", { type: "checkbox", checked: lessons.ghostEnabled() });
  ghostCheck.addEventListener("change", () => lessons.setGhost(ghostCheck.checked));

  function draw(a: Apprentice): void {
    const share = a.total === 0 ? 0 : Math.round((a.agreed / a.total) * 100);
    fill(
      head,
      h("p", {}, h("span", { class: "stat" }, "Rank ", h("b", {}, rankOf(a))), h("span", { class: "stat" }, "Agreement ", h("b", {}, `${String(share)}%`)), h("span", { class: "stat" }, "Lessons ", h("b", {}, String(a.total)))),
    );
    ghost.textContent = lessons.ghostEnabled() ? a.ghostHint ?? "" : "";
    const inferred = lessons.inferred();
    const own = lessons.squirePersona();
    const canvas = h("canvas", { width: "600", height: "260" });
    const ctx = canvas.getContext("2d");
    if (ctx !== null) {
      if (own !== null) drawRadar(ctx, own, 150, 130, 70, "#d9ac64");
      drawRadar(ctx, inferred.persona, 450, 130, 70, "#8fd18f", inferred.confidence);
    }
    const rows = LESSON_SLIDERS.map((key) => {
      const parameter = PARAMETERS.find((item) => item.id === key);
      const confidence = inferred.confidence[key];
      return h("div", { class: "slider", style: confidence < 0.5 ? "opacity: 0.5" : "" },
        h("span", {}, parameter?.name ?? key),
        h("input", { type: "range", min: "0", max: "100", value: String(inferred.persona.sliders[key]), disabled: true }),
        h("span", {}, String(inferred.persona.sliders[key])));
    });
    fill(style, h("h3", {}, "Play like me"), h("div", { class: "row" }, h("span", {}, own?.name ?? "Squire"), h("span", {}, "Your style")),
      canvas, ...rows,
      h("button", { class: "act", onclick: () => lessons.savePersona(false) }, "Save as a persona"),
      h("button", { class: "act", onclick: () => lessons.savePersona(true) }, "Use it"));
    examButton.hidden = a.entries.filter((entry) => entry.signature !== undefined).length < 40;
    examButton.disabled = a.examArmed;
    examNote.hidden = examButton.hidden;
    examNote.textContent = a.examArmed
      ? " Exam ready. Press Ctrl-Z, and Squire's first 20 choices are scored against yours."
      : " After your next Ctrl-Z, Squire's first 20 choices are scored against yours.";
    const recent = a.entries.slice(-40).reverse();
    fill(
      list,
      recent.length === 0
        ? h("p", { class: "muted" }, "Nothing noted yet. Play on, and the squire notes what you do each time something happens: a creature appears, you get hurt, or you reach a new level.")
        : null,
      ...recent.map((entry) => entryRow(entry, lessons)),
    );
  }

  body.append(
    h("p", { class: "muted" }, "While you play, Squire watches as your apprentice. It forms its own choice at each moment that matters and notes where yours differed. It never acts, so your character stays yours."),
    head,
    ghost,
    h("label", {}, ghostCheck, " Show Squire's choice when it differs"),
    style,
    examButton,
    examNote,
    h("button", { class: "act", onclick: () => lessons.watchThis() }, "Watch this"),
    h("span", { class: "muted" }, " Your next five choices count double."),
    list,
  );
  draw(lessons.apprentice());
  return lessons.onChange(draw);
}

function entryRow(entry: NotebookEntry, lessons: Lessons): HTMLElement {
  const reasons =
    entry.agreed || entry.reason !== undefined
      ? null
      : h(
          "div",
          {},
          h("span", { class: "muted" }, "Why, sir? "),
          ...WHY_REASONS.map((reason) => h("button", { class: "act", onclick: () => lessons.why(entry, reason) }, reason)),
        );
  return h(
    "div",
    { class: entry.agreed ? "entry" : "entry disagree" },
    entry.line,
    entry.demonstration ? h("span", { class: "muted" }, " (demonstration)") : null,
    entry.reason === undefined ? null : h("span", { class: "muted" }, ` Because: ${entry.reason}.`),
    reasons,
  );
}
