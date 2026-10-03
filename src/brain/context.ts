/**
 * Every fact Squire sends with a decision, filed under one of ten layers. The
 * state is built from the entries in order, and an empty layer adds nothing.
 * The goal planner puts the character's situation first and the rules last.
 */

import { estimateTokens } from "./systemone.js";

export const LAYERS = [
  /** How the game works: rules, the character's mechanics, birth options. */
  "manual",
  /** What every player is working towards, in order of need. */
  "purpose",
  /** What the character sees and remembers now. */
  "memory",
  /** Lessons from this run and from the family. */
  "knowledge",
  /** The player's standing and current orders. */
  "orders",
  /** The persona's traits, beliefs and voice. */
  "persona",
  "long_goal",
  "mid_goal",
  "near_goal",
  /** How goals ended and what they bought. */
  "outcomes",
] as const;

export type Layer = (typeof LAYERS)[number];

export interface ContextEntry {
  readonly layer: Layer;
  readonly key: string;
  readonly value: unknown;
}

export interface DecisionContext {
  readonly entries: readonly ContextEntry[];
}

/** The largest state any request may carry, in estimated tokens. */
export const STATE_TOKEN_CAP = 6_000;

/** The largest state a Laya request may carry, so the request fits the small model's window. */
export const LAYA_STATE_TOKENS = 1_024;

export type EntrySpec = readonly [Layer, string, unknown];

/** An entry whose value is undefined is skipped, so optional facts can be listed inline. */
export function contextOf(specs: readonly EntrySpec[]): DecisionContext {
  const entries: ContextEntry[] = [];
  const keys = new Set<string>();
  for (const [layer, key, value] of specs) {
    if (value === undefined) continue;
    if (keys.has(key)) throw new Error(`context key ${key} is filed twice`);
    keys.add(key);
    entries.push(Object.freeze({ layer, key, value }));
  }
  return Object.freeze({ entries: Object.freeze(entries) });
}

/** Every key of a fact block, filed under one layer, in the block's own order. */
export function entriesOf(layer: Layer, block: Readonly<Record<string, unknown>>): EntrySpec[] {
  return Object.entries(block).map(([key, value]) => [layer, key, value] as const);
}

/** The facts of one layer. */
export function layerOf(context: DecisionContext, layer: Layer): Record<string, unknown> {
  return Object.fromEntries(context.entries.filter((e) => e.layer === layer).map((e) => [e.key, e.value]));
}

/** The state sent to the model. */
export function stateOf(context: DecisionContext): Record<string, unknown> {
  return Object.fromEntries(context.entries.map((e) => [e.key, e.value]));
}

/** 64-bit FNV-1a of the state's JSON (over UTF-16 code units), as 16 hex digits. */
export function stateHash(state: Readonly<Record<string, unknown>>): string {
  const text = JSON.stringify(state);
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

/** The state's size in tokens, by the same estimate the tally uses. */
export function stateTokens(state: Readonly<Record<string, unknown>>): number {
  return estimateTokens(JSON.stringify(state));
}

/**
 * Layers dropped, in this order, when a state is over its budget. Persona and
 * orders always stay, since the in-character and orders questions read them,
 * and so does the situation.
 */
const SHED_ORDER: readonly Layer[] = ["knowledge", "outcomes", "long_goal", "mid_goal", "purpose", "manual"];

/** Drops whole layers in SHED_ORDER until the state fits, and says whether it still does not. */
export function fitToBudget(context: DecisionContext, budget: number = STATE_TOKEN_CAP): { readonly context: DecisionContext; readonly shed: readonly Layer[]; readonly over: boolean } {
  let entries = context.entries;
  const shed: Layer[] = [];
  for (const layer of SHED_ORDER) {
    if (stateTokens(stateOf({ entries })) <= budget) break;
    if (!entries.some((e) => e.layer === layer)) continue;
    entries = entries.filter((e) => e.layer !== layer);
    shed.push(layer);
  }
  return { context: entries === context.entries ? context : Object.freeze({ entries: Object.freeze([...entries]) }), shed, over: stateTokens(stateOf({ entries })) > budget };
}
