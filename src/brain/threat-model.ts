import type { AgentView, MonsterView, PlayerView } from "@rpgm-tools/neo-angband-core";
import { steps, type Loc } from "../grid.js";
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
export type ItemRef = { readonly floor: { readonly x: number; readonly y: number; readonly index: number } };

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

export function assessThreat(monster: MonsterView, player: PlayerView, awake: readonly MonsterView[], view: AgentView, dreaded: ReadonlySet<string> = new Set()): ThreatAssessment {
  const town = townsperson(monster, player.depth);
  const uniqueFloor = fastUniqueAtLowLevel(monster, player) ? 3 : 0;
  const old = Math.max(uniqueFloor, threatIndex(monster, player.level, player.hp, dreaded, town));
  const recall = inspecting(view).monsterRecall?.(monster.raceIndex);
  if (recall === undefined || recall === null) {
    return { capability: Math.max(uniqueFloor, threatIndex(monster, player.level, Infinity, dreaded)), lethality: old, band: old, round: town ? TOWN_ROUND : roundEstimate(monster.level), description: null, enhanced: false };
  }
  const read = knownCapability(recall.text, monster.level);
  const known = town && !read.knownBlows ? { ...read, round: TOWN_ROUND } : read;
  let capability = Math.max(uniqueFloor, threatIndex(monster, player.level, Infinity, dreaded));
  const knownMagic = /\bmay (?:breathe|cast spells)\b/i.test(recall.text);
  if (known.breeds || known.round >= 16 || knownMagic) capability = Math.max(capability, 1);
  if (known.round >= 32 || known.spell >= 24) capability = Math.max(capability, 2);
  const incoming = Math.max(known.round, known.spell);
  const nearby = awake.filter((other) => steps(player.grid, other.grid) <= 5).length;
  /* A townsperson walks up at no special pace and the character can always step away from one. */
  const closing = town ? 0 : Math.max(0, steps(player.grid, monster.grid) - 1);
  const speed = town || monster.speed <= player.speed ? 0 : Math.min(2, Math.ceil((monster.speed - player.speed) / 10));
  const exposure = incoming * (1 + speed * 0.5) * (1 + Math.min(2, closing) * 0.5);
  let lethality = 0;
  if (player.hp <= exposure / 2) lethality = 3;
  else if (player.hp <= exposure || (player.maxHp > 0 && incoming >= player.maxHp)) lethality = 2;
  else if (player.hp <= exposure * 2) lethality = 1;
  if (nearby >= 2) lethality = Math.min(3, lethality + (nearby >= 4 && !town ? 2 : 1));
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
