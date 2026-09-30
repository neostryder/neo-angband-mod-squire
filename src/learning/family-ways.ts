import type { AgentCommand, AgentView, ItemView } from "@rpgm-tools/neo-angband-core";
import type { Persona } from "../persona/persona.js";
import { gearCandidates } from "../gear/compare.js";
import { PACK_LIMIT } from "../brain/items.js";
import { inspecting } from "../brain/threat-model.js";
import { shownName } from "../town/needs.js";
import { missingPreparation } from "../strategy/readiness.js";

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

export interface FamilyFlourishes {
  readonly superstitions: readonly Superstition[];
  readonly darkDeaths: number;
  readonly bestFind: Find | null;
}

export interface Flourishes {
  readonly superstitions: readonly Superstition[];
  readonly darkLesson: boolean;
  readonly favouredDepth: number | null;
  readonly trophies: readonly Trophy[];
  readonly uniqueKills: readonly string[];
  readonly bestFind: Find | null;
  readonly lastUse: Superstition | null;
}

export function emptyFlourishes(): Flourishes {
  return { superstitions: [], darkLesson: false, favouredDepth: null, trophies: [], uniqueKills: [], bestFind: null, lastUse: null };
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
  const enabled = (id: "inheritedSuperstitions" | "darkLessons" | "favouredGrounds") => parent.toggles[id] && heir.toggles[id];
  return { ...emptyFlourishes(),
    superstitions: enabled("inheritedSuperstitions") ? family.superstitions.slice(-Math.ceil(6 * share)).filter(() => share > 0) : [],
    darkLesson: enabled("darkLessons") && family.darkDeaths > 0 && share > 0 && (share === 1 || rng() < share),
    favouredDepth: enabled("favouredGrounds") && family.bestFind !== null && share > 0 && (share === 1 || rng() < share) ? family.bestFind.depth : null,
  };
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
  return { superstitions, darkDeaths: family.darkDeaths + (persona.toggles.darkLessons && dark ? 1 : 0), bestFind };
}

export function emptyFamilyFlourishes(): FamilyFlourishes {
  return { superstitions: [], darkDeaths: 0, bestFind: null };
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
    const text = inspecting(view).inspectItem?.(item.handle)?.text ?? "";
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
  return { superstitions: strings(r["superstitions"]), darkDeaths: typeof r["darkDeaths"] === "number" && Number.isFinite(r["darkDeaths"]) ? Math.max(0, Math.round(r["darkDeaths"])) : 0, bestFind: find(r["bestFind"]) };
}

export function readWays(raw: unknown): Flourishes {
  const r = record(raw);
  const trophies = Array.isArray(r["trophies"]) ? r["trophies"].slice(0, PACK_LIMIT).flatMap((t) => {
    const s = record(t);
    return typeof s["unique"] === "string" && typeof s["name"] === "string" && typeof s["handle"] === "number" && Number.isInteger(s["handle"]) && s["handle"] > 0
      ? [{ unique: s["unique"].slice(0, 100), name: s["name"].slice(0, 100), handle: s["handle"] }] : [];
  }) : [];
  const uniqueKills = Array.isArray(r["uniqueKills"]) ? r["uniqueKills"].filter((s): s is string => typeof s === "string").slice(-200).map((s) => s.slice(0, 100)) : [];
  return { superstitions: strings(r["superstitions"]), darkLesson: r["darkLesson"] === true, favouredDepth: depth(r["favouredDepth"]), trophies, uniqueKills, bestFind: find(r["bestFind"]), lastUse: strings([r["lastUse"]])[0] ?? null };
}
