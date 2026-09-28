import type { Tally, TallyTotals } from "../brain/tally.js";
import type { LoggedDecision } from "../memory/log.js";
import { PARAMETERS } from "../persona/catalog.js";
import type { Persona } from "../persona/persona.js";
import type { Summary as TelemetrySummary } from "../telemetry/batch.js";
import { chronicleLine } from "./chronicle.js";
import type { RunEvent, RunLog } from "./events.js";

/** The host's end-of-run value, declared here so this mod can build by itself. */
export interface RunReport {
  outcome: "death" | "victory" | "retirement";
  cause: string; key: string | null; name: string; race: string; cls: string;
  level: number; maxLevel: number; maxDepth: number; depth: number; gold: number; turn: number;
  score: number; scored: boolean; endedAt: number;
  history: { kind: "birth" | "level" | "unique" | "artifact" | "artifact-unknown" | "note" | "import" | "other"; text: string; turn: number; depth: number; level: number; lost?: boolean }[];
  messages: { text: string; count: number; color?: string }[];
  belongings: unknown[];
  sheet: unknown | null;
  birth: { race: string; cls: string; name: string; stats: number[] };
}

export interface RunSummary {
  readonly headline: {
    readonly name: string; readonly race: string; readonly class: string; readonly level: number;
    readonly deepestFeet: number; readonly turns: number; readonly outcome: RunReport["outcome"]; readonly cause: string;
  };
  readonly personaRadar: readonly { readonly id: string; readonly name: string; readonly value: number }[];
  readonly topKills: readonly { readonly name: string; readonly count: number }[];
  readonly uniquesKilled: readonly string[];
  readonly depthCurve: readonly { readonly turn: number; readonly depth: number }[];
  readonly closeCalls: readonly RunEvent[];
  readonly deathDecisions: readonly LoggedDecision[];
  readonly divergence: { readonly count: number; readonly rate: number };
  readonly spellsByUse: readonly { readonly name: string; readonly count: number }[];
  readonly weaponsByUse: readonly { readonly name: string; readonly count: number }[];
  readonly tokens: TallyTotals;
  readonly tokensByBackend: Readonly<Record<string, TallyTotals>>;
  readonly calibration: Readonly<Record<string, unknown>>;
  readonly lessonsLearned: readonly string[];
  readonly lessonsInherited: readonly string[];
  readonly lineageNames: readonly string[];
  readonly chronicleHighlights: readonly string[];
}

export interface RunSummaryInput {
  readonly report: RunReport;
  readonly runLog: RunLog;
  readonly decisions: readonly LoggedDecision[];
  readonly tally: Tally;
  readonly persona: Persona;
  readonly lessonsLearned: readonly string[];
  readonly lessonsInherited: readonly string[];
  readonly lineageNames: readonly string[];
  readonly calibration: Readonly<Record<string, unknown>>;
  readonly blamedDecisionId?: string;
  readonly chronicleHighlights?: readonly string[];
}

function countUse(decisions: readonly LoggedDecision[], key: "spell" | "weapon"): readonly { readonly name: string; readonly count: number }[] {
  const counts = new Map<string, number>();
  for (const decision of decisions) {
    const value = decision.state[key];
    if (typeof value === "string" && value.trim()) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function buildRunSummary(input: RunSummaryInput): RunSummary {
  const { report, decisions, persona, runLog, tally } = input;
  const divergences = decisions.filter((decision) => decision.persona !== undefined
    && decision.persona.best !== decision.persona.blended).length;
  const beforeDeath = report.outcome === "death"
    ? decisions.filter((decision) => decision.turn <= report.turn).sort((a, b) => a.turn - b.turn || a.seq - b.seq)
    : [];
  const last = beforeDeath.slice(-5);
  const blamed = input.blamedDecisionId === undefined ? undefined : beforeDeath.find((decision) => decision.id === input.blamedDecisionId);
  const deathDecisions = blamed === undefined || last.some((decision) => decision.id === blamed.id) ? last : [blamed, ...last];
  const events = runLog.events();
  const highlightEvent = events.find((event) => event.kind === "unique-kill")
    ?? events.find((event) => event.kind === "near-death") ?? events.find((event) => event.kind === "escape")
    ?? events.find((event) => event.kind === "item-found") ?? events[0];
  return {
    headline: {
      name: report.name, race: report.race, class: report.cls, level: report.level,
      deepestFeet: report.maxDepth * 50, turns: report.turn, outcome: report.outcome, cause: report.cause,
    },
    personaRadar: PARAMETERS.filter((parameter) => parameter.kind === "slider"
      && (parameter.group === "temperament" || parameter.group === "values"))
      .map((parameter) => ({ id: parameter.id, name: parameter.name,
        value: Math.max(0, Math.min(100, persona.sliders[parameter.id])) })),
    topKills: runLog.topKills(10),
    uniquesKilled: report.history.filter((event) => event.kind === "unique").map((event) => event.text),
    depthCurve: runLog.depthCurve(),
    closeCalls: runLog.closeCalls(),
    deathDecisions,
    divergence: { count: divergences, rate: decisions.length === 0 ? 0 : divergences / decisions.length },
    spellsByUse: countUse(decisions, "spell"), weaponsByUse: countUse(decisions, "weapon"),
    tokens: tally.session(), tokensByBackend: tally.byBackend(), calibration: input.calibration,
    lessonsLearned: input.lessonsLearned.slice(), lessonsInherited: input.lessonsInherited.slice(),
    lineageNames: input.lineageNames.slice(),
    chronicleHighlights: input.chronicleHighlights?.slice()
      ?? (highlightEvent === undefined ? [] : [chronicleLine(highlightEvent, persona, () => 0)]),
  };
}

/** Only numeric calibration fields enter telemetry; names and prose stay in the saved report. */
function telemetryCalibration(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [backend, metrics] of Object.entries(value)) {
    if (/trait|backstory|persona|biography|lore|quirk/i.test(backend)
      || metrics === null || typeof metrics !== "object" || Array.isArray(metrics)) continue;
    const numbers: Record<string, number> = {};
    for (const [name, item] of Object.entries(metrics)) {
      if (!/trait|backstory|persona|biography|lore|quirk/i.test(name)
        && typeof item === "number" && Number.isFinite(item)) numbers[name] = item;
    }
    result[backend] = numbers;
  }
  return result;
}

export function summaryForTelemetry(model: RunSummary): TelemetrySummary {
  return {
    persona: { name: model.headline.name, race: model.headline.race, class: model.headline.class },
    outcome: {
      ended: true, won: model.headline.outcome === "victory", depth_max: model.headline.deepestFeet / 50,
      turns: model.headline.turns, cause_of_death: model.headline.outcome === "death" ? model.headline.cause : null,
    },
    top_kills: model.topKills.slice(0, 10),
    tokens: { input: model.tokens.inputTokens, output: model.tokens.outputTokens, calls: model.tokens.requests },
    calibration: telemetryCalibration(model.calibration),
  };
}
