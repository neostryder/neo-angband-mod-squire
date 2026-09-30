/**
 * The one way an instruction is queued.
 *
 * The panel's Orders box, the command key, a creed file and a chat channel all
 * call this, so an instruction from any of them is sorted, weighed and
 * remembered the same way. Viewers' orders, collected from the separate
 * squire-link project by `channel.ts`, arrive through
 * `queueInstruction(orders, text, "channel", { viewer })`. Nothing here reaches
 * the network.
 */

import type { GiveOptions, GiveResult, Orders } from "./book.js";
import { SOURCES, type InstructionSource } from "./types.js";

/**
 * Queue an instruction from a source. A source that is not one of the four
 * is refused, so an adapter cannot invent one.
 */
export function queueInstruction(orders: Orders, text: string, source: InstructionSource, options?: GiveOptions): GiveResult {
  if (!SOURCES.includes(source)) return { ok: false, problem: "Instructions can only come from the panel, the hotkey, a creed file or a channel." };
  if (typeof text !== "string") return { ok: false, problem: "Write the instruction first." };
  return orders.give(text, source, options);
}
