/**
 * What Squire sets up for every character it is enabled for, handed over or
 * not: the Squire panel, Knight's Lessons, and the kill count.
 */

import type { AgentView, ItemView } from "@rpgm-tools/neo-angband-core";
import { createGoalPlanner, type GoalDigest } from "./brain/goals.js";
import type { Question } from "./brain/brain.js";
import { cfgFromFlags } from "./settings.js";
import { noTerrain, readTerrain, type FeatureLike, type TerrainFlagIndex } from "./terrain.js";
import type { Runtime, SquireHost } from "./runtime.js";
import {
  emptyApprentice,
  goalOfCommand,
  isDecisionPoint,
  momentOf,
  note,
  noteLine,
  proceduralPick,
  type Apprentice,
  type Moment,
  type NotebookEntry,
  type PlayerCommand,
} from "./knight.js";
import type { Goal } from "./brain/goals.js";
import { mountPanel } from "./ui/panel.js";

type EventHandler = (name: string, payload: unknown) => void;

/** The host context `register` receives, as far as Squire reads it. */
export interface AttachHost extends SquireHost {
  readonly flags: Readonly<Record<string, boolean>>;
  readonly core?: {
    createAgentView?(state: unknown): AgentView;
    readonly TF?: TerrainFlagIndex;
  };
  readonly registries?: { readonly features?: { allFeatures(): readonly FeatureLike[] } };
  readonly state?: unknown;
  readonly events?: { on(name: string, handler: EventHandler): void; off?(name: string, handler: EventHandler): void };
  readonly ui?: { registerPanelKind?(spec: PanelKindSpecLike): () => void };
}

/** The host's panel kind spec (MOD_SEAMS 4p), as far as Squire fills it. */
export interface PanelKindSpecLike {
  readonly kind: string;
  readonly label: string;
  readonly tab?: string;
  readonly minWidth?: number;
  readonly minHeight?: number;
  readonly preferredPlacement?: { readonly kind: "dock"; readonly target: string; readonly edge: "left" | "right" | "top" | "bottom" };
  mount(host: PanelHostLike): (() => void) | void;
}

export interface PanelHostLike {
  readonly root: ShadowRoot | HTMLElement;
  onStateChange?(listener: (state: { readonly active: boolean }) => void): () => void;
  requestFocus?(): void;
}

/** Knight's Lessons, as the panel sees it. */
export interface Lessons {
  apprentice(): Apprentice;
  onChange(listener: (apprentice: Apprentice) => void): () => void;
  /** Mark the next few decisions as demonstrations. */
  watchThis(): void;
  /** Answer "Why, sir?" for a notebook entry. */
  why(entry: NotebookEntry, reason: string): void;
}

const APPRENTICE_KEY = "squire/apprentice";
const DEMONSTRATION_DECISIONS = 5;

export function attachSquire(ctx: AttachHost, rt: Runtime): Lessons {
  const make = ctx.core?.createAgentView;

  /**
   * A view of the game while the player plays. The pack comes from the input
   * snapshot, whose items carry the names the inventory shows, so the
   * apprentice knows exactly what the player knows.
   */
  function viewNow(): AgentView | null {
    if (make === undefined || ctx.state === undefined) return null;
    const base = make(ctx.state);
    const snap = ctx.snapshot?.() as unknown as { readonly core?: { readonly inventory?: ItemView[]; readonly equipment?: (ItemView | null)[] } } | null;
    const inventory = snap?.core?.inventory ?? [];
    const equipment = snap?.core?.equipment ?? [];
    return { ...base, inventory: () => inventory, equipment: () => equipment };
  }

  /* Kills, for the report and telemetry. A killing blow fires while the
   * monster still holds its index, so its race can be read then. */
  ctx.events?.on("combat-outcome", (_name, payload) => {
    const p = payload as { readonly attacker?: unknown; readonly target?: unknown; readonly died?: unknown };
    if (p.attacker !== "player" || p.died !== true || typeof p.target !== "number") return;
    const view = viewNow();
    const monster = view?.monsters().find((m) => m.id === p.target);
    if (monster !== undefined) rt.recordKill(monster.race, monster.raceFlags.includes("UNIQUE"), view ?? null);
  });

  let apprentice = emptyApprentice();
  const listeners = new Set<(a: Apprentice) => void>();
  let demonstrations = 0;
  let previous: Moment | null = null;
  let asking = false;
  void rt
    .store()
    .get(APPRENTICE_KEY)
    .then((stored) => {
      const s = stored as Partial<Apprentice> | undefined;
      if (s !== undefined && Array.isArray(s.entries) && typeof s.agreed === "number" && typeof s.total === "number") {
        apprentice = { entries: s.entries, agreed: s.agreed, total: s.total };
        for (const l of listeners) l(apprentice);
      }
    });

  function save(next: Apprentice): void {
    apprentice = next;
    void rt.store().set(APPRENTICE_KEY, next);
    for (const l of listeners) l(next);
  }

  const terrain =
    ctx.registries?.features !== undefined && ctx.core?.TF !== undefined
      ? readTerrain(ctx.registries.features.allFeatures(), ctx.core.TF)
      : noTerrain();
  const planner = createGoalPlanner({ cfg: cfgFromFlags(ctx.flags), terrain, log: () => {} });

  function record(squire: Goal, knight: Goal, view: AgentView): void {
    const p = view.player();
    const share = p.maxHp > 0 ? p.hp / p.maxHp : 1;
    const demonstration = demonstrations > 0;
    if (demonstration) demonstrations -= 1;
    save(
      note(apprentice, {
        turn: view.turn(),
        squire,
        knight,
        agreed: squire === knight,
        line: noteLine(squire, knight, share),
        demonstration,
      }),
    );
  }

  ctx.events?.on("player-command", (_name, payload) => {
    if (rt.brain() !== null) return;
    const view = viewNow();
    if (view === null) return;
    /* The journal follows the whole run, including the turns the player
     * plays, so the depth chart and report have no gaps. */
    rt.observe(view);
    if (!rt.config().knightsLessons.enabled) return;
    const knight = goalOfCommand(payload as PlayerCommand, view);
    const moment = momentOf(view);
    const point = isDecisionPoint(previous, moment, knight);
    previous = moment;
    if (!point || knight === null) return;
    const asked = planner.ask(view);
    if ("handBack" in asked) return;
    const question: Question<GoalDigest> = asked;
    const p = view.player();
    const share = p.maxHp > 0 ? p.hp / p.maxHp : 1;
    const offline = proceduralPick(question.context.offers, share);
    const backend = rt.backend();
    if (backend === null || asking) {
      if (offline !== null) record(offline, knight, view);
      return;
    }
    /* One question in flight at a time: a player moving quickly should not
     * queue up a request per step. */
    asking = true;
    void rt.send(question.request).then((result) => {
      asking = false;
      if (result.ok) {
        rt.tally().record(backend, result.usage, Date.now());
        const answer = result.answers["goal"];
        const pick = answer?.type === "choice" ? answer.choice : "none_of_these";
        const squire = question.context.offers.find((o) => o.goal === pick)?.goal ?? offline;
        if (squire !== null && squire !== undefined) record(squire, knight, view);
      } else if (offline !== null) {
        record(offline, knight, view);
      }
    });
  });

  const lessons: Lessons = {
    apprentice: () => apprentice,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    watchThis() {
      demonstrations = DEMONSTRATION_DECISIONS;
    },
    why(entry, reason) {
      save({
        ...apprentice,
        entries: apprentice.entries.map((e) => (e === entry ? { ...e, reason } : e)),
      });
    },
  };

  const register = ctx.ui?.registerPanelKind;
  if (register !== undefined) {
    register.call(ctx.ui, {
      kind: "squire",
      label: "Squire",
      tab: "Squire",
      minWidth: 260,
      minHeight: 200,
      preferredPlacement: { kind: "dock", target: "main", edge: "right" },
      mount: (host) => mountPanel(host, rt, lessons),
    });
  }
  return lessons;
}
