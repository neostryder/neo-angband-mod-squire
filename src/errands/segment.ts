/**
 * What the player did with the keyboard between a hand-back and Squire taking
 * over again: where the character went, what it fought and used, and what it
 * killed, read from the view the way a watcher would see it.
 *
 * Squire does not assume the player followed its plan. When it takes the
 * keyboard back, this record becomes one line in the outcomes layer, so the
 * next decisions start from what actually happened. The record lives on the
 * character's save, because taking the keyboard back reloads the page.
 */

import type { AgentCommand, AgentView } from "@rpgm-tools/neo-angband-core";
import { directionToward, DIRECTIONS, type Loc } from "../grid.js";
import { shownName } from "../town/needs.js";

export interface PlayerSegment {
  /** True while the player still has the keyboard. */
  readonly open: boolean;
  readonly fromTurn: number;
  readonly toTurn: number;
  readonly fromDepth: number;
  readonly toDepth: number;
  readonly deepest: number;
  readonly commands: number;
  /** Creatures the player attacked, by race, first seen first. */
  readonly fought: readonly string[];
  /** Items the player used, by the name the inventory showed. */
  readonly used: readonly string[];
  /** Creatures the player killed, by race, one entry per kill. */
  readonly killed: readonly string[];
}

/** How many names each list keeps. */
const KEPT = 6;

const USES: ReadonlySet<string> = new Set(["quaff", "read", "eat", "aim", "zap-rod", "use", "activate", "fire", "throw"]);
const AIMED: ReadonlySet<string> = new Set(["fire", "throw", "aim", "zap-rod", "cast"]);

/** A segment starting now. */
export function startSegment(view: AgentView): PlayerSegment {
  const player = view.player();
  return { open: true, fromTurn: view.turn(), toTurn: view.turn(), fromDepth: player.depth, toDepth: player.depth, deepest: player.depth, commands: 0, fought: [], used: [], killed: [] };
}

function add(list: readonly string[], name: string | null | undefined): readonly string[] {
  if (name === null || name === undefined || name === "" || list.includes(name)) return list;
  return [...list, name].slice(-KEPT);
}

function struck(command: AgentCommand, view: AgentView): string | null {
  const at = view.player().grid;
  if (command.code === "melee" && typeof command.dir === "number") {
    const step = DIRECTIONS.find((d) => d.key === command.dir);
    if (step === undefined) return null;
    const there: Loc = { x: at.x + step.dx, y: at.y + step.dy };
    return view.monsters().find((m) => m.grid.x === there.x && m.grid.y === there.y)?.race ?? null;
  }
  if (command.code === "walk" && typeof command.dir === "number") {
    /* Walking into a creature attacks it. */
    const step = DIRECTIONS.find((d) => d.key === command.dir);
    if (step === undefined) return null;
    return view.monsters().find((m) => m.visible && m.grid.x === at.x + step.dx && m.grid.y === at.y + step.dy)?.race ?? null;
  }
  if (AIMED.has(command.code)) {
    const target = view.target?.();
    const id = target?.midx ?? 0;
    if (id > 0) return view.monsters().find((m) => m.id === id)?.race ?? null;
    /* An aimed command with a direction: the nearest creature that way. */
    if (typeof command.dir === "number") {
      const near = view.monsters().filter((m) => m.visible && directionToward(at, m.grid) === command.dir);
      return near[0]?.race ?? null;
    }
  }
  return null;
}

function usedName(command: AgentCommand, view: AgentView): string | null {
  if (!USES.has(command.code)) return null;
  const handle = command.args?.["handle"];
  if (typeof handle !== "number") return null;
  const item = view.inventory().find((i) => i.handle === handle) ?? view.equipment().find((i) => i?.handle === handle) ?? null;
  return item === null ? null : shownName(item);
}

/** Note one of the player's commands, with the view it was given in. */
export function noteCommand(segment: PlayerSegment, command: AgentCommand, view: AgentView): PlayerSegment {
  const depth = view.player().depth;
  return {
    ...segment,
    toTurn: view.turn(),
    toDepth: depth,
    deepest: Math.max(segment.deepest, depth),
    commands: segment.commands + 1,
    fought: add(segment.fought, struck(command, view)),
    used: add(segment.used, usedName(command, view)),
  };
}

/** Note a kill the player made. */
export function noteKill(segment: PlayerSegment, race: string): PlayerSegment {
  return { ...segment, killed: [...segment.killed, race].slice(-KEPT * 2), fought: add(segment.fought, race) };
}

/** Squire has the keyboard again. */
export function closeSegment(segment: PlayerSegment, view: AgentView | null): PlayerSegment {
  if (view === null) return { ...segment, open: false };
  const depth = view.player().depth;
  return { ...segment, open: false, toTurn: Math.max(segment.toTurn, view.turn()), toDepth: depth, deepest: Math.max(segment.deepest, depth) };
}

function where(depth: number): string {
  return depth === 0 ? "town" : `level ${String(depth)}`;
}

function counted(races: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const race of races) counts.set(race, (counts.get(race) ?? 0) + 1);
  return [...counts].map(([race, n]) => (n === 1 ? race : `${String(n)} ${race}`)).join(", ");
}

/** The segment as one line for the outcomes layer, or null when the player did nothing. */
export function segmentLine(segment: PlayerSegment): string | null {
  if (segment.commands === 0 && segment.killed.length === 0) return null;
  const parts: string[] = [];
  parts.push(segment.fromDepth === segment.toDepth
    ? `stayed on ${where(segment.toDepth)}${segment.deepest > segment.toDepth ? ` after going as deep as ${where(segment.deepest)}` : ""}`
    : `went from ${where(segment.fromDepth)} to ${where(segment.toDepth)}`);
  if (segment.fought.length > 0) parts.push(`fought ${segment.fought.join(", ")}`);
  if (segment.killed.length > 0) parts.push(`killed ${counted(segment.killed)}`);
  if (segment.used.length > 0) parts.push(`used ${segment.used.join(", ")}`);
  const turns = Math.max(0, segment.toTurn - segment.fromTurn);
  return `While the player had the keyboard (${String(segment.commands)} commands over ${String(turns)} game turns), the character ${parts.join("; ")}. Squire's earlier plan may no longer apply.`;
}

/** Read a stored segment, or null. */
export function readSegment(value: unknown): PlayerSegment | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const n = (key: string): number => (typeof r[key] === "number" && Number.isFinite(r[key]) ? (r[key] as number) : 0);
  const names = (key: string): string[] => (Array.isArray(r[key]) ? (r[key] as unknown[]).filter((v): v is string => typeof v === "string").map((v) => v.slice(0, 80)).slice(-KEPT * 2) : []);
  return {
    open: r["open"] === true,
    fromTurn: n("fromTurn"),
    toTurn: n("toTurn"),
    fromDepth: n("fromDepth"),
    toDepth: n("toDepth"),
    deepest: n("deepest"),
    commands: n("commands"),
    fought: names("fought"),
    used: names("used"),
    killed: names("killed"),
  };
}
