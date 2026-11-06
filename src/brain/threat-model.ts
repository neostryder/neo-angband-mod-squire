import type { AgentView, MonsterView, PlayerView } from "../host-adapter.js";
import { key, neighbours, steps, type Loc } from "../grid.js";
import type { Terrain } from "../terrain.js";
import { shownName } from "../town/needs.js";
import type { CastableSpell } from "./pack.js";
import { starvationDamage } from "./pack.js";
import { neverMoves, standingOnHarm } from "../map.js";

export const THREAT_BANDS = ["an easy kill", "a fair fight", "dangerous", "deadly"] as const;
export type ThreatBand = (typeof THREAT_BANDS)[number];
/** Rough chance a band kills a healthy character that stands and fights it. */
export const BAND_RISK: readonly number[] = [0.03, 0.15, 0.4, 0.75];

type Creature = Pick<MonsterView, "level" | "raceFlags"> & { readonly race?: string };


/** The view's spell inspection bound to it, or undefined when the view has none. */
export function spellInfoOf(view: AgentView): AgentView["spellInfo"] {
  return view.spellInfo?.bind(view);
}

/**
 * A rough ceiling on one round of a creature's melee, from its level alone,
 * for a creature whose blows the character has not seen. A player sizing up a
 * creature does the same: a town mercenary (level 0) can hit for 10, so a 5 hit
 * point mage should not call it an easy kill.
 */
export function roundEstimate(level: number): number {
  return 8 + 3 * level;
}

/**
 * The same ceiling for a townsperson whose blows are unseen. The town's worst
 * ordinary blow is a mercenary's or a battle-scarred veteran's 1d10 or so, and
 * most townspeople beg, touch or steal, so the dungeon's level 0 figure made a
 * beggar look dangerous to a hurt priest.
 */
export const TOWN_ROUND = 6;

/** A level 0 creature met in town, which cannot follow the character far and cannot hit hard. */
export function townsperson(monster: Creature, depth: number): boolean {
  return depth === 0 && monster.level === 0 && !monster.raceFlags.includes("UNIQUE");
}

export function fastUniqueAtLowLevel(monster: MonsterView, player: PlayerView): boolean {
  return player.depth > 0 && player.level <= 4 && monster.raceFlags.includes("UNIQUE") && monster.speed > player.speed;
}

/** Turns spent next to the character without hurting it before a town creature with unseen blows counts as harmless. */
export const HARMLESS_CONTACTS = 3;
/**
 * The race's spell flags, once the character's recall shows the creature casting or breathing.
 * The view reports every flag the race has, learned or not, so before then none of them count.
 * Once one is seen the whole set counts: the recall text names spells but not their flags.
 */
export function knownSpellFlags(view: AgentView, monster: MonsterView): readonly string[] {
  if ((monster.knownSpellFlags?.length ?? 0) > 0) return monster.knownSpellFlags;
  if (monster.spellFlags.length === 0) return monster.spellFlags;
  const text = view.monsterRecall?.(monster.raceIndex)?.text ?? "";
  return /\bmay (?:breathe|cast spells)\b|\(\d+\)/i.test(text) ? monster.spellFlags : [];
}

/* Spells that only move the caster, or call attention, cannot hurt the character. */
const HARMLESS_SPELLS: ReadonlySet<string> = new Set(["BLINK", "TPORT", "HASTE", "HEAL", "SHRIEK"]);

/**
 * A creature that cannot hurt the character, or has had its chances and not:
 * one with no blows and no harmful spell anywhere, or, in town, one whose
 * recall shows no damaging blow or spell that either wanders at random or has
 * stood next to the character for `HARMLESS_CONTACTS` turns without a hit.
 * Farmer Maggot coming into view ended the soak Mage's rest 56 times and sent
 * the Warrior backing away from him at full health. A creature that has hurt
 * the character is never harmless; the caller keeps that record.
 */
export function harmlessKind(monster: MonsterView, view: AgentView, contacts = 0): boolean {
  if (knownSpellFlags(view, monster).some((flag) => !HARMLESS_SPELLS.has(flag))) return false;
  const text = view.monsterRecall?.(monster.raceIndex)?.text ?? "";
  if (/\(\d+\)/.test(text) || /\bmay breathe\b/i.test(text)) return false;
  if (monster.raceFlags.includes("NEVER_BLOW")) return true;
  if (view.player().depth !== 0 || /\(\d+d\d+/.test(text)) return false;
  return contacts >= HARMLESS_CONTACTS || monster.raceFlags.includes("RAND_25") || monster.raceFlags.includes("RAND_50");
}

/**
 * How a creature compares with the character, from their levels. Uniques count
 * one band worse than their level suggests, hit points the creature could take
 * in a round or two outrank levels, and a kind of creature that killed or nearly
 * killed one of this line is treated as dangerous at least.
 */
export function threatIndex(monster: Creature, characterLevel: number, characterHp = Infinity, dreaded: ReadonlySet<string> = new Set(), town = false): number {
  let band: number;
  if (monster.level * 2 <= characterLevel) band = 0;
  else if (monster.level <= characterLevel) band = 1;
  else if (monster.level <= characterLevel + 5) band = 2;
  else band = 3;
  if (monster.raceFlags.includes("UNIQUE")) band = Math.min(3, band + 1);
  const round = town ? TOWN_ROUND : roundEstimate(monster.level);
  if (characterHp <= round / 2) band = 3;
  else if (characterHp <= round) band = Math.max(band, 2);
  if (monster.race !== undefined && dreaded.has(monster.race)) band = Math.max(band, 2);
  return band;
}

export interface ThreatAssessment {
  readonly capability: number;
  readonly lethality: number;
  readonly band: number;
  readonly round: number;
  readonly description: string | null;
  readonly enhanced: boolean;
}

export function knownCapability(text: string, level: number): { round: number; spell: number; breeds: boolean; knownBlows: boolean } {
  const blows = [...text.matchAll(/\b(\d+)d(\d+)(?=[, )])/g)]
    .map((match) => Number(match[1]) * Number(match[2]));
  const spellText = [...text.matchAll(/\bmay (?:breathe|cast spells|[^.]*?)([^.]*?)\.\s{1,2}/gi)]
    .map((match) => match[0]).join(" ");
  const spell = Math.max(0, ...[...spellText.matchAll(/\((\d+)\)/g)].map((match) => Number(match[1])));
  return {
    round: blows.length > 0 ? blows.reduce((sum, damage) => sum + damage, 0) : roundEstimate(level),
    spell,
    breeds: /\bbreeds explosively\b/i.test(text),
    knownBlows: blows.length > 0,
  };
}

export interface DamageEstimate {
  readonly incomplete?: true;
  readonly damage: number;
  readonly status: number;
  readonly uncertainty: number;
}

/** Only observed weak physical breeders qualify; poison, paralysis and magic keep their bounds. */
export function breederBlow(view: AgentView, monster: MonsterView, observed?: ReadonlyMap<string, number>): number | null {
  if (!monster.raceFlags.includes("MULTIPLY") || monster.raceFlags.includes("UNIQUE") || monster.level > 2 || monster.spellFlags.some((flag) => !HARMLESS_SPELLS.has(flag))) return null;
  const text = view.monsterRecall?.(monster.raceIndex)?.text ?? "";
  if (/poison|acid|paraly|confus|hold|drain|may breathe|may cast spells/i.test(text)) return null;
  const blows = [...text.matchAll(/\((\d+)d(\d+)(?:,[^)]*)?\)/g)];
  const damage = blows.length > 0 ? blows.reduce((sum, blow) => sum + Number(blow[1]) * Number(blow[2]), 0) : observed?.get(monster.race);
  return damage !== undefined && damage <= 2 ? damage : null;
}

export interface ThreatFacts {
  readonly observedDamage?: ReadonlyMap<string, number>;
  readonly monsters?: readonly MonsterView[];
  readonly unseenDamage?: number;
  readonly unseenHit?: UnseenHit;
  readonly openedDoor?: Loc;
  readonly lastSeen?: ReadonlyMap<number, number>;
  readonly energy?: SpeedEnergy;
  /** Leave out poison and cut damage, for checks that ask whether a creature can kill the character. */
  readonly creaturesOnly?: boolean;
  readonly expectation?: boolean;
}

export interface UnseenHit {
  readonly direction?: number | undefined;
  readonly grid: Loc;
  readonly damage: number;
  readonly turn: number;
}

export function unseenDamageAt(hit: UnseenHit | undefined, at: Loc, turn: number): number {
  if (hit === undefined || turn < hit.turn || turn - hit.turn > 50) return 0;
  const distance = steps(at, hit.grid);
  if (distance > 5) return 0;
  return hit.damage * (1 - (turn - hit.turn) / 51) / (1 + distance / 3);
}

export type SpeedEnergy = (speed: number) => number;

function energyBounds(speed: number, energy?: SpeedEnergy): { low: number; high: number } {
  if (energy !== undefined) {
    const rate = Math.max(1, energy(speed));
    return { low: rate, high: rate };
  }
  /* A missing host table widens the rate bounds at very slow and fast speeds. */
  return {
    low: speed >= 110 ? 10 + Math.min(20, speed - 110) : speed >= 100 ? 5 : 1,
    high: speed >= 110 ? Math.min(49, 10 + speed - 110) : speed > 100 ? 10 : 5,
  };
}

/** The most game turns one action of the character can take at its speed. */
export function turnsPerAction(speed: number, energy?: SpeedEnergy): number {
  return Math.ceil(100 / energyBounds(speed, energy).low);
}

/** Initiative is absent from the view, so fractional monster actions round up. */
export function monsterActions(monster: MonsterView, player: PlayerView, actions: number, energy?: SpeedEnergy): number {
  return Math.max(1, Math.ceil(actions * energyBounds(monster.speed, energy).high / energyBounds(player.speed, energy).low));
}

export function hitProbability(toHit: number, ac: number): number {
  const chance = Math.max(9, toHit);
  const scaled = Math.trunc(10000 * Math.max(0, chance - Math.trunc(2 * ac / 3)) / chance);
  return Math.max(0, Math.min(1, (1200 + Math.trunc(8300 * scaled / 10000)) / 10000));
}

export function armorDamage(damage: number, ac: number): number {
  return damage - Math.trunc(damage * Math.min(ac, 240) / 400);
}

export function castingMixture(monster: MonsterView, flags: readonly string[], failedSpell = 0): { spell: number; innate: number; melee: number; damageSpell: number; high: number } {
  const rate = (value: NonNullable<MonsterView["knownCombat"]>["spellFrequency"]) => value === null || value === undefined
    ? { mean: 0.1, high: 0.6 }
    : { mean: (value.exact ? value.percent : (Math.max(1, value.percent - 9) + value.percent) / 2) / 100, high: Math.min(1, 2 * value.percent / 100) };
  const innateFlag = (flag: string) => /^(?:BR_|ARROW|SHOT|BOULDER|LASH|SPIT)/.test(flag);
  const s = flags.some((f) => !innateFlag(f)) ? rate(monster.knownCombat?.spellFrequency ?? null) : { mean: 0, high: 0 };
  const i = flags.some(innateFlag) ? rate(monster.knownCombat?.innateFrequency ?? null) : { mean: 0, high: 0 };
  return { spell: s.mean, innate: (1 - s.mean) * i.mean, melee: (1 - s.mean) * (1 - i.mean), damageSpell: s.mean * (1 - failedSpell), high: s.high + (1 - s.high) * i.high };
}

export interface BlowMoments {
  readonly mean: number;
  readonly variance: number;
  readonly upper: number;
  readonly uncertain: boolean;
}

/** Integer damage transforms must precede averaging because armor rounds each roll. */
export function meleeMoments(view: AgentView, monster: MonsterView): BlowMoments | null {
  if (monster.raceFlags.includes("NEVER_BLOW")) return { mean: 0, variance: 0, upper: 0, uncertain: false };
  const blows = monster.knownCombat?.blows;
  if (blows === undefined || blows.length === 0) return null;
  const player = view.player();
  const stats = view.simulateLoadout?.({}) ?? null;
  let mean = 0;
  let variance = 0;
  let upper = 0;
  let uncertain = false;
  for (const blow of blows) {
    const die = blow.damage;
    if (die === null || die.mBonus !== 0 || die.dice * die.sides > 256 || die.dice < 0 || die.sides < 0) {
      const fallback = roundEstimate(monster.level);
      mean += fallback / 2;
      upper += fallback;
      uncertain = true;
      continue;
    }
    let law = new Map<number, number>([[die.base, 1]]);
    for (let n = 0; n < die.dice; n++) {
      const next = new Map<number, number>();
      for (const [x, p] of law) for (let roll = 1; roll <= die.sides; roll++) next.set(x + roll, (next.get(x + roll) ?? 0) + p / die.sides);
      law = next;
    }
    const power = view.blowRules?.effects.get(blow.effect);
    const phys = view.blowRules?.methods.get(blow.method);
    uncertain ||= power === undefined || phys === undefined;
    const toHit = 3 * Math.max(1, monster.level) + (power ?? 40);
    const hit = blow.effect === "NONE" ? 1 : hitProbability(monster.stunned ? Math.trunc(toHit * 0.75) : toHit, player.ac);
    let first = 0;
    let second = 0;
    let ceiling = 0;
    for (const [x, p] of law) {
      const damage = blow.effect === "NONE" ? 0 : blow.effect === "HURT" || blow.effect === "SHATTER" ? armorDamage(x, player.ac)
        : ["ACID", "ELEC", "FIRE", "COLD", "POISON"].includes(blow.effect)
          ? Math.max(phys === false ? 0 : armorDamage(x, player.ac + 50), resistedDamage(x, ({ ELEC: "electricity", POISON: "poison" }[blow.effect] ?? blow.effect.toLowerCase()), player, stats)) : x;
      first += p * damage;
      second += p * damage * damage;
      ceiling = Math.max(ceiling, damage);
    }
    mean += hit * first;
    variance += hit * second - (hit * first) ** 2;
    upper += ceiling;
  }
  return { mean, variance, upper, uncertain };
}

const ELEMENTS: readonly [RegExp, string, "resAcid" | "resElec" | "resFire" | "resCold" | "resPois"][] = [
  [/\bacid\b/i, "ACID", "resAcid"],
  [/\b(?:lightning|electricity)\b/i, "ELEC", "resElec"],
  [/\bfire\b/i, "FIRE", "resFire"],
  [/\b(?:cold|frost)\b/i, "COLD", "resCold"],
  [/\bpoison\b/i, "POIS", "resPois"],
];

export function resistedDamage(damage: number, attack: string, player: PlayerView, stats: ReturnType<NonNullable<AgentView["simulateLoadout"]>>): number {
  const element = ELEMENTS.find(([pattern]) => pattern.test(attack));
  if (element === undefined) return damage;
  const [, code, timer] = element;
  const derived = stats?.before.stats;
  const index = derived?.resistElements.findIndex((name) => name.toUpperCase() === code) ?? -1;
  const resist = index < 0 ? 0 : derived?.resists[index] ?? 0;
  if (resist >= 3) return 0;
  if (resist < 0) damage = Math.ceil(damage * 4 / 3);
  if (resist > 0) damage = Math.ceil(damage / 3);
  if (resist >= 2) damage = Math.ceil(damage / 3);
  /* Without a derive, a timed resistance is the only verified protection. */
  if (player.status[timer] > 0 && resist < 2) damage = Math.ceil(damage / 3);
  return damage;
}

function attackFacts(view: AgentView, monster: MonsterView, stats: ReturnType<NonNullable<AgentView["simulateLoadout"]>>, observed?: ReadonlyMap<string, number>, expectation = false): { melee: number; ranged: number; status: number; uncertain: boolean; bolt: boolean } {
  const player = view.player();
  const text = view.monsterRecall?.(monster.raceIndex)?.text ?? "";
  const weak = breederBlow(view, monster, observed);
  const lowBreeder = monster.level <= 2 && monster.raceFlags.includes("MULTIPLY") && !monster.raceFlags.includes("UNIQUE") && monster.spellFlags.length === 0 && !/poison|acid|paraly|confus|hold|drain|may breathe|may cast spells/i.test(text);
  const fallback = weak ?? (townsperson(monster, player.depth) ? TOWN_ROUND : lowBreeder
    ? Math.min(roundEstimate(monster.level), Math.max(2, monster.level + Math.ceil(player.maxHp * 0.1))) : roundEstimate(monster.level));
  const blows = [...text.matchAll(/([^.(]*?)\((\d+)d(\d+)(?:,[^)]*)?\)/g)];
  const spellFlags = knownSpellFlags(view, monster);
  /* Recall omits method flags, so resistance cannot erase a physical component. */
  let melee = monster.raceFlags.includes("NEVER_BLOW") ? 0 : blows.length === 0 ? fallback : blows.reduce((sum, blow) => {
    const ceiling = Number(blow[2]) * Number(blow[3]);
    return sum + Math.max(ceiling, resistedDamage(ceiling, blow[1]!, player, stats));
  }, 0);
  const magic = /\bmay (?:breathe|cast spells)\b/i.test(text) || spellFlags.length > 0;
  const spells = [...text.matchAll(/([^().]*?)\((\d+)\)/g)];
  let ranged = magic ? Math.max(spells.length === 0 ? fallback : 0, ...spells.map((spell) => resistedDamage(Number(spell[2]), spell[1]!, player, stats))) : 0;
  const learned = meleeMoments(view, monster);
  if (learned !== null) melee = expectation ? learned.mean : learned.upper;
  else if (expectation) melee = blows.length === 0 ? melee / 2 : blows.reduce((sum, blow) => sum + Number(blow[2]) * (Number(blow[3]) + 1) / 2, 0);
  if (expectation && magic) {
    const mix = castingMixture(monster, spellFlags);
    melee *= mix.melee;
    ranged *= mix.spell + mix.innate;
    if (spells.length === 0) ranged /= 2;
  }
  const flags = player.objectFlags;
  const effects = monster.knownCombat?.blows.map((b) => b.effect) ?? [];
  const status = (/\b(?:paraly[sz]|hold)\w*\b/i.test(text) || spellFlags.includes("HOLD") || effects.includes("PARALYZE")) && !flags.includes("FREE_ACT") ? 150
    : (/\bconfus\w*\b/i.test(text) || spellFlags.includes("CONF") || effects.includes("CONFUSE")) && !flags.includes("PROT_CONF") ? 10
      : spellFlags.includes("SLOW") ? 5 : 0;
  return { melee, ranged, status, uncertain: blows.length === 0 || (magic && spells.length === 0) || monster.asleep || !monster.visible, bolt: (/\b(?:bolts?|missiles?|arrows?|shots?)\b/i.test(text) || spellFlags.some((flag) => /^(?:BO_|ARROW|SHOT|MISSILE)/.test(flag))) && !/\bbreathe|\bball|\bstorm/i.test(text) && !spellFlags.some((flag) => /^(?:BR_|BA_)/.test(flag)) };
}

function rangedPath(view: AgentView, from: Loc, to: Loc, bolt: boolean, monsters: readonly MonsterView[], openedDoor?: Loc): { clear: boolean; uncertain: boolean } {
  const distance = steps(from, to);
  const projection = view.projectionPath;
  if (projection !== undefined && key(to) === key(view.player().grid) && openedDoor === undefined) {
    const grids = projection.call(view, from).grids;
    const end = grids.findIndex((grid) => key(grid) === key(from));
    if (end < 0) return { clear: false, uncertain: false };
    const blocked = grids.slice(0, end).some((grid) => {
      const cell = view.cell(grid.x, grid.y);
      return cell !== null && cell.known && !cell.passable || bolt && monsters.some((m) => key(m.grid) === key(grid));
    });
    return { clear: !blocked, uncertain: grids.slice(0, end).some((grid) => view.cell(grid.x, grid.y)?.known !== true) };
  }
  let uncertain = false;
  for (let i = 1; i < distance; i += 1) {
    const x = from.x + (to.x - from.x) * i / distance;
    const y = from.y + (to.y - from.y) * i / distance;
    const choices = [Math.floor(x), Math.ceil(x)].flatMap((a) => [Math.floor(y), Math.ceil(y)].map((b) => ({ x: a, y: b })));
    /* Without a projection origin read, either side of a diagonal can carry fire. */
    const clear = choices.some((at) => {
      const cell = view.cell(at.x, at.y);
      if (cell === null) return false;
      if (!cell.known) uncertain = true;
      else if (!cell.passable && (openedDoor === undefined || key(openedDoor) !== key(at))) return false;
      return !bolt || !monsters.some((m) => key(m.grid) === key(at));
    });
    if (!clear) return { clear: false, uncertain };
  }
  return { clear: true, uncertain };
}

interface ReachPositions extends Map<string, number> {
  incomplete?: true;
}

/** Only reachable attack positions count; a closed door costs an opening action. */
function attackPositions(view: AgentView, monster: MonsterView, at: Loc, actions: number, terrain: Terrain | undefined, monsters: readonly MonsterView[], openedDoor?: Loc, ranged = false, priorActions = 0): ReachPositions {
  const available = actions + priorActions;
  const costs = new Map<string, number>([[key(monster.grid), 0]]);
  const queue: { at: Loc; cost: number }[] = [{ at: monster.grid, cost: 0 }];
  const positions: ReachPositions = new Map<string, number>();
  for (let head = 0; head < queue.length && head < 4000; head += 1) {
    const here = queue[head]!;
    if (ranged || steps(here.at, at) === 1) positions.set(key(here.at), Math.max(positions.get(key(here.at)) ?? 0, Math.min(actions, available - here.cost)));
    if (neverMoves(view, monster) || here.cost >= available - 1) continue;
    for (const next of neighbours(here.at)) {
      if (key(next) === key(at) || priorActions === 0 && !monster.raceFlags.some((flag) => flag === "MOVE_BODY" || flag === "KILL_BODY") && monsters.some((m) => m.id !== monster.id && key(m.grid) === key(next))) continue;
      const cell = view.cell(next.x, next.y);
      if (cell === null) continue;
      let cost = here.cost + 1;
      if (cell.known && !cell.passable && (openedDoor === undefined || key(openedDoor) !== key(next))) {
        const destroys = monster.raceFlags.some((flag) => flag === "PASS_WALL" || flag === "KILL_WALL" || flag === "SMASH_WALL");
        if (!destroys && !(terrain?.isClosedDoor(cell.feat) && monster.raceFlags.includes("BASH_DOOR"))) {
          if (terrain?.isClosedDoor(cell.feat) && monster.raceFlags.includes("OPEN_DOOR")) cost += 1;
          else continue;
        }
      }
      if (cost >= available || cost >= (costs.get(key(next)) ?? Infinity)) continue;
      costs.set(key(next), cost);
      queue.push({ at: next, cost });
    }
  }
  if (queue.length > 4000) {
    positions.incomplete = true;
    for (const near of neighbours(at)) {
      const cell = view.cell(near.x, near.y);
      if (cell !== null && (!cell.known || cell.passable)) positions.set(key(near), actions);
    }
  }
  return positions;
}

/** The ceiling counts HP damage separately from disabling effects and missing facts. */
export function incomingDamage(view: AgentView, at: Loc = view.player().grid, actions = 1, terrain?: Terrain, facts: ThreatFacts = {}): DamageEstimate {
  const player = view.player();
  const monsters = facts.monsters ?? view.monsters().filter((m) => m.visible);
  const occupied = new Map<string, number>();
  const ticks = Math.ceil(actions * 10 / energyBounds(player.speed, facts.energy).low);
  const statusDamage = facts.creaturesOnly === true ? 0 : ticks * ((player.status.poisoned > 0 ? 1 : 0) + (player.status.cut > 200 ? 3 : player.status.cut > 100 ? 2 : player.status.cut > 0 ? 1 : 0) + starvationDamage(view));
  const unseen = facts.unseenHit === undefined ? facts.unseenDamage ?? 0 : unseenDamageAt(facts.unseenHit, at, view.turn());
  let damage = unseen * actions + statusDamage;
  let status = 0;
  let uncertainty = unseen * actions;
  let incomplete = false;
  if (monsters.length === 0) return { damage, status, uncertainty };
  const stats = view.simulateLoadout?.({}) ?? null;
  const melee: { positions: Map<string, number>; damage: number }[] = [];
  for (const monster of monsters) {
    if (monster.visible && steps(monster.grid, at) > 20) continue;
    const count = monsterActions(monster, player, actions, facts.energy);
    const seen = monster.visible ? undefined : facts.lastSeen?.get(monster.id);
    const prior = seen === undefined ? 0 : Math.max(0, Math.ceil((view.turn() - seen) * energyBounds(monster.speed, facts.energy).high / 100));
    const read = attackFacts(view, monster, stats, facts.observedDamage, facts.expectation);
    const phase = facts.expectation === true ? actions * energyBounds(monster.speed, facts.energy).high / energyBounds(player.speed, facts.energy).low / count : 1;
    const positions = attackPositions(view, monster, at, count, terrain, monsters, facts.openedDoor, false, prior);
    incomplete ||= positions.incomplete === true;
    const meleeDamage = Math.max(0, ...positions.values()) * read.melee * phase;
    const path = rangedPath(view, monster.grid, at, read.bolt, monsters, facts.openedDoor);
    let spellDamage = path.clear ? count * read.ranged * phase : 0;
    let rangedStatus = path.clear;
    if (read.ranged > 0 || read.status > 0) {
      const reachable = attackPositions(view, monster, at, count, terrain, monsters, facts.openedDoor, true, prior);
      if (reachable.incomplete === true) {
        incomplete = true;
        spellDamage = Math.max(spellDamage, count * read.ranged * phase);
        rangedStatus = true;
      }
      for (const [position, remaining] of reachable) {
        const [x, y] = position.split(",").map(Number);
        const shot = rangedPath(view, { x: x!, y: y! }, at, read.bolt, monsters, facts.openedDoor);
        if (shot.clear) {
          spellDamage = Math.max(spellDamage, remaining * read.ranged * phase);
          rangedStatus = true;
        }
      }
    }
    if (facts.expectation === true) {
      damage += spellDamage;
      if (meleeDamage > 0) melee.push({ positions, damage: read.melee * phase });
    } else if (spellDamage >= meleeDamage && (spellDamage > 0 || read.status > 0 && path.clear)) damage += spellDamage;
    else if (meleeDamage > 0) melee.push({ positions, damage: read.melee * phase });
    if (rangedStatus && read.ranged > 0 || positions.size > 0) status += read.status;
    if (read.uncertain || path.uncertain) uncertainty += Math.max(meleeDamage, spellDamage, read.status);
  }
  /* An injective assignment stops three corridor attackers occupying one square. */
  const assigned: { positions: Map<string, number>; damage: number }[] = [];
  const place = (index: number, visited: Set<string>): boolean => {
    const attack = assigned[index]!;
    for (const slot of [...attack.positions.keys()].sort((a, b) => attack.positions.get(b)! - attack.positions.get(a)!)) {
      if (visited.has(slot)) continue;
      visited.add(slot);
      const previous = occupied.get(slot);
      if (previous === undefined || place(previous, visited)) {
        occupied.set(slot, index);
        return true;
      }
    }
    return false;
  };
  for (const attack of melee.sort((a, b) => b.damage * Math.max(...b.positions.values()) - a.damage * Math.max(...a.positions.values()))) {
    assigned.push(attack);
    if (!place(assigned.length - 1, new Set())) assigned.pop();
  }
  for (const index of occupied.values()) {
    const attack = assigned[index]!;
    /* The largest reachable count stays conservative after a slot reassignment. */
    damage += attack.damage * Math.max(...attack.positions.values());
  }
  return { damage, status, uncertainty, ...(incomplete ? { incomplete: true as const } : {}) };
}

/** A perception omission clears a memory only when every reachable position is visibly empty. */
export function rememberedCleared(view: AgentView, monster: MonsterView, lastSeen: number, terrain?: Terrain, energy?: SpeedEnergy): boolean {
  if (view.player().status.blind > 0 || view.knownLevel?.() === undefined || view.knownLevel?.() === null) return false;
  if (view.monsters().some((m) => m.visible && m.id === monster.id)) return false;
  const elapsed = Math.max(0, Math.ceil((view.turn() - lastSeen) * energyBounds(monster.speed, energy).high / 100));
  const positions = attackPositions(view, monster, view.player().grid, 1, terrain, view.monsters(), undefined, true, elapsed);
  if (positions.incomplete === true || positions.size === 0 || positions.size >= 4000) return false;
  return [...positions.keys()].every((position) => {
    const [x, y] = position.split(",").map(Number);
    const cell = view.cell(x!, y!);
    return cell?.inView === true && cell.monster !== monster.id;
  });
}

export interface ExposureForecast {
  readonly mean: number;
  readonly upper: number;
  readonly status: number;
  readonly unknown: readonly string[];
}

/** This uses reachable worst positions for memory; it does not claim a calibrated percentile. */
export function forecastExposure(view: AgentView, at: Loc = view.player().grid, actions = 1, terrain?: Terrain, facts: ThreatFacts = {}): ExposureForecast {
  const upper = incomingDamage(view, at, actions, terrain, facts);
  const mean = incomingDamage(view, at, actions, terrain, { ...facts, expectation: true });
  const unknown = new Set<string>();
  if (terrain !== undefined && standingOnHarm(view, terrain, at)) unknown.add("terrain-damage");
  if (upper.incomplete === true || mean.incomplete === true) unknown.add("position-budget");
  for (const monster of facts.monsters ?? view.monsters().filter((m) => m.visible)) {
    if (meleeMoments(view, monster)?.uncertain !== false && !monster.raceFlags.includes("NEVER_BLOW")) unknown.add(/\(\d+d\d+/.test(view.monsterRecall?.(monster.raceIndex)?.text ?? "") ? "blow-mechanics" : "blows");
    const flags = knownSpellFlags(view, monster);
    if (flags.length > 0 && (monster.knownCombat?.spellFrequency === null || monster.knownCombat?.spellFrequency === undefined)) unknown.add("casting-rate");
    if (flags.length > 0 && !/\(\d+\)/.test(view.monsterRecall?.(monster.raceIndex)?.text ?? "")) unknown.add("spell-damage");
    if (!monster.visible) unknown.add("remembered-position");
    if (monster.asleep || monster.knownCombat?.status.includes("held")) unknown.add("wake-or-release");
  }
  if (view.apiVersion.startsWith("2.") && monstersWithTimedEffects(view, facts.monsters)) unknown.add("timed-expiry");
  if (upper.uncertainty > 0 && unknown.size === 0) unknown.add("capability");
  return { mean: Math.min(upper.damage, mean.damage), upper: upper.damage, status: upper.status, unknown: [...unknown] };
}

function monstersWithTimedEffects(view: AgentView, monsters: readonly MonsterView[] = view.monsters()): boolean {
  const status = view.player().status;
  return status.fast > 0 || status.sprint > 0 || status.resAcid > 0 || status.resElec > 0 || status.resFire > 0 || status.resCold > 0 || status.resPois > 0 ||
    monsters.some((monster) => monster.knownCombat?.status.some((effect) => effect === "hasted" || effect === "slowed") === true);
}

export function threatWindow(view: AgentView, at: Loc = view.player().grid, terrain?: Terrain, facts: ThreatFacts = {}): { one: DamageEstimate; two: DamageEstimate } {
  return { one: incomingDamage(view, at, 1, terrain, facts), two: incomingDamage(view, at, 2, terrain, facts) };
}

/** A possible kill improves attack comparisons, while a missed attack keeps its danger. */
export function effectiveAttack(view: AgentView, target: MonsterView, spell?: CastableSpell): { damage: number; failure: number } {
  const player = view.player();
  if (spell !== undefined) {
    const info = view.spellInfo?.(spell.sidx);
    if (info === undefined || info === null || !info.canCastNow) return { damage: 0, failure: 1 };
    const summary = /\baverage of (.+?) damage\b/i.exec(info.description);
    if (summary === null) return { damage: 0, failure: 1 };
    const immune = ELEMENTS.some(([pattern, code]) => pattern.test(summary[1]!) && target.raceFlags.includes(`IM_${code}`));
    const damage = immune ? 0 : [...summary[1]!.matchAll(/\d+(?:\.\d+)?/g)].reduce((sum, match) => sum + Number(match[0]), 0);
    return { damage, failure: Math.max(0.05, info.failChance / 100) };
  }
  if (steps(player.grid, target.grid) > 1 || player.status.afraid > 0) return { damage: 0, failure: 1 };
  const weapon = view.equipment().find((item) => item !== null && /\((\d+)d(\d+)\)/.test(shownName(item) ?? ""));
  const dice = weapon === undefined || weapon === null ? null : /\((\d+)d(\d+)\)/.exec(shownName(weapon) ?? "");
  if (dice === null) return { damage: 0, failure: 1 };
  const damage = Math.max(0, Number(dice[1]) * (Number(dice[2]) + 1) / 2 + player.toDam) * Math.max(1, player.blows / 100);
  return { damage, failure: 0.25 };
}

/**
 * The danger band of one creature, rated on that creature alone. Counting the
 * crowd here made a floating eye look deadly from across the room when wild
 * dogs stood beside it; the crowd belongs in the incoming damage line. A
 * creature whose blows the character has never seen is rated on half its
 * level's damage ceiling, close to an average round, while the incoming damage
 * line keeps the whole ceiling.
 */
export function assessThreat(monster: MonsterView, player: PlayerView, _awake: readonly MonsterView[], view: AgentView, dreaded: ReadonlySet<string> = new Set(), terrain?: Terrain, energy?: SpeedEnergy): ThreatAssessment {
  const town = townsperson(monster, player.depth);
  const uniqueFloor = fastUniqueAtLowLevel(monster, player) ? 3 : 0;
  const recall = view.monsterRecall?.(monster.raceIndex);
  const window = threatWindow(view, player.grid, terrain, { monsters: [monster], ...(energy === undefined ? {} : { energy }) });
  const unknownBlows = !/\(\d+d\d+|\(\d+\)/.test(recall?.text ?? "");
  const scale = unknownBlows ? 0.5 : 1;
  const one = window.one.damage * scale;
  const two = window.two.damage * scale;
  let lethality = player.hp <= one / 2 && one > 0 ? 3
    : player.hp <= one && one > 0 ? 2
      : player.hp <= two && two > 0 ? 1 : 0;
  if (recall === undefined || recall === null) {
    const capability = Math.max(uniqueFloor, threatIndex(monster, player.level, Infinity, dreaded));
    return { capability, lethality, band: Math.max(capability, lethality), round: town ? TOWN_ROUND : roundEstimate(monster.level), description: null, enhanced: false };
  }
  const read = knownCapability(recall.text, monster.level);
  const known = town && !read.knownBlows ? { ...read, round: TOWN_ROUND } : read;
  let capability = Math.max(uniqueFloor, threatIndex(monster, player.level, Infinity, dreaded));
  const knownMagic = /\bmay (?:breathe|cast spells)\b/i.test(recall.text);
  if (known.breeds || known.round >= 16 || knownMagic) capability = Math.max(capability, 1);
  if (known.round >= 32 || known.spell >= 24) capability = Math.max(capability, 2);
  const band = Math.max(capability, lethality);
  const description = known.knownBlows
    ? `${known.round >= 16 ? "hits hard" : "known blows"} for a level ${String(player.level)} ${player.cls.toLowerCase()} (up to ${String(known.round)} a round)`
    : known.spell > 0 ? `known magic up to ${String(known.spell)} damage` : knownMagic ? "known spells or breaths" : known.breeds ? "breeds explosively" : "attacks not yet known";
  return { capability, lethality, band, round: known.round, description, enhanced: true };
}

export function pickAttackSpell(spells: readonly CastableSpell[], info?: AgentView["spellInfo"]): CastableSpell | undefined {
  if (info === undefined) return spells[0];
  let best: CastableSpell | undefined;
  let fallback: CastableSpell | undefined;
  let bestScore = -1;
  for (const spell of spells) {
    const detail = info(spell.sidx);
    if (detail === null) {
      fallback ??= spell;
      continue;
    }
    if (!detail.canCastNow) continue;
    fallback ??= spell;
    /* The engine writes "an average of 7.5 damage" or "an average of 12 fire and 5.5 cold damage". */
    const summary = /\baverage of (.+?) damage\b/i.exec(detail.description);
    if (summary === null) continue;
    const damage = [...summary[1]!.matchAll(/\d+(?:\.\d+)?/g)].reduce((sum, match) => sum + Number(match[0]), 0);
    const score = damage * (1 - detail.failChance / 100);
    if (score > bestScore) {
      best = spell;
      bestScore = score;
    }
  }
  return best ?? fallback;
}

function same(a: Loc, b: Loc): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Whether a creature at `from` could see or fire at `to`, by the same line the
 * damage bound uses. Unknown grids count as open, so a square only reads as out
 * of sight when remembered walls block every line to it.
 */
export function inLineOfFire(view: AgentView, from: Loc, to: Loc): boolean {
  return steps(from, to) <= 1 || rangedPath(view, from, to, false, []).clear;
}

export function clearShot(view: AgentView, target: MonsterView): boolean {
  const { projectionPath } = view;
  if (projectionPath === undefined) return rangedPath(view, view.player().grid, target.grid, true, view.monsters().filter((m) => m.visible)).clear;
  const path = projectionPath.call(view, target.grid).grids;
  const end = path.findIndex((grid) => same(grid, target.grid));
  if (end < 0) return false;
  return path.slice(0, end).every((grid) => {
    const occupant = view.cell(grid.x, grid.y)?.monster;
    return occupant === undefined || occupant <= 0;
  });
}

export function bestBallAim(view: AgentView, monsters: readonly MonsterView[], target: MonsterView, radius = 2): Loc | null {
  const { blastArea, projectionPath } = view;
  if (blastArea === undefined || projectionPath === undefined) return target.grid;
  let best: Loc | null = null;
  let count = -1;
  for (const monster of monsters.filter((m) => m.visible)) {
    const at = monster.grid;
    if (!clearShot(view, monster)) continue;
    const grids = blastArea.call(view, at, radius, 0).grids;
    if (grids.some((grid) => same(grid, view.player().grid))) continue;
    const caught = monsters.filter((m) => m.visible && grids.some((grid) => same(grid, m.grid))).length;
    if (caught > count && caught > 0) {
      best = at;
      count = caught;
    }
  }
  return best;
}
