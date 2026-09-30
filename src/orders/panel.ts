/** The Squire panel's Orders box as plain lines, so the DOM code stays thin. */

import type { Instruction, Sorted } from "./types.js";
import { STATE_LABELS } from "./types.js";

export const ORDERS_HEADING = "Orders";
export const ORDERS_EMPTY = "No orders. Give one below, or press Squire's order key (O unless that key is taken) while you play.";
export const ORDER_PROMPT = "What does your patron order?";
export const ORDER_PLACEHOLDER = "For example: suit up at the armour shop";
export const KEPT_LABEL = "Instructions kept";
export const KEPT_HELP = "How many orders and standing instructions the squire holds before it drops the one it follows least readily.";
export const FAMILY_LABEL = "Family creed (heirs inherit it)";
export const KIND_ORDER_LABEL = "Order";
export const KIND_STANDING_LABEL = "Standing instruction";
export const GIVE_LABEL = "Give";
export const RETIRE_LABEL = "Retire";
export const LOAD_CREED_LABEL = "Load creed";
export const SAVE_CREED_LABEL = "Save creed";
export const AUTO_KIND_LABEL = "Let the squire tell";

/** What the panel shows in place of a kind. */
export function kindLabel(kind: Instruction["kind"]): string {
  return kind === "order" ? "Order" : "Standing";
}

/** The sorted form on one line, for the player to check and correct. */
export function sortedLine(sorted: Sorted): string {
  const parts: string[] = [];
  if (sorted.aim !== null) {
    const detail = sorted.aim === "depth" && sorted.depth !== null ? ` ${String(sorted.depth * 50)} ft`
      : sorted.aim === "item" && sorted.item !== null ? ` ${String(sorted.count)} ${sorted.item}`
      : sorted.aim === "gold" && sorted.gold !== null ? ` ${String(sorted.gold)} gold` : "";
    parts.push(`aim: ${sorted.aim}${detail}`);
  }
  if (sorted.trigger !== "always") parts.push(`when: ${sorted.trigger}`);
  if (sorted.response !== null) parts.push(`then: ${sorted.response}${sorted.avoids.length > 0 ? ` ${sorted.avoids.join(", ")}` : ""}`);
  if (sorted.store !== null) parts.push(`at: ${sorted.store}`);
  if (sorted.frequency.mode === "once") parts.push("how often: the first time");
  else if (sorted.frequency.mode === "until-level") parts.push(`how often: until level ${String(sorted.frequency.level)}`);
  return parts.length === 0 ? "kept as written" : parts.join("; ");
}

/** One line per instruction: its state, its words, and what it was sorted into. */
export function orderLines(items: readonly Instruction[]): string[] {
  if (items.length === 0) return [ORDERS_EMPTY];
  return items.map((i) => `${STATE_LABELS[i.state]} - ${kindLabel(i.kind)}${i.familyCreed ? " (family creed)" : ""}: ${i.text} [${sortedLine(i.sorted)}]`);
}
