/**
 * Reading stored and imported instructions back into a safe shape.
 *
 * Saves, creed files and lineages are untrusted text, so each known field is
 * copied into a fresh value with its own bounds.
 */

import { MAX_TEXT, MAX_VIEWER, SOURCES, type BanVerb, type Frequency, type Instruction, type InstructionKind, type InstructionSource, type InstructionState, type ItemBan, type OrderAim, type ResponseKind, type Sorted, type TriggerKind } from "./types.js";

const BAN_VERBS: readonly string[] = ["read", "quaff", "use", "zap", "aim"];

const STATES: readonly InstructionState[] = ["following", "grudgingly", "ignoring", "forgotten", "done", "abandoned"];
const AIMS: readonly string[] = ["spellbook", "lantern", "armour", "weapon", "free-action", "see-invisible", "depth", "item", "gold"];
const TRIGGERS: readonly string[] = ["always", "unique", "low-hp", "new-level", "in-store"];
const RESPONSES: readonly string[] = ["flee", "fight", "leave-level", "descend", "buy", "rest", "avoid"];

/** Most instructions read from one stored list. */
export const MAX_STORED = 60;

function rec(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function num(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly string[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value) ? (value as T) : fallback;
}

function optional(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : null;
}

export function readSorted(value: unknown): Sorted {
  const r = rec(value) ?? {};
  const f = rec(r["frequency"]) ?? {};
  const mode = oneOf<Frequency["mode"]>(f["mode"], ["always", "once", "until-level"], "always");
  const frequency: Frequency = mode === "until-level" ? { mode, level: Math.round(num(f["level"], 1, 50, 50)) } : { mode };
  const aim = typeof r["aim"] === "string" && AIMS.includes(r["aim"]) ? (r["aim"] as OrderAim) : null;
  const response = typeof r["response"] === "string" && RESPONSES.includes(r["response"]) ? (r["response"] as ResponseKind) : null;
  return {
    aim,
    trigger: oneOf<TriggerKind>(r["trigger"], TRIGGERS, "always"),
    response,
    avoids: Array.isArray(r["avoids"]) ? r["avoids"].filter((v): v is string => typeof v === "string").slice(0, 8).map((v) => v.slice(0, 30)) : [],
    store: typeof r["store"] === "string" ? r["store"].slice(0, 40) : null,
    depth: optional(r["depth"], 1, 127),
    deadlineLevel: optional(r["deadlineLevel"], 1, 50),
    item: typeof r["item"] === "string" ? r["item"].slice(0, 80) : null,
    count: Math.round(num(r["count"], 1, 99, 1)),
    gold: optional(r["gold"], 0, 100_000_000),
    frequency,
    ...readHpBelow(r["hpBelow"]),
    ...readBansField(r["bans"]),
  };
}

function readHpBelow(value: unknown): Pick<Sorted, "hpBelow"> {
  const r = rec(value);
  if (r === null || typeof r["value"] !== "number" || !Number.isFinite(r["value"])) return {};
  if (r["kind"] === "hp") return { hpBelow: { kind: "hp", value: Math.round(num(r["value"], 1, 100_000, 1)) } };
  if (r["kind"] === "share") return { hpBelow: { kind: "share", value: num(r["value"], 0.01, 1, 0.5) } };
  return {};
}

function readBansField(value: unknown): Pick<Sorted, "bans"> {
  if (!Array.isArray(value)) return {};
  const bans: ItemBan[] = [];
  for (const raw of value.slice(0, 8)) {
    const r = rec(raw);
    if (r === null) continue;
    bans.push({
      verb: oneOf<BanVerb>(r["verb"], BAN_VERBS, "use"),
      item: typeof r["item"] === "string" && r["item"].trim() !== "" ? r["item"].trim().slice(0, 40) : null,
      when: oneOf<ItemBan["when"]>(r["when"], ["always", "fight"], "always"),
    });
  }
  return bans.length === 0 ? {} : { bans };
}

/** One instruction, or null when the value is not one. */
export function readInstruction(value: unknown): Instruction | null {
  const r = rec(value);
  if (r === null || typeof r["text"] !== "string" || r["text"].trim() === "" || typeof r["id"] !== "string") return null;
  const kind = oneOf<InstructionKind>(r["kind"], ["order", "standing"], "order");
  return {
    id: r["id"].slice(0, 20),
    text: r["text"].slice(0, MAX_TEXT),
    kind,
    source: oneOf<InstructionSource>(r["source"], SOURCES, "panel"),
    ...(typeof r["viewer"] === "string" && r["viewer"].trim() !== "" ? { viewer: r["viewer"].trim().slice(0, MAX_VIEWER) } : {}),
    sorted: readSorted(r["sorted"]),
    state: oneOf<InstructionState>(r["state"], STATES, "following"),
    memory: num(r["memory"], 0, 1, 1),
    adherence: num(r["adherence"], 0, 1, 0.5),
    familyCreed: kind === "standing" && r["familyCreed"] === true,
    createdTurn: num(r["createdTurn"], 0, Number.MAX_SAFE_INTEGER, 0),
    seenTurn: num(r["seenTurn"], 0, Number.MAX_SAFE_INTEGER, 0),
    acted: Math.round(num(r["acted"], 0, 1_000_000, 0)),
    lowReviews: Math.round(num(r["lowReviews"], 0, 1000, 0)),
    disliked: r["disliked"] === true,
  };
}

export function readInstructions(value: unknown): Instruction[] {
  if (!Array.isArray(value)) return [];
  const out: Instruction[] = [];
  for (const raw of value.slice(-MAX_STORED)) {
    const one = readInstruction(raw);
    if (one !== null) out.push(one);
  }
  return out;
}
