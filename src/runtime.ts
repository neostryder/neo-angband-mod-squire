/**
 * One Squire per page: the settings, the character's own data, the decision
 * log, the token tally and telemetry, shared by the controller, the panel and
 * Knight's Lessons.
 *
 * The host calls `register` and `controller` separately and in no fixed
 * order, and the page reloads between characters, so the runtime is created by
 * whichever call comes first and lives until the page goes.
 */

import type { AgentController, AgentView } from "@rpgm-tools/neo-angband-core";
import { ask, JEV, JEV_KEY_VARIABLES, type Backend, type NetLike } from "./brain/backend.js";
import { keyReady, type SecretsLike } from "./brain/boot.js";
import { createBrain, type Brain, type DecisionRecord, type Token } from "./brain/brain.js";
import { createGoalPlanner, type GoalDigest } from "./brain/goals.js";
import { createTally, type Tally } from "./brain/tally.js";
import type { SystemOneRequest } from "./brain/systemone.js";
import { activePersona, backendFor, backstoryBudget, readConfig, writeConfig, type SquireConfig } from "./config.js";
import { indexedDbStore, type KvStore } from "./memory/kv.js";
import { createDecisionLog, type LoggedDecision } from "./memory/log.js";
import { markRollOn, sessionMarks } from "./birth.js";
import { installId } from "./memory/install.js";
import { normalize, type Persona } from "./persona/persona.js";
import type { SquireCfg } from "./settings.js";
import type { Terrain } from "./terrain.js";
import { buildBatches } from "./telemetry/batch.js";
import { createJournal, emptyJournal, heirFrom, withAncestor, type Journal, type JournalState } from "./journal.js";
import { buildRunSummary, summaryForTelemetry, type RunReport, type RunSummary } from "./report/summary.js";
import { defaultPersona } from "./persona/persona.js";
import { createSender } from "./telemetry/sender.js";

/** The parts of the host's plugin context Squire uses, declared so the mod builds without the host's source. */
export interface SquireHost {
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
}

const CHARACTER_FORMAT = "neo-angband/squire/character";

export const MOD_VERSION = "1.0.0-dev";

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
  /** Build the controller the host installs, once the key check settles. */
  controllerFor(cfg: SquireCfg, terrain: Terrain, errands: () => AgentController): AgentController;
  /** The brain, while one is running. */
  brain(): Brain | null;
  recordKill(race: string, unique: boolean, view: AgentView | null): void;
  /** Record what changed since the last look at the game. */
  observe(view: AgentView): void;
  journal(): Journal;
  /** The report for the run that ended on this page, or the last one stored. */
  lastSummary(): Promise<RunSummary | null>;
  onChronicle(listener: (line: string) => void): () => void;
  store(): KvStore;
  exportDecisions(): string;
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
  };
  const tally = createTally(config.caps, config.spend);
  const log = createDecisionLog(store, character.runId);
  /* Read the saved log back before appending, or a reload would restart the
   * numbering and overwrite the first chunk. */
  const logLoaded = log.load().catch(() => {});
  const listeners = new Set<DecisionListener>();
  let brain: Brain | null = null;
  let lastTurn = 0;
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

    controllerFor(cfg, terrain, errands) {
      const backend = backendFor(config);
      const net = host.net;
      if (backend === null || net === undefined || !cfg.useModel) {
        if (cfg.useModel && net === undefined) host.log("This version of the game cannot send Squire's requests, so Squire runs its errands");
        return errands();
      }
      const ready = keyReady(net.secrets, backend, false, host.log);
      let chosen: AgentController | null = null;
      let picked: boolean | null = null;
      ready.then(
        (ok) => (picked = ok),
        () => (picked = false),
      );
      return (view, act) => {
        if (chosen === null) {
          if (picked === null) return null;
          chosen = picked ? startBrain(backend, cfg, terrain) ?? errands() : errands();
        }
        lastTurn = view.turn();
        lastView = view;
        journal.observe(view);
        return chosen(view, act);
      };
    },
    brain: () => brain,
    recordKill(race, unique, view) {
      const kills = { ...character.kills, [race]: (character.kills[race] ?? 0) + 1 };
      self.saveCharacter({ ...character, kills });
      journal.kill(race, unique, view);
    },
    observe(view) {
      lastView = view;
      journal.observe(view);
    },
    journal: () => journal,
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
    decisions: () => logLoaded.then(() => log.records()),
    net: () => host.net ?? null,
  };

  /** The persona this character plays with: its own, or the active one adopted under its name. */
  function personaFor(): Persona | null {
    if (character.persona !== null) return character.persona;
    const heir = config.pendingHeir;
    if (heir !== null) {
      const born = heirFrom(config.lineages[heir.lineage], heir.parent, normalize(activePersona(config) ?? defaultPersona()), Math.random);
      self.saveConfig({ ...config, pendingHeir: null, ...(born === null ? {} : { lineages: { ...config.lineages, [heir.lineage]: born.lineage } }) });
      if (born !== null) {
        self.saveCharacter({ ...character, persona: born.persona, lineage: heir.lineage });
        host.log(`Squire's new character carries on the ${heir.lineage} line`);
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
        log: host.log,
        persona: () => (persona === null ? null : character.persona),
        backstoryTokens: backstoryBudget(config),
        lessons: (view) => journal.lessonLines(view),
        calibrate: (probs) => journal.calibrate(probs),
      }),
      tally,
      send: (request) => self.send(request),
      token: () => host.snapshot?.()?.token ?? null,
      now,
      log: host.log,
      status: (label, reason) => host.controller?.setStatus(reason === undefined ? { label } : { label, reason }),
      onDecision: (record) => {
        void logLoaded.then(() => logDecision(record));
        for (const listener of listeners) listener(record, lastTurn);
      },
    });
    host.log(`Squire has the keyboard and asks ${backend.label} what to do${persona === null ? "" : `, playing as ${persona.name}`}`);
    return brain.controller;
  }

  function logDecision(record: DecisionRecord<GoalDigest>): void {
    const goal = record.answers["goal"];
    const trace = record.context.trace;
    const id = log.append({
      at: now(),
      turn: lastTurn,
      trigger: "decision",
      backend: record.backend,
      question: "goal",
      choice: trace?.pick ?? (goal?.type === "choice" ? goal.choice : ""),
      confidence: goal?.type === "choice" ? goal.confidence : null,
      probs: goal?.type === "choice" ? goal.probabilities : null,
      state: record.request.state,
      options: record.context.offers.map((o) => o.goal),
      plan: record.outcome,
      latencyMs: record.latencyMs,
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
    const logged = log.records().find((r) => r.id === id);
    if (logged !== undefined && lastView !== null) journal.decided(logged, lastView);
    unsavedSpend += 1;
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
    persistSpend();
    const blamed = report.outcome === "death" ? await journal.died(log.records(), report.cause, lastView) : null;
    await log.flush();
    const persona = character.persona ?? activePersona(config) ?? defaultPersona();
    const lineageName = character.lineage ?? report.name;
    const lineage = config.lineages[lineageName];
    try {
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
      });
      await store.set(`squire/reports/${character.runId}`, summary);
    } catch (error) {
      host.log(`Squire could not build this run's report: ${String(error)}`);
    }
    if (report.outcome === "death" && character.persona !== null) {
      const died = { depth: report.maxDepth, cause: report.cause, turn: report.turn };
      const next = withAncestor(lineage, report.name, report.race, report.cls, died, journal.lessons());
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
    if (create === undefined) return;
    const like = config.rollOn === "like" ? report.birth : undefined;
    markRollOn(sessionMarks(), now());
    const result = await create.call(host.saves, like === undefined ? { resumeAutoplayer: true } : { like, resumeAutoplayer: true });
    if (!result.ok) host.log(`Squire could not start the next character: ${result.reason ?? "the game refused"}`);
  }

  return self;
}
