/**
 * Creed files and family creeds.
 *
 * A creed file is a shareable list of standing instructions in plain words.
 * Loading one gives each line to the squire as if the player had typed it, so
 * the squire sorts and weighs it like any other. Orders are never written to a
 * creed file, and never inherited.
 */

import type { Persona } from "../persona/persona.js";
import type { Orders } from "./book.js";
import { queueInstruction } from "./input.js";
import { MAX_TEXT, type Instruction } from "./types.js";

export const CREED_FORMAT = "neo-angband/squire/creed";
export const CREED_SCHEMA = 1;
/** Most instructions read from one creed file. */
export const MAX_CREED_LINES = 100;

export interface CreedEntry {
  readonly text: string;
  readonly familyCreed: boolean;
}

/** The creed file for the squire's live standing instructions. */
export function exportCreed(name: string, instructions: readonly Instruction[]): string {
  const entries: CreedEntry[] = instructions
    .filter((i) => i.kind === "standing" && (i.state === "following" || i.state === "grudgingly" || i.state === "ignoring"))
    .map((i) => ({ text: i.text, familyCreed: i.familyCreed }));
  return JSON.stringify({ format: CREED_FORMAT, schemaVersion: CREED_SCHEMA, data: { name, instructions: entries } }, null, 2);
}

export type CreedRead =
  | { readonly ok: true; readonly name: string; readonly entries: readonly CreedEntry[] }
  | { readonly ok: false; readonly problem: string };

export function importCreed(text: string): CreedRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, problem: "That file isn't a creed file." };
  }
  const env = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  if (env === null || env["format"] !== CREED_FORMAT) return { ok: false, problem: "That file isn't a creed file." };
  if (typeof env["schemaVersion"] !== "number" || env["schemaVersion"] > CREED_SCHEMA) return { ok: false, problem: "That creed file needs a newer version of Squire." };
  const data = env["data"] !== null && typeof env["data"] === "object" ? (env["data"] as Record<string, unknown>) : null;
  const list = data?.["instructions"];
  if (data === null || !Array.isArray(list)) return { ok: false, problem: "That creed file has no instructions in it." };
  const entries: CreedEntry[] = [];
  for (const raw of list.slice(0, MAX_CREED_LINES)) {
    const r = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    if (r === null || typeof r["text"] !== "string" || r["text"].trim() === "") continue;
    entries.push({ text: r["text"].slice(0, MAX_TEXT), familyCreed: r["familyCreed"] === true });
  }
  return { ok: true, name: typeof data["name"] === "string" ? data["name"].slice(0, 60) : "", entries };
}

/** Load a creed file into the squire's book. Returns how many instructions were taken. */
export function loadCreed(orders: Orders, text: string): { readonly ok: true; readonly taken: number } | { readonly ok: false; readonly problem: string } {
  const read = importCreed(text);
  if (!read.ok) return read;
  let taken = 0;
  for (const entry of read.entries) {
    const result = queueInstruction(orders, entry.text, "creed", { kind: "standing", familyCreed: entry.familyCreed });
    if (result.ok) taken += 1;
  }
  return { ok: true, taken };
}

/**
 * The family creeds an heir inherits: as many as the Inheritance slider allows
 * of the twelve lore lessons' share, the firmest first, each at half the memory.
 */
export function inheritCreeds(creeds: readonly Instruction[], parent: Persona): Instruction[] {
  const share = Math.max(0, Math.min(1, parent.sliders.inheritance / 100));
  const count = Math.min(12, Math.floor(12 * share));
  return creeds
    .filter((i) => i.kind === "standing" && i.familyCreed)
    .sort((a, b) => b.memory - a.memory || a.createdTurn - b.createdTurn)
    .slice(0, count)
    .map((i) => ({ ...i, memory: i.memory / 2 }));
}
