/** Gear choices use item types and shown names; hidden item fields are not player knowledge. */

import type { AgentView, ItemView, LoadoutSimulation } from "@rpgm-tools/neo-angband-core";

/**
 * The item kinds (tvals) this file sorts gear by, as Angband 4.2 numbers them.
 * A mod folder cannot import the engine's own table at run time, so it is
 * copied here, and a test checks it still matches the engine's.
 */
export const TV = Object.freeze({
  SHOT: 2, ARROW: 3, BOLT: 4, BOW: 5, DIGGING: 6, HAFTED: 7, POLEARM: 8, SWORD: 9,
  BOOTS: 10, GLOVES: 11, HELM: 12, CROWN: 13, SHIELD: 14, CLOAK: 15,
  SOFT_ARMOR: 16, HARD_ARMOR: 17, DRAG_ARMOR: 18, LIGHT: 19, AMULET: 20, RING: 21,
});
import { shownName } from "../town/needs.js";

/** A candidate that can be worn without giving up known cursed gear or ammunition use. */
export interface GearCandidate {
  readonly handle: number;
  readonly name: string;
  readonly score: number;
  readonly unknown: boolean;
  readonly criteria: string;
}

/** The units are a rough turn value, with a small margin against trivial swaps. */
export const GEAR_WEIGHTS = {
  ac: 0.5,
  toHit: 1,
  toDam: 1.5,
  blows: 0.2,
  shots: 0.2,
  speed: 5,
  maxHp: 0.2,
  maxSp: 0.7,
  light: 3,
  resist: 6,
  threshold: 2,
} as const;

const WEAPONS: readonly number[] = [TV.DIGGING, TV.HAFTED, TV.POLEARM, TV.SWORD];
const BODY: readonly number[] = [TV.SOFT_ARMOR, TV.HARD_ARMOR, TV.DRAG_ARMOR];
const HEAD: readonly number[] = [TV.HELM, TV.CROWN];
const WEARABLE: readonly number[] = [...WEAPONS, TV.BOW, TV.BOOTS, TV.GLOVES, ...HEAD, TV.SHIELD, TV.CLOAK, ...BODY, TV.LIGHT, TV.AMULET, TV.RING];

function slot(tval: number): string | null {
  if (WEAPONS.includes(tval)) return "weapon";
  if (BODY.includes(tval)) return "body";
  if (HEAD.includes(tval)) return "head";
  return ({ [TV.BOW]: "bow", [TV.BOOTS]: "boots", [TV.GLOVES]: "gloves", [TV.SHIELD]: "shield", [TV.CLOAK]: "cloak", [TV.LIGHT]: "light", [TV.AMULET]: "amulet", [TV.RING]: "ring" } as Record<number, string>)[tval] ?? null;
}

/** A visible plus pair or armour plus, without the rune marker that says more remains unknown. */
export function fullyKnown(name: string): boolean {
  const marks = [...name.matchAll(/\{([^}]*)\}/g)].flatMap((match) => (match[1] ?? "").toLowerCase().split(/,\s*/));
  return marks.every((mark) => mark === "cursed" || mark === "ignore") &&
    (/\([+-]?\d+,[+-]?\d+\)/.test(name) || /\[\d+,[+-]?\d+\]/.test(name));
}

/**
 * Whether two shown names are the same kind of item, ignoring the count, the
 * article and a light's turns of fuel. Two torches that differ only in fuel
 * are no reason to swap.
 */
export function sameKind(a: string, b: string): boolean {
  const plain = (name: string) => name.toLowerCase()
    .replace(/\(\d+ turns\)/g, "")
    .replace(/^(an?|the|\d+)\s+/, "")
    .replace(/(?:es|s)(?=\s|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain(a) === plain(b);
}

function cursed(name: string): boolean {
  return /\{[^}]*curs[^}]*\}|\bcursed\b/i.test(name);
}

function wornFor(item: ItemView, equipment: readonly (ItemView | null)[]): ItemView | null {
  const kind = slot(item.tval);
  if (kind === null) return null;
  const matching = equipment.filter((worn) => worn !== null && slot(worn.tval) === kind);
  if (kind === "ring" && matching.length < 2) return null;
  return matching[0] ?? null;
}

function keepsLauncher(equipment: readonly (ItemView | null)[], after: readonly (ItemView | null)[], hasAmmo: boolean): boolean {
  if (!hasAmmo || !equipment.some((worn) => worn?.tval === TV.BOW)) return true;
  return after.some((worn) => worn?.tval === TV.BOW);
}

function visibleBase(name: string, tval: number): number | null {
  if (tval === TV.LIGHT && /\(0 turns\)/i.test(name)) return 0;
  if (tval === TV.LIGHT) return /\bLantern\b/i.test(name) ? 2 : /\bTorch\b/i.test(name) ? 1 : null;
  if (tval === TV.BOW) {
    const match = /\(x(\d+)\)/.exec(name);
    return match === null ? null : Number(match[1]);
  }
  if ([...BODY, ...HEAD, TV.BOOTS, TV.GLOVES, TV.SHIELD, TV.CLOAK].includes(tval)) {
    const match = /\[(\d+)(?:,[+-]?\d+)?\]/.exec(name);
    return match === null ? null : Number(match[1]);
  }
  if (WEAPONS.includes(tval)) {
    const match = /\((\d+)d(\d+)\)/.exec(name);
    return match === null ? null : Number(match[1]) * (Number(match[2]) + 1) / 2;
  }
  return null;
}

function visibleValue(name: string, tval: number, base: number): number {
  if ([...BODY, ...HEAD, TV.BOOTS, TV.GLOVES, TV.SHIELD, TV.CLOAK].includes(tval)) {
    return base + Number(/\[\d+,([+-]?\d+)\]/.exec(name)?.[1] ?? 0);
  }
  if (WEAPONS.includes(tval) || tval === TV.BOW) {
    const plus = /\(([+-]?\d+),([+-]?\d+)\)/.exec(name);
    return base + Number(plus?.[2] ?? 0) + Number(plus?.[1] ?? 0) * 0.3;
  }
  return base;
}

function simulated(name: string, handle: number, result: LoadoutSimulation): GearCandidate | null {
  if (result.unresolved.length > 0 || result.placements.length === 0) return null;
  const d = result.delta;
  const w = GEAR_WEIGHTS;
  const resistValue = d.resists.reduce((sum, change) => sum + change, 0);
  const score = d.ac * w.ac + d.toH * w.toHit + d.toD * w.toDam + d.blows * w.blows +
    d.shots * w.shots + d.speed * w.speed + d.maxHp * w.maxHp + d.maxSp * w.maxSp +
    d.light * w.light + resistValue * w.resist;
  if (score <= w.threshold) return null;
  const before = result.before.player;
  const after = result.after.player;
  const changes: string[] = [];
  const note = (label: string, a: number, b: number) => { if (a !== b) changes.push(`${label} ${String(b)} instead of ${String(a)}`); };
  note("armour class", before.ac, after.ac);
  note("to-hit", before.toHit, after.toHit);
  note("to-damage", before.toDam, after.toDam);
  note("blows", before.blows, after.blows);
  note("shots", before.shots, after.shots);
  note("speed", before.speed, after.speed);
  note("maximum hit points", before.maxHp, after.maxHp);
  note("maximum mana", before.maxSp, after.maxSp);
  note("light radius", before.light, after.light);
  result.after.stats.resistElements.forEach((element, i) => {
    const old = result.before.stats.resists[i] ?? 0;
    const now = result.after.stats.resists[i] ?? 0;
    if (old !== now) changes.push(`${element} resistance ${String(now)} instead of ${String(old)}`);
  });
  return { handle, name, score, unknown: false, criteria: `Wear ${name}: ${changes.join(", ")}.` };
}

/** Find wearable upgrades without reading an unfamiliar item's hidden bonuses. */
export function gearCandidates(view: AgentView): GearCandidate[] {
  const equipment = view.equipment();
  const ammoTypes: readonly number[] = [TV.SHOT, TV.ARROW, TV.BOLT];
  const hasAmmo = view.inventory().some((item) => ammoTypes.includes(item.tval));
  const out: GearCandidate[] = [];
  for (const item of view.inventory()) {
    const name = shownName(item);
    if (name === null || !WEARABLE.includes(item.tval) || cursed(name)) continue;
    if (item.tval === TV.LIGHT && /\(0 turns\)/i.test(name)) continue;
    const replaced = wornFor(item, equipment);
    if (replaced !== null && cursed(shownName(replaced) ?? "")) continue;
    if (fullyKnown(name) && view.simulateLoadout !== undefined) {
      const result = view.simulateLoadout({ wield: [{ from: "gear", handle: item.handle }] });
      if (result !== null) {
        if (!keepsLauncher(equipment, result.after.equipment, hasAmmo)) continue;
        if (result.placements.some((place) => place.displaced !== null && cursed(shownName(place.displaced) ?? ""))) continue;
        const candidate = simulated(name, item.handle, result);
        if (candidate !== null) out.push(candidate);
        continue;
      }
    }
    /* Standard 4.2 melee and bow slots do not displace one another. */
    const base = visibleBase(name, item.tval);
    const oldName = replaced === null ? null : shownName(replaced);
    const oldBase = oldName === null || replaced === null ? null : visibleBase(oldName, replaced.tval);
    const visible = base === null ? null : visibleValue(name, item.tval, base);
    const oldVisible = oldBase === null || oldName === null || replaced === null ? null : visibleValue(oldName, replaced.tval, oldBase);
    if (visible !== null && oldVisible !== null && visible < oldVisible) continue;
    if (oldName !== null && sameKind(oldName, name) && base === oldBase) continue;
    const metric = item.tval === TV.LIGHT ? "light radius" : item.tval === TV.BOW ? "launcher multiplier" :
      WEAPONS.includes(item.tval) ? "base damage" : "base armour class";
    const detail = base !== null && oldBase !== null && base > oldBase
      ? ` Its shown ${metric} is ${String(base)} instead of ${String(oldBase)}.` : "";
    out.push({ handle: item.handle, name, score: visible !== null && oldVisible !== null ? visible - oldVisible : 0, unknown: true,
      criteria: `Try on the unknown ${name} to learn what it does.${detail}` });
  }
  return out.sort((a, b) => Number(a.unknown) - Number(b.unknown) || b.score - a.score);
}
