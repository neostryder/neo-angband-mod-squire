/** Shop knowledge belongs to the character and starts at the shop door. */

import type { AgentView } from "@rpgm-tools/neo-angband-core";
import { jitteredStrength } from "../persona/blend.js";
import type { Persona } from "../persona/persona.js";
import type { Terrain } from "../terrain.js";
import { shownName } from "./needs.js";

export interface RememberedWare {
  readonly name: string;
  readonly tval: number;
  readonly price: number;
  readonly count: number;
}

export interface StoreMemory {
  readonly feat: number;
  readonly name: string;
  readonly owner: string | null;
  readonly turn: number;
  readonly lifetime: number;
  readonly stock: readonly RememberedWare[];
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function number(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function readStoreMemory(value: unknown): StoreMemory[] {
  if (!Array.isArray(value)) return [];
  const found = new Set<number>();
  return value.flatMap((entry): StoreMemory[] => {
    const raw = record(entry);
    if (!number(raw["feat"]) || found.has(raw["feat"]) || !number(raw["turn"]) || !number(raw["lifetime"]) || raw["lifetime"] <= 0 || typeof raw["name"] !== "string" || !Array.isArray(raw["stock"])) return [];
    found.add(raw["feat"]);
    const stock = raw["stock"].flatMap((item): RememberedWare[] => {
      const ware = record(item);
      return typeof ware["name"] === "string" && number(ware["tval"]) && number(ware["price"]) && number(ware["count"]) && ware["count"] > 0
        ? [{ name: ware["name"], tval: ware["tval"], price: ware["price"], count: ware["count"] }] : [];
    });
    return [{ feat: raw["feat"], name: raw["name"], owner: typeof raw["owner"] === "string" ? raw["owner"] : null, turn: raw["turn"], lifetime: raw["lifetime"], stock }];
  });
}

export function stockConfidence(memory: StoreMemory, turn: number): number {
  return Math.max(0, 1 - Math.max(0, turn - memory.turn) / memory.lifetime);
}

export function wareName(name: string): string {
  /* A smaller stack still contains the remembered item. */
  return name.replace(/^(?:a|an|the|\d+)\s+/i, "").toLowerCase()
    .replace(/\btorches\b/g, "torch").replace(/\bknives\b/g, "knife").replace(/\bstaves\b/g, "staff")
    .replace(/\b(\w+)s\b/g, "$1");
}

/** A memory that never fades: only the shop itself changing makes it wrong. */
export const LASTING_MEMORY = Number.MAX_SAFE_INTEGER;

function lifetime(view: AgentView, persona: Persona | null, rng: () => number): number {
  const forgetful = persona?.quirks.forgetful;
  if (persona === null || forgetful === undefined || !forgetful.on) return LASTING_MEMORY;
  /* Store days accumulate in dungeon time and maintenance consumes them in town. */
  const day = 10 * (view.constants().storeTurns || 1000);
  const sliders = persona.sliders;
  const habit = (sliders.patience + sliders.greed - sliders.impulsiveness - 50) / 200 - forgetful.strength / 100;
  return day * 2 * Math.max(0.25, 1 + jitteredStrength(persona, rng) * habit);
}

export function createStoreMemory(initial: readonly StoreMemory[] = [], save: (memory: readonly StoreMemory[]) => void = () => {}, rng: () => number = Math.random) {
  let memories = [...initial];
  let entered: number | null = null;
  return {
    all: (): readonly StoreMemory[] => memories,
    reset(): void {
      memories = [];
      entered = null;
      save(memories);
    },
    observe(view: AgentView, terrain: Terrain, persona: Persona | null): { readonly changed: boolean; readonly entered: boolean; readonly memory: StoreMemory | null } {
      const player = view.player();
      const cell = view.cell(player.grid.x, player.grid.y);
      if (player.depth !== 0 || cell === null || !terrain.isShopEntrance(cell.feat)) {
        entered = null;
        return { changed: false, entered: false, memory: null };
      }
      let store;
      try {
        store = view.stores().find((entry) => entry.feat === cell.feat);
      } catch {
        return { changed: false, entered: false, memory: null };
      }
      if (store === undefined || store.isHome) return { changed: false, entered: false, memory: null };
      const previous = memories.find((entry) => entry.feat === store.feat);
      const owner = store.owner?.name ?? null;
      const fresh = entered !== store.feat;
      entered = store.feat;
      const memory: StoreMemory = {
        feat: store.feat, name: terrain.shopName(store.feat) ?? store.featName, owner, turn: view.turn(),
        lifetime: !fresh && previous?.owner === owner ? previous.lifetime : lifetime(view, persona, rng),
        stock: store.stock.flatMap((item) => {
          const name = shownName(item);
          return name !== null && item.number > 0 && item.price !== undefined && item.price > 0 ? [{ name, tval: item.tval, price: item.price, count: item.number }] : [];
        }),
      };
      const changed = fresh || JSON.stringify(previous === undefined ? undefined : { ...previous, turn: memory.turn }) !== JSON.stringify(memory);
      if (changed) {
        /* A new proprietor replaces every old observation of this shop. */
        memories = [...memories.filter((entry) => entry.feat !== memory.feat), memory];
        save(memories);
      }
      return { changed, entered: fresh, memory };
    },
  };
}
