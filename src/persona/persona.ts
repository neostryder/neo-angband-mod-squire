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
  /**
   * The style preset the persona started from, whose play rule the persona
   * layer states, or null. Editing a lever by hand keeps it: a preset is a
   * starting style the player tunes, and its rule says how the character plays
   * rather than restating any one lever. The persona sheet clears or changes
   * it explicitly.
   */
  preset: ArchetypeId | null;
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
  return { name, sliders, lists, quirks, toggles, backstoryCap: 600, backstory: "", preset: null };
}

/**
 * The base a character the player makes starts from: every trait at its
 * catalog neutral, no quirks, and catalog defaults for toggles and numbered
 * settings. The catalog neutral is 50 for every slider except the few with a
 * stated default (Self-preservation, which sets the death-risk ceiling, and
 * Squire's own dials), which keep that default.
 */
export function neutralPersona(name = "Squire"): Persona {
  return defaultPersona(name);
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
    result.preset = isPreset(raw["preset"]) ? raw["preset"] : null;
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
  /** How the style plays, as one short clause the persona layer states while the preset is active. */
  readonly rule: string;
  readonly sliders?: Partial<Record<SliderId, number>>;
  readonly lists?: Partial<Record<ListId, readonly string[]>>;
  readonly quirks?: Partial<Record<QuirkId, { readonly on: boolean; readonly strength?: number }>>;
};

/** Style presets: lever values plus a play rule. The persona sheet offers them in this order. */
export const ARCHETYPES = {
  coward: { rule: "retreats at the first real loss of hit points", sliders: { boldness: 10, ambition: 40, selfpreservation: 90, retreatat: 85, escapes: 90, paranoia: 80, strength: 65 }, quirks: { cowardice: { on: true } } },
  berserker: { rule: "closes to melee and presses every fight", sliders: { boldness: 90, impulsiveness: 85, selfpreservation: 30, range: 10, strength: 70, pride: 80 } },
  miser: { rule: "spends gold only on what keeps it alive", sliders: { greed: 95, savings: 90, pricesense: 90, hoarding: 85, selling: 80, strength: 65 } },
  scholar: { rule: "studies every unknown item it finds", sliders: { curiosity: 90, patience: 85, detection: 80, levelfeel: 85, impulsiveness: 20, strength: 65 }, lists: { elements: ["magic", "healing"] } },
  zealot: { rule: "obeys its patron and hunts the undead first", sliders: { devotion: 95, honour: 85, stubbornness: 85, mercy: 20, strength: 75 }, lists: { hated: ["undead"] } },
  tourist: { rule: "sees each level before going deeper", sliders: { curiosity: 85, levelfeel: 90, ambition: 20, boldness: 30, towntrips: 80, strength: 60 } },
  diver: { rule: "ignores minor loot and heads down", sliders: { ambition: 90, levelfeel: 15, greed: 25, patience: 30, boldness: 70, strength: 65 } },
  completionist: { rule: "maps the whole level and keeps identify scrolls", sliders: { levelfeel: 95, detection: 85, curiosity: 80, patience: 80, strength: 65 } },
  paranoid: { rule: "will not fight a unique without an escape path", sliders: { paranoia: 90, escapes: 85, detection: 80, selfpreservation: 85, pride: 25, strength: 65 } },
} as const satisfies Record<string, Override>;

export type ArchetypeId = keyof typeof ARCHETYPES;

function isPreset(value: unknown): value is ArchetypeId {
  return typeof value === "string" && Object.hasOwn(ARCHETYPES, value);
}

/** The play rule of the preset a persona came from, or null. */
export function presetRule(persona: Pick<Persona, "preset">): string | null {
  return persona.preset === null ? null : ARCHETYPES[persona.preset].rule;
}

/** A preset's name as the persona sheet shows it. */
export function presetName(id: ArchetypeId): string {
  return id[0]!.toUpperCase() + id.slice(1);
}

export function archetype(id: ArchetypeId): Persona {
  const override: Override = ARCHETYPES[id];
  return normalize({
    ...defaultPersona(),
    name: presetName(id),
    preset: id,
    sliders: { ...defaultPersona().sliders, ...override.sliders },
    lists: { ...defaultPersona().lists, ...override.lists },
    quirks: { ...defaultPersona().quirks, ...override.quirks },
  });
}
