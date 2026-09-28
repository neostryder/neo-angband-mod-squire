import { defaultPersona, type Persona } from "../persona/persona.js";
import type { SliderId } from "../persona/catalog.js";
import type { CoachingExample } from "./coaching.js";

export const RANKS = ["Page", "Squire", "Knight-Errant"] as const;
export type Rank = (typeof RANKS)[number];

export function rankFor(agreementShare: number, examples: number): Rank {
  if (examples >= 150 && agreementShare >= 0.75) return "Knight-Errant";
  if (examples >= 40 && agreementShare >= 0.55) return "Squire";
  return "Page";
}

export interface PlayerCommand {
  readonly kind: "fight" | "retreat" | "rest" | "heal" | "consumable" | "descend" | "ranged" | "melee" | "move";
  readonly turn: number;
  readonly dangerousNear?: boolean;
  readonly hpShare?: number;
  readonly restedToFull?: boolean;
  readonly exploredShare?: number;
}

export interface InferredPersona {
  readonly persona: Persona;
  readonly confidence: Readonly<Record<SliderId, number>>;
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function mean(values: readonly number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }

/** Inferred sliders use observed actions; missing evidence keeps the neutral 50. */
export function inferPersona(examples: readonly CoachingExample[], commands: readonly PlayerCommand[]): InferredPersona {
  const persona = defaultPersona("Player");
  const confidence = {} as Record<SliderId, number>;
  for (const key of Object.keys(persona.sliders) as SliderId[]) {
    persona.sliders[key] = 50;
    confidence[key] = 0;
  }
  function set(key: SliderId, count: number, value: number): void {
    if (count === 0) return;
    persona.sliders[key] = Math.round(clamp01(value) * 100);
    confidence[key] = clamp01(count / 20);
  }

  const danger = commands.filter((command) => command.dangerousNear && (command.kind === "fight" || command.kind === "retreat"));
  const choiceDanger = examples.filter((example) => example.situation["dangerousNear"] === true
    && ["fight", "retreat", "phase", "teleport"].includes(example.playerPick));
  const dangerValues = [
    ...danger.map((command) => command.kind === "fight" ? 1 : 0),
    ...choiceDanger.map((example) => example.playerPick === "fight" ? 1 : 0),
  ];
  set("boldness", dangerValues.length, dangerValues.length ? mean(dangerValues) : 0.5);

  const rests = commands.filter((command) => command.kind === "rest" && command.restedToFull !== undefined);
  set("patience", rests.length, rests.length ? rests.filter((command) => command.restedToFull).length / rests.length : 0.5);

  const heals = commands.filter((command) => command.kind === "heal" && command.hpShare !== undefined);
  set("healat", heals.length, heals.length ? mean(heals.map((command) => command.hpShare!)) : 0.5);
  const retreats = commands.filter((command) => command.kind === "retreat" && command.hpShare !== undefined);
  set("retreatat", retreats.length, retreats.length ? mean(retreats.map((command) => command.hpShare!)) : 0.5);

  const duration = commands.length < 2 ? 0 : Math.max(...commands.map((command) => command.turn)) - Math.min(...commands.map((command) => command.turn));
  const consumed = commands.filter((command) => command.kind === "consumable");
  if (duration > 0) set("consumables", commands.length, consumed.length * 1000 / duration / 10);

  const descents = commands.filter((command) => command.kind === "descend" && command.exploredShare !== undefined);
  set("levelfeel", descents.length, descents.length ? mean(descents.map((command) => command.exploredShare!)) : 0.5);
  const attacks = commands.filter((command) => command.kind === "ranged" || command.kind === "melee");
  set("range", attacks.length, attacks.length ? attacks.filter((command) => command.kind === "ranged").length / attacks.length : 0.5);
  return { persona, confidence };
}
