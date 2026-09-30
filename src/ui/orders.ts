/**
 * The Orders tab: give an order or a standing instruction, see each with its
 * state, retire one, and load or save a creed file. Ctrl+Shift+O anywhere in
 * the game opens this tab with the box ready to type in.
 */

import type { Runtime } from "../runtime.js";
import { loadCreed, exportCreed } from "../orders/creed.js";
import { queueInstruction } from "../orders/input.js";
import {
  AUTO_KIND_LABEL, FAMILY_LABEL, GIVE_LABEL, KIND_ORDER_LABEL, KIND_STANDING_LABEL, LOAD_CREED_LABEL, ORDERS_EMPTY, ORDERS_HEADING, ORDER_PLACEHOLDER, ORDER_PROMPT,
  RETIRE_LABEL, SAVE_CREED_LABEL, sortedLine, kindLabel,
} from "../orders/panel.js";
import { isLive, STATE_LABELS, type InstructionKind, type InstructionSource } from "../orders/types.js";
import { download, fill, h, pickFile } from "./dom.js";

/** The key the panel listens for to give an order mid-game. */
export const ORDER_HOTKEY = { ctrl: true, shift: true, key: "o" } as const;

export function isOrderHotkey(e: Pick<KeyboardEvent, "ctrlKey" | "shiftKey" | "key">): boolean {
  return e.ctrlKey === ORDER_HOTKEY.ctrl && e.shiftKey === ORDER_HOTKEY.shift && e.key.toLowerCase() === ORDER_HOTKEY.key;
}

export function mountOrders(body: HTMLElement, rt: Runtime, source: InstructionSource = "panel"): () => void {
  const orders = rt.orders();
  const list = h("div");
  const message = h("p", { class: "muted" });
  const text = h("textarea", { placeholder: ORDER_PLACEHOLDER, "aria-label": ORDER_PROMPT });
  const kind = h("select");
  for (const [value, label] of [["", AUTO_KIND_LABEL], ["order", KIND_ORDER_LABEL], ["standing", KIND_STANDING_LABEL]] as const) kind.append(h("option", { value }, label));
  const family = h("input", { type: "checkbox" });

  function draw(): void {
    const items = orders.list();
    fill(list, ...(items.length === 0 ? [h("p", { class: "muted" }, ORDERS_EMPTY)] : items.map((i) => {
      const live = isLive(i.state);
      return h(
        "div",
        { class: "entry" },
        h("p", {}, h("b", {}, STATE_LABELS[i.state]), ` - ${kindLabel(i.kind)}${i.familyCreed ? " (family creed)" : ""}: ${i.text}`),
        h("p", { class: "muted" }, sortedLine(i.sorted)),
        live ? h("button", { class: "act", onclick: () => { orders.retire(i.id); draw(); } }, RETIRE_LABEL) : null,
      );
    })));
  }

  function give(): void {
    const chosen = kind.value === "" ? undefined : (kind.value as InstructionKind);
    const result = queueInstruction(orders, text.value, source, { ...(chosen === undefined ? {} : { kind: chosen }), familyCreed: family.checked });
    if (!result.ok) {
      message.textContent = result.problem;
      message.className = "bad";
      return;
    }
    text.value = "";
    message.textContent = "";
    draw();
  }

  async function load(): Promise<void> {
    const file = await pickFile(".json,application/json");
    if (file === null) return;
    const result = loadCreed(orders, file);
    message.textContent = result.ok ? `Loaded ${String(result.taken)} instructions from the creed.` : result.problem;
    message.className = result.ok ? "ok" : "bad";
    draw();
  }

  fill(
    body,
    h("h3", {}, ORDERS_HEADING),
    list,
    h("label", {}, ORDER_PROMPT, text),
    h("div", { class: "row" }, kind, h("label", {}, family, ` ${FAMILY_LABEL}`)),
    h(
      "div",
      {},
      h("button", { class: "act", onclick: give }, GIVE_LABEL),
      h("button", { class: "act", onclick: () => void load() }, LOAD_CREED_LABEL),
      h("button", { class: "act", onclick: () => download("squire.creed.json", exportCreed(rt.character().persona?.name ?? "Squire", orders.list())) }, SAVE_CREED_LABEL),
    ),
    message,
  );
  draw();
  const timer = setInterval(draw, 4000);
  text.focus();
  return () => clearInterval(timer);
}
