/**
 * Town judgments the persona owns: whether to head back to town before the
 * supply margin forces it, and what to spend gold on once the survival basket
 * is stocked. Code keeps the floors (`supplyMargin`, the basket); above them
 * both calls are code too. The trip home is a draw against the persona's own
 * lean (`townPull`) scaled by how short the pack is, and the buying order is
 * the persona's lean plus a small random term, so two visits can come out
 * differently. With no persona the leans fall back to a plain middle. No model
 * is asked for either.
 */

import type { AgentView } from "@rpgm-tools/neo-angband-core";
import { readPack } from "../brain/pack.js";
import type { Persona } from "../persona/persona.js";
import { recallItem, RECALL_FROM_DEPTH, supplyNeeds, type SupplyKind } from "../town/needs.js";
import { affordable, type Aim } from "./aims.js";
import { drive, pursuitWeight, type Pursuit } from "./pursuits.js";
import { missingEssentials, supplyMargin } from "./readiness.js";

export type PurchaseKind = SupplyKind | "gear" | "save";

/** Today's fixed buying order beyond the basket: supplies by priority, then gear. Saving is never chosen by code. */
export const FIXED_PURCHASE_ORDER: readonly PurchaseKind[] = ["healing", "phase", "food", "light", "escape", "recall", "oil", "ammo", "gear"];

function unit(value: number): number {
  return Math.max(0, Math.min(1, value / 100));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Why a trip home is worth weighing now, or null when it is not: in the
 * dungeon, above the margin that forces a trip, short of what the persona
 * wants, and with a way home (a Recall scroll, or stairs near the surface).
 */
/** Supplies the persona would buy before saving its gold; only these can justify an early trip. */
function wanted(kind: SupplyKind, persona: Persona | null, pursuits: readonly Pursuit[]): boolean {
  return purchaseLean(kind, persona, pursuits) > purchaseLean("save", persona, pursuits);
}

export function townReason(view: AgentView, persona: Persona | null, pursuits: readonly Pursuit[] = []): string | null {
  const player = view.player();
  if (player.depth === 0 || player.dead || supplyMargin(view) !== null) return null;
  const recall = recallItem(view) !== null;
  if (!recall && player.depth >= RECALL_FROM_DEPTH) return null;
  const short = supplyNeeds(view, readPack(view), persona).filter((need) => need.kind !== "recall" && need.kind !== "ammo" && need.kind !== "oil" && need.have < need.want && wanted(need.kind, persona, pursuits));
  if (short.length === 0) return null;
  const listed = short.map((need) => `${String(need.have)} of ${String(need.want)} ${need.name}`).join(", ");
  return `The pack holds ${listed}. Supplies are above the level that forces a trip home. ${recall ? "A Word of Recall scroll is in the pack." : "The way home is on foot, up the stairs."} The character has ${String(player.gold)} gold.`;
}

/** How short the pack is of what the persona wants, 0 (stocked) to 1 (empty). */
export function shortfall(view: AgentView, persona: Persona | null, pursuits: readonly Pursuit[] = []): number {
  const needs = supplyNeeds(view, readPack(view), persona).filter((need) => ["healing", "phase", "food", "light"].includes(need.kind) && need.want > 0 && wanted(need.kind, persona, pursuits));
  if (needs.length === 0) return 0;
  return needs.reduce((sum, need) => sum + clamp01((need.want - need.have) / need.want), 0) / needs.length;
}

/**
 * The persona's own pull toward town, 0 to 1. Town trips raise it, as does
 * the wish to keep the line going; drive and the wish to get rich lower it.
 */
export function townPull(persona: Persona | null, pursuits: readonly Pursuit[]): number {
  if (persona === null) return 0.5;
  return clamp01(0.2 + 0.5 * unit(persona.sliders.towntrips) + 0.2 * pursuitWeight(pursuits, "lineage") - 0.3 * (drive(persona) - 0.46) - 0.1 * pursuitWeight(pursuits, "riches"));
}

/** The chance of heading home: the persona's pull, scaled by how short the pack is. Drawn against this in code. */
export function townChance(persona: Persona | null, pursuits: readonly Pursuit[], short: number): number {
  return clamp01(townPull(persona, pursuits) * (0.4 + 0.6 * clamp01(short)));
}

/** What the character could spend gold on beyond the basket, with saving it always among them. */
export function purchaseCandidates(view: AgentView, persona: Persona | null, aims: readonly Aim[]): PurchaseKind[] {
  const player = view.player();
  if (player.depth !== 0 || player.gold <= 0 || missingEssentials(view, persona).length > 0) return [];
  const kinds: PurchaseKind[] = supplyNeeds(view, readPack(view), persona).filter((need) => need.have < need.want).map((need) => need.kind);
  if (aims.some((aim) => aim.kind !== "win" && affordable(aim, player.gold))) kinds.push("gear");
  if (kinds.length === 0) return [];
  return [...new Set([...kinds, "save" as const])];
}

/** The persona's own lean toward one purchase, 0 to 1. */
export function purchaseLean(kind: PurchaseKind, persona: Persona | null, pursuits: readonly Pursuit[]): number {
  const w = (k: Pursuit["kind"]) => pursuitWeight(pursuits, k);
  const s = persona?.sliders;
  switch (kind) {
    case "gear": return clamp01(0.3 + 0.5 * w("treasure") + 0.2 * w("win") - 0.5 * (unit(s?.savings ?? 50) - 0.5));
    case "save": return clamp01(0.15 + 0.3 * w("riches") + 0.8 * (unit(s?.savings ?? 50) - 0.5));
    case "healing": return clamp01(0.45 + 0.4 * w("lineage"));
    case "phase":
    case "escape": return clamp01(0.35 + 0.5 * w("lineage") + 0.2 * unit(s?.escapes ?? 50) - 0.1);
    case "recall": return clamp01(0.35 + 0.3 * w("win") + 0.2 * w("lineage"));
    case "food": return 0.45;
    case "light": return 0.4;
    case "oil":
    case "ammo": return clamp01(0.25 + 0.3 * w("uniques") + 0.2 * w("depth"));
  }
}

/**
 * The buying order: the persona's lean plus a small random draw so one visit
 * is not a copy of the last. Anything below saving is left unpurchased.
 */
export function purchaseOrder(candidates: readonly PurchaseKind[], persona: Persona | null, pursuits: readonly Pursuit[], rng: () => number): PurchaseKind[] {
  const value = new Map<PurchaseKind, number>();
  for (const kind of candidates) value.set(kind, purchaseLean(kind, persona, pursuits) + 0.06 * rng());
  return [...candidates].sort((a, b) => (value.get(b) ?? 0) - (value.get(a) ?? 0));
}

/** What one review decides in code: the trip home, and the buying order for this town visit. */
export interface Judgments {
  readonly town: { readonly reason: string; readonly short: number } | null;
  readonly purchases: readonly PurchaseKind[];
}

export function judgmentsFor(view: AgentView, persona: Persona | null, aims: readonly Aim[], wantTown: boolean, pursuits: readonly Pursuit[] = []): Judgments {
  const reason = wantTown ? townReason(view, persona, pursuits) : null;
  const town = reason === null ? null : { reason, short: shortfall(view, persona, pursuits) };
  const purchases = purchaseCandidates(view, persona, aims);
  return { town, purchases: purchases.length > 1 ? purchases : [] };
}
