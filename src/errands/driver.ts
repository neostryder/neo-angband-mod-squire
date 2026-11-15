/**
 * The errand driver: Squire's play with the errand menu laid over it.
 *
 * While nothing is chosen, the controller Squire would have installed anyway
 * plays as before. The errand key opens the menu, and play pauses while it
 * shows: no command is given, so no game time passes. Choosing an errand runs
 * it to its end, then gives the keyboard back with a status line saying how it
 * ended.
 *
 * ------------------------------------------------------------------
 * SELF-PRESERVATION IS NOT AN ERRAND'S TO SWITCH OFF
 * ------------------------------------------------------------------
 *
 * Before every errand decision the driver asks whether anything is dangerous: a
 * creature awake in sight, hit points at the retreat line, a condition such as
 * blindness, harmful ground, hunger with food in the pack. While it is, the
 * decision belongs to a goal planner narrowed to the safety goals, with its
 * safety floor, reflexes and escapes intact. The errand resumes when it has
 * passed. Nothing an errand or a setting says turns that check off.
 *
 * ------------------------------------------------------------------
 * COMPLIANT BY DEFAULT
 * ------------------------------------------------------------------
 *
 * An errand runs the plain way: no persona, so no quirks or grudges, and no Law
 * to Chaos draw. With the persona setting on, the persona changes the route
 * (a wary one keeps a step away from creatures), the risk (a bold one holds on
 * past the retreat line a little longer) and what is picked up. It never
 * decides whether the errand is done.
 *
 * ------------------------------------------------------------------
 * THE HAND-BACK EPOCH
 * ------------------------------------------------------------------
 *
 * A counter that moves on every hand-back and every errand start. A model
 * answer carries the epoch it was asked under and the state it was asked about,
 * and one from an older epoch or another state is dropped when it lands.
 */

import type { AgentActions, AgentCommand, AgentController, AgentView, ControllerKeyAnswer, ControllerKeyPress } from "@rpgm-tools/neo-angband-core";
import type { SquireContext } from "../context.js";
import type { Mission, Stop } from "../mission.js";
import { isStop } from "../mission.js";
import type { Brain, Plan } from "../brain/brain.js";
import type { Persona } from "../persona/persona.js";
import type { SquireCfg } from "../settings.js";
import type { Terrain } from "../terrain.js";
import type { Loc } from "../grid.js";
import { steps } from "../grid.js";
import { newProgress, type Progress } from "../progress.js";
import { standingOnHarm } from "../map.js";
import { harmlessKind } from "../brain/threat-model.js";
import { hungry, readPack } from "../brain/pack.js";
import { inStore } from "../orders/vocab.js";
import { errandMenu, type ErrandEntry, type ErrandId } from "./catalog.js";
import { endsOnNewLevel, errandMission, type ErrandEnv } from "./run.js";
import { keyHandler, type KeyTarget } from "./keys.js";
import { ERRAND_TEXT } from "./text.js";

/** What the menu panel shows. */
export interface MenuModel {
  readonly key: string;
  readonly entries: readonly ErrandEntry[];
  /** The model's short list, best first. Empty when there is none. */
  readonly suggested: readonly ErrandEntry[];
}

/** The menu panel, as the driver drives it. */
export interface MenuView {
  show(model: MenuModel, pick: (position: number) => void): void;
  hide(): void;
}

export interface DriverDeps {
  readonly cfg: SquireCfg;
  readonly terrain: Terrain;
  readonly log: (message: string) => void;
  errandKey(): string;
  /** The character's persona. Read only when the persona setting is on. */
  persona(): Persona | null;
  /** A goal brain narrowed to the safety goals, publishing its status through `status`. */
  safety(status: (label: string, reason?: string) => void): Brain;
  /** A shopping trip, played the way `persona` says (null for the plain way). */
  shopping(persona: Persona | null): Plan;
  status(label: string, reason?: string): void;
  /** Give the keyboard back. Absent on a game too old to let a mod do it. */
  readonly release?: (reason: string) => void;
  readonly menu?: MenuView;
  /** Ask the model for the short list. Absent when no model is in use. */
  readonly rank?: (view: AgentView, entries: readonly ErrandEntry[]) => Promise<readonly ErrandId[] | null>;
  /** Called on every hand-back, after the driver has dropped its own state. */
  readonly onHandBack?: (source: string) => void;
}

export type DriverMode = "free" | "errand" | "ended";

export interface ErrandDriver {
  /** Wrap the controller Squire plays with when no errand is running. */
  controller(free: AgentController): AgentController;
  /** The host's `onKey`. */
  onKey(press: ControllerKeyPress): ControllerKeyAnswer;
  /** The hand-back epoch. */
  epoch(): number;
  mode(): DriverMode;
  menuOpen(): boolean;
  /** The errand running, or null. */
  errand(): ErrandId | null;
  /** The short list showing on the menu, best first. */
  suggested(): readonly ErrandId[];
  /** The player has the keyboard again: drop the errand, the menu and anything in flight. */
  handBack(source: string): void;
  /** Start an errand by its menu position. Null once started, otherwise why not. */
  pick(position: number): string | null;
}

/** An errand runs this many times the short errand's decisions before it gives up. */
export const ERRAND_BUDGET_FACTOR = 10;

/** Decisions one spell of looking after itself may take before Squire gives the errand up. */
export const SAFETY_DECISIONS = 400;

/** Waits in a row from the safety planner before the errand gets a decision of its own. */
const SAFETY_WAITS = 4;

const AFFLICTIONS = ["blind", "confused", "afraid", "poisoned", "cut", "stun", "paralyzed"] as const;

/**
 * Why the character needs looking after right now, or null when it does not.
 *
 * In town, a creature counts only once it is next to the character: the
 * townspeople wander, and most of them are harmless at a distance.
 */
export function danger(view: AgentView, terrain: Terrain, retreat: number): string | null {
  const player = view.player();
  if (player.maxHp > 0 && player.hp <= player.maxHp * retreat) return "hit points are at the retreat line";
  const afflicted = AFFLICTIONS.filter((name) => (player.status[name] ?? 0) > 0);
  if (afflicted.length > 0) return `the character is ${afflicted.join(" and ")}`;
  if (standingOnHarm(view, terrain, player.grid)) return "the ground is harmful";
  if (hungry(view) && readPack(view).food.length > 0) return "the character is hungry";
  const town = player.depth === 0;
  for (const monster of view.monsters()) {
    if (!monster.visible || monster.asleep) continue;
    if (town && steps(player.grid, monster.grid) > 1) continue;
    if (harmlessKind(monster, view)) continue;
    return `a ${monster.race} is awake in sight`;
  }
  return null;
}

/** The retreat line an errand watches: the setting's, moved by boldness when the persona colours errands. */
export function retreatLine(cfg: SquireCfg, persona: Persona | null): number {
  if (persona === null) return cfg.retreatFraction;
  const boldness = persona.sliders.boldness ?? 50;
  return Math.min(0.9, Math.max(0.1, cfg.retreatFraction * (1.5 - boldness / 100)));
}

/** Grids a wary persona keeps away from: those next to a creature in sight. */
export function waryAvoid(view: AgentView, persona: Persona | null): ((grid: Loc) => boolean) | undefined {
  if (persona === null || (persona.sliders.paranoia ?? 50) < 60) return undefined;
  const seen = view.monsters().filter((m) => m.visible).map((m) => m.grid);
  if (seen.length === 0) return undefined;
  return (grid) => seen.some((m) => steps(m, grid) <= 1);
}

/** The state an answer was asked about: the turn, the depth and the grid. */
export function stateKey(view: AgentView): string {
  const player = view.player();
  return `${String(view.turn())}:${String(player.depth)}:${String(player.grid.x)},${String(player.grid.y)}`;
}

interface Running {
  readonly id: ErrandId;
  readonly label: string;
  mission: Mission | null;
  progress: Progress | null;
  startDepth: number;
  decisions: number;
}

export function createErrandDriver(deps: DriverDeps): ErrandDriver {
  const { cfg, terrain, log } = deps;
  let epoch = 0;
  let mode: DriverMode = "free";
  let menu = false;
  let suggestedIds: readonly ErrandId[] = [];
  let running: Running | null = null;
  let safety: Brain | null = null;
  let safetyDecisions = 0;
  let safetyWaits = 0;
  let lastView: AgentView | null = null;
  /* The ending, until the keyboard has been given back. */
  let ending: { readonly text: string; shopLeft: boolean; released: boolean } | null = null;

  const coloured = (): Persona | null => (cfg.personaErrands ? deps.persona() : null);

  const env: ErrandEnv = {
    persona: coloured,
    avoid: (view) => waryAvoid(view, coloured()),
    shopping: () => deps.shopping(coloured()),
  };

  function entries(view: AgentView): ErrandEntry[] {
    return errandMenu(view, terrain);
  }

  function showMenu(): void {
    if (!menu || lastView === null) return;
    const all = entries(lastView);
    const suggested = suggestedIds.map((id) => all.find((entry) => entry.id === id)).filter((entry): entry is ErrandEntry => entry !== undefined && entry.reason === null);
    deps.menu?.show({ key: deps.errandKey(), entries: all, suggested }, (position) => {
      const refused = self.pick(position);
      if (refused !== null) log(`Squire did not start that errand: ${refused}`);
    });
  }

  function openMenu(): void {
    menu = true;
    suggestedIds = [];
    log("Squire opened the errand menu");
    showMenu();
    const view = lastView;
    if (view === null || deps.rank === undefined) return;
    const askedEpoch = epoch;
    const askedState = stateKey(view);
    deps.rank(view, entries(view)).then(
      (ids) => {
        if (ids === null) return;
        if (askedEpoch !== epoch || lastView === null || stateKey(lastView) !== askedState) {
          log("Squire dropped an errand ranking asked before things changed");
          return;
        }
        if (!menu) return;
        suggestedIds = ids;
        showMenu();
      },
      () => {},
    );
  }

  function closeMenu(): void {
    if (!menu) return;
    menu = false;
    suggestedIds = [];
    deps.menu?.hide();
    log("Squire closed the errand menu");
  }

  function start(entry: ErrandEntry): void {
    epoch += 1;
    closeMenu();
    safety = null;
    ending = null;
    running = { id: entry.id, label: entry.label, mission: null, progress: null, startDepth: lastView?.player().depth ?? 0, decisions: 0 };
    mode = "errand";
    deps.status(ERRAND_TEXT.running(entry.label));
    log(`errand started: ${entry.label}${cfg.personaErrands ? ", coloured by the persona" : ""}`);
  }

  function context(view: AgentView, act: AgentActions, progress: Progress): SquireContext {
    return { view, act, terrain, cfg, progress, log };
  }

  /** End the running errand and start giving the keyboard back. */
  function end(stop: Stop, view: AgentView, act: AgentActions): AgentCommand | null {
    const label = running?.label ?? "";
    const text = stop.reason === "done" ? ERRAND_TEXT.done(label, stop.detail) : ERRAND_TEXT.stopped(label, stop.detail);
    log(`errand ended (${stop.reason}): ${stop.detail}`);
    deps.status(ERRAND_TEXT.endedLabel, text);
    running = null;
    safety = null;
    mode = "ended";
    ending = { text, shopLeft: false, released: false };
    return finish(view, act);
  }

  /**
   * Leave nothing open behind: a shop screen is closed first, which takes no
   * game time, and then the keyboard goes back.
   */
  function finish(view: AgentView, act: AgentActions): AgentCommand | null {
    if (ending === null || ending.released) return null;
    if (!ending.shopLeft && inStore(view)) {
      ending.shopLeft = true;
      return act.shopExit();
    }
    ending.released = true;
    noteHandBack("the errand ended");
    if (deps.release === undefined) log("this game cannot take the keyboard back for Squire; press Escape to take it");
    else deps.release(ending.text);
    return null;
  }

  function errandStep(view: AgentView, act: AgentActions): AgentCommand | null {
    const job = running;
    if (job === null) return null;
    const player = view.player();
    if (job.mission === null || job.progress === null) {
      job.mission = errandMission(job.id, env);
      job.progress = newProgress(player.depth);
      job.startDepth = player.depth;
      const declined = job.mission.begin(context(view, act, job.progress));
      if (declined !== null) return end(declined, view, act);
    }
    if (player.dead) return end({ reason: "dead", detail: "The character died." }, view, act);
    if (endsOnNewLevel(job.id) && player.depth !== job.startDepth) {
      return end({ reason: "level-changed", detail: `The character is now on ${player.depth === 0 ? "the town level" : `level ${String(player.depth)}`}.` }, view, act);
    }
    job.decisions += 1;
    const threat = danger(view, terrain, retreatLine(cfg, coloured()));
    const busy = safety !== null && (safety.state() === "running" || safety.state() === "asking");
    /* The budget ends an errand only once the danger has passed; the safety planner has its own limit. */
    if (threat === null && !busy && job.decisions > cfg.errandSteps * ERRAND_BUDGET_FACTOR) {
      return end({ reason: "budget", detail: "It took more decisions than an errand is allowed." }, view, act);
    }
    if (threat !== null || busy) {
      if (safety === null) {
        safety = deps.safety((label, reason) => deps.status(ERRAND_TEXT.running(job.label), reason ?? label));
        safetyDecisions = 0;
        safetyWaits = 0;
        log(`errand: Squire looks after the character first (${threat ?? "a plan is still running"})`);
      }
      safetyDecisions += 1;
      if (safetyDecisions > SAFETY_DECISIONS) {
        return end({ reason: "blocked", detail: "Squire could not get the character clear of danger." }, view, act);
      }
      let command = safety.controller(view, act);
      /* A planner that has just chosen a plan answers nothing on that call; its first step is the next one. */
      if (command === null && safety.state() === "running") command = safety.controller(view, act);
      const waiting = command?.code === "hold";
      safetyWaits = waiting ? safetyWaits + 1 : 0;
      /* A planner that can only wait, again and again, while something stays in
       * sight is not looking after anything. The errand takes a turn. */
      if (command !== null && safetyWaits <= SAFETY_WAITS) return command;
      if (command === null && (safety.state() === "asking" || safety.state() === "waiting" || safety.state() === "running")) return null;
      safetyWaits = 0;
    } else if (safety !== null) {
      safety = null;
      log("errand: the danger has passed, so the errand goes on");
    }

    const decision = job.mission.step(context(view, act, job.progress));
    if (isStop(decision)) return end(decision.stop, view, act);
    return decision.command;
  }

  const target: KeyTarget = {
    errandKey: () => deps.errandKey(),
    menuOpen: () => menu,
    openMenu,
    closeMenu,
    pick: (position) => self.pick(position),
    log,
  };
  const onKey = keyHandler(target);

  /** The keyboard went back: answers asked before now are stale, and the menu and the safety planner go. */
  function noteHandBack(source: string): void {
    epoch += 1;
    closeMenu();
    if (running !== null) log(`errand abandoned: ${running.label}`);
    running = null;
    safety = null;
    log(`Squire handed the keyboard back (${source})`);
    deps.onHandBack?.(source);
  }

  /** The player has the keyboard after an errand, so Squire plays as usual the next time it is handed over. */
  function backToFree(): void {
    mode = "free";
    ending = null;
  }

  const self: ErrandDriver = {
    controller(free) {
      return (view, act) => {
        lastView = view;
        /* Called again after the game took the keyboard back for the errand's
         * end: the player has handed it over once more. */
        if (mode === "ended" && ending?.released === true && deps.release !== undefined) backToFree();
        if (mode === "ended") return finish(view, act);
        /* The menu pauses play: nothing is decided while the player reads it. */
        if (menu) return null;
        if (mode === "errand") return errandStep(view, act);
        return free(view, act);
      };
    },
    onKey,
    epoch: () => epoch,
    mode: () => mode,
    menuOpen: () => menu,
    errand: () => running?.id ?? null,
    suggested: () => suggestedIds,
    handBack(source) {
      noteHandBack(source);
      backToFree();
    },
    pick(position) {
      const view = lastView;
      if (view === null) return ERRAND_TEXT.refused(ERRAND_TEXT.reasons.notYet);
      const entry = entries(view)[position - 1];
      if (entry === undefined) return ERRAND_TEXT.noSuchErrand;
      if (entry.reason !== null) return ERRAND_TEXT.refused(entry.reason);
      start(entry);
      return null;
    },
  };
  return self;
}
