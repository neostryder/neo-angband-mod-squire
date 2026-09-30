/**
 * What the character is carrying that matters in a fight, read from the names
 * the inventory shows.
 *
 * The item view also carries the kind's raw name, which names an unidentified
 * potion's real kind. Squire reads only the shown name, so an unknown flavour
 * stays unknown to it, as it does to the player. An item with no shown name is
 * skipped.
 */

import type { AgentView, ItemView, SpellView } from "@rpgm-tools/neo-angband-core";

/** The food counter's upper edge for the Hungry grade: grade 15 times food_value 100 (player_timed.txt). */
export const HUNGRY_BELOW = 1500;

/** One item Squire can use, with how strong it is within its kind. */
export interface PackItem {
  readonly handle: number;
  readonly name: string;
  /** Higher is stronger. For healing, the potion's rank from Cure Light Wounds up. */
  readonly power: number;
}

/** One spell Squire can cast now. */
export interface CastableSpell {
  readonly sidx: number;
  readonly name: string;
  readonly fail: number;
  readonly mana: number;
  readonly power: number;
}

export interface Pack {
  readonly heal: readonly PackItem[];
  readonly phase: readonly PackItem[];
  readonly teleport: readonly PackItem[];
  readonly oil: readonly PackItem[];
  readonly attackWand: readonly PackItem[];
  readonly ammo: readonly PackItem[];
  readonly food: readonly PackItem[];
  readonly launcher: boolean;
  readonly attackSpell: readonly CastableSpell[];
  readonly healSpell: readonly CastableSpell[];
  readonly escapeSpell: readonly CastableSpell[];
}

/** A visible mapping or detection action available on this turn. */
export type Detection =
  | { readonly kind: "read" | "zap"; readonly handle: number; readonly name: string }
  | { readonly kind: "cast"; readonly sidx: number; readonly name: string };

/** Exact spell names in Angband 4.2 class.txt. */
const DETECTION_SPELLS: readonly string[] = [
  "Find Traps, Doors & Stairs", "Detect Monsters", "Treasure Detection", "Reveal Monsters",
  "Detection", "Detect Evil", "Object Detection",
];

/** A known source only: an unidentified scroll or rod name never identifies its effect. */
export function detectionSources(view: AgentView): Detection[] {
  const out: Detection[] = [];
  const reading = canRead(view);
  for (const item of view.inventory()) {
    const name = shownName(item);
    if (name === null || empty(name)) continue;
    if (reading && /\bScrolls? of Magic Mapping\b/i.test(name)) out.push({ kind: "read", handle: item.handle, name });
    if (/\bRods? of (Treasure Location|Detection|Detect Evil)\b/i.test(name)) out.push({ kind: "zap", handle: item.handle, name });
  }
  for (const spell of reading ? castable(view) : []) {
    if (DETECTION_SPELLS.includes(spell.name)) out.push({ kind: "cast", sidx: spell.sidx, name: spell.name });
  }
  return out;
}

/** Choose the first available source for the current plan. */
export function detectionSource(view: AgentView): Detection | null {
  return detectionSources(view)[0] ?? null;
}

const HEAL_POTIONS: readonly [RegExp, number][] = [
  [/\bPotions? of Life\b/i, 6],
  [/\bPotions? of \*Healing\*/i, 5],
  [/\bPotions? of Healing\b/i, 4],
  [/\bPotions? of Cure Critical Wounds\b/i, 3],
  [/\bPotions? of Cure Serious Wounds\b/i, 2],
  [/\bPotions? of Cure Light Wounds\b/i, 1],
];

const ATTACK_WANDS: readonly [RegExp, number][] = [
  [/\bWands? of Magic Missile\b/i, 1],
  [/\bWands? of Stinking Cloud\b/i, 1],
  [/\bWands? of (Lightning|Frost|Fire|Acid) Bolt\b/i, 2],
  [/\bWands? of Stone to Mud\b/i, 0],
  [/\bWands? of (Lightning|Frost|Fire|Acid) Ball\b/i, 3],
  [/\bWands? of (Drain Life|Annihilation|Dragon's (Flame|Frost|Breath))\b/i, 4],
];

/** Attack spell names across the classes, with a rough strength. */
const ATTACK_SPELLS: readonly [RegExp, number][] = [
  [/^(Magic Missile|Nether Bolt|Stinking Cloud)$/i, 1],
  [/^(Frost Bolt|Fire Bolt|Acid Bolt|Lightning Strike|Orb of Draining|Crush|Spear of Light)$/i, 2],
  [/^(Frost Ball|Fire Ball|Acid Spray|Mana Bolt|Thrust Away|Disenchant|Dispel Evil|Holy Word)$/i, 3],
  [/^(Mana Storm|Meteor Swarm|Rift|Unleash Chaos|Annihilate)$/i, 4],
];

const HEAL_SPELLS: readonly [RegExp, number][] = [
  [/^(Minor Healing|Cure Light Wounds)$/i, 1],
  [/^(Healing|Cure Serious Wounds|Heal)$/i, 3],
];

const ESCAPE_SPELLS: readonly RegExp[] = [/^(Phase Door|Blink|Teleport Self|Portal|Shadow Shift|Warp)$/i];

function shownName(item: ItemView): string | null {
  const name = (item as { readonly name?: unknown }).name;
  return typeof name === "string" && name.length > 0 ? name : null;
}

function rank(name: string, table: readonly [RegExp, number][]): number | null {
  for (const [re, power] of table) if (re.test(name)) return power;
  return null;
}

/** A device or stack reporting it is empty: "(0 charges)". */
function empty(name: string): boolean {
  return /\(0 charges?\)/i.test(name);
}

function byPower<T extends { readonly power: number }>(list: T[]): T[] {
  return list.sort((a, b) => b.power - a.power);
}

/** Spells castable now: learned, not forgotten, affordable and not too likely to fail. */
function castable(view: AgentView): SpellView[] {
  const sp = view.player().sp;
  const out: SpellView[] = [];
  for (const book of view.spellbooks()) {
    for (const spell of book.spells) {
      if (spell.learned && !spell.forgotten && spell.mana <= sp && spell.fail <= 50) out.push(spell);
    }
  }
  return out;
}

/** A spell the character could learn now from a book it carries. */
export interface Studyable {
  readonly handle: number;
  readonly sidx: number;
  readonly spell: string;
}

/**
 * The first spell worth studying: in a carried book (matched by the name the
 * inventory shows), not yet learned, and at or below the character's level.
 * The view does not say how many spells are left to learn. A spell studied
 * at this level that is still unlearned means the game refused ("You cannot
 * learn any new spells"), so nothing more is offered until the level changes.
 */
export function studyable(view: AgentView, tried: ReadonlySet<string> = new Set()): Studyable | null {
  const level = view.player().level;
  if (!canRead(view)) return null;
  const prefix = `${String(level)}:`;
  for (const book of view.spellbooks()) {
    for (const spell of book.spells) if (!spell.learned && tried.has(prefix + String(spell.sidx))) return null;
  }
  const carried = view.inventory().flatMap((item) => {
    const name = shownName(item);
    return name === null ? [] : [{ handle: item.handle, name }];
  });
  for (const book of view.spellbooks()) {
    const item = carried.find((c) => book.name.length > 0 && c.name.includes(book.name));
    if (item === undefined) continue;
    const spells = [...book.spells].sort((a, b) => a.level - b.level);
    for (const spell of spells) {
      if (spell.learned || spell.level > level || tried.has(`${String(level)}:${String(spell.sidx)}`)) continue;
      return { handle: item.handle, sidx: spell.sidx, spell: spell.name };
    }
  }
  return null;
}

/**
 * Whether the character can read a scroll or cast a spell right now. The game
 * refuses both while blind or confused, without using a turn, so offering them
 * then only loops.
 */
export function canRead(view: AgentView): boolean {
  const player = view.player();
  const status = player.status;
  if (status.blind > 0 || status.confused > 0) return false;
  /* The game also refuses reading and casting when the character's own grid is
   * dark. A carried light or a lit room lights it; a necromancer's unlight
   * lets it see there without either. */
  const here = view.cell(player.grid.x, player.grid.y);
  return player.light > 0 || here?.glow === true || player.classFlags.includes("UNLIGHT");
}

/** Read the pack and the spell list. */
export function readPack(view: AgentView): Pack {
  const reading = canRead(view);
  const heal: PackItem[] = [];
  const phase: PackItem[] = [];
  const teleport: PackItem[] = [];
  const oil: PackItem[] = [];
  const attackWand: PackItem[] = [];
  const ammo: PackItem[] = [];
  const food: PackItem[] = [];

  /* Missiles and throwing items live in the quiver, which the pack list leaves
   * out. Games from before the quiver read have no way to show it. */
  const quiver = (view as { quiver?: () => ItemView[] }).quiver?.() ?? [];
  for (const item of [...view.inventory(), ...quiver]) {
    const name = shownName(item);
    if (name === null) continue;
    const entry = (power: number): PackItem => ({ handle: item.handle, name, power });
    const h = rank(name, HEAL_POTIONS);
    if (h !== null) heal.push(entry(h));
    else if (/\bScrolls? of Phase Door\b/i.test(name)) {
      if (reading) phase.push(entry(1));
    } else if (/\bScrolls? of (Teleportation|Teleport Level)\b|\bStaffs? of Teleportation\b/i.test(name) && !empty(name)) {
      if (reading || !/\bScrolls?\b/i.test(name)) teleport.push(entry(/Level/i.test(name) ? 1 : 2));
    } else if (/\bFlasks? of Oil\b/i.test(name)) oil.push(entry(1));
    else if (/\b(Iron Shots?|Pebbles?|Arrows?|Seeker Arrows?|Bolts?|Seeker Bolts?|Mithril Shots?)\b/i.test(name)) {
      ammo.push(entry(1));
    } else if (/\b(Rations? of Food|Slime Molds?|Elvish Waybread|Hard Biscuits?|Honey-cakes?|Flasks? of Whisky|Apples?|Strips? of Venison)\b/i.test(name)) {
      food.push(entry(1));
    } else {
      const w = rank(name, ATTACK_WANDS);
      if (w !== null && w > 0 && !empty(name)) attackWand.push(entry(w));
    }
  }

  /* A launcher fires only its own kind of missile: a sling shots and pebbles,
   * a bow arrows, a crossbow bolts. */
  let firesKind: RegExp | null = null;
  for (const item of view.equipment()) {
    const name = item === null ? null : shownName(item);
    if (name === null || firesKind !== null) continue;
    if (/\bSling\b/i.test(name)) firesKind = /\b(Shots?|Pebbles?)\b/i;
    else if (/\bCrossbow\b/i.test(name)) firesKind = /\bBolts?\b/i;
    else if (/\bBow\b/i.test(name)) firesKind = /\bArrows?\b/i;
  }
  const launcher = firesKind !== null;
  const kind = firesKind;
  const fireable = kind === null ? [] : ammo.filter((item) => kind.test(item.name));

  const attackSpell: CastableSpell[] = [];
  const healSpell: CastableSpell[] = [];
  const escapeSpell: CastableSpell[] = [];
  for (const spell of reading ? castable(view) : []) {
    const entry = (power: number): CastableSpell => ({ sidx: spell.sidx, name: spell.name, fail: spell.fail, mana: spell.mana, power });
    const a = rank(spell.name, ATTACK_SPELLS);
    const hs = rank(spell.name, HEAL_SPELLS);
    if (a !== null) attackSpell.push(entry(a));
    else if (hs !== null) healSpell.push(entry(hs));
    else if (ESCAPE_SPELLS.some((re) => re.test(spell.name))) escapeSpell.push(entry(1));
  }

  return {
    heal: byPower(heal),
    phase,
    teleport: byPower(teleport),
    oil,
    attackWand: byPower(attackWand),
    ammo: fireable,
    food,
    launcher,
    attackSpell: byPower(attackSpell),
    healSpell: byPower(healSpell),
    escapeSpell,
  };
}

/** Whether the character is hungry enough to eat. */
export function hungry(view: AgentView): boolean {
  return view.player().status.food < HUNGRY_BELOW;
}
