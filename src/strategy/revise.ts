/**
 * The revise-goal check: moments that may make the mid-term goal worth
 * dropping, the yes/no question asked at them, and the guard that keeps a
 * dropped goal from coming straight back.
 *
 * Every trigger reads what the player can see: known item names, the
 * learned-spell list, the rune message the game prints, named supplies in
 * the pack, hit points, the dungeon level and visible monsters. Each one
 * fires on the change, not on every step the condition holds. Supplies count
 * as used only when Squire's own command drank, read or used them, so a
 * drop, a sale, a burnt scroll or a spell that grows unreliable is not a use.
 */

import type { AgentView } from "../host-adapter.js";
import { shownName } from "../town/needs.js";
import type { Answer, SystemOneRequest } from "../brain/systemone.js";
import type { Persona } from "../persona/persona.js";
import { dangerousUniquesInView } from "./near.js";
import { escapeItem, escapeItems, HEALING_POTION, reliableEscapeSpell, supplies } from "./readiness.js";
import { pursuitFacts, type Pursuit } from "./pursuits.js";

/** Meaningful actions between periodic checks. */
export const CHECKPOINT_ACTIONS = 150;
/** Game turns a goal dropped by a check stays out of reach. */
export const REVISE_BLOCK_TURNS = 2000;
/** Goals the check may drop on one dungeon level, counted by level number for the whole run. */
export const REVISE_LEVEL_CAP = 2;
/** Dungeon levels per depth band. */
export const DEPTH_BAND = 5;
/** Yes threshold, and the higher one a stubborn persona needs. */
export const REVISE_YES = 0.5;
export const STUBBORN_YES = 0.65;
/** Stubbornness above this share of its slider asks for the higher threshold. */
export const STUBBORN_AT = 0.7;

export type ReviseTrigger =
  | "near-death" | "escape" | "loss" | "unique" | "treasure" | "rune" | "spell"
  | "town-in" | "town-out" | "band" | "resume" | "checkpoint";

/** When several fire on one step, the first in this order is the one asked about. */
export const REVISE_ORDER: readonly ReviseTrigger[] = [
  "near-death", "escape", "loss", "unique", "treasure", "rune", "spell", "town-in", "town-out", "band", "resume", "checkpoint",
];

export interface ReviseEvent {
  readonly trigger: ReviseTrigger;
  /** Finishes "because ...", for the outcome and the log. */
  readonly reason: string;
}

/** What the last look showed, so each trigger fires on the change. */
export interface ReviseWatch {
  /** Known artifact and ego names ever carried, so picking one up again does not count. */
  readonly treasures: readonly string[];
  readonly runes: readonly string[];
  readonly spells: number;
  /** Healing potions held at the last look. */
  readonly healing: number;
  /** The most healing potions held since the last loss or the last trip down, less any that left the pack undrunk. */
  readonly healingPeak: number;
  /** Healing potions Squire drank since the last loss or the last trip down. */
  readonly healingUsed: number;
  /** Escape scrolls and staff charges held at the last look. Spells are not counted. */
  readonly escapes: number;
  /** Hit points fell below a fifth and have not yet come back above half. */
  readonly low: boolean;
  readonly depth: number;
  readonly band: number;
  /** Dangerous uniques already counted on this level. */
  readonly uniques: readonly string[];
}

function treasureKeys(view: AgentView): { readonly artifacts: string[]; readonly egos: string[] } {
  const artifacts: string[] = [];
  const egos: string[] = [];
  for (const item of [...view.inventory(), ...view.equipment()]) {
    if (item === null) continue;
    /* Names are what the character knows: an unknown ego or an unassessed artifact reads as null. */
    if (item.artifactName !== null && item.artifactName !== undefined) artifacts.push(`artifact:${item.artifactName}`);
    else if (item.egoName !== null && item.egoName !== undefined) egos.push(`ego:${item.kindKey}:${item.egoName}`);
  }
  return { artifacts, egos };
}

const RUNE_LINE = /^You have learned the rune of (.+)\.$/;

function runesIn(messages: readonly string[]): string[] {
  return messages.flatMap((line) => {
    const match = RUNE_LINE.exec(line.trim());
    return match === null ? [] : [match[1] ?? ""];
  });
}

function learnedSpells(view: AgentView): number {
  const seen = new Set<number>();
  for (const book of view.spellbooks()) for (const spell of book.spells) if (spell.learned) seen.add(spell.sidx);
  return seen.size;
}

/** Potions and scrolls used up by the commands given since the last look. */
export interface Used {
  readonly healing: boolean;
  readonly escape: boolean;
}

export const NOTHING_USED: Used = { healing: false, escape: false };

/**
 * Reads what a command uses up from the pack item its handle names, in the
 * view the command was chosen from. Quaffing a Cure potion uses healing.
 * Reading a Phase Door or teleport scroll, or using a Staff of Teleportation,
 * uses an escape.
 */
export function usedBy(view: AgentView, command: { readonly code: string; readonly args?: Readonly<Record<string, unknown>> }, before: Used = NOTHING_USED): Used {
  const handle = command.args?.["handle"];
  const item = typeof handle === "number" ? view.inventory().find((entry) => entry.handle === handle) : undefined;
  if (item === undefined) return before;
  return {
    healing: before.healing || command.code === "quaff" && HEALING_POTION.test(shownName(item) ?? ""),
    escape: before.escape || (command.code === "read" || command.code === "use-staff") && escapeItem(item),
  };
}

function bandOf(depth: number): number {
  return Math.floor(Math.max(0, depth) / DEPTH_BAND);
}

/** The first look: everything the character already has or knows counts as old. */
export function startWatch(view: AgentView): ReviseWatch {
  const player = view.player();
  const keys = treasureKeys(view);
  return {
    treasures: [...keys.artifacts, ...keys.egos],
    runes: runesIn(view.messages()),
    spells: learnedSpells(view),
    healing: supplies(view).cures,
    healingPeak: supplies(view).cures,
    healingUsed: 0,
    escapes: escapeItems(view),
    low: player.maxHp > 0 && player.hp * 5 < player.maxHp,
    depth: player.depth,
    band: bandOf(player.maxDepth),
    uniques: dangerousUniquesInView(view),
  };
}

/** What changed since the last look, in `REVISE_ORDER`. `used` is what Squire's commands since then used up. */
export function watchStep(prev: ReviseWatch, view: AgentView, used: Used = NOTHING_USED): { readonly watch: ReviseWatch; readonly fired: readonly ReviseEvent[] } {
  const player = view.player();
  const fired: ReviseEvent[] = [];
  const add = (trigger: ReviseTrigger, reason: string): void => { fired.push({ trigger, reason }); };

  let low = prev.low;
  if (player.maxHp > 0 && player.hp * 5 < player.maxHp) low = true;
  else if (low && player.maxHp > 0 && player.hp * 2 > player.maxHp) {
    add("near-death", "the character nearly died and then recovered");
    low = false;
  }

  const below = player.depth > 0;
  const escapes = escapeItems(view);
  /* An escape spell the character casts reliably is still an escape, so the last scroll is not the last escape. */
  if (below && used.escape && prev.escapes > 0 && escapes === 0 && !reliableEscapeSpell(view)) add("escape", "the character used its last escape");

  const healing = supplies(view).cures;
  const gone = Math.max(0, prev.healing - healing);
  const drunk = used.healing ? gone : 0;
  /* A trip down starts a fresh count. Potions that left the pack without being drunk come off the peak. */
  const tripDown = prev.depth === 0 && below;
  let healingPeak = tripDown ? healing : Math.max(healing, Math.max(prev.healingPeak, healing) - (gone - drunk));
  let healingUsed = tripDown ? 0 : prev.healingUsed + drunk;
  if (below && drunk > 0 && healingPeak >= 2 && healingUsed * 2 >= healingPeak) {
    add("loss", "the character used up half of its healing potions");
    healingPeak = healing;
    healingUsed = 0;
  }

  const levelChanged = player.depth !== prev.depth;
  const counted = levelChanged ? [] : [...prev.uniques];
  const uniques = dangerousUniquesInView(view);
  const fresh = uniques.find((name) => !counted.includes(name));
  if (fresh !== undefined) add("unique", `the dangerous unique ${fresh} came into view`);
  for (const name of uniques) if (!counted.includes(name)) counted.push(name);

  const keys = treasureKeys(view);
  const treasures = [...prev.treasures];
  const newArtifact = keys.artifacts.some((key) => !treasures.includes(key));
  const newEgo = keys.egos.some((key) => !treasures.includes(key));
  if (newArtifact) add("treasure", "the character found a new artifact");
  else if (newEgo) add("treasure", "the character found a new ego item");
  for (const key of [...keys.artifacts, ...keys.egos]) if (!treasures.includes(key)) treasures.push(key);

  const runes = [...prev.runes];
  const rune = runesIn(view.messages()).find((name) => !runes.includes(name));
  if (rune !== undefined) add("rune", `the character learned the rune of ${rune}`);
  for (const name of runesIn(view.messages())) if (!runes.includes(name)) runes.push(name);

  const spells = learnedSpells(view);
  if (spells > prev.spells) add("spell", "the character learned a new spell");

  if (prev.depth > 0 && player.depth === 0) add("town-in", "the character reached the town");
  if (prev.depth === 0 && player.depth > 0) add("town-out", "the character left the town");

  const band = Math.max(prev.band, bandOf(player.maxDepth));
  if (band > prev.band) add("band", `the character reached dungeon level ${String(band * DEPTH_BAND)} for the first time`);

  fired.sort((a, b) => REVISE_ORDER.indexOf(a.trigger) - REVISE_ORDER.indexOf(b.trigger));
  return {
    watch: { treasures, runes, spells: Math.max(prev.spells, spells), healing, healingPeak, healingUsed, escapes, low, depth: player.depth, band, uniques: counted },
    fired,
  };
}

const RESUME_REASON = "a stretch of manual play ended";
const CHECKPOINT_REASON = `the character took ${String(CHECKPOINT_ACTIONS)} actions since the last check`;

export function resumeEvent(): ReviseEvent {
  return { trigger: "resume", reason: RESUME_REASON };
}

export function checkpointEvent(): ReviseEvent {
  return { trigger: "checkpoint", reason: CHECKPOINT_REASON };
}

/**
 * Every command code Squire gives, and whether it counts toward the periodic
 * check. Moving, fighting, casting, studying, using, carrying and trading
 * count. Resting, holding still and leaving a shop screen do not, and neither
 * does a code missing from this table.
 */
export const COMMAND_COUNTS: Readonly<Record<string, boolean>> = {
  walk: true, run: true, pathfind: true, "navigate-down": true, "navigate-up": true, descend: true, ascend: true,
  tunnel: true, open: true, close: true, disarm: true,
  fire: true, throw: true, cast: true, study: true,
  quaff: true, read: true, eat: true, "aim-wand": true, "zap-rod": true, "use-staff": true, activate: true,
  wield: true, pickup: true, drop: true,
  "shop-buy": true, "shop-sell": true,
  rest: false, hold: false, "shop-exit": false,
};

export function meaningfulAction(command: { readonly code: string }): boolean {
  return COMMAND_COUNTS[command.code] === true;
}

/** The share of yes a drop needs. A stubborn persona needs more. */
export function reviseThreshold(persona: Persona | null): number {
  if (persona === null) return REVISE_YES;
  return persona.sliders.stubbornness / 100 > STUBBORN_AT ? STUBBORN_YES : REVISE_YES;
}

/** Whether the answer says drop the goal; null when there is no answer. */
export function reviseYes(answer: Answer | null, threshold: number): boolean | null {
  if (answer?.type !== "noul") return null;
  return answer.p >= threshold;
}

export interface ReviseBlock {
  readonly id: string;
  /** The game turn the block ends. */
  readonly until: number;
}

export function blockFor(id: string, turn: number): ReviseBlock {
  return { id, until: turn + REVISE_BLOCK_TURNS };
}

function blocked(id: string, blocks: readonly ReviseBlock[], turn: number): boolean {
  return blocks.some((block) => block.id === id && turn < block.until);
}

/** The candidates a choice may offer: the unblocked ones, or all of them when every one is blocked. */
export function openAims<T extends { readonly kind: string }>(aims: readonly T[], blocks: readonly ReviseBlock[], turn: number): T[] {
  const open = aims.filter((aim) => !blocked(aim.kind, blocks, turn));
  return open.length > 0 ? open : [...aims];
}

/** The ranking with blocked goals moved to the end, so none of them leads while another can. */
export function guardAims<T extends { readonly kind: string }>(aims: readonly T[], blocks: readonly ReviseBlock[], turn: number): T[] {
  return [...aims.filter((aim) => !blocked(aim.kind, blocks, turn)), ...aims.filter((aim) => blocked(aim.kind, blocks, turn))];
}

export const REVISE_GOAL = {
  type: "noul",
  instructions: "Should the character drop its current mid-term goal and choose again?",
  criteria: {
    true: "What just happened changes what this character should work toward, so another aim now serves it better.",
    false: "The current aim still fits this character after what just happened; keep working toward it.",
  },
} as const;

/** One yes/no question about the mid-term goal, with the moment that prompted it. */
export function reviseGoalRequest(view: AgentView, mid: string, reason: string, others: readonly string[], pursuits: readonly Pursuit[] = []): SystemOneRequest {
  const player = view.player();
  return {
    state: {
      rules: "A mid-term goal is an aim worth working toward over the next few dungeon levels. Dropping one costs the progress made toward it, so drop it only when the moment changes what serves this character.",
      character: `Level ${String(player.level)} ${player.race} ${player.cls}, on dungeon level ${String(player.depth)} (deepest reached ${String(player.maxDepth)}), ${String(player.hp)} of ${String(player.maxHp)} hit points, ${String(player.gold)} gold.`,
      mid_goal: mid,
      moment: `This check comes because ${reason}.`,
      ...(others.length === 0 ? {} : { other_aims: others.join("; ") }),
      ...(pursuits.length === 0 ? {} : pursuitFacts(pursuits)),
    },
    questions: { revise_goal: REVISE_GOAL },
  };
}

/** When the next check comes, for the intent card. */
export interface NextCheck {
  /** Meaningful actions left before the periodic check. */
  readonly actions: number;
  /** The dungeon level that opens the next depth band. */
  readonly depth: number;
  /** No more goals may be dropped on this dungeon level. */
  readonly capped: boolean;
}

export function nextCheck(actions: number, maxDepth: number, revisions: number): NextCheck {
  return {
    actions: Math.max(0, CHECKPOINT_ACTIONS - actions),
    depth: (bandOf(maxDepth) + 1) * DEPTH_BAND,
    capped: revisions >= REVISE_LEVEL_CAP,
  };
}
