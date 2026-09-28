import { PARAMETERS } from "./catalog.js";
import type { Persona } from "./persona.js";

function traitWord(id: string, scale: string, value: number): string {
  const [low, high] = scale.split(" to ");
  const word = id === "boldness" && value > 50 ? "bold" : value < 50 ? low : high;
  return `${Math.abs(value - 50) >= 30 ? "very" : "somewhat"} ${word}`;
}

/**
 * The groups that describe the character's nature. Lineage, patron and brain
 * dials steer Squire itself, so they never reach the model as traits.
 */
const NATURE_GROUPS: ReadonlySet<string> = new Set(["temperament", "values", "habits", "tactics", "economy"]);

/** The state carries only strong preferences to keep ordinary decisions compact. */
export function personaState(persona: Persona, budgetTokens: number): Record<string, string> {
  const state: Record<string, string> = {};
  const traits: string[] = [];
  const activeQuirks: string[] = [];
  for (const parameter of PARAMETERS) {
    if (parameter.kind === "slider") {
      if (!NATURE_GROUPS.has(parameter.group)) continue;
      const value = persona.sliders[parameter.id];
      if (Math.abs(value - 50) >= 15) traits.push(`${parameter.name}: ${traitWord(parameter.id, parameter.scale, value)}`);
    } else if (parameter.kind === "list") {
      if (persona.lists[parameter.id].length > 0) state[parameter.id] = persona.lists[parameter.id].join(", ");
    } else if (parameter.kind === "quirk" && persona.quirks[parameter.id].on) {
      activeQuirks.push(parameter.name.toLowerCase());
    }
  }
  if (traits.length > 0) state["traits"] = traits.join("; ");
  if (activeQuirks.length > 0) state["quirks"] = activeQuirks.join(", ");
  const tokens = Math.max(0, Math.min(persona.backstoryCap, Number.isFinite(budgetTokens) ? budgetTokens : 0));
  const limit = Math.floor(tokens * 4 * persona.sliders.backstory / 100);
  if (limit > 0 && persona.backstory.trim()) {
    let excerpt = persona.backstory.trim().slice(0, limit);
    if (excerpt.length < persona.backstory.trim().length) {
      const boundary = Math.max(excerpt.lastIndexOf(". "), excerpt.lastIndexOf("! "), excerpt.lastIndexOf("? "));
      if (boundary >= Math.floor(excerpt.length / 2)) excerpt = excerpt.slice(0, boundary + 1);
    }
    if (excerpt) state["backstory"] = excerpt;
  }
  return state;
}

export function inCharacterInstructions(persona: Persona): string {
  return `Which option would ${persona.name} choose, given this character's nature and history? Answer as the character would act, even when another option seems wiser.`;
}
