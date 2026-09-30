/**
 * Knight's Lessons: while the player has the keyboard, Squire rides along as
 * an apprentice. At each decision point it forms its own answer, compares it
 * with the command the player actually gave, and writes what it noticed in its
 * notebook.
 *
 * Squire issues no commands here, so the character is never marked as
 * autoplayed. Without a model the apprentice uses a fixed order of preference;
 * with one it asks the same question the brain would.
 */

import type { AgentView } from "@rpgm-tools/neo-angband-core";
import { steps } from "./grid.js";
import type { Goal, Offer } from "./brain/goals.js";
import { detectionSources, readPack } from "./brain/pack.js";
import { rankFor, type Rank } from "./learning/ranks.js";
import type { PlayerCommand as CommandEvidence } from "./learning/ranks.js";
import type { SituationSignature } from "./learning/signature.js";
import { recallItem } from "./town/needs.js";

/** One command the player gave, as the host's `player-command` event reports it. */
export interface PlayerCommand {
  readonly code: string;
  readonly dir?: number;
  readonly args?: Readonly<Record<string, unknown>>;
}

const DIR_DELTA: Readonly<Record<number, readonly [number, number]>> = {
  1: [-1, 1], 2: [0, 1], 3: [1, 1], 4: [-1, 0], 6: [1, 0], 7: [-1, -1], 8: [0, -1], 9: [1, -1],
};

/**
 * The option a player's command amounts to, or null when it is not one Squire
 * offers (looking around, the inventory, the character sheet).
 */
export function goalOfCommand(command: PlayerCommand, view: AgentView): Goal | null {
  const player = view.player();
  const at = player.grid;
  const awake = view.monsters().filter((m) => m.visible && !m.asleep);
  const handle = typeof command.args?.["handle"] === "number" ? command.args["handle"] : null;
  const pack = readPack(view);
  const detection = detectionSources(view);
  const has = (list: readonly { readonly handle: number }[]) => handle !== null && list.some((i) => i.handle === handle);

  switch (command.code) {
    case "walk":
    case "run":
    case "pathfind": {
      const delta = command.dir === undefined ? undefined : DIR_DELTA[command.dir];
      if (delta !== undefined) {
        const to = { x: at.x + delta[0], y: at.y + delta[1] };
        if (view.monsters().some((m) => m.grid.x === to.x && m.grid.y === to.y)) return "fight";
        if (awake.length > 0) {
          const nearestNow = Math.min(...awake.map((m) => steps(at, m.grid)));
          const nearestAfter = Math.min(...awake.map((m) => steps(to, m.grid)));
          if (nearestAfter > nearestNow) return "retreat";
          if (nearestAfter < nearestNow) return "fight";
        }
      }
      return "explore";
    }
    case "descend":
      return "descend";
    case "rest":
      return "rest";
    case "pickup":
      return "pick_up";
    case "eat":
      return "eat";
    case "study":
      return "study";
    case "wield":
    case "wear":
      return "wear";
    case "zap-rod":
    case "zap":
      return detection.some((source) => source.kind === "zap" && source.handle === handle) ? "detect" : null;
    case "fire":
      return "shoot";
    case "throw":
      return has(pack.oil) ? "throw_oil" : null;
    case "aim-wand":
      return "aim_wand";
    case "quaff":
      return has(pack.heal) ? "heal" : null;
    case "read":
      if (detection.some((source) => source.kind === "read" && source.handle === handle)) return "detect";
      if (handle !== null && recallItem(view)?.handle === handle) return player.depth === 0 ? "recall_dungeon" : "recall_town";
      if (has(pack.phase)) return "phase";
      if (has(pack.teleport)) return "teleport";
      return null;
    case "use-staff":
      return has(pack.teleport) ? "teleport" : null;
    case "shop-buy":
    case "shop-sell":
      return "shop";
    case "cast": {
      const spell = typeof command.args?.["spell"] === "number" ? command.args["spell"] : null;
      if (spell === null) return null;
      if (pack.attackSpell.some((s) => s.sidx === spell)) return "cast_attack";
      if (pack.healSpell.some((s) => s.sidx === spell)) return "cast_heal";
      if (pack.escapeSpell.some((s) => s.sidx === spell)) return "phase";
      if (detection.some((source) => source.kind === "cast" && source.sidx === spell)) return "detect";
      return null;
    }
    default:
      return null;
  }
}

/**
 * The apprentice's pick with no model: escape what is deadly, heal when low,
 * fight what is safe to fight, then explore and descend.
 */
export function proceduralPick(offers: readonly Offer[], hpShare: number): Goal | null {
  const has = (g: Goal) => offers.find((o) => o.goal === g);
  const first = (...goals: Goal[]) => goals.find((g) => has(g) !== undefined) ?? null;
  const fight = has("fight");
  if (fight !== undefined && fight.risk > 0.45) {
    return first("teleport", "phase", "heal", "retreat", "shoot", "cast_attack", "fight");
  }
  if (hpShare < 0.35) {
    const safe = first("heal", "cast_heal");
    if (safe !== null) return safe;
  }
  if (fight !== undefined) return first("shoot", "cast_attack", "throw_oil", "aim_wand", "fight");
  return first("detect", "wear", "study", "recall_town", "shop", "recall_dungeon", "rest", "eat", "pick_up", "explore", "descend");
}

/** What the apprentice noticed at one decision point. */
export interface NotebookEntry {
  readonly turn: number;
  readonly squire: Goal;
  readonly knight: Goal;
  readonly agreed: boolean;
  readonly line: string;
  /** Set when the player answers "Why, sir?". */
  readonly reason?: string;
  /** A "Watch this" demonstration, which counts double. */
  readonly demonstration: boolean;
  readonly signature?: SituationSignature;
  readonly confidence?: number;
  readonly dangerousNear?: boolean;
}

const LABEL: Readonly<Record<Goal, string>> = {
  fight: "fight in melee",
  shoot: "shoot",
  throw_oil: "throw oil",
  aim_wand: "aim a wand",
  cast_attack: "cast an attack spell",
  heal: "drink a healing potion",
  cast_heal: "cast a healing spell",
  phase: "phase away",
  teleport: "teleport away",
  retreat: "back away",
  rest: "rest",
  eat: "eat",
  study: "learn a spell",
  wear: "wear gear",
  detect: "survey the level",
  pick_up: "pick it up",
  fetch: "fetch an item",
  drop_junk: "drop junk",
  buff: "use a combat buff",
  resist: "drink a resist potion",
  device: "use a curing device",
  activate: "activate an item",
  disarm: "disarm a trap",
  tunnel: "tunnel through rubble",
  explore: "explore",
  descend: "take the stairs",
  leave_level: "leave the level",
  recall_town: "recall to town",
  shop: "shop for supplies",
  recall_dungeon: "recall into the dungeon",
  wait: "wait a turn",
};

export function goalLabel(goal: Goal): string {
  return LABEL[goal];
}

/** A notebook line in plain words. */
export function noteLine(squire: Goal, knight: Goal, hpShare: number): string {
  const hp = `at ${String(Math.round(hpShare * 100))}% health`;
  if (squire === knight) return `Agreed: you chose to ${LABEL[knight]} ${hp}, as I would have.`;
  return `Noted: you chose to ${LABEL[knight]} ${hp}. I would have chosen to ${LABEL[squire]}.`;
}

/** The one-click reasons the notebook offers after a surprise. */
export const WHY_REASONS = ["danger", "saving resources", "setting something up", "instinct", "just because"] as const;

export interface Apprentice {
  readonly entries: readonly NotebookEntry[];
  readonly agreed: number;
  readonly total: number;
  readonly commands: readonly CommandEvidence[];
  readonly exams: readonly { readonly matched: number; readonly scored: number }[];
  readonly examArmed: boolean;
  readonly ghostHint: string | null;
  readonly ghostGoal: Goal | null;
}

export function emptyApprentice(): Apprentice {
  return { entries: [], agreed: 0, total: 0, commands: [], exams: [], examArmed: false, ghostHint: null, ghostGoal: null };
}

/** Add an entry, keeping the most recent 200 in the notebook. */
export function note(apprentice: Apprentice, entry: NotebookEntry): Apprentice {
  const weight = entry.demonstration ? 2 : 1;
  return {
    entries: [...apprentice.entries, entry].slice(-200),
    agreed: apprentice.agreed + (entry.agreed ? weight : 0),
    total: apprentice.total + weight,
    commands: apprentice.commands,
    exams: apprentice.exams,
    examArmed: apprentice.examArmed,
    ghostHint: apprentice.ghostHint,
    ghostGoal: apprentice.ghostGoal,
  };
}

/** The apprentice's rank from its agreement with the knight. */
export function rankOf(apprentice: Apprentice): Rank {
  return rankFor(apprentice.total === 0 ? 0 : apprentice.agreed / apprentice.total, apprentice.total);
}

/**
 * Whether this moment is worth an apprentice's attention. Walking down an empty
 * corridor is not; a creature arriving, a wound, or a new level is.
 */
export interface Moment {
  readonly awake: string;
  readonly hpBand: number;
  readonly depth: number;
}

export function momentOf(view: AgentView): Moment {
  const p = view.player();
  const share = p.maxHp > 0 ? p.hp / p.maxHp : 1;
  const awake = view
    .monsters()
    .filter((m) => m.visible && !m.asleep)
    .map((m) => m.id)
    .sort((a, b) => a - b)
    .join(",");
  return { awake, hpBand: share >= 0.9 ? 0 : share >= 0.6 ? 1 : share >= 0.35 ? 2 : 3, depth: p.depth };
}

export function isDecisionPoint(previous: Moment | null, now: Moment, goal: Goal | null): boolean {
  if (goal === null) return false;
  if (previous === null) return true;
  if (goal !== "explore") return true;
  return previous.awake !== now.awake || previous.hpBand !== now.hpBand || previous.depth !== now.depth;
}
