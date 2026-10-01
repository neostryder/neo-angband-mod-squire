/**
 * One Squire per page: the settings, the character's own data, the decision
 * log, the token tally and telemetry, shared by the controller, the panel and
 * Knight's Lessons.
 *
 * The host calls `register` and `controller` separately and in no fixed
 * order, and the page reloads between characters, so the runtime is created by
 * whichever call comes first and lives until the page goes.
 */

import type { AgentCommand, AgentController, AgentView } from "@rpgm-tools/neo-angband-core";
import { ask, JEV, JEV_KEY_VARIABLES, type Backend, type NetLike } from "./brain/backend.js";
import { keyReady, type SecretsLike } from "./brain/boot.js";
import { createBrain, outcomeLine, type Brain, type DecisionRecord, type PlanEnd, type Token } from "./brain/brain.js";
import { createGoalPlanner, type GoalDigest } from "./brain/goals.js";
import { createTally, type Tally } from "./brain/tally.js";
import { createStrategy, type Strategy } from "./strategy/review.js";
import { passableAims } from "./strategy/heirs.js";
import { createOrders, type Orders } from "./orders/book.js";
import { createChannelPoller } from "./orders/channel.js";
import { queueInstruction } from "./orders/input.js";
import { readInstructions } from "./orders/read.js";
import type { Instruction } from "./orders/types.js";
import type { Answer, SystemOneRequest } from "./brain/systemone.js";
import { activePersona, backendFor, backstoryBudget, readConfig, writeConfig, type SquireConfig } from "./config.js";
import { indexedDbStore, type KvStore } from "./memory/kv.js";
import { createDecisionLog, type LoggedDecision } from "./memory/log.js";
import { markRollOn, sessionMarks, takeRollOn } from "./birth.js";
import { dreadedRaces } from "./learning/lessons.js";
import { feelingLine, feelingLog, remembered, settle, settledLine, type Feeling } from "./learning/grudges.js";
import { addMilestone, epitaphFor, familyVoice, milestoneFact, milestoneId, recallMilestones, type Milestone } from "./learning/flourishes.js";
import type { Lineage } from "./learning/lineage.js";
import { emptyFamilyFlourishes, emptyFlourishes, familyAfterDeath, flourishLines, learnedSuperstitions, observeFlourishes, readWays, usedItem, type Flourishes } from "./learning/family-ways.js";
import { installId } from "./memory/install.js";
import { normalize, type Persona } from "./persona/persona.js";
import type { SquireCfg } from "./settings.js";
import type { Terrain } from "./terrain.js";
import { buildBatches } from "./telemetry/batch.js";
import { createJournal, emptyJournal, heirFrom, withAncestor, type Journal, type JournalState } from "./journal.js";
import { buildRunSummary, summaryForTelemetry, type RunReport, type RunSummary } from "./report/summary.js";
import { defaultPersona } from "./persona/persona.js";
import { createSender } from "./telemetry/sender.js";
import { createRows, countRows, exportRows, rowId } from "./laya/rows.js";
import { createShadow } from "./laya/shadow.js";
import type { Apprentice } from "./knight.js";

/** The parts of the host's plugin context Squire uses, declared so the mod builds without the host's source. */
export interface SquireHost {
  readonly core?: { readonly turnEnergy?: (speed: number) => number };
  readonly log: (message: string) => void;
  readonly prefs?: { get(): unknown; set(value: unknown): void };
  readonly characterStore?: { get(): unknown; set(value: unknown): void };
  readonly character?: {
    key?(): string | null;
    onRunEnd?(listener: (report: RunReportLike) => void): () => void;
  };
  readonly net?: NetLike & { readonly secrets: SecretsLike & NetSecretsWrite };
  readonly snapshot?: () => { readonly token: Token } | null;
  readonly controller?: {
    setStatus(status: { readonly label?: string; readonly reason?: string }): void;
    markNondeterministic(): void;
    /** Available from Core 1.20.0. */
    release?(reason?: string): void;
  };
  readonly saves?: {
    create?(options?: { readonly like?: RunReportLike["birth"]; readonly resumeAutoplayer?: boolean }): Promise<{ readonly ok: boolean; readonly reason?: string }>;
  };
}

interface NetSecretsWrite {
  readonly storage: "os" | "page";
  set(name: string, value: string, options: { readonly hosts: readonly string[] }): Promise<{ readonly ok: boolean; readonly problem?: string }>;
  delete(name: string): Promise<{ readonly ok: boolean }>;
}

/** The host's run report. */
export type RunReportLike = RunReport;

/** What Squire keeps on one character's save. */
export interface CharacterData {
  readonly persona: Persona | null;
  readonly runId: string;
  /** Kills by race, counted from combat events. */
  readonly kills: Readonly<Record<string, number>>;
  readonly journal: JournalState;
  /** The family line this character belongs to, when it is an heir or has one. */
  readonly lineage: string | null;
  /** Orders and standing instructions, live and ended. */
  readonly orders: readonly Instruction[];
  readonly flourishes?: Flourishes;
}

const CHARACTER_FORMAT = "neo-angband/squire/character";

/** Matches manifest.json, which a test checks, so reports name the version the player installed. */
export const MOD_VERSION = "0.1.1";

/** Where Knight's Lessons row numbers start, far above any decision sequence number. */
const LESSON_SEQ_BASE = 500_000;

function runIdFor(key: string | null | undefined, now: number): string {
  const base = (key ?? "char").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "char";
  return `${base}-${now.toString(36)}`;
}

function readCharacter(stored: unknown): CharacterData | null {
  const env = stored !== null && typeof stored === "object" ? (stored as Record<string, unknown>) : null;
  if (env === null || env["format"] !== CHARACTER_FORMAT) return null;
  const data = env["data"] as Record<string, unknown> | undefined;
  if (data === undefined || typeof data["runId"] !== "string") return null;
  const kills: Record<string, number> = {};
  const raw = data["kills"];
  if (raw !== null && typeof raw === "object") {
    for (const [race, n] of Object.entries(raw as Record<string, unknown>)) if (typeof n === "number") kills[race] = n;
  }
  const j = (data["journal"] ?? {}) as Record<string, unknown>;
  const journal: JournalState = {
    runLog: typeof j["runLog"] === "string" ? j["runLog"] : "",
    chronicle: Array.isArray(j["chronicle"]) ? (j["chronicle"] as unknown[]).filter((l): l is string => typeof l === "string") : [],
    lessons: Array.isArray(j["lessons"]) ? (j["lessons"] as JournalState["lessons"]) : [],
    calibration: j["calibration"] !== null && typeof j["calibration"] === "object" ? (j["calibration"] as JournalState["calibration"]) : {},
  };
  return {
    persona: data["persona"] == null ? null : normalize(data["persona"]),
    runId: data["runId"],
    kills,
    journal,
    lineage: typeof data["lineage"] === "string" ? data["lineage"] : null,
    orders: readInstructions(data["orders"]),
    flourishes: readWays(data["flourishes"]),
  };
}

export type DecisionListener = (record: DecisionRecord<GoalDigest>, turn: number) => void;

export interface ConnectionTest {
  readonly ok: boolean;
  readonly message: string;
  readonly latencyMs?: number;
  readonly model?: string | null;
}

export interface Runtime {
  config(): SquireConfig;
  saveConfig(next: SquireConfig): void;
  character(): CharacterData;
  saveCharacter(next: CharacterData): void;
  backend(): Backend | null;
  /** Store an API key for Jev through the host's secrets. */
  setJevKey(value: string): Promise<string>;
  /** Read Jev's key from the environment, desktop only. */
  jevKeyFromEnv(): Promise<string>;
  hasJevKey(): Promise<boolean>;
  testConnection(): Promise<ConnectionTest>;
  send(request: SystemOneRequest): ReturnType<typeof ask>;
  tally(): Tally;
  onDecision(listener: DecisionListener): () => void;
  /** The view behind the most recently reported decision. */
  decisionView(): AgentView | null;
  /** Build the controller the host installs, once the key check settles. */
  controllerFor(cfg: SquireCfg, terrain: Terrain, errands: () => AgentController): AgentController;
  /** The brain, while one is running. */
  brain(): Brain | null;
  /**
   * Whether the command the game just reported came from Squire, used once.
   * Knight's Lessons learns only from the player's own commands.
   */
  takeOwnCommand(now: number): boolean;
  recordKill(race: string, unique: boolean, view: AgentView | null): void;
  /** Where this character's hatred and fear of its ancestors' killers come from, one line each. */
  grudgeLines(): readonly string[];
  familyMemoryLines(): readonly string[];
  flourishLines(): readonly string[];
  recordCommand(command: AgentCommand, view: AgentView): void;
  /** Record what changed since the last look at the game. */
  observe(view: AgentView): void;
  journal(): Journal;
  /** The aims Squire reviews above its errands. Empty until the first review. */
  strategy(): Strategy;
  /** The orders and standing instructions the player has given. */
  orders(): Orders;
  /** The report for the run that ended on this page, or the last one stored. */
  lastSummary(): Promise<RunSummary | null>;
  onChronicle(listener: (line: string) => void): () => void;
  store(): KvStore;
  exportDecisions(): string;
  exportLayaRows(): Promise<string>;
  /**
   * Save a Knight's Lessons decision as a Laya training row, with the knight's
   * own goal as its human label. `n` is a count that only grows for this run.
   */
  recordLesson(request: SystemOneRequest, answers: Readonly<Record<string, Answer>>, model: string | null, n: number, knightGoal: string): Promise<void>;
  layaRowCount(): Promise<number>;
  /** This run's logged decisions, once the saved log has been read back. */
  decisions(): Promise<readonly LoggedDecision[]>;
  /** The host's HTTP relay, or null on a game too old to have one. */
  net(): NetLike | null;
}

let current: Runtime | null = null;

/** The page's runtime, created on first use. */
export function runtime(host: SquireHost): Runtime {
  current ??= createRuntime(host);
  return current;
}

/** Forget the page's runtime. For tests. */
export function resetRuntime(): void {
  current = null;
}

export function createRuntime(host: SquireHost, options: { readonly store?: KvStore; readonly now?: () => number } = {}): Runtime {
  const now = options.now ?? (() => Date.now());
  const store = options.store ?? indexedDbStore("neo-angband-squire");
  let config = readConfig(host.prefs?.get());
  let character = readCharacter(host.characterStore?.get()) ?? {
    persona: null,
    runId: runIdFor(host.character?.key?.(), now()),
    kills: {},
    journal: emptyJournal(),
    lineage: null,
    orders: [],
  };
  const tally = createTally(config.caps, config.spend);
  const log = createDecisionLog(store, character.runId);
  /* Read the saved log back before appending, or a reload would restart the
   * numbering and overwrite the first chunk. */
  const logLoaded = log.load().catch(() => {});
  const layaRows = createRows(store, character.runId);
  const shadow = createShadow({ net: host.net ?? null, rows: layaRows, install: logLoaded.then(() => installId(store)), runId: character.runId, now, log: host.log });
  const listeners = new Set<DecisionListener>();
  let brain: Brain | null = null;
  let lastTurn = 0;
  /* When Squire last handed the game a command, so the player-command event for it is not taken for the player's. */
  let ownCommandAt: number | null = null;
  const OWN_COMMAND_WINDOW_MS = 2_000;
  const tracked = (controller: AgentController): AgentController => (view, act) => {
    lastTurn = view.turn();
    lastView = view;
    journal.observe(view);
    observeFamily(view);
    observeWays(view);
    channel.tick();
    const command = controller(view, act);
    if (command !== null) rememberUse(command, view);
    if (command !== null) ownCommandAt = Date.now();
    return command;
  };
  let lastView: AgentView | null = null;
  let unsavedSpend = 0;
  let summary: RunSummary | null = null;
  const chronicleListeners = new Set<(line: string) => void>();
  const journal = createJournal(character.journal, {
    persona: () => character.persona,
    setPersona: (persona) => self.saveCharacter({ ...character, persona }),
    send: backendFor(config) === null || host.net === undefined ? null : (request) => self.send(request),
    backend: backendFor(config)?.label ?? "none",
    save: (state) => self.saveCharacter({ ...character, journal: state }),
    onChronicle: (line) => {
      for (const l of chronicleListeners) l(line);
    },
  });

  const strategy = createStrategy({
    backend: () => backendFor(config),
    send: (request) => self.send(request),
    tally,
    now,
    log: (message) => host.log(message),
    feelings: () => feelingsNow(),
  });

  const orders = createOrders({
    backend: () => backendFor(config),
    send: (request) => self.send(request),
    tally,
    now,
    persona: () => character.persona,
    setPersona: (persona) => self.saveCharacter({ ...character, persona }),
    kept: () => config.instructionsKept,
    note: (text, notable, turn, depth) => journal.event({ kind: "instruction", turn, depth, text }, notable),
    log: (message) => host.log(message),
    save: (state) => self.saveCharacter({ ...character, orders: state.items }),
  });
  orders.load({ items: character.orders });

  const channel = createChannelPoller({
    url: () => config.channelUrl,
    net: () => host.net ?? null,
    queue: (order) => {
      const result = queueInstruction(orders, order.text, "channel", { deferSort: true, ...(order.viewer === "" ? {} : { viewer: order.viewer }) });
      if (!result.ok) host.log(`Squire didn't take a viewer's order: ${result.problem}`);
    },
    flush: () => orders.flush(),
    log: (message) => host.log(message),
    now,
  });

  const self: Runtime = {
    config: () => config,
    saveConfig(next) {
      config = next;
      host.prefs?.set(writeConfig(next));
    },
    character: () => character,
    saveCharacter(next) {
      character = next;
      host.characterStore?.set({ format: CHARACTER_FORMAT, schemaVersion: 1, data: next });
    },
    backend: () => backendFor(config),

    async setJevKey(value) {
      const net = host.net;
      if (net === undefined) return "This version of the game cannot store keys for mods.";
      const trimmed = value.trim();
      if (trimmed === "") {
        await net.secrets.delete("jev");
        return "The Jev key is removed.";
      }
      const result = await net.secrets.set("jev", trimmed, { hosts: [new URL(JEV.url).host] });
      if (!result.ok) return result.problem ?? "The key could not be stored.";
      return net.secrets.storage === "page"
        ? "The key is saved in this browser's storage, where other mods in the page could read it. The desktop app keeps it encrypted instead."
        : "The key is saved, encrypted by your operating system.";
    },
    async jevKeyFromEnv() {
      const net = host.net;
      if (net === undefined) return "This version of the game cannot read keys for mods.";
      if (net.transport !== "relay") return "Reading a key from the environment works only in the desktop app.";
      const read = await net.secrets.fromEnv("jev", JEV_KEY_VARIABLES, { hosts: [new URL(JEV.url).host] });
      return read.ok ? "Squire will use the key from your environment." : read.problem;
    },
    async hasJevKey() {
      const net = host.net;
      if (net === undefined) return false;
      return (await net.secrets.has("jev")).present;
    },

    async testConnection() {
      const backend = backendFor(config);
      if (backend === null) return { ok: false, message: "No model server is chosen. Squire will run its errands." };
      const net = host.net;
      if (net === undefined) return { ok: false, message: "This version of the game cannot send requests for mods. Update the game to use a model." };
      if (backend.secret !== undefined && !(await net.secrets.has(backend.secret)).present) {
        return { ok: false, message: `No API key is set for ${backend.label}. Paste one above, or read it from the environment.` };
      }
      const request: SystemOneRequest = {
        state: { check: "Squire is testing its connection." },
        questions: { ready: { type: "noul", instructions: "Is this a connection test?", criteria: { true: "It is a test.", false: "It is not." } } },
      };
      const result = await ask(net, backend, request, now);
      if (!result.ok) return { ok: false, message: result.failure.message, latencyMs: result.latencyMs };
      tally.record(backend, result.usage, now());
      return {
        ok: true,
        message: `Connected to ${backend.label}${result.model === null ? "" : ` (${result.model})`} in ${String(result.latencyMs)} ms.`,
        latencyMs: result.latencyMs,
        model: result.model,
      };
    },

    send(request) {
      const backend = backendFor(config);
      const net = host.net;
      if (backend === null || net === undefined) {
        return Promise.resolve({
          ok: false as const,
          latencyMs: 0,
          failure: { kind: "not-allowed" as const, message: "No model server is set up.", retryable: false },
        });
      }
      return ask(net, backend, request, now);
    },
    tally: () => tally,
    onDecision(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    decisionView: () => lastView,

    controllerFor(cfg, terrain, errands) {
      const backend = backendFor(config);
      const net = host.net;
      if (backend === null || net === undefined || !cfg.useModel) {
        if (cfg.useModel && net === undefined) host.log("This version of the game cannot send Squire's requests, so Squire runs its errands");
        return tracked(errands());
      }
      const ready = keyReady(net.secrets, backend, false, host.log);
      let chosen: AgentController | null = null;
      let picked: boolean | null = null;
      ready.then(
        (ok) => (picked = ok),
        () => (picked = false),
      );
      return (view, act) => {
        channel.tick();
        if (chosen === null) {
          if (picked === null) return null;
          chosen = picked ? startBrain(backend, cfg, terrain) ?? errands() : errands();
        }
        lastTurn = view.turn();
        lastView = view;
        journal.observe(view);
        observeFamily(view);
        observeWays(view);
        if (brain !== null) {
          strategy.observe(view);
          orders.observe(view);
        }
        const command = chosen(view, act);
        if (command !== null) rememberUse(command, view);
        if (command !== null) ownCommandAt = Date.now();
        return command;
      };
    },
    brain: () => brain,
    takeOwnCommand(now) {
      const own = ownCommandAt !== null && now - ownCommandAt >= 0 && now - ownCommandAt <= OWN_COMMAND_WINDOW_MS;
      ownCommandAt = null;
      return own;
    },
    recordKill(race, unique, view) {
      const kills = { ...character.kills, [race]: (character.kills[race] ?? 0) + 1 };
      const run = character.flourishes ?? emptyFlourishes();
      self.saveCharacter({ ...character, kills, ...(unique ? { flourishes: { ...run, uniqueKills: [...new Set([...run.uniqueKills, race])] } } : {}) });
      journal.kill(race, unique, view);
      if (unique) settleGrudge(race);
      if (unique) rememberMilestone("unique", view?.player().depth ?? 0, race);
      if (view !== null) observeWays(view);
    },
    grudgeLines: () => feelingsNow().map(feelingLine),
    familyMemoryLines() {
      const lineage = familyNow();
      const persona = character.persona;
      if (lineage === null || persona === null) return self.grudgeLines();
      const epitaphs = [...(lineage.inheritedEpitaphs ?? []), ...(lineage.epitaphs ?? []).filter((e) => e.generation === lineage.generation)];
      const milestones = [...(lineage.inheritedMilestones ?? []), ...(lineage.milestones ?? []).filter((m) => m.generation === lineage.generation)];
      return [...self.grudgeLines(), ...(persona.toggles.epitaphs ? epitaphs.slice(-3).map((e) => e.line) : []), ...(persona.toggles.milestones ? milestones.slice(-5).map(milestoneFact) : [])];
    },
    flourishLines: () => flourishLines(character.flourishes ?? emptyFlourishes(), character.persona),
    recordCommand: rememberUse,
    observe(view) {
      lastView = view;
      journal.observe(view);
      observeFamily(view);
      observeWays(view);
    },
    journal: () => journal,
    strategy: () => strategy,
    orders: () => orders,
    async lastSummary() {
      if (summary !== null) return summary;
      const stored = await store.get(`squire/reports/${character.runId}`);
      return stored === undefined ? null : (stored as RunSummary);
    },
    onChronicle(listener) {
      chronicleListeners.add(listener);
      return () => chronicleListeners.delete(listener);
    },
    store: () => store,
    exportDecisions: () => log.exportJsonl(),
    async recordLesson(request, answers, model, n, knightGoal) {
      if (config.backend !== "jev") return;
      /* Lesson rows sit above every decision sequence number, so the two kinds never share an id. */
      const seq = LESSON_SEQ_BASE + n;
      await shadow.record({ token: null, backend: "Jev", request, context: null, answers, usage: { inputTokens: 0, outputTokens: 0, estimated: true }, model, latencyMs: 0, outcome: "lesson" }, seq, config.layaShadow.enabled, config.layaShadow.url, config.layaShadow.fallbacks);
      await layaRows.attachHuman(rowId(await installId(store), character.runId, seq, "squire_goal"), { goal: knightGoal });
    },
    async exportLayaRows() { await logLoaded; await shadow.rowsReady(); await layaRows.idle(); return exportRows(store); },
    async layaRowCount() { await logLoaded; await shadow.rowsReady(); await layaRows.idle(); return countRows(store); },
    decisions: () => logLoaded.then(() => log.records()),
    net: () => host.net ?? null,
  };

  /** The persona this character plays with: its own, or the active one adopted under its name. */
  function personaFor(): Persona | null {
    if (character.persona !== null) return character.persona;
    const heir = config.pendingHeir;
    if (heir !== null) {
      const template = activePersona(config) ?? defaultPersona();
      const born = heirFrom(config.lineages[heir.lineage], heir.parent, normalize({ ...template, ...(heir.name === undefined ? {} : { name: heir.name }) }), Math.random);
      self.saveConfig({ ...config, pendingHeir: null, ...(born === null ? {} : { lineages: { ...config.lineages, [heir.lineage]: born.lineage } }) });
      if (born !== null) {
        self.saveCharacter({ ...character, persona: born.persona, lineage: heir.lineage, flourishes: born.lineage.flourishes ?? emptyFlourishes() });
        orders.adopt(born.lineage.creeds ?? [], lastTurn);
        strategy.inherit(born.lineage.aims ?? []);
        host.log(`Squire's new character carries on the ${heir.lineage.trim() || "Squire"} line`);
        for (const feeling of born.lineage.feelings ?? []) host.log(feelingLog(born.persona.name, feeling));
        for (const line of self.flourishLines()) host.log(line);
        return born.persona;
      }
    }
    const chosen = activePersona(config);
    if (chosen === null) return null;
    /* A copy, so drift on this character never edits the library entry. */
    const adopted = normalize(chosen);
    self.saveCharacter({ ...character, persona: adopted });
    return adopted;
  }

  function familyNow(): Lineage | null {
    const name = character.lineage?.trim();
    return name === undefined || name === "" ? null : config.lineages[name] ?? null;
  }

  function saveFamily(lineage: Lineage): void {
    const name = character.lineage?.trim() || character.persona?.name;
    if (name === undefined) return;
    if (!character.lineage?.trim()) self.saveCharacter({ ...character, lineage: name });
    self.saveConfig({ ...config, lineages: { ...config.lineages, [name]: lineage } });
  }

  function rememberMilestone(kind: Milestone["kind"], depth: number, fact: string): void {
    const persona = character.persona;
    if (persona === null || !persona.toggles.milestones) return;
    const lineage = familyNow() ?? { name: persona.name, generation: 1, ancestors: [], lore: [], grudges: [] };
    const milestone = addMilestone(lineage, persona, kind, depth, fact);
    if (milestone === null) return;
    const kept = (lineage.milestones ?? []).filter((m) => kind !== "depth" || m.kind !== "depth");
    saveFamily({ ...lineage, milestones: [...kept, milestone] });
    host.log(familyVoice(persona, milestoneFact(milestone)));
  }

  function observeFamily(view: AgentView): void {
    const persona = character.persona;
    if (persona === null || !persona.toggles.milestones) return;
    const lineage = familyNow();
    if (lineage !== null) {
      const recalled = recallMilestones(lineage, persona, view.player().depth, view.monsters().filter((m) => m.visible && m.raceFlags.includes("UNIQUE")).map((m) => m.race));
      if (recalled.length > 0) {
        saveFamily({ ...lineage, mentionedMilestones: [...(lineage.mentionedMilestones ?? []), ...recalled.map(milestoneId)] });
        for (const milestone of recalled) host.log(familyVoice(persona, milestoneFact(milestone)));
      }
    }
    rememberMilestone("depth", view.player().maxDepth, "");
    const artifact = [...view.inventory(), ...view.equipment()].find((item) => item?.artifact && item.artifactName !== null);
    if (artifact !== undefined && artifact !== null) rememberMilestone("artifact", view.player().depth, artifact.artifactName!);
  }

  /** The heir's feelings, which only a character born into a line holds. */
  function feelingsNow(): readonly Feeling[] {
    const line = character.lineage?.trim();
    if (line === undefined || line === "") return [];
    return config.lineages[line]?.feelings ?? [];
  }

  let seenInventory: ReadonlySet<number> | null = null;
  function observeWays(view: AgentView): void {
    const run = character.flourishes ?? emptyFlourishes();
    const handles = new Set(view.inventory().map((i) => i.handle));
    const acquired = new Set([...handles].filter((h) => seenInventory !== null && !seenInventory.has(h)));
    seenInventory = handles;
    const before = flourishLines(run, character.persona);
    const next = observeFlourishes(run, view, character.persona, run.uniqueKills, acquired);
    if (JSON.stringify(next) !== JSON.stringify(run)) self.saveCharacter({ ...character, flourishes: next });
    for (const line of flourishLines(next, character.persona)) if (!before.includes(line)) host.log(line);
    const forgotten = run.superstitions.filter((s) => !next.superstitions.some((t) => t.key === s.key));
    for (const s of forgotten) {
      if (character.persona?.toggles.inheritedSuperstitions) host.log(`${character.persona.name} trusts the ${s.name} now.`);
    }
    const lineageName = character.lineage?.trim();
    const lineage = lineageName === undefined ? undefined : config.lineages[lineageName];
    if (lineageName !== undefined && lineage?.flourishRecord !== undefined) {
      const family = lineage.flourishRecord;
      const learned = learnedSuperstitions(family.superstitions, view);
      if (learned.length > 0) self.saveConfig({ ...config, lineages: { ...config.lineages, [lineageName]: { ...lineage,
        flourishRecord: { ...family, superstitions: family.superstitions.filter((s) => !learned.some((t) => s.key === t.key)) } } } });
    }
  }

  function rememberUse(command: AgentCommand, view: AgentView): void {
    const run = character.flourishes ?? emptyFlourishes();
    const lastUse = usedItem(command, view);
    if (lastUse === null && run.lastUse === null) return;
    self.saveCharacter({ ...character, flourishes: { ...run, lastUse } });
  }

  /** A character that kills a unique the family holds a grudge against settles it for every later heir. */
  function settleGrudge(race: string): void {
    const line = character.lineage?.trim();
    const lineage = line === undefined || line === "" ? undefined : config.lineages[line];
    if (line === undefined || lineage === undefined) return;
    const before = (lineage.killers ?? []).find((k) => k.unique && k.name.toLowerCase() === race.toLowerCase());
    const killers = settle(lineage.killers ?? [], race, lineage.generation);
    if (before === undefined || killers === null) return;
    const feelings = (lineage.feelings ?? []).filter((f) => f.name.toLowerCase() !== race.toLowerCase());
    self.saveConfig({ ...config, lineages: { ...config.lineages, [line]: { ...lineage, killers, feelings } } });
    host.log(settledLine(character.persona?.name ?? "Squire", before.name, remembered(before, lineage.generation)));
  }

  function startBrain(backend: Backend, cfg: SquireCfg, terrain: Terrain): AgentController | null {
    const mark = host.controller?.markNondeterministic;
    if (mark === undefined) {
      host.log("This version of the game cannot mark the save for a model, so Squire runs its errands");
      return null;
    }
    mark.call(host.controller);
    const persona = personaFor();
    brain = createBrain<GoalDigest>({
      backend,
      planner: createGoalPlanner({
        cfg,
        terrain,
        ...(host.core?.turnEnergy === undefined ? {} : { speedEnergy: host.core.turnEnergy }),
        log: host.log,
        persona: () => (persona === null ? null : character.persona),
        backstoryTokens: backstoryBudget(config),
        lessons: (view) => journal.lessonLines(view),
        grudges: () => feelingsNow(),
        flourishes: () => character.flourishes ?? emptyFlourishes(),
        dreaded: () => dreadedRaces([...journal.lessons(), ...(config.lineages[character.lineage?.trim() || "Squire"]?.lore ?? [])]),
        calibrate: (probs) => journal.calibrate(probs),
        strategy: () => ({ aims: orders.promote(strategy.ranked()), tripAllowed: (gold) => strategy.tripAllowed(gold) }),
        orders,
      }),
      tally,
      send: (request) => self.send(request),
      token: () => host.snapshot?.()?.token ?? null,
      now,
      log: host.log,
      status: (label, reason) => host.controller?.setStatus(reason === undefined ? { label } : { label, reason }),
      ...(host.controller?.release === undefined ? {} : { release: (reason?: string) => host.controller?.release?.(reason) }),
      onDecision: (record) => {
        void logLoaded.then(() => logDecision(record));
        for (const listener of listeners) listener(record, lastTurn);
      },
      onPlanEnd: (end) => {
        void logLoaded.then(() => endDecision(end));
      },
      gauge: (view) => ({ turn: view.turn(), hp: view.player().hp, depth: view.player().depth }),
    });
    host.log(`Squire has the keyboard and asks ${backend.label} what to do${persona === null ? "" : `, playing as ${persona.name}`}`);
    return brain.controller;
  }

  /* The logged decision whose plan is still running. */
  let openDecision: string | null = null;

  function endDecision(end: PlanEnd): void {
    if (openDecision === null) return;
    log.attachOutcome(openDecision, outcomeLine(end), end);
    openDecision = null;
    void log.flush();
  }

  function logDecision(record: DecisionRecord<GoalDigest>): void {
    const goal = record.answers["goal"];
    const trace = record.context.trace;
    const id = log.append({
      at: now(),
      turn: lastTurn,
      trigger: record.reflex === undefined ? "decision" : "reflex",
      backend: record.backend,
      question: "goal",
      choice: trace?.pick ?? (goal?.type === "choice" ? goal.choice : ""),
      /* No model answered a reflex, so there is no confidence to log or calibrate. */
      confidence: goal?.type === "choice" && record.reflex === undefined ? goal.confidence : null,
      probs: goal?.type === "choice" && record.reflex === undefined ? goal.probabilities : null,
      ...(record.reflex === undefined ? {} : { reflex: record.reflex }),
      state: record.request.state,
      options: record.context.offers.map((o) => o.goal),
      plan: record.outcome,
      latencyMs: record.latencyMs,
      ...(record.server === undefined ? {} : { server: record.server }),
      inputTokens: record.usage.inputTokens,
      outputTokens: record.usage.outputTokens,
      estimatedTokens: record.usage.estimated,
      ...(trace === undefined
        ? {}
        : {
            persona: {
              best: trace.advice,
              inCharacter: trace.inCharacter === null ? "" : (Object.entries(trace.inCharacter).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ""),
              blended: trace.pick,
              strength: trace.strength,
              removed: trace.removed.length > 0,
            },
          }),
    });
    openDecision = id;
    if (record.reflex === undefined) void shadow.record(record, Number(id.slice(id.lastIndexOf("/") + 1)), config.backend === "jev" && config.layaShadow.enabled, config.layaShadow.url, config.layaShadow.fallbacks);
    const logged = log.records().find((r) => r.id === id);
    if (logged !== undefined && lastView !== null) journal.decided(logged, lastView);
    if (record.reflex === undefined) unsavedSpend += 1;
    if (unsavedSpend >= 20) persistSpend();
    void log.flush();
  }

  function persistSpend(): void {
    unsavedSpend = 0;
    const t = now();
    const d = new Date(t);
    const day = `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    self.saveConfig({ ...config, spend: { day, usd: tally.todayUsd(t) } });
  }

  host.character?.onRunEnd?.((report) => {
    void finishRun(report);
  });

  async function finishRun(report: RunReportLike): Promise<void> {
    const passable = passableAims(strategy.ranked());
    strategy.reset();
    const creeds = orders.creeds();
    orders.reset();
    channel.reset();
    persistSpend();
    const blamed = report.outcome === "death" ? await journal.died(log.records(), report.cause, lastView) : null;
    await log.flush();
    const persona = character.persona ?? activePersona(config) ?? defaultPersona();
    /* A character can die nameless; its line still needs a name to be found by. */
    /* A blank lineage, saved by an earlier version, falls back like a missing one. */
    const lineageName = character.lineage?.trim() || (report.name.trim() === "" ? "Squire" : report.name);
    const lineage = config.lineages[lineageName];
    try {
      const storedApprentice = await store.get("squire/apprentice") as Apprentice | undefined;
      summary = buildRunSummary({
        report,
        runLog: journal.runLog(),
        decisions: log.records(),
        tally,
        persona,
        lessonsLearned: journal.lessons().map((l) => l.line),
        lessonsInherited: (lineage?.lore ?? []).map((l) => l.line),
        lineageNames: (lineage?.ancestors ?? []).map((a) => a.name),
        calibration: {},
        ...(blamed === null ? {} : { blamedDecisionId: blamed }),
        chronicleHighlights: journal.chronicle().slice(-5),
        ...(storedApprentice === undefined ? {} : { apprentice: storedApprentice }),
      });
      await store.set(`squire/reports/${character.runId}`, summary);
    } catch (error) {
      host.log(`Squire could not build this run's report: ${String(error)}`);
    }
    if (report.outcome === "death" && character.persona !== null) {
      const died = { depth: report.maxDepth, cause: report.cause, turn: report.turn };
      const last = log.records().at(-1);
      const epitaph = epitaphFor(persona, { name: report.name.trim() || persona.name, generation: lineage?.generation ?? 1, cause: report.cause, depth: report.depth, level: report.level, action: last?.choice ?? "unknown" });
      if (epitaph !== null) host.log(epitaph.line);
      const next = { ...withAncestor(lineage, report.name, report.race, report.cls, died, journal.lessons(), lastView?.monsters() ?? []), deepest: report.maxDepth, turns: report.turn, epitaphs: [...(lineage?.epitaphs ?? []), ...(epitaph === null ? [] : [epitaph])].slice(-12), creeds, ...(passable.length > 0 ? { aims: passable } : {}),
        flourishRecord: familyAfterDeath(lineage?.flourishRecord ?? emptyFamilyFlourishes(), character.flourishes ?? emptyFlourishes(), lastView, persona) };
      if (!character.lineage?.trim()) self.saveCharacter({ ...character, lineage: lineageName });
      self.saveConfig({
        ...config,
        lineages: { ...config.lineages, [lineageName]: next },
        pendingHeir: brain !== null && config.rollOn !== "wait" ? { lineage: lineageName, parent: character.persona } : config.pendingHeir,
      });
    }
    await sendTelemetry();
    await rollOn(report);
  }

  async function sendTelemetry(): Promise<void> {
    const level = config.telemetry.level;
    if (level === "off" || config.telemetry.endpoint === "" || host.net === undefined || summary === null) return;
    try {
      const batches = buildBatches(
        {
          installId: await installId(store),
          runId: character.runId,
          seq: 0,
          modVersion: MOD_VERSION,
          gameVersion: "unknown",
          summary: summaryForTelemetry(summary),
          decisions: log.records(),
          ...(level === "full" ? { extra: { chronicle: journal.chronicle() } } : {}),
          ...(level === "full" && config.telemetry.backstoryConsent && character.persona !== null
            ? { backstory: character.persona.backstory, backstoryConsent: true }
            : {}),
        },
        level,
      );
      const sender = createSender({ net: host.net, store, endpoint: config.telemetry.endpoint, now, log: host.log });
      for (const batch of batches) await sender.send(batch);
    } catch (error) {
      host.log(`Squire could not build this run's telemetry, so none was sent: ${String(error)}`);
    }
  }

  async function rollOn(report: RunReportLike): Promise<void> {
    if (report.outcome !== "death" || config.rollOn === "wait" || brain === null) return;
    const create = host.saves?.create;
    /* When no new character is coming, nothing Squire armed for one may be left
     * behind: a later character the player makes by hand is not an heir, and its
     * birth screens are the player's. */
    const abandon = (why: string | null) => {
      takeRollOn(sessionMarks(), now());
      if (config.pendingHeir !== null) self.saveConfig({ ...config, pendingHeir: null });
      if (why !== null) host.log(`Squire could not start the next character: ${why}`);
    };
    if (create === undefined) {
      abandon(null);
      return;
    }
    const like = config.rollOn === "like" ? report.birth : undefined;
    markRollOn(sessionMarks(), now());
    try {
      const result = await create.call(host.saves, like === undefined ? { resumeAutoplayer: true } : { like, resumeAutoplayer: true });
      if (!result.ok) abandon(result.reason ?? "the game refused");
    } catch (error) {
      abandon(String(error));
    }
  }

  return self;
}
