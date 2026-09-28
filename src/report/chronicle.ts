import type { ScoreAnswer, ScoreQuestion } from "../brain/systemone.js";
import type { Persona } from "../persona/persona.js";
import type { RunEvent } from "./events.js";

export function notorietyQuestion(_event: RunEvent): ScoreQuestion {
  return {
    type: "score",
    instructions: "Rate how much this single run event deserves a place in the character's Chronicle. Judge its impact, danger and rarity from the facts in the state. Do not invent events.",
    criteria: ["routine", "worth a mention", "notable", "memorable", "legendary"],
  };
}

/** Keep the question state small so only the event being judged affects its score. */
export function notorietyState(event: RunEvent, personaName: string, depth: number, level: number): Readonly<Record<string, unknown>> {
  return {
    persona: personaName, kind: event.kind, fact: event.text, turn: event.turn,
    eventDepth: event.depth, depth, level,
    ...(event.race === undefined ? {} : { race: event.race }),
    ...(event.value === undefined ? {} : { value: event.value }),
  };
}

export function isNotable(answer: ScoreAnswer, chronicleSlider: number): boolean {
  const voice = Number.isFinite(chronicleSlider) ? Math.max(0, Math.min(100, chronicleSlider)) : 0;
  return Number.isFinite(answer.score) && answer.score >= 3 - Math.floor(voice / 50);
}

type Template = (fact: string, feet: number) => string;

/** Every event has three ways to state its recorded fact, with no added game facts. */
const TEMPLATES: Record<RunEvent["kind"], readonly [Template, Template, Template]> = {
  "kill": [(f, d) => `Killed ${f} at ${d} ft.`, (f, d) => `At ${d} ft, ${f} fell.`, (f, d) => `${f} died at ${d} ft.`],
  "unique-kill": [(f, d) => `Cut down ${f} at ${d} ft.`, (f, d) => `At ${d} ft, I killed ${f}.`, (f, d) => `${f} fell to me at ${d} ft.`],
  "near-death": [(f, d) => `Nearly died at ${d} ft: ${f}.`, (f, d) => `At ${d} ft, ${f}. I lived.`, (f, d) => `I survived ${f} at ${d} ft.`],
  "escape": [(f, d) => `Escaped at ${d} ft: ${f}.`, (f, d) => `At ${d} ft, I got away: ${f}.`, (f, d) => `I left danger behind at ${d} ft: ${f}.`],
  "level-up": [(f, d) => `Grew stronger at ${d} ft: ${f}.`, (f, d) => `At ${d} ft, ${f}.`, (f, d) => `${f} at ${d} ft.`],
  "descend": [(f, d) => `Descended to ${d} ft: ${f}.`, (f, d) => `At ${d} ft, ${f}.`, (f, d) => `Went deeper, to ${d} ft: ${f}.`],
  "item-found": [(f, d) => `Found ${f} at ${d} ft.`, (f, d) => `At ${d} ft, I found ${f}.`, (f, d) => `${f} turned up at ${d} ft.`],
  "death": [(f, d) => `Died at ${d} ft: ${f}.`, (f, d) => `At ${d} ft, ${f}. That was the end.`, (f, d) => `My run ended at ${d} ft: ${f}.`],
  "divergence": [(f, d) => `Chose my own way at ${d} ft: ${f}.`, (f, d) => `At ${d} ft, I went against advice: ${f}.`, (f, d) => `${f} at ${d} ft. I made the call.`],
  "lesson": [(f, d) => `Learned at ${d} ft: ${f}.`, (f, d) => `At ${d} ft, I learned: ${f}.`, (f, d) => `${f} That lesson came at ${d} ft.`],
  "lineage": [(f, d) => `Carried the family story to ${d} ft: ${f}.`, (f, d) => `At ${d} ft, ${f}.`, (f, d) => `${f} The line reached ${d} ft.`],
};

export function chronicleLine(event: RunEvent, persona: Persona, rng: () => number): string {
  const templates = TEMPLATES[event.kind];
  const draw = rng();
  const index = Number.isFinite(draw) ? Math.max(0, Math.min(2, Math.floor(draw * 3))) : 0;
  const fact = event.text.trim().replace(/[.!?]+$/, "");
  const line = templates[index]!(fact, event.depth * 50);
  if (persona.sliders.chronicle < 50) return line;
  if (persona.sliders.boldness >= 65) return `${line} I earned that story.`;
  if (persona.sliders.boldness <= 35) return `${line} I am glad I got this far.`;
  return `${line} I will remember it.`;
}
