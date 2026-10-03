/**
 * The short list on top of the errand menu: up to three errands, ranked for the
 * moment by the model Squire already uses.
 *
 * The menu never waits for it. The question goes out when the menu opens, under
 * a strict time limit, and the full menu works the whole time. An answer that
 * comes late, fails, or names nothing that can start leaves the short list out.
 * Whether an answer still applies when it lands is the driver's call: it holds
 * the hand-back epoch and the state the question was about.
 */

import type { AgentView } from "@rpgm-tools/neo-angband-core";
import type { AskResult } from "../brain/backend.js";
import type { Answer, SystemOneRequest } from "../brain/systemone.js";
import { healthBand } from "../brain/goals.js";
import { packFull } from "../brain/items.js";
import { hungry } from "../brain/pack.js";
import { recallItem } from "../town/needs.js";
import type { ErrandEntry, ErrandId } from "./catalog.js";
import { isErrandId } from "./catalog.js";

/** How long the short list may take. Past this the menu goes without one. */
export const RANK_TIMEOUT_MS = 3_000;

/** The most errands the short list holds. */
export const SHORT_LIST = 3;

/** What each errand is for, as the model reads it. */
const PURPOSE: Readonly<Record<ErrandId, string>> = {
  loot: "Pick up the known items worth using or selling, making room by dropping junk.",
  town: "Go back to town, by Word of Recall or by the up staircases.",
  down: "Walk to a down staircase and stop on it.",
  up: "Walk to an up staircase and stop on it.",
  leave: "Take the nearest staircase, up or down, to get off this level.",
  explore: "Walk the unexplored parts of this level.",
  clear: "Hunt down and fight every creature on this level, sleeping ones too.",
  restock: "Visit the town's shops for supplies and sell loot.",
};

/** The question: which of the errands that can start now suits this moment. */
export function rankRequest(view: AgentView, entries: readonly ErrandEntry[]): SystemOneRequest | null {
  const open = entries.filter((entry) => entry.reason === null);
  if (open.length < 2) return null;
  const player = view.player();
  const awake = view.monsters().filter((m) => m.visible && !m.asleep).length;
  const criteria: Record<string, string> = {};
  for (const entry of open) criteria[entry.id] = `${entry.label}. ${PURPOSE[entry.id]}`;
  return {
    state: {
      place: player.depth === 0 ? "town" : `dungeon level ${String(player.depth)}`,
      health: healthBand(player.hp, player.maxHp),
      level: player.level,
      gold: player.gold,
      awakeCreaturesInSight: awake,
      packFull: packFull(view),
      hungry: hungry(view),
      wordOfRecall: recallItem(view) !== null,
    },
    questions: {
      errand: {
        type: "choice",
        instructions: "The player is choosing an errand for Squire to carry out now. Which one suits this moment best?",
        criteria,
      },
    },
  };
}

/** The top errands from an answer, best first, keeping only ones that can start. */
export function shortList(answer: Answer | undefined, entries: readonly ErrandEntry[]): ErrandId[] {
  if (answer?.type !== "choice") return [];
  const open = new Set(entries.filter((entry) => entry.reason === null).map((entry) => entry.id));
  return Object.entries(answer.probabilities)
    .filter((pair): pair is [ErrandId, number] => isErrandId(pair[0]) && open.has(pair[0]) && Number.isFinite(pair[1]) && pair[1] > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, SHORT_LIST)
    .map(([id]) => id);
}

export interface RankDeps {
  send(request: SystemOneRequest): Promise<AskResult>;
  /** Resolves after this many milliseconds. A timer, or a test's stand-in for one. */
  wait?(ms: number): Promise<void>;
  readonly timeoutMs?: number;
}

/** Ask for the short list. Null when there is none: no question worth asking, a failure, or no answer in time. */
export async function rankErrands(deps: RankDeps, view: AgentView, entries: readonly ErrandEntry[]): Promise<ErrandId[] | null> {
  const request = rankRequest(view, entries);
  if (request === null) return null;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const late = wait(deps.timeoutMs ?? RANK_TIMEOUT_MS).then(() => null);
  const result = await Promise.race([deps.send(request).catch(() => null), late]);
  if (result === null || !result.ok) return null;
  const list = shortList(result.answers["errand"], entries);
  return list.length === 0 ? null : list;
}
