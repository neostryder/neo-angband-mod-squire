import type { AgentCommand, AgentView, ItemView } from "@rpgm-tools/neo-angband-core";
import type { Persona } from "../persona/persona.js";
import { gearCandidates, TV } from "../gear/compare.js";
import { PACK_LIMIT } from "../brain/items.js";
import { shownName } from "../town/needs.js";
import { missingPreparation } from "../strategy/readiness.js";
import type { Lineage } from "./lineage.js";

export interface Superstition {
  readonly key: string;
  readonly name: string;
}

export interface Find {
  readonly depth: number;
  readonly value: number;
  readonly name: string;
}

export interface Trophy {
  readonly unique: string;
  readonly handle: number;
  readonly name: string;
}

/** The short line the family keeps. It is set once, then possibly replaced. */
export interface Motto {
  readonly text: string;
  readonly generation: number;
}

/** The weapon kind a single ancestor used most. */
export interface AncestralWeapon {
  readonly generation: number;
  readonly kind: string;
  readonly kills: number;
}

export interface FamilyFlourishes {
  readonly superstitions: readonly Superstition[];
  readonly darkDeaths: number;
  readonly bestFind: Find | null;
  readonly motto: Motto | null;
  readonly ancestralWeapons: readonly AncestralWeapon[];
  readonly cursedDepth: number | null;
}

export interface Flourishes {
  readonly superstitions: readonly Superstition[];
  readonly darkLesson: boolean;
  readonly favouredDepth: number | null;
  readonly trophies: readonly Trophy[];
  readonly uniqueKills: readonly string[];
  readonly bestFind: Find | null;
  readonly lastUse: Superstition | null;
  /** How many kills the character made with each kind of weapon, for the family record. */
  readonly weaponKills: Readonly<Record<string, number>>;
  /** Levels the character has already spoken about, so a level-up line is never repeated. */
  readonly celebratedLevels: readonly number[];
  /** Races the character has already bragged about killing for the first time. */
  readonly boastedRaces: readonly string[];
  /** The weapon kind the family favours, inherited from the most successful ancestor. */
  readonly favouredKind: string | null;
}

export function emptyFlourishes(): Flourishes {
  return { superstitions: [], darkLesson: false, favouredDepth: null, trophies: [], uniqueKills: [], bestFind: null, lastUse: null, weaponKills: {}, celebratedLevels: [], boastedRaces: [], favouredKind: null };
}

function itemKey(item: ItemView): string {
  /* The kind identifies repeat sightings without revealing its unknown effect. */
  return item.kindId ?? `${String(item.tval)}:${String(item.sval)}`;
}

export function unknownUse(item: ItemView): Superstition | null {
  const name = shownName(item);
  if (name === null || !/\b(?:Scrolls?|Potions?|Wands?)\b/i.test(name) || /\b(?:Scrolls?|Potions?|Wands?) of\b/i.test(name)) return null;
  const plain = name.replace(/^(?:an?|the|\d+)\s+/i, "").replace(/\s*\([^)]*\)|\s*\{[^}]*\}/g, "").trim();
  return { key: itemKey(item), name: plain };
}

export function usedItem(command: AgentCommand, view: AgentView): Superstition | null {
  if (!["read", "quaff", "aim-wand"].includes(command.code)) return null;
  const item = view.inventory().find((i) => i.handle === command.args?.["handle"]);
  return item === undefined ? null : unknownUse(item);
}

export function distrusted(item: ItemView, memories: Flourishes, persona: Persona | null): boolean {
  const unknown = unknownUse(item);
  return persona?.toggles.inheritedSuperstitions === true && unknown !== null && memories.superstitions.some((s) => s.key === unknown.key);
}

export function distrustedUse(command: AgentCommand, view: AgentView, run: Flourishes, persona: Persona | null): boolean {
  const use = usedItem(command, view);
  return persona?.toggles.inheritedSuperstitions === true && use !== null && run.superstitions.some((s) => s.key === use.key);
}

export function learnedSuperstitions(superstitions: readonly Superstition[], view: AgentView): Superstition[] {
  return superstitions.filter((s) => view.inventory().some((i) => itemKey(i) === s.key && unknownUse(i) === null));
}

export function inheritWays(family: FamilyFlourishes, parent: Persona, heir: Persona, rng: () => number): Flourishes {
  const share = Math.max(0, Math.min(1, parent.sliders.inheritance / 100));
  const enabled = (id: "inheritedSuperstitions" | "darkLessons" | "favouredGrounds" | "favouredWeapons") => parent.toggles[id] && heir.toggles[id];
  const inheritedFavoured = enabled("favouredWeapons") && share > 0 && (share === 1 || rng() < share) ? favouredWeapon(family) : null;
  return { ...emptyFlourishes(),
    superstitions: enabled("inheritedSuperstitions") ? family.superstitions.slice(-Math.ceil(6 * share)).filter(() => share > 0) : [],
    darkLesson: enabled("darkLessons") && family.darkDeaths > 0 && share > 0 && (share === 1 || rng() < share),
    favouredDepth: enabled("favouredGrounds") && family.bestFind !== null && share > 0 && (share === 1 || rng() < share) ? family.bestFind.depth : null,
    favouredKind: inheritedFavoured === null ? null : inheritedFavoured.kind,
  };
}

/** The single weapon category name an item slot belongs to, or null for non-weapons. */
export function weaponKind(tval: number): string | null {
  if (tval === TV.SWORD) return "blade";
  if (tval === TV.HAFTED) return "hafted";
  if (tval === TV.POLEARM) return "polearm";
  if (tval === TV.BOW) return "bow";
  if (tval === TV.DIGGING) return "hafted";
  return null;
}

/** The category the most successful ancestor favoured. Success is the most kills with a kind. */
export function favouredWeapon(family: FamilyFlourishes): AncestralWeapon | null {
  const withKills = family.ancestralWeapons.filter((w) => w.kills > 0);
  if (withKills.length === 0) return null;
  return [...withKills].sort((a, b) => b.kills - a.kills || b.generation - a.generation)[0] ?? null;
}

/** A short phrase the family repeats at moments that fit. The persona's top sliders drive the wording. */
const MOTTO_WORDS: Readonly<Record<string, readonly { readonly at: number; readonly words: readonly string[] }[]>> = {
  boldness: [{ at: 85, words: ["close the gap and end it", "strike first, before they recover"] }, { at: 65, words: ["hold the line and push on"] }, { at: 35, words: ["hold back and read the room"] }],
  patience: [{ at: 85, words: ["wait them out, foot by foot"] }, { at: 35, words: ["seize the moment when it comes"] }],
  pride: [{ at: 85, words: ["leave a name worth telling", "make the depths remember me"] }, { at: 65, words: ["do something worth the climb"] }, { at: 35, words: ["let the deed speak for itself"] }],
  composure: [{ at: 85, words: ["breathe and cut clean"] }, { at: 35, words: ["trust the gut, even when it shakes"] }],
  honour: [{ at: 85, words: ["fight fair and face to face"] }, { at: 35, words: ["take any edge they hand me"] }],
  greed: [{ at: 85, words: ["leave nothing of value on the floor"] }, { at: 35, words: ["travel light and keep moving"] }],
  curiosity: [{ at: 85, words: ["see what the next room holds"] }, { at: 35, words: ["keep to the proven road"] }],
  paranoia: [{ at: 85, words: ["trust nothing I cannot name"] }, { at: 35, words: ["trust the footing and press on"] }],
  ambition: [{ at: 85, words: ["go one level deeper each night"] }, { at: 35, words: ["take what the day gives me"] }],
  stubbornness: [{ at: 85, words: ["never give a step back"] }, { at: 35, words: ["cut my losses early"] }],
};

export function mottoForPersona(persona: Persona, rng: () => number): string {
  const picks: { readonly at: number; readonly phrase: string }[] = [];
  for (const [id, table] of Object.entries(MOTTO_WORDS)) {
    const slider = persona.sliders[id as keyof typeof persona.sliders];
    if (!Number.isFinite(slider)) continue;
    for (const entry of table) {
      const distance = Math.abs(slider - 50);
      const band = entry.at >= 50 ? slider >= entry.at : slider <= entry.at;
      if (!band) continue;
      const draw = Math.max(0, Math.min(0.999999, rng()));
      const phrase = entry.words[Math.floor(draw * entry.words.length)];
      if (phrase !== undefined) picks.push({ at: distance, phrase });
    }
  }
  picks.sort((a, b) => b.at - a.at);
  return picks[0]?.phrase ?? "keep moving and keep your head.";
}

export function mayReplaceMotto(older: Persona | null, persona: Persona, motto: Motto | null, rng: () => number): boolean {
  if (motto === null) return true;
  const roll = rng();
  if (!Number.isFinite(roll)) return false;
  /* The fraction of sliders that have moved more than 30 from the older persona's
   * value decides whether the new character keeps the old motto or writes its own. */
  if (older === null) return roll < 0.25;
  const moved = Object.entries(older.sliders).filter(([key, value]) => {
    const heirValue = persona.sliders[key as keyof typeof persona.sliders];
    return heirValue !== undefined && Math.abs(value - heirValue) >= 30;
  }).length;
  const share = moved / Object.keys(older.sliders).length;
  return roll < share;
}

/** Names of artifacts the family has held: read from the existing milestone record. */
export function heirloomNames(lineage: Lineage | undefined): string[] {
  if (lineage === undefined) return [];
  return (lineage.milestones ?? []).filter((m) => m.kind === "artifact").map((m) => m.fact);
}

export function familyAfterDeath(family: FamilyFlourishes, run: Flourishes, view: AgentView | null, persona: Persona): FamilyFlourishes {
  const last = run.lastUse;
  const known = view?.inventory().some((i) => itemKey(i) === last?.key && unknownUse(i) === null) ?? false;
  const learned = view === null ? [] : learnedSuperstitions(family.superstitions, view);
  const remembered = family.superstitions.filter((s) => !learned.some((t) => s.key === t.key));
  const superstitions = persona.toggles.inheritedSuperstitions && last !== null && !known
    ? [...remembered.filter((s) => s.key !== last.key), last].slice(-6) : remembered;
  const dark = view !== null && view.player().depth > 0 && view.player().light <= 0 && !view.player().classFlags.includes("UNLIGHT");
  const bestFind = persona.toggles.favouredGrounds && run.bestFind !== null && run.bestFind.value > (family.bestFind?.value ?? -1) ? run.bestFind : family.bestFind;
  /* Each generation contributes its most-used weapon kind to the family record. */
  const kinds = Object.entries(run.weaponKills).filter(([, n]) => typeof n === "number" && n > 0);
  const topKind = kinds.length === 0 ? null : [...kinds].sort((a, b) => (b[1] as number) - (a[1] as number))[0]!;
  const nextGeneration = family.ancestralWeapons.length === 0 ? 1 : Math.max(...family.ancestralWeapons.map((w) => w.generation)) + 1;
  const nextWeapon: AncestralWeapon[] = topKind !== null
    ? [...family.ancestralWeapons.slice(-12), { generation: nextGeneration, kind: topKind[0], kills: topKind[1] as number }]
    : family.ancestralWeapons.slice(-12);
  const diedDepth = view !== null && view.player().depth > 0 ? view.player().depth : null;
  const cursedDepthNext = diedDepth !== null ? (family.cursedDepth ?? diedDepth) : family.cursedDepth;
  /* The first character to write a record sets the family motto. A later generation may replace it. */
  const nextMotto = family.motto ?? (persona.toggles.familyMotto ? { text: mottoForPersona(persona, Math.random), generation: nextGeneration } : null);
  return { superstitions, darkDeaths: family.darkDeaths + (persona.toggles.darkLessons && dark ? 1 : 0), bestFind, motto: nextMotto, ancestralWeapons: nextWeapon, cursedDepth: cursedDepthNext };
}

export function emptyFamilyFlourishes(): FamilyFlourishes {
  return { superstitions: [], darkDeaths: 0, bestFind: null, motto: null, ancestralWeapons: [], cursedDepth: null };
}

export function observeFlourishes(run: Flourishes, view: AgentView, persona: Persona | null, uniqueKills: readonly string[], acquired: ReadonlySet<number>): Flourishes {
  const items = view.inventory();
  const superstitions = run.superstitions.filter((s) => !items.some((i) => itemKey(i) === s.key && unknownUse(i) === null));
  const trophies = run.trophies.flatMap((t) => {
    const item = items.find((i) => i.handle === t.handle);
    return item === undefined ? [] : [{ ...t, name: shownName(item) ?? t.name }];
  });
  let bestFind = run.bestFind;
  const upgrades = new Set(gearCandidates(view).map((g) => g.handle));
  for (const item of items) {
    const name = shownName(item);
    if (name === null) continue;
    const text = view.inspectItem?.(item.handle)?.text ?? "";
    const originDepth = /(?:found|dropped)[\s\S]*?\(level (\d+)\)/i.exec(text);
    const bought = /Bought from a store|An inheritance from your family|Created by debug option/i.test(text);
    const depth = bought ? 0 : originDepth === null ? acquired.has(item.handle) ? view.player().depth : 0 : Number(originDepth[1]);
    const value = item.value;
    if (persona?.toggles.favouredGrounds && depth > 0 && typeof value === "number" && Number.isFinite(value) && value > (bestFind?.value ?? 0)) bestFind = { depth, value, name };
    if (!persona?.toggles.trophies || persona.sliders.pride < 70 || items.length >= PACK_LIMIT || upgrades.has(item.handle) || item.number < 1) continue;
    const unique = uniqueKills.find((race) => text.includes(`Dropped by ${race} `) || text.includes(`Dropped by ${race}, `));
    if (unique === undefined || trophies.some((t) => t.unique === unique || t.handle === item.handle)) continue;
    trophies.push({ unique, handle: item.handle, name });
  }
  return { ...run, superstitions, trophies, bestFind };
}

export function trophyHandles(run: Flourishes, view: AgentView, persona: Persona | null): ReadonlySet<number> {
  if (!persona?.toggles.trophies || persona.sliders.pride < 70 || view.inventory().length >= PACK_LIMIT) return new Set();
  const upgrades = new Set(gearCandidates(view).map((g) => g.handle));
  return new Set(run.trophies.filter((t) => !upgrades.has(t.handle)).map((t) => t.handle));
}

/** A short line spoken on a level-up or a first unique kill. Persona voice picks the shape. */
export function celebrationLine(persona: Persona, kind: "level-up" | "first-unique", fact: string): string {
  const bold = persona.sliders.boldness >= 65;
  const proud = persona.sliders.pride >= 70;
  const coward = persona.quirks.cowardice.on || persona.sliders.boldness <= 35;
  if (kind === "first-unique") {
    if (coward) return `${persona.name}: my hands shake, but ${fact} is mine.`;
    if (bold) return `${persona.name}: ${fact} falls. I meant for that.`;
    if (proud) return `${persona.name}: ${fact} is dead. The line should remember it.`;
    return `${persona.name}: ${fact} is dead. The deeper dark will be easier now.`;
  }
  if (coward) return `${persona.name}: I am still alive at level ${String(levelFor(persona, fact))}.`;
  if (proud) return `${persona.name}: level ${String(levelFor(persona, fact))}. The climb is mine.`;
  if (bold) return `${persona.name}: level ${String(levelFor(persona, fact))}. Onwards.`;
  return `${persona.name}: stronger now, at level ${String(levelFor(persona, fact))}.`;
}

function levelFor(persona: Persona, fact: string): number {
  const match = /level\s+(\d+)/.exec(fact);
  if (match !== null) return Number(match[1]);
  return Math.round(persona.sliders.levelfeel / 5);
}

/** A boast for a first kill of a creature kind. Proud persona, sometimes silent. */
export function firstKillBoast(persona: Persona, race: string, rng: () => number): string | null {
  if (!persona.toggles.firstKillBoasts) return null;
  if (persona.sliders.pride < 60) return null;
  const roll = rng();
  if (!Number.isFinite(roll) || roll > 0.35) return null;
  if (persona.sliders.boldness >= 65) return `${persona.name}: my first ${race}. Not my last.`;
  if (persona.sliders.pride >= 80) return `${persona.name}: my first ${race}. The line should remember that.`;
  return `${persona.name}: first ${race} for me. I will not forget the feel.`;
}

/** Recognition of an artifact the family has carried before. Names the heirloom. */
export function heirloomRecognition(persona: Persona, name: string, where: "floor" | "shop"): string | null {
  if (!persona.toggles.heirlooms) return null;
  if (persona.sliders.pride >= 70) {
    const claim = where === "floor" ? "It is mine by right." : "The shopkeeper will hear from me.";
    return `${persona.name}: ${name}, again. The family has held this. ${claim}`;
  }
  if (persona.sliders.greed >= 70) {
    const claim = where === "floor" ? "I want it back." : "I will buy it.";
    return `${persona.name}: ${name} again. The family has held this before. ${claim}`;
  }
  return `${persona.name}: ${name}, the family's old ${where === "floor" ? "find" : "shelf"}. I want it.`;
}

/** The line for the family motto, called at level-up and near-death. */
export function mottoLine(persona: Persona, motto: Motto | null): string | null {
  if (!persona.toggles.familyMotto || motto === null) return null;
  return `${persona.name}: ${motto.text}`;
}

/** Has-been-cursed-ground line. Persona cautious, superstitious or bold. */
export function cursedGroundLine(persona: Persona, depth: number): string {
  const cautious = persona.sliders.boldness <= 35 || persona.sliders.paranoia >= 65;
  const bold = persona.sliders.pride >= 70 || persona.sliders.boldness >= 65;
  if (bold) return `${persona.name}: back at ${String(depth * 50)} ft, where the family fell. This time we go further.`;
  if (cautious) return `${persona.name}: ${String(depth * 50)} ft. The air feels wrong here.`;
  return `${persona.name}: ${String(depth * 50)} ft. An ancestor died here. I feel the weight of it.`;
}

export function flourishLines(run: Flourishes, persona: Persona | null): string[] {
  if (persona === null) return [];
  return [
    ...(persona.toggles.inheritedSuperstitions ? run.superstitions.map((s) => `${persona.name} distrusts the ${s.name} until its kind is known.`) : []),
    ...(persona.toggles.darkLessons && run.darkLesson ? [`${persona.name} wants a spare torch or extra oil after an ancestor died without light.`] : []),
    ...(persona.toggles.favouredGrounds && run.favouredDepth !== null ? [`${persona.name} favours hunting at ${String(run.favouredDepth * 50)} ft.`] : []),
    ...(persona.toggles.trophies ? run.trophies.map((t) => `${persona.name} keeps a trophy from ${t.unique}: ${t.name} (one item).`) : []),
  ];
}

export function nudgeGrounds(dist: Readonly<Record<string, number>>, offers: readonly { readonly goal: string; readonly risk: number }[], run: Flourishes, view: AgentView, persona: Persona | null, ceiling: number): Record<string, number> {
  const out = { ...dist };
  const target = run.favouredDepth;
  if (!persona?.toggles.favouredGrounds || target === null || missingPreparation(view, target).length > 0) return out;
  const depth = view.player().depth;
  const goal = depth < target ? "descend" : depth === target ? "explore" : null;
  for (const offer of offers) if (offer.goal === goal && offer.risk <= ceiling && out[offer.goal] !== undefined) out[offer.goal] = out[offer.goal]! * 1.1;
  return out;
}

/** A cautious heir lingers less on the depth the family died at; a bold one pushes to go deeper. */
export function nudgeCursedGround(dist: Readonly<Record<string, number>>, family: FamilyFlourishes, view: AgentView, persona: Persona | null, ceiling: number): Record<string, number> {
  const out = { ...dist };
  if (!persona?.toggles.cursedGround || family.cursedDepth === null) return out;
  const depth = view.player().depth;
  if (depth !== family.cursedDepth) return out;
  const cautious = persona.sliders.boldness <= 35 || persona.sliders.paranoia >= 65;
  const bold = persona.sliders.pride >= 70 || persona.sliders.boldness >= 65;
  const mult = cautious ? 0.85 : bold ? 1.1 : 1;
  for (const goal of ["explore", "descend"]) {
    const current = out[goal];
    if (current !== undefined && ceiling > 0) out[goal] = current * mult;
  }
  return out;
}

function record(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
}

function strings(raw: unknown): Superstition[] {
  return Array.isArray(raw) ? raw.slice(-6).flatMap((s) => {
    const r = record(s);
    return typeof r["key"] === "string" && typeof r["name"] === "string" ? [{ key: r["key"].slice(0, 100), name: r["name"].slice(0, 100) }] : [];
  }) : [];
}

function depth(raw: unknown): number | null {
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0 && raw <= 127 ? raw : null;
}

function find(raw: unknown): Find | null {
  const r = record(raw);
  const at = depth(r["depth"]);
  return at !== null && typeof r["value"] === "number" && Number.isFinite(r["value"]) && r["value"] >= 0 && typeof r["name"] === "string"
    ? { depth: at, value: r["value"], name: r["name"].slice(0, 100) } : null;
}

export function readFamilyFlourishes(raw: unknown): FamilyFlourishes {
  const r = record(raw);
  const weapons = Array.isArray(r["ancestralWeapons"]) ? r["ancestralWeapons"].slice(-20).flatMap((w): AncestralWeapon[] => {
    const s = record(w);
    return typeof s["generation"] === "number" && Number.isInteger(s["generation"]) && s["generation"] >= 1 && typeof s["kind"] === "string" && typeof s["kills"] === "number" && Number.isInteger(s["kills"]) && s["kills"] >= 0
      ? [{ generation: s["generation"], kind: s["kind"].slice(0, 20), kills: s["kills"] }]
      : [];
  }) : [];
  const mottoEntry = ((): Motto | null => {
    const m = record(r["motto"]);
    return typeof m["text"] === "string" && typeof m["generation"] === "number" && Number.isInteger(m["generation"]) && m["generation"] >= 1
      ? { text: m["text"].slice(0, 120), generation: m["generation"] }
      : null;
  })();
  return {
    superstitions: strings(r["superstitions"]),
    darkDeaths: typeof r["darkDeaths"] === "number" && Number.isFinite(r["darkDeaths"]) ? Math.max(0, Math.round(r["darkDeaths"])) : 0,
    bestFind: find(r["bestFind"]),
    motto: mottoEntry,
    ancestralWeapons: weapons,
    cursedDepth: depth(r["cursedDepth"]),
  };
}

export function readWays(raw: unknown): Flourishes {
  const r = record(raw);
  const trophies = Array.isArray(r["trophies"]) ? r["trophies"].slice(0, PACK_LIMIT).flatMap((t) => {
    const s = record(t);
    return typeof s["unique"] === "string" && typeof s["name"] === "string" && typeof s["handle"] === "number" && Number.isInteger(s["handle"]) && s["handle"] > 0
      ? [{ unique: s["unique"].slice(0, 100), name: s["name"].slice(0, 100), handle: s["handle"] }]
      : [];
  }) : [];
  const uniqueKills = Array.isArray(r["uniqueKills"]) ? r["uniqueKills"].filter((s): s is string => typeof s === "string").slice(-200).map((s) => s.slice(0, 100)) : [];
  const weaponKillsRaw = record(r["weaponKills"]);
  const weaponKills: Record<string, number> = {};
  for (const [kind, value] of Object.entries(weaponKillsRaw)) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100000 && kind.length > 0 && kind.length <= 20) weaponKills[kind] = value;
  }
  const celebratedLevels = Array.isArray(r["celebratedLevels"]) ? r["celebratedLevels"].filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 100).slice(-50) : [];
  const boastedRaces = Array.isArray(r["boastedRaces"]) ? r["boastedRaces"].filter((s): s is string => typeof s === "string").slice(-100).map((s) => s.slice(0, 60)) : [];
  return {
    superstitions: strings(r["superstitions"]),
    darkLesson: r["darkLesson"] === true,
    favouredDepth: depth(r["favouredDepth"]),
    trophies,
    uniqueKills,
    bestFind: find(r["bestFind"]),
    lastUse: strings([r["lastUse"]])[0] ?? null,
    weaponKills,
    celebratedLevels,
    boastedRaces,
    favouredKind: typeof r["favouredKind"] === "string" && r["favouredKind"].length > 0 && r["favouredKind"].length <= 20 ? r["favouredKind"] : null,
  };
}
