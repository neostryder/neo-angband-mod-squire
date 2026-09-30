/**
 * Squire's saved settings: which model server to ask, spend caps, telemetry
 * consent, the persona library and roll-on after death.
 *
 * They live in `ctx.prefs`, which belongs to the player's install rather than
 * to one character, in the Neo Angband JSON envelope. The Mods screen's
 * switches stay the manifest rules; this holds what a switch cannot say, such
 * as a server address or a persona.
 *
 * `readConfig` never throws. A missing, damaged or older value comes back as
 * the defaults with whatever parts could be read.
 */

import { JEV, selfHosted, type Backend } from "./brain/backend.js";
import type { ConsentLevel } from "./telemetry/consent.js";
import { DEFAULT_ENDPOINT } from "./telemetry/sender.js";
import { defaultPersona, normalize, type Persona } from "./persona/persona.js";
import type { Lineage } from "./learning/lineage.js";
import type { InheritedAim } from "./strategy/heirs.js";
import { readInstructions } from "./orders/read.js";

export const CONFIG_FORMAT = "neo-angband/squire/prefs";
export const CONFIG_SCHEMA = 1;

export type BackendChoice = "jev" | "laya" | "custom" | "none";

/** What happens when a character Squire is playing dies. */
export type RollOn = "wait" | "random" | "like";

export interface SquireConfig {
  readonly backend: BackendChoice;
  /** The server address for Laya or another System One server. */
  readonly serverUrl: string;
  /** More addresses for the same server, tried in order when the first is busy or not answering. */
  readonly serverFallbacks: readonly string[];
  /** The model name to send, for servers that want one. Empty sends none. */
  readonly serverModel: string;
  /** Send Jev's decisions to a local Laya server for training rows. */
  readonly layaShadow: { readonly enabled: boolean; readonly url: string; readonly fallbacks: readonly string[] };
  /** The most tokens of context a server takes, for trimming the backstory. */
  readonly contextTokens: number;
  readonly caps: { readonly perSessionUsd: number; readonly perDayUsd: number };
  readonly telemetry: {
    readonly level: ConsentLevel;
    readonly backstoryConsent: boolean;
    readonly endpoint: string;
    /** The consent question has been answered once. */
    readonly asked: boolean;
  };
  readonly personas: readonly Persona[];
  /** Index into `personas` for new characters, or -1 to play without a persona. */
  readonly activePersona: number;
  readonly rollOn: RollOn;
  readonly knightsLessons: { readonly enabled: boolean; readonly ghost: boolean };
  /** The setup wizard has been finished once. */
  readonly setupDone: boolean;
  /** Today's spend on metered servers, so a day cap survives a reload. */
  readonly spend: { readonly day: string; readonly usd: number };
  /** How many orders and standing instructions the squire holds before it drops one. */
  readonly instructionsKept: number;
  /** Family lines, by name, so an heir inherits across characters. */
  readonly lineages: Readonly<Record<string, Lineage>>;
  /** Set when a Squire character died and roll-on is starting its heir. */
  readonly pendingHeir: { readonly lineage: string; readonly parent: Persona } | null;
}

/** The Instructions kept setting: how many the squire holds, and the bounds the setup box allows. */
export const DEFAULT_INSTRUCTIONS_KEPT = 8;
export const MIN_INSTRUCTIONS_KEPT = 1;
export const MAX_INSTRUCTIONS_KEPT = 50;

export const LAYA_DEFAULT_URL = "http://localhost:8010/v1/systemone";

export function defaultConfig(): SquireConfig {
  return {
    backend: "jev",
    serverUrl: LAYA_DEFAULT_URL,
    serverFallbacks: [],
    serverModel: "",
    layaShadow: { enabled: false, url: LAYA_DEFAULT_URL, fallbacks: [] },
    contextTokens: 4096,
    caps: { perSessionUsd: 0, perDayUsd: 0 },
    telemetry: { level: "off", backstoryConsent: false, endpoint: DEFAULT_ENDPOINT, asked: false },
    personas: [defaultPersona("Squire")],
    activePersona: 0,
    rollOn: "wait",
    knightsLessons: { enabled: true, ghost: false },
    setupDone: false,
    spend: { day: "", usd: 0 },
    instructionsKept: DEFAULT_INSTRUCTIONS_KEPT,
    lineages: {},
    pendingHeir: null,
  };
}

function lineagesOf(value: unknown): Record<string, Lineage> {
  const out: Record<string, Lineage> = {};
  const r = rec(value);
  if (r === null) return out;
  for (const [name, raw] of Object.entries(r).slice(0, 30)) {
    const l = rec(raw);
    if (l === null || typeof l["name"] !== "string" || typeof l["generation"] !== "number") continue;
    out[name] = {
      name: l["name"],
      generation: l["generation"],
      ancestors: Array.isArray(l["ancestors"]) ? (l["ancestors"] as Lineage["ancestors"]).slice(-50) : [],
      lore: Array.isArray(l["lore"]) ? (l["lore"] as Lineage["lore"]).slice(-60) : [],
      grudges: Array.isArray(l["grudges"]) ? (l["grudges"] as Lineage["grudges"]).slice(-30) : [],
      creeds: readInstructions(l["creeds"]).filter((i) => i.kind === "standing" && i.familyCreed),
      aims: readAims(l["aims"]),
    };
  }
  return out;
}

function readAims(value: unknown): InheritedAim[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 2).flatMap((raw): InheritedAim[] => {
    const a = rec(raw);
    if (a === null) return [];
    if (a["kind"] === "weapon") return [{ kind: "weapon", depth: null }];
    return a["kind"] === "depth" && typeof a["depth"] === "number" && Number.isFinite(a["depth"]) ? [{ kind: "depth", depth: Math.max(1, Math.min(127, Math.round(a["depth"]))) }] : [];
  });
}

function rec(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function pickOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function numberIn(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function str(value: unknown, fallback: string, max = 500): string {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Up to eight server addresses, in order, from a stored list. */
export function addresses(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter((v) => v !== "" && v.length <= 300).slice(0, 8);
}

/** Split typed addresses on commas, spaces or new lines. */
export function parseAddresses(text: string): string[] {
  return addresses(text.split(/[\s,]+/));
}

/** Read the stored value, or the defaults. */
export function readConfig(stored: unknown): SquireConfig {
  const base = defaultConfig();
  const envelope = rec(stored);
  if (envelope === null || envelope["format"] !== CONFIG_FORMAT) return base;
  const data = rec(envelope["data"]);
  if (data === null) return base;
  const caps = rec(data["caps"]) ?? {};
  const telemetry = rec(data["telemetry"]) ?? {};
  const knights = rec(data["knightsLessons"]) ?? {};
  const spend = rec(data["spend"]) ?? {};
  const layaShadow = rec(data["layaShadow"]) ?? {};
  const personas = Array.isArray(data["personas"]) ? data["personas"].slice(0, 50).map((p) => normalize(p)) : base.personas;
  return {
    backend: pickOf(data["backend"], ["jev", "laya", "custom", "none"], base.backend),
    serverUrl: str(data["serverUrl"], base.serverUrl),
    serverFallbacks: addresses(data["serverFallbacks"]),
    serverModel: str(data["serverModel"], base.serverModel, 100),
    layaShadow: { enabled: bool(layaShadow["enabled"], false), url: str(layaShadow["url"], LAYA_DEFAULT_URL), fallbacks: addresses(layaShadow["fallbacks"]) },
    contextTokens: numberIn(data["contextTokens"], 512, 200_000, base.contextTokens),
    caps: {
      perSessionUsd: numberIn(caps["perSessionUsd"], 0, 1000, 0),
      perDayUsd: numberIn(caps["perDayUsd"], 0, 1000, 0),
    },
    telemetry: {
      level: pickOf(telemetry["level"], ["off", "summary", "decisions", "full"], "off"),
      backstoryConsent: bool(telemetry["backstoryConsent"], false),
      endpoint: str(telemetry["endpoint"], base.telemetry.endpoint),
      asked: bool(telemetry["asked"], false),
    },
    personas: personas.length > 0 ? personas : base.personas,
    activePersona: Math.round(numberIn(data["activePersona"], -1, Math.max(0, personas.length - 1), 0)),
    rollOn: pickOf(data["rollOn"], ["wait", "random", "like"], "wait"),
    knightsLessons: { enabled: bool(knights["enabled"], true), ghost: bool(knights["ghost"], false) },
    setupDone: bool(data["setupDone"], false),
    spend: { day: str(spend["day"], "", 10), usd: numberIn(spend["usd"], 0, 1_000_000, 0) },
    instructionsKept: Math.round(numberIn(data["instructionsKept"], MIN_INSTRUCTIONS_KEPT, MAX_INSTRUCTIONS_KEPT, DEFAULT_INSTRUCTIONS_KEPT)),
    lineages: lineagesOf(data["lineages"]),
    pendingHeir: (() => {
      const heir = rec(data["pendingHeir"]);
      return heir !== null && typeof heir["lineage"] === "string" ? { lineage: heir["lineage"], parent: normalize(heir["parent"]) } : null;
    })(),
  };
}

/** The value to store. */
export function writeConfig(config: SquireConfig): unknown {
  return { format: CONFIG_FORMAT, schemaVersion: CONFIG_SCHEMA, data: config };
}

/** The server a config names, or null for no model. */
export function backendFor(config: SquireConfig): Backend | null {
  switch (config.backend) {
    case "jev":
      return JEV;
    case "laya":
      return selfHosted("laya", "Laya", config.serverUrl, config.serverModel === "" ? undefined : config.serverModel, config.serverFallbacks);
    case "custom":
      return selfHosted("custom", "your System One server", config.serverUrl, config.serverModel === "" ? undefined : config.serverModel, config.serverFallbacks);
    case "none":
      return null;
  }
}

/** How many backstory tokens one decision may carry on this server. */
export function backstoryBudget(config: SquireConfig): number {
  if (config.backend === "jev") return 2000;
  /* A small context has to hold the rules, the situation and every option too. */
  return Math.max(0, Math.floor(config.contextTokens * 0.15));
}

/** The persona for a new character, or null. */
export function activePersona(config: SquireConfig): Persona | null {
  return config.activePersona < 0 ? null : (config.personas[config.activePersona] ?? null);
}
