/**
 * Memory strength: how firmly an instruction is remembered.
 *
 * It fades with game turns and with level changes. The Forgetful quirk speeds
 * the fade and a high Devotion slows it. Repeating the instruction refreshes it
 * fully and acting on it refreshes it in part. Below a threshold the instruction
 * leaves the decision state. A forgotten standing instruction stays faintly
 * remembered, and may come back when its trigger happens.
 */

import type { Persona } from "../persona/persona.js";

/** Memory below this is forgotten. */
export const FORGET_BELOW = 0.15;
/** Memory of an instruction that has just come back. */
export const REMEMBERED_AT = 0.6;
/** What a forgotten standing instruction keeps, so it can still be remembered. */
export const FAINT = 0.1;
/** Memory lost per game turn at neutral speed. */
const TURN_FADE = 1 / 120_000;
/** Memory lost per change of level. */
const LEVEL_FADE = 0.03;
/** Memory an act on the instruction restores. */
const ACT_REFRESH = 0.25;

/** How fast this persona forgets, as a multiple of the neutral rate. */
export function fadeRate(persona: Persona): number {
  const forgetful = persona.quirks.forgetful.on ? 1 + 2 * (persona.quirks.forgetful.strength / 100) : 1;
  const devotion = 1.25 - 0.75 * (persona.sliders.devotion / 100);
  return forgetful * devotion;
}

export function fade(memory: number, turns: number, levelChanges: number, persona: Persona): number {
  const t = Number.isFinite(turns) ? Math.max(0, turns) : 0;
  const l = Number.isFinite(levelChanges) ? Math.max(0, levelChanges) : 0;
  return Math.max(0, memory - (t * TURN_FADE + l * LEVEL_FADE) * fadeRate(persona));
}

export function refreshed(memory: number, full: boolean): number {
  return full ? 1 : Math.min(1, memory + ACT_REFRESH);
}

export function isForgotten(memory: number): boolean {
  return memory < FORGET_BELOW;
}

/** Whether a faintly remembered instruction comes back now, given a draw from 0 to 1. */
export function comesBack(persona: Persona, draw: number): boolean {
  return draw < 0.3 + 0.4 * (persona.sliders.devotion / 100);
}
