/**
 * What Squire sets up for every character it is enabled for, handed over or
 * not: the Squire panel, Knight's Lessons, and the kill count.
 */

import type { Api2PanelKindSpec, Api2PanelMount } from "@rpgm-tools/neo-angband-mod-sdk";
import type { AgentView } from "./host-adapter.js";
import type { Api2Host } from "./api2/host.js";
import type { Terrain } from "./terrain.js";
import { turnEnergy } from "./energy.js";
import { createGoalPlanner, type GoalDigest } from "./brain/goals.js";
import type { Question } from "./brain/brain.js";
import { cfgFromFlags } from "./settings.js";
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
import { inferPersona, type InferredPersona } from "./learning/ranks.js";
import type { CoachingExample } from "./learning/coaching.js";
import { commandEvidence, signatureForView } from "./lessons/evidence.js";
import { subscribeExam } from "./lessons/exam.js";
import { saveInferredPersona } from "./lessons/persona.js";
import { ghostAfterCommand, ghostHint } from "./lessons/ghost.js";
import { activePersona } from "./config.js";
import type { Persona } from "./persona/persona.js";

/** The plugin context fields used while attaching Squire's panels and events. */
export type AttachHost = Pick<Api2Host, "settings" | "events" | "viewNow" | "readWorld"> & SquireHost;
export type PanelHostLike = Pick<Api2PanelMount, "root" | "onStateChange" | "requestFocus">;

/** Knight's Lessons, as the panel sees it. */
export interface Lessons {
  apprentice(): Apprentice;
  onChange(listener: (apprentice: Apprentice) => void): () => void;
  /** Mark the next few decisions as demonstrations. */
  watchThis(): void;
  /** Answer "Why, sir?" for a notebook entry. */
  why(entry: NotebookEntry, reason: string): void;
  inferred(): InferredPersona;
  squirePersona(): Persona | null;
  savePersona(use: boolean): void;
  ghostEnabled(): boolean;
  setGhost(enabled: boolean): void;
  takeExam(): void;
}

const APPRENTICE_KEY = "squire/apprentice";
const DEMONSTRATION_DECISIONS = 5;

/** What attachSquire leaves behind: Knight's Lessons, and the cleanup that takes the panel kind back out of the game's panel list. */
export type Attached = Lessons & { detach(): void };

export function attachSquire(ctx: AttachHost, rt: Runtime, terrain: Terrain): Attached {
  /** The game as last read, for an event that fires while the monster is still in it. */
  function viewNow(): AgentView | null {
    return ctx.viewNow();
  }

  /* Kills, for the report and telemetry. A killing blow fires while the
   * monster still holds its index, so its race can be read then. */
  ctx.events?.on("combat-outcome", (p) => {
    if (p.attacker !== "player" || !p.died || typeof p.target !== "object") return;
    const target = p.target.monster;
    const view = viewNow();
    const monster = view?.monsters().find((m) => m.id === target);
    if (monster !== undefined) rt.recordKill(monster.race, monster.raceFlags.includes("UNIQUE"), view ?? null);
  });

  let apprentice = emptyApprentice();
  const listeners = new Set<(a: Apprentice) => void>();
  let demonstrations = 0;
  let previous: Moment | null = null;
  let asking = false;
  let decisionSerial = 0;
  let pendingRest: number | null = null;
  const exam = subscribeExam(rt, () => apprentice.entries, (result) => {
    save({ ...apprentice, examArmed: false, exams: [...apprentice.exams, result].slice(-10),
      entries: [...apprentice.entries, { turn: rt.decisionView()?.turn() ?? 0, squire: "rest" as const, knight: "rest" as const,
        agreed: true, line: `Exam: matched your choice ${String(result.matched)} of ${String(result.scored)} times`, demonstration: false }].slice(-200) });
  }, () => save({ ...apprentice, examArmed: false }));
  void rt
    .store()
    .get(APPRENTICE_KEY)
    .then((stored) => {
      const s = stored as Partial<Apprentice> | undefined;
      if (s !== undefined && Array.isArray(s.entries) && typeof s.agreed === "number" && typeof s.total === "number") {
        apprentice = { ...emptyApprentice(), ...s, entries: s.entries, agreed: s.agreed, total: s.total,
          commands: Array.isArray(s.commands) ? s.commands : [], exams: Array.isArray(s.exams) ? s.exams : [] };
        if (apprentice.examArmed) exam.arm();
        for (const l of listeners) l(apprentice);
      }
    });

  function save(next: Apprentice): void {
    apprentice = next;
    void rt.store().set(APPRENTICE_KEY, next);
    for (const l of listeners) l(next);
  }

  const planner = createGoalPlanner({ cfg: cfgFromFlags(ctx.flags ?? {}, ctx.settings), terrain, log: () => {}, speedEnergy: turnEnergy });

  function record(squire: Goal, knight: Goal, view: AgentView, dangerousNear: boolean, serial: number, confidence?: number): void {
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
        signature: signatureForView(view),
        dangerousNear,
        ...(confidence === undefined ? {} : { confidence }),
      }),
    );
    if (rt.config().knightsLessons.ghost && serial === decisionSerial) {
      save({ ...apprentice, ghostHint: ghostHint(squire, knight, view), ghostGoal: squire === knight ? null : squire });
    }
  }

  ctx.events?.on("player-command", (payload) => {
    exam.end();
    /* Only the player's commands teach the apprentice. */
    if (rt.takeOwnCommand(payload as PlayerCommand, Date.now())) return;
    /* The game is read after the event, so a command that has already run shows its effect; the apprentice learns from the turn that follows. */
    void ctx.readWorld().then((view) => { if (view !== null) learnFrom(payload as PlayerCommand, view); });
  });

  function learnFrom(payload: PlayerCommand, view: AgentView): void {
    const serial = ++decisionSerial;
    /* The journal follows the whole run, including the turns the player
     * plays, so the depth chart and report have no gaps. */
    rt.observe(view, terrain);
    rt.recordCommand(payload as PlayerCommand, view);
    if (!rt.config().knightsLessons.enabled) return;
    const knight = goalOfCommand(payload, view);
    const evidence = commandEvidence(payload, knight, view);
    const dangerousNear = evidence?.dangerousNear ?? false;
    if (pendingRest !== null) {
      save({ ...apprentice, commands: apprentice.commands.map((item, index) => index === pendingRest
        ? { ...item, restedToFull: view.player().hp >= view.player().maxHp } : item) });
      pendingRest = null;
    }
    if (evidence !== null) {
      const commands = [...apprentice.commands, evidence].slice(-1000);
      pendingRest = evidence.kind === "rest" ? commands.length - 1 : null;
      save({ ...apprentice, commands });
    }
    if (apprentice.ghostHint !== null && ghostAfterCommand(apprentice.ghostHint, apprentice.ghostGoal, knight) === null)
      save({ ...apprentice, ghostHint: null, ghostGoal: null });
    const moment = momentOf(view);
    const point = isDecisionPoint(previous, moment, knight);
    previous = moment;
    if (!point || knight === null) return;
    const asked = planner.ask(view);
    if ("handBack" in asked) return;
    /* Squire's choice at a forced or routine moment is known without asking the model. */
    if ("reflex" in asked) {
      const answer = asked.answers["goal"];
      const goal = asked.context.offers.find((o) => answer?.type === "choice" && o.goal === answer.choice)?.goal;
      if (goal !== undefined) record(goal, knight, view, dangerousNear, serial);
      return;
    }
    const question: Question<GoalDigest> = asked;
    const p = view.player();
    const share = p.maxHp > 0 ? p.hp / p.maxHp : 1;
    const offline = proceduralPick(question.context.offers, share);
    const backend = rt.backend();
    if (backend === null || asking) {
      if (offline !== null) record(offline, knight, view, dangerousNear, serial);
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
        if (squire !== null && squire !== undefined) record(squire, knight, view, dangerousNear, serial,
          answer?.type === "choice" ? answer.confidence : undefined);
        /* The knight's own goal is a human label for Laya's training. */
        void rt.recordLesson(question.request, result.answers, result.model, apprentice.total, knight, question.context.layers).catch(() => {});
      } else if (offline !== null) {
        record(offline, knight, view, dangerousNear, serial);
      }
    });
  }

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
    inferred() {
      const examples: CoachingExample[] = apprentice.entries.filter((entry) => entry.signature !== undefined).map((entry) => ({
        situation: { dangerousNear: entry.dangerousNear === true }, offered: [],
        squirePick: entry.squire, playerPick: entry.knight, question: "goal", source: entry.demonstration ? "watch" : "takeover",
        weight: entry.demonstration ? 2 : 1,
      }));
      return inferPersona(examples, apprentice.commands);
    },
    squirePersona: () => rt.character().persona ?? activePersona(rt.config()),
    savePersona(use) {
      saveInferredPersona(rt, lessons.inferred().persona, ctx.character?.key?.() ?? "Player", use);
    },
    ghostEnabled: () => rt.config().knightsLessons.ghost,
    setGhost(enabled) {
      const config = rt.config();
      rt.saveConfig({ ...config, knightsLessons: { ...config.knightsLessons, ghost: enabled } });
      if (!enabled) save({ ...apprentice, ghostHint: null, ghostGoal: null });
    },
    takeExam() {
      if (apprentice.entries.filter((entry) => entry.signature !== undefined).length < 40) return;
      exam.arm();
      save({ ...apprentice, examArmed: true });
    },
  };

  let unregister: (() => void) | undefined;
  const register = ctx.ui?.registerPanelKind;
  if (register !== undefined) {
    unregister = register.call(ctx.ui, {
      kind: "squire",
      label: "Squire",
      tab: "Squire",
      minSize: { width: 260, height: 200 },
      preferredPlacement: { kind: "dock", target: "main", edge: "right" },
      mount: (host) => mountPanel(host, rt, lessons),
    });
  }
  return Object.assign(lessons, {
    detach(): void {
      unregister?.();
      unregister = undefined;
    },
  });
}
