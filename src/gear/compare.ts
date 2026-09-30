/** Gear choices use item types and shown names; hidden item fields are not player knowledge. */

import type { AgentView, ItemView, LoadoutSimulation, LoadoutView } from "@rpgm-tools/neo-angband-core";
import { escapeMana, weaponDamage } from "../brain/combat-kit.js";
import { readPack } from "../brain/pack.js";
import { missingPreparation } from "../strategy/readiness.js";

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
  readonly safeUpgrade?: boolean;
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
/** Turns of fuel below which a light is swapped for a fuller one of the same kind. */
const LOW_FUEL_TURNS = 500;
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
    (/\([+-]?\d+,[+-]?\d+\)/.test(name) || /\[\d+,[+-]?\d+\]/.test(name) || /^(?:an?|the|\d+)\s+(?:Rings?|Amulets?) of (?:Free Action|See Invisible|Telepathy)$/i.test(name));
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
  if (tval === TV.LIGHT) return /\bLanterns?\b/i.test(name) ? 2 : /\bTorch(?:es)?\b/i.test(name) ? 1 : null;
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

export function loadoutDamage(loadout: LoadoutView): number | null {
  const weapon = loadout.equipment.find((item) => item !== null && WEAPONS.includes(item.tval));
  if (weapon === undefined || weapon === null) return null;
  return weaponDamage(shownName(weapon) ?? "", loadout.player.toDam, loadout.player.blows / 100);
}

export function loadoutMissileDamage(loadout: LoadoutView, view?: AgentView): number | null {
  const bow = loadout.equipment.find((item) => item?.tval === TV.BOW);
  if (bow === undefined || bow === null) return null;
  const name = shownName(bow) ?? "";
  const kind = /Crossbow/i.test(name) ? TV.BOLT : /Sling/i.test(name) ? TV.SHOT : /Bow/i.test(name) ? TV.ARROW : -1;
  const quiver = (view as { quiver?: () => ItemView[] } | undefined)?.quiver?.() ?? [];
  const ammo = [...(loadout.inventory ?? []), ...quiver].filter((item) => item.tval === kind);
  const mult = loadout.stats.ammoMult > 0 ? loadout.stats.ammoMult : Number(/\(x(\d+)\)/.exec(name)?.[1] ?? 0);
  const bonus = Number(/\([+-]?\d+,([+-]?\d+)\)/.exec(name)?.[1] ?? 0);
  const damages = ammo.flatMap((item) => {
    const damage = weaponDamage(shownName(item) ?? "", bonus, loadout.player.shots / 10);
    return damage === null || mult <= 0 ? [] : [damage * mult];
  });
  return damages.length === 0 ? null : Math.max(...damages);
}

function loadoutView(view: AgentView, loadout: LoadoutView): AgentView {
  return { ...view, player: () => ({ ...loadout.player, sp: Math.min(view.player().sp, loadout.player.maxSp) }),
    equipment: () => [...loadout.equipment], inventory: () => [...(loadout.inventory ?? view.inventory())],
    inspectItem: () => ({ text: loadout.stats.resistElements.filter((_, i) => (loadout.stats.resists[i] ?? 0) > 0).map((element) => `Provides resistance to ${element === "ELEC" ? "lightning" : element}.`).join(" ") }) } as AgentView;
}

/** The same readiness guard covers wearing, acquisition weight and removal. */
export function keepsCapacity(view: AgentView, result: LoadoutSimulation): boolean {
  if (result.unresolved.length > 0) return false;
  const before = result.before.player;
  const after = result.after.player;
  if (result.before.equipment.some((item) => item?.tval === TV.BOW) && !result.after.equipment.some((item) => item?.tval === TV.BOW)) return false;
  if (["FREE_ACT", "SEE_INVIS", "TELEPATHY"].some((flag) => before.objectFlags.includes(flag) && !after.objectFlags.includes(flag))) return false;
  if (before.light > 0 && after.light <= 0 && !after.classFlags.includes("UNLIGHT")) return false;
  if (!result.before.stats.heavyWield && result.after.stats.heavyWield || !result.before.stats.heavyShoot && result.after.stats.heavyShoot) return false;
  const oldDamage = loadoutDamage(result.before);
  const newDamage = loadoutDamage(result.after);
  if (oldDamage !== null && (newDamage === null || oldDamage > 0 && newDamage <= 0)) return false;
  const oldMissile = loadoutMissileDamage(result.before, view);
  const newMissile = loadoutMissileDamage(result.after, view);
  if (oldMissile !== null && (newMissile === null || oldMissile > 0 && newMissile <= 0)) return false;
  const reserve = escapeMana(view);
  const attacks = readPack({ ...view, player: () => ({ ...before, sp: before.maxSp }) }).attackSpell.filter((spell) => spell.fail <= 25);
  const manaFloor = attacks.length === 0 ? reserve : reserve + Math.min(...attacks.map((spell) => spell.mana));
  if (before.maxSp > 0 && (after.maxSp <= 0 || before.maxSp >= manaFloor && after.maxSp < manaFloor)) return false;
  const depth = Math.max(view.player().depth + 1, view.player().maxDepth);
  const has = (loadout: LoadoutView, element: string) => {
    const index = loadout.stats.resistElements.findIndex((name) => name.toUpperCase() === element);
    return index >= 0 && (loadout.stats.resists[index] ?? 0) > 0;
  };
  if (depth > 20) {
    const basics = ["ACID", "ELEC", "FIRE", "COLD"];
    if (has(result.before, "FIRE") && !has(result.after, "FIRE")) return false;
    const required = depth > 25 ? 4 : 3;
    if (depth > 25 && basics.some((element) => has(result.before, element) && !has(result.after, element))) return false;
    if (basics.filter((element) => has(result.before, element)).length >= required && basics.filter((element) => has(result.after, element)).length < required) return false;
    if (depth >= 40 && ["POIS", "CONFU"].some((element) => has(result.before, element) && !has(result.after, element))) return false;
  }
  const missingBefore = new Set(missingPreparation(loadoutView(view, result.before), depth).map((need) => need.reason));
  return !missingPreparation(loadoutView(view, result.after), depth).some((need) => !missingBefore.has(need.reason));
}

/** Displayed capacity takes precedence over the item's price and preferred name. */
export function equipmentValue(result: LoadoutSimulation, view?: AgentView): number {
  const damageBefore = loadoutDamage(result.before);
  const damageAfter = loadoutDamage(result.after);
  const damage = damageBefore === null || damageAfter === null ? 0 : damageAfter - damageBefore;
  const missileBefore = loadoutMissileDamage(result.before, view);
  const missileAfter = loadoutMissileDamage(result.after, view);
  const missile = missileBefore === null || missileAfter === null ? 0 : missileAfter - missileBefore;
  const d = result.delta;
  return (damage + missile) * 4 + d.speed * 5 + d.maxSp * 2 + d.ac * 0.5 + d.toH + d.maxHp * 0.2 + d.light * 3 + d.resists.reduce((sum, value) => sum + value, 0) * 6 +
    result.after.player.objectFlags.filter((flag) => ["FREE_ACT", "SEE_INVIS", "TELEPATHY"].includes(flag) && !result.before.player.objectFlags.includes(flag)).length * 20;
}

function simulated(view: AgentView, name: string, handle: number, result: LoadoutSimulation): GearCandidate | null {
  if (result.unresolved.length > 0 || result.placements.length === 0) return null;
  if (!keepsCapacity(view, result)) return null;
  const score = equipmentValue(result, view);
  if (score <= GEAR_WEIGHTS.threshold) return null;
  const before = result.before.player;
  const after = result.after.player;
  const changes: string[] = [];
  const note = (label: string, a: number, b: number) => { if (a !== b) changes.push(`${label} ${String(b)} instead of ${String(a)}`); };
  const oldDamage = loadoutDamage(result.before);
  const newDamage = loadoutDamage(result.after);
  if (oldDamage !== null && newDamage !== null) note("melee damage per action", oldDamage, newDamage);
  else changes.push("melee damage per action is unknown");
  const oldMissile = loadoutMissileDamage(result.before, view);
  const newMissile = loadoutMissileDamage(result.after, view);
  if (oldMissile !== null && newMissile !== null) note("missile damage per action", oldMissile, newMissile);
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
  const lostFlags = before.objectFlags.filter((flag) => !after.objectFlags.includes(flag));
  const gainedFlags = after.objectFlags.filter((flag) => !before.objectFlags.includes(flag));
  const flagName = (flag: string) => ({ FREE_ACT: "Free Action", SEE_INVIS: "See Invisible", TELEPATHY: "telepathy" } as Record<string, string>)[flag] ?? flag.toLowerCase().replaceAll("_", " ");
  if (gainedFlags.length > 0) changes.push(`gains ${gainedFlags.map(flagName).join(", ")}`);
  if (lostFlags.length > 0) changes.push(`loses ${lostFlags.map(flagName).join(", ")}`);
  const safeUpgrade = lostFlags.length === 0 && result.delta.resists.every((change) => change >= 0) && after.speed >= before.speed && after.maxSp >= before.maxSp && after.maxHp >= before.maxHp && after.ac >= before.ac && after.toHit >= before.toHit && after.shots >= before.shots && (oldDamage === null && newDamage === null || oldDamage !== null && newDamage !== null && newDamage >= oldDamage) && (oldMissile === null && newMissile === null || oldMissile !== null && newMissile !== null && newMissile >= oldMissile);
  return { handle, name, score, unknown: false, safeUpgrade, criteria: `Wear ${name}: ${changes.join(", ")}.` };
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
    /* With no light the character cannot see new ground at all, so any plain
     * light beats none. A light's name shows no combat numbers, which is why it
     * is judged here rather than as unknown gear. */
    if (item.tval === TV.LIGHT && !/\{\?\?\}/.test(name)) {
      const oldLight = replaced === null ? null : shownName(replaced) ?? "";
      const fuel = (shown: string) => Number(/\((\d+) turns\)/i.exec(shown)?.[1] ?? Infinity);
      const safeLight = () => {
        const result = view.simulateLoadout?.({ wield: [{ from: "gear", handle: item.handle }] });
        if (result !== undefined && result !== null) return keepsCapacity(view, result);
        return replaced === null || !view.player().objectFlags.some((flag) => ["FREE_ACT", "SEE_INVIS", "TELEPATHY"].includes(flag));
      };
      if (oldLight === null || fuel(oldLight) === 0) {
        if (!safeLight()) continue;
        out.push({ handle: item.handle, name, score: 100, unknown: false,
          criteria: `Wield ${name}. The character has no light, so it cannot see new ground or creatures.` });
        continue;
      }
      if (sameKind(oldLight, name) && fuel(oldLight) < LOW_FUEL_TURNS && fuel(name) > fuel(oldLight)) {
        if (!safeLight()) continue;
        out.push({ handle: item.handle, name, score: 50, unknown: false,
          criteria: `Wield ${name}. The light in use is nearly out of fuel.` });
        continue;
      }
    }
    if (fullyKnown(name) && view.simulateLoadout !== undefined) {
      const result = view.simulateLoadout({ wield: [{ from: "gear", handle: item.handle }] });
      if (result !== null) {
        if (!keepsLauncher(equipment, result.after.equipment, hasAmmo)) continue;
        if (result.placements.some((place) => place.displaced !== null && cursed(shownName(place.displaced) ?? ""))) continue;
        const candidate = simulated(view, name, item.handle, result);
        if (candidate !== null) out.push(candidate);
        continue;
      }
    }
    /* Standard 4.2 melee and bow slots do not displace one another. */
    const base = visibleBase(name, item.tval);
    /* Without a verified substitution, a trial cannot certify a required protection. */
    if (replaced !== null && (view.player().objectFlags.some((flag) => ["FREE_ACT", "SEE_INVIS", "TELEPATHY"].includes(flag)) || Math.max(view.player().depth, view.player().maxDepth) >= 20)) continue;
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
