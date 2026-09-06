/**
 * An errand, and the vocabulary for ending one.
 *
 * This is the shape the whole mod is built around. An ordinary autoplayer has
 * one decision function and runs it until somebody stops it; Squire has a
 * MISSION, which is a decision function that is also allowed to say "finished,
 * and here is why". Every errand is written to reach that answer, and the
 * reasons are a closed list rather than free text so that the reason can be
 * shown, tested, and reasoned about.
 *
 * A mission may also DECLINE at the moment it is handed the keyboard. Declining
 * is not a failure: it is the fighting errand saying there is nothing in sight
 * to fight, before it has spent a single game turn finding that out the
 * expensive way.
 */

import type { AgentCommand } from "@rpgm-tools/neo-angband-core";
import type { SquireContext } from "./context.js";

/**
 * Why an errand ended.
 *
 * Ordered roughly from "the errand did what it was asked" to "something took
 * the decision away from it", because that is the order a player reads them in.
 */
export type StopReason =
  /** The errand reached its own end condition. */
  | "done"
  /** There was nothing to do when the errand started. */
  | "nothing-to-do"
  /** The errand refused to start, because of something already in sight. */
  | "unsafe"
  /** The thing the errand was sent after is no longer there. */
  | "target-gone"
  /** A creature that was not in sight at handover came into view. */
  | "creature-appeared"
  /** Hit points fell past the retreat line. */
  | "hurt"
  /** A status effect landed: blind, confused, afraid, held, poisoned, stunned. */
  | "afflicted"
  /** The floor changed underfoot. */
  | "level-changed"
  /** The character stopped being able to move. */
  | "blocked"
  /** The errand ran out of the decisions a short errand is allowed. */
  | "budget"
  /** The character died. */
  | "dead";

/** An errand ending, with a line a player can read. */
export interface Stop {
  readonly reason: StopReason;
  /** One sentence, in plain words, for the message line and the log. */
  readonly detail: string;
}

/** What one decision produced: a command to issue, or the end of the errand. */
export type Decision = { readonly command: AgentCommand } | { readonly stop: Stop };

/** Whether a decision ended the errand. */
export function isStop(decision: Decision): decision is { readonly stop: Stop } {
  return "stop" in decision;
}

/** Build a stop. */
export function stop(reason: StopReason, detail: string): { readonly stop: Stop } {
  return { stop: { reason, detail } };
}

/** Build a command decision. */
export function issue(command: AgentCommand): { readonly command: AgentCommand } {
  return { command };
}

/** One errand. */
export interface Mission {
  /** Stable id, for the log and the tests. */
  readonly id: string;
  /** What the errand is, in the words shown to the player when it starts. */
  readonly label: string;
  /**
   * Look at the world once, at handover, and either accept the errand or
   * decline it. Returning a stop means nothing was spent: no game turn passed
   * and the keyboard goes straight back.
   */
  begin(ctx: SquireContext): Stop | null;
  /** Decide one command, or end. Called once per decision the game asks for. */
  step(ctx: SquireContext): Decision;
}
