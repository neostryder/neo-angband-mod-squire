/**
 * The vocabulary of orders and standing instructions.
 *
 * An order ends: its test passes, the squire gives up on it, or it is
 * forgotten. A standing instruction lasts until the player retires it, and has
 * a trigger, a response and how often it applies. The player's words are kept
 * exactly as written; the sorted form beside them is only what code can act on.
 */

import type { AimKind } from "../strategy/aims.js";

export type InstructionKind = "order" | "standing";

/** Where an instruction came from. The panel, the hotkey, a creed file and a chat channel all queue the same way. */
export type InstructionSource = "panel" | "hotkey" | "creed" | "channel";

export const SOURCES: readonly InstructionSource[] = ["panel", "hotkey", "creed", "channel"];

/** What the panel shows beside each instruction. */
export type InstructionState = "following" | "grudgingly" | "ignoring" | "forgotten" | "done" | "abandoned";

/** States in which an instruction still reaches the decision state. */
export const LIVE_STATES: readonly InstructionState[] = ["following", "grudgingly", "ignoring"];

export type Stance = "following" | "grudgingly" | "ignoring";

export type OrderAim = AimKind | "item" | "gold";

export type TriggerKind = "always" | "unique" | "low-hp" | "new-level" | "in-store";

export type ResponseKind = "flee" | "fight" | "leave-level" | "descend" | "buy" | "rest" | "avoid";

export type Frequency =
  | { readonly mode: "always" }
  | { readonly mode: "once" }
  | { readonly mode: "until-level"; readonly level: number };

/** An instruction sorted into Squire's own vocabulary. Every part may be absent. */
export interface Sorted {
  readonly aim: OrderAim | null;
  readonly trigger: TriggerKind;
  readonly response: ResponseKind | null;
  /** The goals an avoid response names. */
  readonly avoids: readonly string[];
  readonly store: string | null;
  /** Dungeon level to reach, for a depth aim. */
  readonly depth: number | null;
  /** Character level after which an order that is not done is given up. */
  readonly deadlineLevel: number | null;
  /** Pack item to hold, and how many, for an item aim. */
  readonly item: string | null;
  readonly count: number;
  /** Gold to have saved, for a gold aim. */
  readonly gold: number | null;
  readonly frequency: Frequency;
}

export interface Instruction {
  readonly id: string;
  /** The player's words, as written. */
  readonly text: string;
  readonly kind: InstructionKind;
  readonly source: InstructionSource;
  /** The chat viewer who gave it, for an instruction from a channel. */
  readonly viewer?: string;
  readonly sorted: Sorted;
  readonly state: InstructionState;
  /** 0 to 1: how firmly the instruction is remembered. */
  readonly memory: number;
  /** 0 to 1: how hard it pulls on the options that serve or break it. */
  readonly adherence: number;
  /** A standing instruction that heirs inherit. Never set on an order. */
  readonly familyCreed: boolean;
  readonly createdTurn: number;
  /** The turn memory was last faded to. */
  readonly seenTurn: number;
  /** Times the squire acted on it. */
  readonly acted: number;
  /** Consecutive reviews at ignoring stance. */
  readonly lowReviews: number;
  /** Whether it was carried out against the squire's temper. */
  readonly disliked: boolean;
}

/** Longest instruction kept, in characters. Longer text is cut, not refused. */
export const MAX_TEXT = 2000;

/** Longest viewer name kept, in characters. */
export const MAX_VIEWER = 40;

/** The words a state is shown with. */
export const STATE_LABELS: Readonly<Record<InstructionState, string>> = {
  following: "following",
  grudgingly: "grudgingly",
  ignoring: "ignoring",
  forgotten: "forgotten",
  done: "done",
  abandoned: "abandoned",
};

export function isLive(state: InstructionState): boolean {
  return LIVE_STATES.includes(state);
}
