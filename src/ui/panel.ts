/**
 * The Squire panel: setup, the persona sheet, Knight's Lessons and a live
 * dashboard, docked beside the map. The host owns the slot, its tab and its
 * saved place; this file only draws inside the shadow root it is given.
 */

import type { Lessons, PanelHostLike } from "../attach.js";
import type { Runtime } from "../runtime.js";
import { mountSetup } from "./setup.js";
import { mountPersona } from "./persona-sheet.js";
import { mountLessons } from "./lessons.js";
import { mountDashboard } from "./dashboard.js";
import { mountReport } from "./report-view.js";
import { h, STYLE } from "./dom.js";

type Tab = "setup" | "persona" | "lessons" | "dashboard" | "report";

const TABS: readonly [Tab, string][] = [
  ["setup", "Setup"],
  ["persona", "Persona"],
  ["lessons", "Lessons"],
  ["dashboard", "Dashboard"],
  ["report", "Report"],
];

/** The text scale, kept per browser: it suits one screen, not every one. */
const SCALE_KEY = "squire/panelScale";
const SCALES: readonly number[] = [0.8, 0.9, 1, 1.15, 1.3, 1.5];

function readScale(): number {
  try {
    const stored = Number(localStorage.getItem(SCALE_KEY));
    return SCALES.includes(stored) ? stored : 1;
  } catch {
    return 1;
  }
}

function writeScale(scale: number): void {
  try {
    localStorage.setItem(SCALE_KEY, String(scale));
  } catch {
    /* Without storage the scale lasts until the page reloads. */
  }
}

export function mountPanel(host: PanelHostLike, rt: Runtime, lessons: Lessons): () => void {
  const root = host.root;
  const body = h("div", { class: "body" });
  const bar = h("div", { class: "tabs", role: "tablist" });
  const panel = h("div", { class: "squire" }, bar, body);
  root.append(h("style", {}, STYLE), panel);

  let scale = readScale();
  function applyScale(next: number): void {
    scale = next;
    panel.style.setProperty("--squire-scale", String(scale));
    writeScale(scale);
  }
  applyScale(scale);
  const step = (by: number): void => {
    const at = SCALES.indexOf(scale);
    applyScale(SCALES[Math.max(0, Math.min(SCALES.length - 1, at + by))] ?? 1);
  };

  let cleanup: (() => void) | null = null;
  /* First run opens on setup; after that, on the dashboard. */
  let current: Tab = rt.config().setupDone ? "dashboard" : "setup";

  function show(tab: Tab): void {
    current = tab;
    cleanup?.();
    body.replaceChildren();
    for (const button of bar.querySelectorAll("button")) {
      button.setAttribute("aria-selected", button.dataset["tab"] === tab ? "true" : "false");
    }
    switch (tab) {
      case "setup":
        cleanup = mountSetup(body, rt, () => show("persona"));
        break;
      case "persona":
        cleanup = mountPersona(body, rt);
        break;
      case "lessons":
        cleanup = mountLessons(body, lessons);
        break;
      case "dashboard":
        cleanup = mountDashboard(body, rt);
        break;
      case "report":
        cleanup = mountReport(body, rt);
        break;
    }
  }

  for (const [tab, label] of TABS) {
    const button = h("button", { role: "tab", onclick: () => show(tab) }, label);
    button.dataset["tab"] = tab;
    bar.append(button);
  }
  bar.append(
    h("button", { class: "size", title: "Smaller text", "aria-label": "Smaller text", onclick: () => step(-1) }, "A-"),
    h("button", { title: "Larger text", "aria-label": "Larger text", onclick: () => step(1) }, "A+"),
  );
  show(current);
  return () => cleanup?.();
}
