/**
 * The Lessons tab: the squire's notebook from Knight's Lessons, its rank, and
 * the "Why, sir?" and "Watch this" controls.
 */

import type { Lessons } from "../attach.js";
import { rankOf, WHY_REASONS, type Apprentice, type NotebookEntry } from "../knight.js";
import { fill, h } from "./dom.js";

export function mountLessons(body: HTMLElement, lessons: Lessons): () => void {
  const head = h("div");
  const list = h("div");

  function draw(a: Apprentice): void {
    const share = a.total === 0 ? 0 : Math.round((a.agreed / a.total) * 100);
    fill(
      head,
      h("p", {}, h("span", { class: "stat" }, "Rank ", h("b", {}, rankOf(a))), h("span", { class: "stat" }, "Agreement ", h("b", {}, `${String(share)}%`)), h("span", { class: "stat" }, "Lessons ", h("b", {}, String(a.total)))),
    );
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
