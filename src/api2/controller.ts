/**
 * One decision, at one input wait.
 *
 * The game calls a mod's controller each time it needs a command, with the
 * wait's token, and the mod answers by submitting intents under it. Squire's
 * decision code is synchronous and wants the game as a view, so a tick reads the
 * world, asks the decision code for one command, and submits the targets it
 * chose and then the command. A tick that has nothing to do, or whose command
 * the game refuses, submits nothing more and the game asks again; a run of
 * refusals ends the errand so the keyboard goes back instead of looping.
 */

import type { AgentCommand, AgentController } from "@rpgm-tools/neo-angband-core";
import type { Api2InputState, Api2Prompt, Api2PromptAnswer, ModApi2 } from "@rpgm-tools/neo-angband-mod-sdk";
import type { Bridge } from "./host.js";
import { createActFacade, intentOf } from "./act.js";

/** Consecutive refusals after which the errand ends and the keyboard goes back. */
export const REFUSALS_BEFORE_RELEASE = 25;

/** The only command codes the game accepts while a store is open. */
const STORE_CODES: ReadonlySet<string> = new Set(["shop-buy", "shop-sell", "shop-exit"]);

export interface Tick {
  (mod: ModApi2, input: Api2InputState): Promise<void>;
}

/** What to say to a prompt the game raised at Squire's turn. Squire asks nothing of the player. */
export function promptAnswer(prompt: Api2Prompt): Api2PromptAnswer {
  switch (prompt.kind) {
    case "ack": return { action: "acknowledge" };
    case "confirm": return true;
    case "quantity": return prompt.defaultValue;
    case "text": return prompt.defaultValue;
    default: return { action: "cancel" };
  }
}

export function createTick(bridge: Bridge, decide: AgentController): Tick {
  let refusals = 0;
  let announced = false;
  return async (mod, input) => {
    bridge.setInput(input);
    if (input.prompt !== null) {
      await mod.act.answer(input.prompt.promptId, promptAnswer(input.prompt));
      return;
    }
    if (input.phase !== "play" && input.phase !== "store") return;
    const view = await bridge.readWorld();
    if (view === null) return;
    const facade = createActFacade();
    const command = decide(view, facade.act);
    const targets = facade.take();
    if (command === null) return;
    if (!announced) {
      announced = true;
      mod.meta.log("Squire is playing.");
    }
    let token = input.token;
    for (const target of targets) {
      const result = await mod.act.submit(token, target);
      if (!result.ok) mod.meta.log(`Squire's target was refused: ${result.message}`);
    }
    if (targets.length > 0) {
      const fresh = await mod.view.input();
      if (fresh.ok) token = fresh.value.token;
    }
    /* A store is open and the decision is a walk or a rest, which the game refuses until the store is left. */
    const code = (command as { code: string }).code;
    const sent = await mod.act.submit(token, input.phase === "store" && !STORE_CODES.has(code) ? intentOf({ code: "shop-exit" } as AgentCommand) : intentOf(command));
    if (sent.ok) {
      refusals = 0;
      return;
    }
    refusals += 1;
    if (refusals === 1 || refusals % 10 === 0) mod.meta.log(`Squire's ${(command as { code: string }).code} was refused: ${sent.message}`);
    if (refusals >= REFUSALS_BEFORE_RELEASE) {
      refusals = 0;
      await mod.act.controller.release("The game kept refusing Squire's commands.");
    }
  };
}
