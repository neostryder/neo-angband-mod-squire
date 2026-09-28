import { PARAMETERS } from "./catalog.js";
import type { ListId, QuirkId, SliderId, ToggleId } from "./catalog.js";

export interface Persona {
  name: string;
  sliders: Record<SliderId, number>;
  lists: Record<ListId, string[]>;
  quirks: Record<QuirkId, { on: boolean; strength: number }>;
  toggles: Record<ToggleId, boolean>;
  backstoryCap: number;
  backstory: string;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function bounded(value: unknown, fallback: number, high = 100): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(high, Math.round(value))) : fallback;
}

export function defaultPersona(name = "Squire"): Persona {
  const sliders = {} as Record<SliderId, number>;
  const lists = {} as Record<ListId, string[]>;
  const quirks = {} as Record<QuirkId, { on: boolean; strength: number }>;
  const toggles = {} as Record<ToggleId, boolean>;
  for (const parameter of PARAMETERS) {
    switch (parameter.kind) {
      case "slider": sliders[parameter.id] = "default" in parameter ? parameter.default as number : 50; break;
      case "list": lists[parameter.id] = []; break;
      case "quirk": quirks[parameter.id] = { on: false, strength: 50 }; break;
      case "toggle": toggles[parameter.id] = parameter.default; break;
      case "number": break;
    }
  }
  return { name, sliders, lists, quirks, toggles, backstoryCap: 600, backstory: "" };
}

/** Imported or edited data is untrusted, so each known field is copied into a fresh shape. */
export function normalize(input: unknown): Persona {
  try {
    const raw = record(input);
    const result = defaultPersona(typeof raw["name"] === "string" ? raw["name"].trim().slice(0, 100) || "Squire" : undefined);
    const sliders = record(raw["sliders"]);
    const lists = record(raw["lists"]);
    const quirks = record(raw["quirks"]);
    const toggles = record(raw["toggles"]);
    for (const parameter of PARAMETERS) {
      switch (parameter.kind) {
        case "slider": result.sliders[parameter.id] = bounded(sliders[parameter.id], result.sliders[parameter.id]); break;
        case "list": {
          const value = lists[parameter.id];
          result.lists[parameter.id] = Array.isArray(value)
            ? value.filter((item): item is string => typeof item === "string")
                .map((item) => item.trim().slice(0, 40)).filter(Boolean).slice(0, 12)
            : [];
          break;
        }
        case "quirk": {
          const value = record(quirks[parameter.id]);
          result.quirks[parameter.id] = {
            on: typeof value["on"] === "boolean" ? value["on"] : false,
            strength: bounded(value["strength"], 50),
          };
          break;
        }
        case "toggle": {
          const value = toggles[parameter.id];
          result.toggles[parameter.id] = typeof value === "boolean" ? value : result.toggles[parameter.id];
          break;
        }
        case "number": break;
      }
    }
    result.backstoryCap = bounded(raw["backstoryCap"], 600, 4000);
    result.backstory = typeof raw["backstory"] === "string" ? raw["backstory"].slice(0, 20_000) : "";
    return result;
  } catch {
    return defaultPersona();
  }
}

function unit(rng: () => number): number {
  const value = rng();
  return Number.isFinite(value) ? Math.max(0, Math.min(1 - Number.EPSILON, value)) : 0;
}

export function randomPersona(rng: () => number, name = "Squire"): Persona {
  const result = defaultPersona(name);
  for (const parameter of PARAMETERS) {
    if (parameter.kind === "slider") result.sliders[parameter.id] = 20 + Math.floor(unit(rng) * 61);
  }
  const pool: QuirkId[] = ["forgetful", "delusional", "compulsive", "pyromaniac", "cowardice"];
  const count = 1 + Math.floor(unit(rng) * 2);
  for (let i = 0; i < count; i += 1) {
    const index = Math.floor(unit(rng) * pool.length);
    const id = pool.splice(index, 1)[0];
    if (id !== undefined) result.quirks[id].on = true;
  }
  return result;
}

type Override = {
  readonly sliders?: Partial<Record<SliderId, number>>;
  readonly lists?: Partial<Record<ListId, readonly string[]>>;
  readonly quirks?: Partial<Record<QuirkId, { readonly on: boolean; readonly strength?: number }>>;
};

export const ARCHETYPES = {
  coward: { sliders: { boldness: 10, selfpreservation: 90, retreatat: 85, escapes: 90, paranoia: 80, strength: 65 }, quirks: { cowardice: { on: true } } },
  berserker: { sliders: { boldness: 90, impulsiveness: 85, selfpreservation: 30, range: 10, strength: 70, pride: 80 } },
  miser: { sliders: { greed: 95, savings: 90, pricesense: 90, hoarding: 85, selling: 80, strength: 65 } },
  scholar: { sliders: { curiosity: 90, patience: 85, detection: 80, levelfeel: 85, impulsiveness: 20, strength: 65 }, lists: { elements: ["magic", "healing"] } },
  zealot: { sliders: { devotion: 95, honour: 85, stubbornness: 85, mercy: 20, strength: 75 }, lists: { hated: ["undead"] } },
  tourist: { sliders: { curiosity: 85, levelfeel: 90, ambition: 20, boldness: 30, towntrips: 80, strength: 60 } },
} as const satisfies Record<string, Override>;

export type ArchetypeId = keyof typeof ARCHETYPES;

export function archetype(id: ArchetypeId): Persona {
  const override: Override = ARCHETYPES[id];
  return normalize({
    ...defaultPersona(),
    name: id[0]!.toUpperCase() + id.slice(1),
    sliders: { ...defaultPersona().sliders, ...override.sliders },
    lists: { ...defaultPersona().lists, ...override.lists },
    quirks: { ...defaultPersona().quirks, ...override.quirks },
  });
}
