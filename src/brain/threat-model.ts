import type { AgentView, MonsterView, PlayerView } from "@rpgm-tools/neo-angband-core";
import { key, neighbours, steps, type Loc } from "../grid.js";
import type { Terrain } from "../terrain.js";
import { shownName } from "../town/needs.js";
import type { CastableSpell } from "./pack.js";

export const THREAT_BANDS = ["an easy kill", "a fair fight", "dangerous", "deadly"] as const;
export type ThreatBand = (typeof THREAT_BANDS)[number];
/** Rough chance a band kills a healthy character that stands and fights it. */
export const BAND_RISK: readonly number[] = [0.03, 0.15, 0.4, 0.75];

type Creature = Pick<MonsterView, "level" | "raceFlags"> & { readonly race?: string };

/** What one spell does and costs, as the engine's spell inspection reports it. */
export interface SpellInfoRead {
  readonly description: string;
  readonly mana: number;
  readonly failChance: number;
  readonly canCastNow: boolean;
}

interface GridList {
  readonly grids: readonly Loc[];
}

/**
 * The engine's read-only inspection calls this module uses. They are declared
 * here as well as in the engine because the engine version this repository
 * builds against predates them; each is optional, and every caller falls back
 * to the older behavior when the view lacks it.
 */
export interface InspectingView {
  monsterRecall?(raceIndex: number): { readonly text: string } | null;
  spellInfo?(spellIndex: number): SpellInfoRead | null;
  projectionPath?(to: Loc): GridList;
  blastArea?(to: Loc, radius: number, arc?: number): GridList;
  inspectItem?(ref: ItemRef): InspectText | null;
}

/** An item inspection's text, as newer engines return it. */
export interface InspectText {
  readonly token: { readonly epoch: number; readonly revision: number };
  readonly title: string;
  readonly text: string;
}

/** Where an inspected item is: on the floor at a grid, or elsewhere by the engine's own reference. */
export type ItemRef = number | { readonly floor: { readonly x: number; readonly y: number; readonly index: number } };

export function inspecting(view: AgentView): AgentView & InspectingView {
  return view as AgentView & InspectingView;
}

/** The view's spell inspection bound to it, or undefined when the view has none. */
export function spellInfoOf(view: AgentView): InspectingView["spellInfo"] {
  const v = inspecting(view);
  return v.spellInfo?.bind(v);
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
  return player.depth > 0 && player.level <= 3 && monster.raceFlags.includes("UNIQUE") && monster.speed > player.speed;
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
  readonly damage: number;
  readonly status: number;
  readonly uncertainty: number;
}

export interface ThreatFacts {
  readonly monsters?: readonly MonsterView[];
  readonly unseenDamage?: number;
  readonly openedDoor?: Loc;
  readonly lastSeen?: ReadonlyMap<number, number>;
  readonly energy?: SpeedEnergy;
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

/** Initiative is absent from the view, so fractional monster actions round up. */
export function monsterActions(monster: MonsterView, player: PlayerView, actions: number, energy?: SpeedEnergy): number {
  return Math.max(1, Math.ceil(actions * energyBounds(monster.speed, energy).high / energyBounds(player.speed, energy).low));
}

const ELEMENTS: readonly [RegExp, string, keyof PlayerView["status"]][] = [
  [/\bacid\b/i, "ACID", "resAcid"],
  [/\b(?:lightning|electricity)\b/i, "ELEC", "resElec"],
  [/\bfire\b/i, "FIRE", "resFire"],
  [/\b(?:cold|frost)\b/i, "COLD", "resCold"],
  [/\bpoison\b/i, "POIS", "resPois"],
];

function resistedDamage(damage: number, attack: string, player: PlayerView, stats: ReturnType<NonNullable<AgentView["simulateLoadout"]>>): number {
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

function attackFacts(view: AgentView, monster: MonsterView, stats: ReturnType<NonNullable<AgentView["simulateLoadout"]>>): { melee: number; ranged: number; status: number; uncertain: boolean; bolt: boolean } {
  const player = view.player();
  const text = inspecting(view).monsterRecall?.(monster.raceIndex)?.text ?? "";
  const fallback = townsperson(monster, player.depth) ? TOWN_ROUND : roundEstimate(monster.level);
  const blows = [...text.matchAll(/([^.(]*?)\((\d+)d(\d+)(?:,[^)]*)?\)/g)];
  /* Recall omits method flags, so resistance cannot erase a physical component. */
  const melee = monster.raceFlags.includes("NEVER_BLOW") ? 0 : blows.length === 0 ? fallback : blows.reduce((sum, blow) => {
    const ceiling = Number(blow[2]) * Number(blow[3]);
    return sum + Math.max(ceiling, resistedDamage(ceiling, blow[1]!, player, stats));
  }, 0);
  const magic = /\bmay (?:breathe|cast spells)\b/i.test(text) || monster.spellFlags.length > 0;
  const spells = [...text.matchAll(/([^().]*?)\((\d+)\)/g)];
  const ranged = magic ? Math.max(spells.length === 0 ? fallback : 0, ...spells.map((spell) => resistedDamage(Number(spell[2]), spell[1]!, player, stats))) : 0;
  const flags = player.objectFlags;
  const status = (/\b(?:paraly[sz]|hold)\w*\b/i.test(text) || monster.spellFlags.includes("HOLD")) && !flags.includes("FREE_ACT") ? 150
    : (/\bconfus\w*\b/i.test(text) || monster.spellFlags.includes("CONF")) && !flags.includes("PROT_CONF") ? 10
      : monster.spellFlags.includes("SLOW") ? 5 : 0;
  return { melee, ranged, status, uncertain: blows.length === 0 || (magic && spells.length === 0) || monster.asleep || !monster.visible, bolt: (/\b(?:bolts?|missiles?|arrows?|shots?)\b/i.test(text) || monster.spellFlags.some((flag) => /^(?:BO_|ARROW|SHOT|MISSILE)/.test(flag))) && !/\bbreathe|\bball|\bstorm/i.test(text) && !monster.spellFlags.some((flag) => /^(?:BR_|BA_)/.test(flag)) };
}

function rangedPath(view: AgentView, from: Loc, to: Loc, bolt: boolean, monsters: readonly MonsterView[], openedDoor?: Loc): { clear: boolean; uncertain: boolean } {
  const distance = steps(from, to);
  const projection = inspecting(view).projectionPath;
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

/** Only reachable attack positions count; a closed door costs an opening action. */
function attackPositions(view: AgentView, monster: MonsterView, at: Loc, actions: number, terrain: Terrain | undefined, monsters: readonly MonsterView[], openedDoor?: Loc, ranged = false, priorActions = 0): Map<string, number> {
  const available = actions + priorActions;
  const costs = new Map<string, number>([[key(monster.grid), 0]]);
  const queue: { at: Loc; cost: number }[] = [{ at: monster.grid, cost: 0 }];
  const positions = new Map<string, number>();
  for (let head = 0; head < queue.length && head < 4000; head += 1) {
    const here = queue[head]!;
    if (ranged || steps(here.at, at) === 1) positions.set(key(here.at), Math.max(positions.get(key(here.at)) ?? 0, Math.min(actions, available - here.cost)));
    if (monster.raceFlags.includes("NEVER_MOVE") || here.cost >= available - 1) continue;
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
  return positions;
}

/** The ceiling counts HP damage separately from disabling effects and missing facts. */
export function incomingDamage(view: AgentView, at: Loc = view.player().grid, actions = 1, terrain?: Terrain, facts: ThreatFacts = {}): DamageEstimate {
  const player = view.player();
  const monsters = facts.monsters ?? view.monsters().filter((m) => m.visible);
  const occupied = new Map<string, number>();
  const ticks = Math.ceil(actions * 10 / energyBounds(player.speed, facts.energy).low);
  const statusDamage = ticks * ((player.status.poisoned > 0 ? 1 : 0) + (player.status.cut > 200 ? 3 : player.status.cut > 100 ? 2 : player.status.cut > 0 ? 1 : 0));
  let damage = (facts.unseenDamage ?? 0) * actions + statusDamage;
  let status = 0;
  let uncertainty = (facts.unseenDamage ?? 0) * actions;
  if (monsters.length === 0) return { damage, status, uncertainty };
  const stats = view.simulateLoadout?.({}) ?? null;
  const melee: { positions: Map<string, number>; damage: number }[] = [];
  for (const monster of monsters) {
    if (steps(monster.grid, at) > 20) continue;
    const count = monsterActions(monster, player, actions, facts.energy);
    const seen = monster.visible ? undefined : facts.lastSeen?.get(monster.id);
    const prior = seen === undefined ? 0 : Math.max(0, Math.ceil((view.turn() - seen) * energyBounds(monster.speed, facts.energy).high / 100));
    const read = attackFacts(view, monster, stats);
    const positions = attackPositions(view, monster, at, count, terrain, monsters, facts.openedDoor, false, prior);
    const meleeDamage = Math.max(0, ...positions.values()) * read.melee;
    const path = rangedPath(view, monster.grid, at, read.bolt, monsters, facts.openedDoor);
    let spellDamage = path.clear ? count * read.ranged : 0;
    let rangedStatus = path.clear;
    if (read.ranged > 0 || read.status > 0) {
      const reachable = attackPositions(view, monster, at, count, terrain, monsters, facts.openedDoor, true, prior);
      for (const [position, remaining] of reachable) {
        const [x, y] = position.split(",").map(Number);
        const shot = rangedPath(view, { x: x!, y: y! }, at, read.bolt, monsters, facts.openedDoor);
        if (shot.clear) {
          spellDamage = Math.max(spellDamage, remaining * read.ranged);
          rangedStatus = true;
        }
      }
    }
    if (spellDamage >= meleeDamage && (spellDamage > 0 || read.status > 0 && path.clear)) damage += spellDamage;
    else if (meleeDamage > 0) melee.push({ positions, damage: read.melee });
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
  return { damage, status, uncertainty };
}

export function threatWindow(view: AgentView, at: Loc = view.player().grid, terrain?: Terrain, facts: ThreatFacts = {}): { one: DamageEstimate; two: DamageEstimate } {
  return { one: incomingDamage(view, at, 1, terrain, facts), two: incomingDamage(view, at, 2, terrain, facts) };
}

/** A possible kill improves attack comparisons, while a missed attack keeps its danger. */
export function effectiveAttack(view: AgentView, target: MonsterView, spell?: CastableSpell): { damage: number; failure: number } {
  const player = view.player();
  if (spell !== undefined) {
    const info = inspecting(view).spellInfo?.(spell.sidx);
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

export function assessThreat(monster: MonsterView, player: PlayerView, awake: readonly MonsterView[], view: AgentView, dreaded: ReadonlySet<string> = new Set(), terrain?: Terrain, energy?: SpeedEnergy): ThreatAssessment {
  const town = townsperson(monster, player.depth);
  const uniqueFloor = fastUniqueAtLowLevel(monster, player) ? 3 : 0;
  const recall = inspecting(view).monsterRecall?.(monster.raceIndex);
  const window = threatWindow(view, player.grid, terrain, { monsters: awake.some((m) => m.id === monster.id) ? awake : [...awake, monster], ...(energy === undefined ? {} : { energy }) });
  let lethality = player.hp <= window.one.damage / 2 && window.one.damage > 0 ? 3
    : player.hp <= window.one.damage && window.one.damage > 0 ? 2
      : player.hp <= window.two.damage && window.two.damage > 0 ? 1 : 0;
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

export function pickAttackSpell(spells: readonly CastableSpell[], info?: InspectingView["spellInfo"]): CastableSpell | undefined {
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
    const score = damage * (1 - detail.failChance / 100) / Math.max(1, detail.mana);
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

export function clearShot(view: AgentView, target: MonsterView): boolean {
  const { projectionPath } = inspecting(view);
  if (projectionPath === undefined) return true;
  const path = projectionPath.call(view, target.grid).grids;
  const end = path.findIndex((grid) => same(grid, target.grid));
  if (end < 0) return false;
  return path.slice(0, end).every((grid) => {
    const occupant = view.cell(grid.x, grid.y)?.monster;
    return occupant === undefined || occupant <= 0;
  });
}

export function bestBallAim(view: AgentView, monsters: readonly MonsterView[], target: MonsterView, radius = 2): Loc | null {
  const { blastArea, projectionPath } = inspecting(view);
  if (blastArea === undefined || projectionPath === undefined) return target.grid;
  let best: Loc | null = null;
  let count = -1;
  for (const monster of monsters.filter((m) => m.visible)) {
    const at = monster.grid;
    if (!clearShot(view, monster)) continue;
    const grids = blastArea.call(view, at, radius, 0).grids;
    const caught = monsters.filter((m) => m.visible && grids.some((grid) => same(grid, m.grid))).length;
    if (caught > count && caught > 0) {
      best = at;
      count = caught;
    }
  }
  return best;
}
