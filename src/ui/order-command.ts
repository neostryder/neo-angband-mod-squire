/**
 * The in-game key for giving an order. The game's own keymap runs it, so it
 * works during play whether or not the Squire panel is mounted; the panel's
 * Ctrl+Shift+O listener stays for when the panel has the keyboard.
 */

import type { Runtime } from "../runtime.js";
import type { CommandFacade, ModKeymaps, ModPanel, ModPluginContext, ModUi } from "@rpgm-tools/neo-angband-core";
import { h, STYLE } from "./dom.js";
import { mountOrders } from "./orders.js";

export const ORDER_COMMAND = "squire:order";
export const ORDER_VERB = "give an order";
/** Single keys tried in turn; the keymap only hands out a key nobody holds. */
export const ORDER_KEYS: readonly string[] = ["O", "N"];
export const ORDER_PANEL_LABEL = "Give Squire an order";

type PanelLike = ModPanel;

/** The registry host `register` receives, as far as this command reads it. */
export interface OrderCommandHost {
  readonly commands?: Pick<CommandFacade, "register" | "setVerb">;
}

export type OrderCommandCtx = Partial<Pick<ModPluginContext, "log">> & {
  readonly ui?: Pick<ModUi, "openPanel">;
  readonly keymaps?: Pick<ModKeymaps, "isBindableTriggerKey" | "bind">;
};

/** Register the command and bind a key to it. Returns the key bound, or null. */
export function registerOrderCommand(host: unknown, ctx: OrderCommandCtx, rt: Runtime): string | null {
  const commands = (host as OrderCommandHost | null | undefined)?.commands;
  const openPanel = ctx.ui?.openPanel;
  if (commands === undefined || openPanel === undefined) return null;
  let shown: PanelLike | null = null;

  function prompt(): void {
    if (shown?.open === true) return;
    const panel = openPanel!.call(ctx.ui, { id: "order", modal: true, label: ORDER_PANEL_LABEL });
    const body = h("div", { class: "body" });
    panel.root.append(h("style", {}, STYLE), h("div", { class: "squire" }, body));
    const cleanup = mountOrders(body, rt, "hotkey");
    shown = panel;
    void panel.closed.then(() => {
      cleanup();
      if (shown === panel) shown = null;
    });
  }

  /* Opening the prompt takes no game time. */
  commands.register(ORDER_COMMAND, () => {
    try {
      prompt();
    } catch (error) {
      ctx.log?.(`Squire couldn't open the order prompt: ${String(error)}`);
    }
    return 0;
  });
  commands.setVerb(ORDER_COMMAND, ORDER_VERB);
  const keymaps = ctx.keymaps;
  if (keymaps === undefined) {
    ctx.log?.("Squire's order key isn't bound, because this game doesn't let mods bind keys.");
    return null;
  }
  for (const key of ORDER_KEYS) {
    if (keymaps.isBindableTriggerKey(key) && keymaps.bind(key, ORDER_COMMAND)) {
      ctx.log?.(`Squire's order key is ${key}.`);
      return key;
    }
  }
  ctx.log?.("Squire's order key isn't bound, because every key it tried is taken.");
  return null;
}
