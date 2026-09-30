/**
 * How hard an instruction pulls, and what that does to the options.
 *
 * Adherence is a number from 0 to 1, recomputed at review points. Devotion
 * raises it and Resentment lowers it. A clash between what the instruction asks
 * and the persona's own temper lowers it, more for a stubborn persona.
 * Stubbornness also makes it slow to change. Persona strength scales how much
 * any of that matters. It weighs the options that serve or break the
 * instruction beside the persona weights, and at a high enough level lets an
 * order carry an option past the death-risk ceiling.
 */

import type { Persona } from "../persona/persona.js";
import type { Instruction, ResponseKind, Sorted, Stance } from "./types.js";

/** Adherence at which an order may carry an option past the risk ceiling. */
export const PASS_ADHERENCE = 0.85;
/** Below this the squire ignores the instruction. */
export const IGNORE_BELOW = 0.2;
/** Below this, or with a clash or a grudge, it follows grudgingly. */
export const GRUDGE_BELOW = 0.4;
/** Reviews at ignoring stance before the squire gives up an order. */
export const GIVE_UP_REVIEWS = 3;
/** A viewer's request settles at this share of the adherence the patron's own word would reach. */
export const VIEWER_PULL = 0.6;
/** Devotion at which the squire takes a viewer's request as seriously as the patron's word. */
export const VERY_DEVOTED = 90;

/** The most a fully adherent instruction raises an option it serves, as a multiple of its weight. */
const SERVE_BOOST = 3;
/** The most it lowers an option it breaks. */
const BREAK_CUT = 0.85;

function unit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/** How much the persona's own temper resists what the instruction asks, 0 to 1. */
export function clash(sorted: Sorted, persona: Persona): number {
  const s = persona.sliders;
  const bold = s.boldness / 100;
  const careful = s.selfpreservation / 100;
  const wants: number[] = [];
  const response: ResponseKind | null = sorted.response;
  if (response === "flee") wants.push(bold * 0.6 + (s.pride / 100) * 0.4);
  if (response === "fight") wants.push((1 - bold) * 0.5 + careful * 0.5);
  if (response === "descend" || sorted.aim === "depth") wants.push(careful * 0.6 + (1 - s.ambition / 100) * 0.4);
  if (response === "buy" || sorted.aim === "armour" || sorted.aim === "weapon" || sorted.aim === "item") wants.push((s.savings / 100) * 0.5 + (s.pricesense / 100) * 0.5);
  if (sorted.aim === "gold") wants.push((s.impulsiveness / 100) * 0.5 + (s.greed / 100) * 0.5);
  if (response === "rest") wants.push((1 - s.patience / 100) * 0.7);
  if (response === "avoid") wants.push(s.impulsiveness / 100 * 0.6);
  return wants.length === 0 ? 0 : unit(Math.max(...wants));
}

/** Where adherence settles for this persona, before stubbornness slows the move. A viewer's request pulls less than the patron's word. */
export function targetAdherence(sorted: Sorted, persona: Persona, viewer = false): number {
  const s = persona.sliders;
  const pull = ((s.devotion - 50) / 50) * 0.9;
  const grudge = (s.resentment / 100) * 0.4;
  const friction = clash(sorted, persona) * (0.3 + 0.4 * (s.stubbornness / 100));
  const weight = 0.6 + 0.4 * (s.strength / 100);
  const own = unit(0.5 + 0.5 * (pull - grudge - friction) * weight);
  return viewer && s.devotion < VERY_DEVOTED ? own * VIEWER_PULL : own;
}

/** Adherence moves toward its target; a stubborn persona moves slowly, either way. */
export function nextAdherence(previous: number | null, sorted: Sorted, persona: Persona, viewer = false): number {
  const target = targetAdherence(sorted, persona, viewer);
  if (previous === null) return target;
  const rate = Math.max(0.1, 1 - 0.9 * (persona.sliders.stubbornness / 100));
  return unit(previous + (target - previous) * rate);
}

/** Following, grudgingly or ignoring, from adherence and the persona. */
export function stanceOf(adherence: number, sorted: Sorted, persona: Persona): Stance {
  if (adherence < IGNORE_BELOW) return "ignoring";
  if (adherence < GRUDGE_BELOW || clash(sorted, persona) >= 0.4 || persona.sliders.resentment >= 60) return "grudgingly";
  return "following";
}

/** Goals an instruction serves and breaks, from its sorted form. */
export function goalsOf(sorted: Sorted): { readonly serves: readonly string[]; readonly breaks: readonly string[] } {
  const serves = new Set<string>();
  const breaks = new Set<string>(sorted.avoids);
  const attacks = ["fight", "shoot", "cast_attack", "throw_oil", "aim_wand"];
  const escapes = ["retreat", "phase", "teleport"];
  switch (sorted.response) {
    case "flee":
      escapes.forEach((g) => serves.add(g));
      serves.add("leave_level");
      attacks.forEach((g) => breaks.add(g));
      break;
    case "fight":
      attacks.forEach((g) => serves.add(g));
      escapes.forEach((g) => breaks.add(g));
      break;
    case "leave-level":
      serves.add("leave_level");
      serves.add("descend");
      break;
    case "descend": serves.add("descend"); break;
    case "buy": serves.add("shop"); serves.add("recall_town"); break;
    case "rest": serves.add("rest"); break;
    case "avoid": case null: break;
  }
  switch (sorted.aim) {
    case "armour": case "weapon": case "spellbook": case "lantern": case "item":
      serves.add("recall_town"); serves.add("shop");
      if (sorted.aim === "armour" || sorted.aim === "weapon") serves.add("wear");
      if (sorted.aim === "item") serves.add("pick_up");
      break;
    case "depth": serves.add("descend"); serves.add("leave_level"); break;
    default: break;
  }
  for (const goal of breaks) serves.delete(goal);
  return { serves: [...serves], breaks: [...breaks] };
}

/** Multiply the weights of served and broken options by this instruction's adherence and memory. Returns a new distribution. */
export function weigh(dist: Readonly<Record<string, number>>, instruction: Instruction, modelServes: ReadonlySet<string> = new Set()): Record<string, number> {
  const { serves, breaks } = goalsOf(instruction.sorted);
  const a = unit(instruction.adherence) * unit(instruction.memory);
  const out: Record<string, number> = { ...dist };
  for (const key of Object.keys(out)) {
    const serving = serves.includes(key) || modelServes.has(key);
    const base = out[key] ?? 0;
    if (breaks.includes(key)) out[key] = base * (1 - BREAK_CUT * a);
    else if (serving) out[key] = base * (1 + SERVE_BOOST * a);
  }
  return out;
}
