/**
 * The tactical pack asked in a fight: an escape gate (should the character get
 * out now?) beside the option choice, the persona's thresholds for the gate,
 * the low-confidence fallback, pruning of dominated options, and the short
 * purpose clause each option carries.
 *
 * Everything here works on offers already built from what the character can
 * see, so nothing reads hidden game state.
 */

import type { Persona } from "../persona/persona.js";
import type { Goal, Offer } from "./goals.js";
import type { LoopFinding } from "./loops.js";
import type { LoggedDecision } from "../memory/log.js";
import type { NoulQuestion } from "./systemone.js";

/** What kind of move an option is. Pruning, the gate and the fallback all work by class. */
export type ActionClass = "escape" | "heal" | "gamble" | "attack" | "wait" | "position" | "errand";

const CLASSES: Readonly<Record<string, ActionClass>> = {
  phase: "escape", teleport: "escape", retreat: "escape", leave_level: "escape", recall_town: "escape", deep_descent: "escape",
  heal: "heal", cast_heal: "heal", device: "heal", rest: "heal",
  quaff_unknown: "gamble", read_unknown: "gamble",
  fight: "attack", shoot: "attack", throw_oil: "attack", aim_wand: "attack", cast_attack: "attack",
  swing_unseen: "attack", cast_area: "attack", unseen_staff: "attack", unseen_wand: "attack", unseen_rod: "attack",
  wait: "wait", endure: "wait",
  take_position: "position", step_aside: "position", close_door: "position",
};

export function classOf(goal: string): ActionClass {
  return CLASSES[goal] ?? "errand";
}

/** The gate's two edges: under `low` nothing changes, from `high` up only escapes are left. */
export interface EscapeBands {
  readonly low: number;
  readonly high: number;
}

export const ESCAPE_LOW = 0.55;
export const ESCAPE_HIGH = 0.78;
/** The narrowest the middle band may get, so a strong persona still has one. */
const MIN_BAND = 0.1;

/**
 * The gate's edges for a persona. A bold one needs a stronger yes before it
 * steps back and a self-preserving one a weaker one. The question is asked the
 * same for every persona: boldness changes what the answer does, never whether
 * it is asked.
 */
export function escapeThresholds(persona: Persona | null): EscapeBands {
  if (persona === null) return { low: ESCAPE_LOW, high: ESCAPE_HIGH };
  const lean = (persona.sliders.selfpreservation - persona.sliders.boldness) / 100;
  const low = Math.min(0.75, Math.max(0.35, ESCAPE_LOW - lean * 0.15));
  const high = Math.min(0.92, Math.max(low + MIN_BAND, 0.6, ESCAPE_HIGH - lean * 0.12));
  return { low: round2(low), high: round2(high) };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type EscapeBand = "stay" | "consider" | "get_out";

export function bandOf(p: number, bands: EscapeBands): EscapeBand {
  return p >= bands.high ? "get_out" : p >= bands.low ? "consider" : "stay";
}

const SAFE_CLASSES: ReadonlySet<ActionClass> = new Set(["escape", "heal", "gamble", "position"]);

/**
 * The goals left to pick from in a band, or null when the band leaves the
 * choice alone. The middle band shrinks the choice toward safe moves without
 * naming one; the top band leaves only escapes. A band with nothing it allows
 * on offer falls back to the band below it.
 */
export function allowedGoals(band: EscapeBand, offers: readonly Offer[]): ReadonlySet<string> | null {
  if (band === "stay") return null;
  const escapes = offers.filter((o) => classOf(o.goal) === "escape").map((o) => o.goal as string);
  const safe = offers.filter((o) => SAFE_CLASSES.has(classOf(o.goal))).map((o) => o.goal as string);
  const chosen = band === "get_out" && escapes.length > 0 ? escapes : safe;
  return chosen.length === 0 ? null : new Set([...chosen, "none_of_these"]);
}

/** The question for the gate. */
export const ESCAPE_QUESTION: NoulQuestion = {
  type: "noul",
  instructions: "Should the character stop what it is doing and get to safety now?",
  criteria: {
    true: "Staying risks death or a loss it cannot recover from soon; escaping or healing comes before anything else.",
    false: "The character can keep fighting or carry on; nothing here needs it to break off now.",
  },
};

/** Under this confidence the option answer is not trusted on its own. */
export const CONFIDENCE_FLOOR = 0.3;

/** The safest offer of a class: one that leaves hit points under the bound first, then the lowest risk. */
function safestOf(offers: readonly Offer[], classes: ReadonlySet<ActionClass>): Offer | undefined {
  return offers.filter((o) => classes.has(classOf(o.goal)) && o.gaps === undefined).sort((a, b) =>
    Number((b.survival ?? 0) > 0) - Number((a.survival ?? 0) > 0) || a.risk - b.risk || (a.cost ?? 0) - (b.cost ?? 0))[0];
}

/**
 * What to do when the option answer is too unsure to follow: the safest escape
 * when the gate answer reaches the persona's low edge, otherwise the safest
 * attack or wait. Null leaves the choice to the usual path.
 */
export function lowConfidencePick(offers: readonly Offer[], escapeP: number | null, lowEdge: number): Goal | null {
  if (escapeP !== null && escapeP >= lowEdge) {
    const out = safestOf(offers, new Set(["escape"])) ?? safestOf(offers, new Set(["heal"]));
    if (out !== undefined) return out.goal;
  }
  return safestOf(offers, new Set(["attack", "wait"]))?.goal ?? null;
}

/** An option dropped before asking, and the option that does at least as well on every count. */
export interface Pruned {
  readonly goal: Goal;
  readonly by: Goal;
}

const PRUNABLE: ReadonlySet<ActionClass> = new Set(["attack", "escape", "heal"]);

/**
 * Whether `a` is at least as good as `b` on risk, cost, progress and hit
 * points left, and better on one. A sure escape or heal can stand in for an
 * uncertain one but not the other way round; an attack's progress already
 * allows for missing, so its uncertainty is not counted twice. A walk to the
 * target is never compared with an attack from where the character stands.
 */
function dominates(a: Offer, b: Offer, targetAdjacent: boolean): boolean {
  if (classOf(a.goal) !== classOf(b.goal)) return false;
  if (a.progress === undefined || b.progress === undefined || a.cost === undefined || b.cost === undefined) return false;
  if (classOf(a.goal) === "attack" && !targetAdjacent && (a.goal === "fight") !== (b.goal === "fight")) return false;
  const attack = classOf(a.goal) === "attack";
  if (!attack && a.uncertain === true && b.uncertain !== true) return false;
  if (a.gaps !== undefined) return false;
  const aSurv = a.survival ?? null;
  const bSurv = b.survival ?? null;
  if ((aSurv === null) !== (bSurv === null)) return false;
  const noWorse = a.risk <= b.risk && a.cost <= b.cost && a.progress >= b.progress && (aSurv === null || bSurv === null || aSurv >= bSurv);
  const better = a.risk < b.risk || a.cost < b.cost || a.progress > b.progress || aSurv !== null && bSurv !== null && aSurv > bSurv || !attack && a.uncertain !== true && b.uncertain === true;
  return noWorse && better;
}

/**
 * Drops the attacks, escapes and heals another offer of the same class beats
 * on every count. Gambles, errands, waits and positions are never dropped, and
 * neither is anything in `keep`.
 */
export function pruneDominated(offers: readonly Offer[], targetAdjacent: boolean, keep: ReadonlySet<string> = new Set()): { readonly kept: Offer[]; readonly pruned: Pruned[] } {
  const beaten = (offer: Offer) => PRUNABLE.has(classOf(offer.goal)) && !keep.has(offer.goal) && offer.aim === undefined
    ? offers.filter((other) => other !== offer && dominates(other, offer, targetAdjacent)) : [];
  const out = new Set(offers.filter((offer) => beaten(offer).length > 0));
  const pruned: Pruned[] = [];
  for (const offer of out) {
    /* Name an option that is still offered when there is one, so the log points at what the model sees. */
    const by = beaten(offer);
    pruned.push({ goal: offer.goal, by: (by.find((other) => !out.has(other)) ?? by[0]!).goal });
  }
  return { kept: offers.filter((offer) => !out.has(offer)), pruned };
}

/** Near-goal kinds and the options that move them along. */
const NEAR_SERVED: Readonly<Record<string, readonly string[]>> = {
  explore: ["explore", "detect", "fetch", "pick_up", "tunnel", "disarm"],
  rest: ["rest", "heal", "cast_heal", "device", "retreat"],
  down: ["descend", "deep_descent"],
  leave: ["leave_level", "retreat", "teleport", "deep_descent", "descend"],
  recall: ["recall_town", "recall_dungeon"],
  shop: ["shop", "recall_town"],
  try: ["quaff_unknown", "read_unknown", "wear"],
  position: ["take_position", "step_aside", "close_door"],
};

const SERVES_BY_CLASS: Readonly<Record<ActionClass, string>> = {
  escape: "survival", heal: "survival", gamble: "a cure or a way out", attack: "the fight", wait: "time", position: "a better position", errand: "upkeep",
};

const SERVES_ERRAND: Readonly<Record<string, string>> = {
  explore: "exploring", descend: "going deeper", shop: "supplies", recall_dungeon: "going deeper", fetch: "loot", pick_up: "loot", drop_junk: "loot",
};

function servesOf(offer: Offer, nearKind: string | null): string {
  if (nearKind !== null && (NEAR_SERVED[nearKind] ?? []).includes(offer.goal)) return "the near goal";
  return SERVES_ERRAND[offer.goal] ?? SERVES_BY_CLASS[classOf(offer.goal)];
}

function progressWord(progress: number): string {
  return progress >= 0.95 ? "finishes it" : progress >= 0.6 ? "most of the way" : progress >= 0.3 ? "part of the way" : progress > 0 ? "a little" : "none";
}

export function riskWord(risk: number): string {
  return risk < 0.1 ? "low risk" : risk < 0.3 ? "some risk" : risk < 0.6 ? "high risk" : "very high risk";
}

/**
 * One short clause per option on what it serves, how far it gets, what it
 * costs and how risky it is. A field the options all share says nothing to
 * choose by, so it is left out; with nothing left the option gets no clause.
 */
export function purposeClauses(offers: readonly Offer[], nearKind: string | null): Map<Goal, string> {
  const fields = offers.map((offer) => ({
    goal: offer.goal,
    serves: `serves ${servesOf(offer, nearKind)}`,
    progress: offer.progress === undefined ? undefined : `progress: ${progressWord(offer.progress)}`,
    cost: offer.costNote === undefined ? undefined : `costs ${offer.costNote}`,
    risk: riskWord(offer.risk),
  }));
  const differs = (pick: (f: (typeof fields)[number]) => string | undefined): boolean => new Set(fields.map(pick)).size > 1;
  const use = { serves: differs((f) => f.serves), progress: differs((f) => f.progress), cost: differs((f) => f.cost), risk: differs((f) => f.risk) };
  const out = new Map<Goal, string>();
  for (const f of fields) {
    const parts = [use.serves ? f.serves : undefined, use.progress ? f.progress : undefined, use.cost ? f.cost : undefined, use.risk ? f.risk : undefined].filter((p): p is string => p !== undefined);
    if (parts.length > 0) out.set(f.goal, `Purpose: ${parts.join("; ")}.`);
  }
  return out;
}

/** The escape gate as asked and answered. */
export interface GateRecord extends EscapeBands {
  p?: number | null;
  band?: EscapeBand;
  /** Goals the band left, when it narrowed the choice. */
  allowed?: readonly string[];
}

/** What the pack decided, kept for the decision log. */
export interface PackRecord {
  readonly pruned: readonly Pruned[];
  /** Set when the escape gate was asked beside the option choice. */
  readonly gate?: GateRecord;
  /** The class fallback taken because the option answer was unsure. */
  lowConfidence?: Goal;
}

/** The pack and any loop in the shape the local decision log keeps, or nothing when neither happened. */
export function tacticalLog(pack: PackRecord | undefined, loop: (LoopFinding & { fellBack?: boolean }) | undefined): Pick<LoggedDecision, "tactical"> {
  if (pack === undefined && loop === undefined) return {};
  const gate = pack?.gate;
  return {
    tactical: {
      ...(gate === undefined ? {} : { escape: { p: gate.p ?? null, low: gate.low, high: gate.high, ...(gate.band === undefined ? {} : { band: gate.band }) } }),
      ...(pack === undefined || pack.pruned.length === 0 ? {} : { pruned: pack.pruned.map((p) => p.goal) }),
      ...(pack?.lowConfidence === undefined ? {} : { lowConfidence: pack.lowConfidence }),
      ...(loop === undefined ? {} : { loop: { kind: loop.kind, tactic: loop.tactic, fellBack: loop.fellBack === true } }),
    },
  };
}
