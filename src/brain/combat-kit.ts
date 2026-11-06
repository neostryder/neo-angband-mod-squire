/**
 * Combat preparation: the buffs and devices a character may use before a hard
 * fight, and the resist potions it may drink before a creature it knows breathes.
 *
 * Everything here reads names the player can see and the creature recall the
 * game already keeps. A creature's breath is only known from that recall, so a
 * view without it never offers a resist; the same is true of every other read.
 */

import type { AgentView, ItemView, MonsterView } from "../host-adapter.js";
import { shownName } from "../town/needs.js";
import { bestBallAim, clearShot, hitProbability, incomingDamage, type ThreatFacts } from "./threat-model.js";
import { readPack, type PackItem, type CastableSpell } from "./pack.js";
import { steps } from "../grid.js";
import type { Terrain } from "../terrain.js";
import { failBand, targetShare } from "./bands.js";

export interface AttackContext {
  readonly terrain?: Terrain;
  readonly facts?: ThreatFacts;
}

export type AttackKind = "fight" | "shoot" | "throw_oil" | "aim_wand" | "cast_attack";

export interface HpRange {
  readonly low: number;
  readonly mean: number;
  readonly high: number;
  readonly exact: boolean;
  readonly prior: boolean;
}

/** API 2 health bands constrain a population estimate, never an exact monster maximum. */
export function targetHp(target: MonsterView): HpRange {
  const known = target.knownCombat;
  if (known === undefined) return { low: target.hp, mean: target.hp, high: target.hp, exact: true, prior: false };
  const average = known.averageHp ?? 10 + 6 * target.level;
  const [low, high] = { unhurt: [1, 1], somewhat: [0.6, 1], wounded: [0.25, 0.6], badly: [0.1, 0.25], almost: [0, 0.1] }[known.health]!;
  const spread = known.averageHp === null ? 3.5 : 2.5;
  return { low: Math.max(1, Math.ceil(average * 0.25 * low!)), mean: Math.max(1, average * (low! + high!) / 2),
    high: Math.max(1, Math.ceil(average * spread * high!) - (known.health === "unhurt" ? 0 : 1)), exact: false, prior: known.averageHp === null };
}

export interface AttackOutcome {
  readonly kind: AttackKind;
  readonly source: PackItem | CastableSpell | null;
  readonly damage: number | null;
  readonly minimum: number | null;
  readonly failure: number;
  readonly accuracyKnown: boolean;
  readonly kill: boolean;
  readonly manaReserve: number;
  readonly fuelReserve: number;
  readonly hpRange?: HpRange;
  readonly energy?: number;
}

const ATTACK_ELEMENTS: readonly [RegExp, string][] = [
  [/\bacid\b/i, "ACID"], [/\b(?:lightning|electricity)\b/i, "ELEC"], [/\b(?:fire|flame)\b/i, "FIRE"],
  [/\b(?:cold|frost)\b/i, "COLD"], [/\b(?:poison|stinking)\b/i, "POIS"],
];

function describedDamage(text: string, target: MonsterView): number | null {
  const summary = /\baverage of (.+?) damage\b/i.exec(text)?.[1];
  if (summary === undefined) {
    const dice = /\b(?:for\s+)?(?:(\d+)\+)?(\d+)d(\d+)\s+([a-z ]*?)damage\b/i.exec(text);
    if (dice === null) return null;
    if (ATTACK_ELEMENTS.some(([pattern, code]) => pattern.test(dice[4] ?? "") && target.raceFlags.includes(`IM_${code}`))) return 0;
    return Number(dice[1] ?? 0) + Number(dice[2]) * (Number(dice[3]) + 1) / 2;
  }
  const parts = [...summary.matchAll(/(\d+(?:\.\d+)?)\s*([a-z ]*?)(?=\s+and\s+|$)/gi)];
  if (parts.length === 0) return null;
  return parts.reduce((sum, part) => {
    const immune = ATTACK_ELEMENTS.some(([pattern, code]) => pattern.test(part[2] ?? "") && target.raceFlags.includes(`IM_${code}`));
    return sum + (immune ? 0 : Number(part[1]));
  }, 0);
}

/** A displayed damage die and displayed bonuses are knowledge; raw item fields are not. */
export function weaponDamage(name: string, bonus: number, attacks: number): number | null {
  const dice = /\((\d+)d(\d+)\)/.exec(name);
  if (dice === null || !Number.isFinite(attacks) || attacks <= 0) return null;
  const plus = Number(/\([+-]?\d+,([+-]?\d+)\)/.exec(name)?.[1] ?? 0);
  return Math.max(0, Number(dice[1]) * (Number(dice[2]) + 1) / 2 + bonus + plus) * attacks;
}

/** The reserve uses an escape the character can cast now, rather than a class constant. */
export function escapeMana(view: AgentView): number {
  const pack = readPack(view);
  if (view.player().depth === 0 || pack.phase.length > 0 || pack.teleport.length > 0) return 0;
  const costs = pack.escapeSpell.flatMap((spell) => {
    const info = view.spellInfo?.(spell.sidx);
    const fail = info?.failChance ?? spell.fail;
    const mana = info?.mana ?? spell.mana;
    /* A self-wounding escape with no known cost cannot support a reserve claim. */
    if (/^(Shadow Shift|Warp)$/i.test(spell.name) || info?.canCastNow === false || fail > 15 || mana > view.player().sp) return [];
    return [mana];
  });
  return costs.length === 0 ? 0 : Math.min(...costs);
}

export function attackOutcome(view: AgentView, target: MonsterView, kind: AttackKind, source: PackItem | CastableSpell | null = null): AttackOutcome {
  const player = view.player();
  let damage: number | null = null;
  let minimum: number | null = null;
  let failure = 0.5;
  let accuracyKnown = false;
  const text = source === null ? "" : "sidx" in source
    ? view.spellInfo?.(source.sidx)?.description ?? ""
    : view.inspectItem?.(source.handle)?.text ?? "";
  if (kind === "fight") {
    const weapon = view.equipment().find((item) => item !== null && [6, 7, 8, 9].includes(item.tval));
    if (steps(player.grid, target.grid) <= 1 && player.status.afraid === 0 && weapon !== undefined && weapon !== null) {
      const name = shownName(weapon) ?? "";
      damage = player.blows < 100 ? null : weaponDamage(name, player.toDam, player.blows / 100);
      const dice = /\((\d+)d\d+\)/.exec(name);
      if (dice !== null && player.blows > 0) minimum = Math.max(0, Number(dice[1]) + player.toDam + Number(/\([+-]?\d+,([+-]?\d+)\)/.exec(name)?.[1] ?? 0)) * Math.floor(player.blows / 100);
    }
  } else if (kind === "cast_attack" && source !== null && "sidx" in source) {
    const info = view.spellInfo?.(source.sidx);
    failure = Math.max(0, (info?.failChance ?? source.fail) / 100);
    accuracyKnown = true;
    if (info?.canCastNow === false || (info?.mana ?? source.mana) > player.sp) failure = 1;
    damage = describedDamage(text, target);
    const element = ATTACK_ELEMENTS.find(([pattern]) => pattern.test(source.name));
    if (element !== undefined && !ATTACK_ELEMENTS.some(([pattern]) => pattern.test(text)) && target.raceFlags.includes(`IM_${element[1]}`)) damage = minimum = 0;
    const dice = /\b(\d+)d(\d+)\b/.exec(text);
    if (dice !== null && damage !== null) minimum = Math.min(damage, Number(dice[1]));
    if (/(?:ball|orb|cloud|storm)/i.test(source.name) && view.blastArea !== undefined && view.projectionPath !== undefined) {
      const aim = bestBallAim(view, view.monsters().filter((monster) => monster.visible && !monster.asleep), target);
      if (aim === null) failure = 1;
      else if (!view.blastArea!(aim, 2).grids.some((grid) => grid.x === target.grid.x && grid.y === target.grid.y)) damage = minimum = null;
    }
  } else if (source !== null && "handle" in source) {
    damage = describedDamage(text, target);
    if (kind === "shoot" && damage === null) {
      const bow = view.equipment().find((item) => item !== null && item.tval === 5);
      const name = bow === undefined || bow === null ? "" : shownName(bow) ?? "";
      const mult = /\(x(\d+)\)/.exec(name);
      const bowBonus = Number(/\([+-]?\d+,([+-]?\d+)\)/.exec(name)?.[1] ?? 0);
      const base = weaponDamage(source.name, bowBonus, player.shots / 10);
      damage = mult === null || base === null ? null : base * Number(mult[1]);
    }
    if (kind === "throw_oil") {
      /* Ordinary oil explodes for three times 1d4, including against fire immunity. */
      if (damage === null) { damage = 7.5; minimum = 3; }
    }
    const chance = /(?:chance of (?:hitting|success)|(?:hit|success) (?:chance|rate))[^\d]*([\d.]+)%/i.exec(text);
    if (chance !== null) { failure = 1 - Number(chance[1]) / 100; accuracyKnown = true; }
    const element = ATTACK_ELEMENTS.find(([pattern]) => pattern.test(source.name));
    if (element !== undefined && target.raceFlags.includes(`IM_${element[1]}`)) damage = minimum = 0;
  }
  const item = source !== null && "handle" in source ? view.inspectItem?.(source.handle)?.combat : null;
  if (kind === "shoot" && item?.damage !== null && item?.damage !== undefined) damage = item.damage.normal;
  if (kind === "fight") {
    const weapon = view.equipment().find((w) => w !== null && [6, 7, 8, 9].includes(w.tval));
    const combat = weapon === null || weapon === undefined ? null : view.inspectItem?.(weapon.handle)?.combat;
    if (combat?.damage !== null && combat?.damage !== undefined && steps(player.grid, target.grid) <= 1) damage = combat.damage.normal;
  }
  if (kind !== "fight" && !clearShot(view, target) && !(kind === "cast_attack" && /ball|orb|cloud|storm/i.test(source?.name ?? ""))) failure = 1;
  const targetAc = /(?:armor|armour)(?: rating)?(?: of|:)\s*(\d+)/i.exec(view.monsterRecall?.(target.raceIndex)?.text ?? "");
  if (targetAc !== null && kind !== "cast_attack") {
    const skill = player.skills[kind === "fight" ? 6 : kind === "shoot" ? 7 : 8];
    if (skill !== undefined) {
      const shownHit = (name: string) => Number(/\(([+-]?\d+),[+-]?\d+\)/.exec(name)?.[1] ?? 0);
      const weapon = view.equipment().find((w) => w !== null && [6, 7, 8, 9].includes(w.tval));
      const bow = view.equipment().find((w) => w?.tval === 5);
      const gearHit = kind === "fight" ? shownHit(weapon === null || weapon === undefined ? "" : shownName(weapon) ?? "")
        : kind === "shoot" ? shownHit(source?.name ?? "") + shownHit(bow === null || bow === undefined ? "" : shownName(bow) ?? "") : shownHit(source?.name ?? "");
      const chance = kind === "throw_oil" ? Math.trunc(1.5 * skill) + 3 * gearHit - steps(player.grid, target.grid)
        : skill + 3 * (player.toHit + gearHit) - (kind === "shoot" ? steps(player.grid, target.grid) : 0);
      failure = Math.max(failure >= 1 ? 1 : 0, 1 - hitProbability(chance, Number(targetAc[1])));
      accuracyKnown = true;
    }
  }
  const hpRange = targetHp(target);
  const blowEnergy = Math.max(1, Math.trunc(10000 / Math.max(1, player.blows)));
  const energy = kind === "shoot" ? Math.max(1, Math.trunc(1000 / Math.max(10, player.shots))) : kind === "fight" && player.blows >= 100 ? Math.floor(100 / blowEnergy) * blowEnergy : 100;
  /* Extra shots improve sustained damage, but one firing command releases only one missile. */
  const killingDamage = kind === "shoot" && damage !== null ? player.shots > 0 ? damage * 10 / player.shots : null : damage;
  return { kind, source, damage, minimum, failure, accuracyKnown, hpRange, energy, kill: killingDamage !== null && hpRange.high > 0 && killingDamage >= hpRange.high,
    manaReserve: escapeMana(view), fuelReserve: !player.objectFlags.includes("NO_FUEL") && !player.classFlags.includes("UNLIGHT") && view.equipment().some((item) => item !== null && /\bLantern\b/i.test(shownName(item) ?? "")) ? 1 : 0 };
}

export function attackAllowed(view: AgentView, target: MonsterView, outcome: AttackOutcome, context: AttackContext = {}): boolean {
  if (outcome.failure >= 1 || outcome.damage === 0) return false;
  const source = outcome.source;
  const hp = targetHp(target);
  const removesDanger = outcome.minimum !== null && hp.high > 0 && outcome.minimum >= hp.high && outcome.failure <= 0.25 &&
    incomingDamage(view, view.player().grid, 1, context.terrain, { ...context.facts, monsters: (context.facts?.monsters ?? view.monsters().filter((monster) => monster.visible)).filter((monster) => monster.id !== target.id) }).damage < view.player().hp;
  if (removesDanger) return true;
  if (outcome.kind === "cast_attack" && source !== null && "sidx" in source) {
    const mana = view.spellInfo?.(source.sidx)?.mana ?? source.mana;
    return view.player().sp - mana >= outcome.manaReserve;
  }
  if (outcome.kind === "throw_oil" && outcome.fuelReserve > 0) {
    return oilCount(view) > outcome.fuelReserve;
  }
  if (outcome.kind === "aim_wand" && source !== null && "handle" in source) {
    const text = view.inspectItem?.(source.handle)?.text ?? "";
    const charges = /\((\d+) charges?\)/i.exec(source.name);
    if (/\bteleport(?:s|ation)?\s+(?:you|the player)\b/i.test(text) && (charges === null || Number(charges[1]) <= 1)) return false;
  }
  return true;
}

function oilCount(view: AgentView): number {
  const quiver = (view as { quiver?: () => ItemView[] }).quiver?.() ?? [];
  return [...view.inventory(), ...quiver].reduce((sum, item) => sum + (/\bFlasks? of Oil\b/i.test(shownName(item) ?? "") ? item.number : 0), 0);
}

export function attackOptions(view: AgentView, target: MonsterView, kind: AttackKind, context: AttackContext = {}): AttackOutcome[] {
  const pack = readPack(view);
  const sources = kind === "fight" ? [null] : kind === "shoot" ? pack.ammo : kind === "throw_oil" ? pack.oil : kind === "aim_wand" ? pack.attackWand : pack.attackSpell.map((spell) => {
    const info = view.spellInfo?.(spell.sidx);
    return info === undefined || info === null ? spell : { ...spell, mana: info.mana, fail: info.failChance };
  });
  return sources.map((source) => attackOutcome(view, target, kind, source)).filter((outcome) => attackAllowed(view, target, outcome, context)).sort((a, b) =>
    Number(b.kill) - Number(a.kill) || (b.damage === null ? -1 : b.damage * (1 - b.failure)) - (a.damage === null ? -1 : a.damage * (1 - a.failure)) || a.failure - b.failure);
}

/** The attack in numbers, each beside its band; with the target given, damage is also put against its health. */
export function attackDescription(outcome: AttackOutcome, view: AgentView, target?: MonsterView): string {
  const expected = outcome.damage === null ? null : Math.round(outcome.damage * (1 - outcome.failure) * 10) / 10;
  const damage = expected === null ? "Damage per action is unknown" : `Estimated damage per action is ${String(expected)}${target === undefined ? "" : ` (${targetShare(expected, target.hp)})`}`;
  const miss = Math.round(outcome.failure * 100);
  const accuracy = outcome.accuracyKnown ? `${String(miss)}% failure or miss chance (${failBand(miss)})` : "accuracy is unknown; the estimate discounts damage by half";
  const source = outcome.source;
  const spendsMana = outcome.kind === "cast_attack" && source !== null && "sidx" in source && view.player().sp - (view.spellInfo?.(source.sidx)?.mana ?? source.mana) < outcome.manaReserve;
  const spendsFuel = outcome.kind === "throw_oil" && outcome.fuelReserve > 0 && oilCount(view) <= outcome.fuelReserve;
  return ` ${damage}; ${accuracy}. ${outcome.kill ? `A hit could kill the ${target?.race ?? "target"} now.` : "An immediate kill is not established."} The escape reserve is ${String(outcome.manaReserve)} mana and ${String(outcome.fuelReserve)} fuel units.${spendsMana || spendsFuel ? ` This immediate killing attempt spends the ${spendsMana ? "escape mana" : "fuel"} reserve.` : ""}`;
}

/** Partial cures cannot promise an unknown API 2 timer has expired. */
export function healingStatus(view: AgentView, source: PackItem | CastableSpell): ReturnType<AgentView["player"]>["status"] {
  const status = { ...view.player().status };
  if (!("handle" in source)) return status;
  const name = source.name;
  if (/Cure Light Wounds/i.test(name)) {
    status.blind = 0;
    if (!view.apiVersion.startsWith("2.")) {
      status.cut = Math.max(0, status.cut - 20);
      status.confused = Math.max(0, status.confused - 20);
    }
  } else if (/Cure Serious Wounds/i.test(name)) {
    status.blind = status.cut = status.confused = 0;
  } else if (/Cure Critical Wounds|\*?Healing\*?|\bLife\b|Curing/i.test(name)) {
    status.blind = status.cut = status.confused = status.poisoned = status.stun = 0;
  }
  return status;
}

/** One usable object or spell, with how the game consumes it. */
export type CombatUse =
  | { readonly how: "quaff" | "read"; readonly handle: number; readonly name: string }
  | { readonly how: "cast"; readonly sidx: number; readonly name: string }
  | { readonly how: "staff" | "rod"; readonly handle: number; readonly name: string }
  | { readonly how: "activate"; readonly handle: number; readonly name: string };

/** The lower healing bound uses visible effect text before the standard cure fallback. */
export function healingAmount(view: AgentView, source: PackItem | CastableSpell | CombatUse): number {
  const text = "sidx" in source ? view.spellInfo?.(source.sidx)?.description ?? ""
    : view.inspectItem?.(source.handle)?.text ?? "";
  const fixed = /\b(?:heal\w*|restor\w*)\s+(?:you\s+for\s+|at least\s+)?((?:\d+\+)?\d+d\d+|\d+)\s+(?:hit\s?points|HP)\b(?:\s+\(or\s+(\d+)%, whichever is greater\))?/i.exec(text);
  const fraction = /\b(\d+)%\s+of\s+(?:your\s+)?(?:missing hit points|wounds)\b/i.exec(text);
  const missing = Math.max(0, view.player().maxHp - view.player().hp);
  const dice = fixed === null ? null : /^(?:(\d+)\+)?(\d+)d\d+$/.exec(fixed[1]!);
  const minimum = dice === null ? Number(fixed?.[1] ?? 0) : Number(dice[1] ?? 0) + Number(dice[2]);
  if (fixed !== null || fraction !== null) return Math.min(missing, Math.max(minimum, Math.floor(missing * Number(fraction?.[1] ?? fixed?.[2] ?? 0) / 100)));
  if ("sidx" in source || !/\bPotions? of\b/i.test(source.name)) return 0;
  const fallback = /\bLife\b|\*Healing\*/i.test(source.name) ? [1200, 0]
    : /\bHealing\b/i.test(source.name) ? [300, 35]
      : /\bCritical\b/i.test(source.name) ? [30, 25]
        : /\bSerious\b/i.test(source.name) ? [25, 20] : [15, 15];
  return Math.min(missing, Math.max(fallback[0]!, Math.floor(missing * fallback[1]! / 100)));
}

export function healingPotion(view: AgentView, incoming: number): PackItem | undefined {
  const potions = [...readPack(view).heal].sort((a, b) => a.power - b.power);
  const hp = view.player().hp;
  return potions.find((potion) => {
    const amount = healingAmount(view, potion);
    return hp + amount > incoming && (amount >= incoming || incoming >= hp && amount > incoming / 3);
  }) ?? potions.at(-1);
}

export function healingSpell(view: AgentView, incoming: number): CastableSpell | undefined {
  const spells = readPack(view).healSpell.flatMap((spell) => {
    const info = view.spellInfo?.(spell.sidx);
    if (info !== undefined && info !== null && (!info.canCastNow || info.mana > view.player().sp)) return [];
    const known = info === undefined || info === null ? spell : { ...spell, fail: info.failChance, mana: info.mana };
    return known.fail <= 15 ? [known] : [];
  });
  return spells.find((spell) => {
    const amount = healingAmount(view, spell);
    return view.player().hp + amount > incoming && (amount >= incoming || incoming >= view.player().hp && amount > incoming / 3);
  }) ?? spells[0];
}

const BUFF_ITEMS: readonly [RegExp, "quaff" | "read"][] = [
  [/\bPotions? of (Heroism|Berserk Strength|Speed)\b/i, "quaff"],
  [/\bScrolls? of (Blessing|Heroism)\b/i, "read"],
];

const BUFF_SPELLS: readonly RegExp[] = [/^(Heroism|Blessing|Berserk Strength|Haste Self)$/i];

const CURING: readonly [RegExp, "staff" | "rod"][] = [
  [/\bStaffs? of Curing\b/i, "staff"],
  [/\bRods? of Curing\b/i, "rod"],
];

function held(view: AgentView): { readonly item: ItemView; readonly name: string }[] {
  return view.inventory().flatMap((item) => {
    const name = shownName(item);
    return name === null ? [] : [{ item, name }];
  });
}

/** A spell the character can cast right now. */
function castable(view: AgentView): { readonly sidx: number; readonly name: string }[] {
  const sp = view.player().sp;
  const out: { sidx: number; name: string }[] = [];
  for (const book of view.spellbooks()) {
    for (const spell of book.spells) {
      if (spell.learned && !spell.forgotten && spell.mana <= sp && spell.fail <= 50) out.push({ sidx: spell.sidx, name: spell.name });
    }
  }
  return out;
}

/** Whether the character is already under one of the combat buffs. */
function alreadyBuffed(view: AgentView): boolean {
  const s = view.player().status;
  return s.hero > 0 || s.shero > 0 || s.blessed > 0 || s.fast > 0 || s.sprint > 0;
}

/** A heroism, blessing, berserk or speed source the character is not already under. */
export function buffUse(view: AgentView): CombatUse | null {
  if (alreadyBuffed(view)) return null;
  for (const { item, name } of held(view)) {
    const found = BUFF_ITEMS.find(([pattern]) => pattern.test(name));
    if (found !== undefined) return { how: found[1], handle: item.handle, name };
  }
  for (const spell of castable(view)) {
    if (BUFF_SPELLS.some((pattern) => pattern.test(spell.name))) return { how: "cast", sidx: spell.sidx, name: spell.name };
  }
  return null;
}

/** A resist potion or scroll the character can drink before a known breather. */
export function resistUse(view: AgentView): CombatUse | null {
  for (const { item, name } of held(view)) {
    if (/\bPotions? of Resist/i.test(name)) return { how: "quaff", handle: item.handle, name };
    if (/\bScrolls? of Resist/i.test(name)) return { how: "read", handle: item.handle, name };
  }
  return null;
}

/** A staff or rod of Curing, which restores hit points and closes a cut. */
export function deviceHealUse(view: AgentView): CombatUse | null {
  for (const { item, name } of held(view)) {
    if (item.timeout > 0 || /\(0 charges?\)/i.test(name)) continue;
    const found = CURING.find(([pattern]) => pattern.test(name));
    if (found !== undefined) return { how: found[1], handle: item.handle, name };
  }
  return null;
}

/** A carried object with an activation that is ready to use. */
export function activationUse(view: AgentView): CombatUse | null {
  for (const { item, name } of held(view)) {
    if (item.activation && item.timeout <= 0) return { how: "activate", handle: item.handle, name };
  }
  return null;
}

/** A visible, awake creature whose recall says it breathes, and the element. */
export function breatherInSight(view: AgentView, monsters: readonly MonsterView[]): { readonly race: string; readonly element: string | null } | null {
  const recall = view.monsterRecall;
  if (recall === undefined) return null;
  for (const monster of monsters) {
    if (!monster.visible || monster.asleep) continue;
    const info = recall.call(view, monster.raceIndex);
    if (info === null || info === undefined || !/\bbreathe/i.test(info.text)) continue;
    const element = /\bbreathe[s]?\s+([a-z]+)/i.exec(info.text)?.[1] ?? null;
    return { race: monster.race, element };
  }
  return null;
}
