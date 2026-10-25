/**
 * The errand menu panel.
 *
 * It sits over the game rather than taking the screen, and it does not take
 * the keyboard: while Squire drives, every key goes to Squire's key handler,
 * which is where the numbers are read. The rows can also be clicked.
 */

import type { ModPanel, ModUi } from "@rpgm-tools/neo-angband-core";
import type { MenuModel, MenuView } from "../errands/driver.js";
import { ERRAND_TEXT } from "../errands/text.js";
import { h, STYLE } from "./dom.js";

export const ERRAND_PANEL_ID = "errands";

/** One row of the menu as text, for the panel and for tests. */
export interface MenuRow {
  readonly position: number;
  readonly text: string;
  readonly enabled: boolean;
}

/** The menu's rows: the short list first when there is one, then every errand. */
export function menuRows(model: MenuModel): { readonly suggested: readonly MenuRow[]; readonly all: readonly MenuRow[] } {
  const row = (entry: MenuModel["entries"][number]): MenuRow => ({
    position: entry.position,
    text: entry.reason === null ? `${String(entry.position)}. ${entry.label}` : `${String(entry.position)}. ${entry.label} (${ERRAND_TEXT.notNow} ${entry.reason})`,
    enabled: entry.reason === null,
  });
  return { suggested: model.suggested.map(row), all: model.entries.map(row) };
}

const MENU_STYLE = `
.errands { pointer-events: auto; position: absolute; top: 3em; left: 50%; transform: translateX(-50%); min-width: 22em; max-width: calc(100vw - 32px); }
.errands h2 { margin: 0 0 0.4em; font-size: 1em; }
.errands h3 { margin: 0.6em 0 0.2em; font-size: 0.9em; }
.errands button { display: block; width: 100%; text-align: left; margin: 0.1em 0; }
.errands button:disabled { opacity: 0.6; }
.errands p { margin: 0.6em 0 0; font-size: 0.85em; }
`;

/** The panel, built through the host's panel API. Without one, the menu still works by its numbers. */
export function errandMenuView(ui: Pick<ModUi, "openPanel"> | undefined, log: (message: string) => void): MenuView {
  let panel: ModPanel | null = null;
  return {
    show(model, pick) {
      if (ui === undefined) return;
      try {
        if (panel?.open !== true) panel = ui.openPanel({ id: ERRAND_PANEL_ID, modal: false, label: ERRAND_TEXT.menuTitle });
        const rows = menuRows(model);
        const button = (row: MenuRow) => h("button", { type: "button", disabled: !row.enabled, onClick: () => pick(row.position) }, row.text);
        const box = h("div", { class: "squire errands body", role: "dialog", "aria-label": ERRAND_TEXT.menuTitle },
          h("h2", {}, ERRAND_TEXT.menuTitle),
          ...(rows.suggested.length === 0 ? [] : [h("h3", {}, ERRAND_TEXT.suggested), ...rows.suggested.map(button), h("h3", {}, ERRAND_TEXT.allErrands)]),
          ...rows.all.map(button),
          h("p", {}, ERRAND_TEXT.menuFooter(model.key)),
        );
        panel.root.replaceChildren(h("style", {}, STYLE + MENU_STYLE), box);
      } catch (error) {
        log(`Squire could not show the errand menu: ${String(error)}`);
      }
    },
    hide() {
      panel?.close();
      panel = null;
    },
  };
}
