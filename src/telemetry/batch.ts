import type { LoggedDecision } from "../memory/log.js";
import type { ConsentLevel } from "./consent.js";

export interface Summary {
  readonly persona: { readonly name: string; readonly race: string; readonly class: string };
  readonly outcome: { readonly ended: boolean; readonly won: boolean; readonly depth_max: number; readonly turns: number; readonly cause_of_death: string | null };
  readonly top_kills: readonly { readonly name: string; readonly count: number }[];
  readonly tokens: { readonly input: number; readonly output: number; readonly calls: number };
  readonly calibration: Readonly<Record<string, unknown>>;
}

export interface TelemetryDecision {
  readonly t: number;
  readonly kind: string;
  readonly question: string;
  readonly choice: string;
  readonly confidence: number | null;
  readonly probs: Readonly<Record<string, number>> | null;
  readonly outcome: string | null;
}

export interface Batch {
  readonly schema: 1;
  readonly level: Exclude<ConsentLevel, "off">;
  readonly install_id: string;
  readonly run_id: string;
  readonly seq: number;
  readonly sent_at: string;
  readonly mod_version: string;
  readonly game_version: string;
  readonly summary: Summary;
  readonly decisions?: readonly TelemetryDecision[];
  readonly extra?: Readonly<Record<string, unknown>>;
  readonly backstory_consent?: true;
  readonly backstory?: string;
}

export interface BatchInput {
  readonly installId: string;
  readonly runId: string;
  readonly seq: number;
  readonly sentAt?: string;
  readonly modVersion: string;
  readonly gameVersion: string;
  readonly summary: Summary;
  readonly decisions: readonly LoggedDecision[];
  readonly extra?: Readonly<Record<string, unknown>>;
  readonly backstory?: string;
  readonly backstoryConsent?: boolean;
}

const REFUSED = /backstory|persona|quirk|biography|lore/i;
const LIMITS = { summary: 32 * 1024, decisions: 1024 * 1024, full: 1536 * 1024 } as const;
const MAX_RECORDS = 5000;

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !REFUSED.test(key)).map(([key, item]) => [key, strip(item)]));
  }
  return value;
}

function bytes(batch: Batch): number { return Buffer.byteLength(JSON.stringify(batch), "utf8"); }

function decision(record: LoggedDecision): TelemetryDecision {
  return strip({
    t: record.turn,
    kind: record.plan.trim().split(/\s+/)[0] || "unknown",
    question: record.question,
    choice: record.choice,
    confidence: record.confidence,
    probs: record.probs,
    outcome: record.outcome,
  }) as TelemetryDecision;
}

/** Every candidate is measured as wire JSON, including UTF-8 characters and metadata. */
export function buildBatches(input: BatchInput, level: ConsentLevel): Batch[] {
  if (level === "off") return [];
  const summary: Summary = { ...input.summary, calibration: strip(input.summary.calibration) as Record<string, unknown> };
  if (JSON.stringify(summary.calibration).length > 16 * 1024) throw new RangeError("Calibration exceeds the contract limit.");
  const base = {
    schema: 1 as const,
    level,
    install_id: input.installId,
    run_id: input.runId,
    sent_at: input.sentAt ?? new Date().toISOString(),
    mod_version: input.modVersion,
    game_version: input.gameVersion,
  };
  const running: Summary = { ...summary, outcome: { ...summary.outcome, ended: false } };
  const batches: Batch[] = [];
  const make = (records: readonly TelemetryDecision[], seq: number): Batch => ({
    ...base, seq, summary: running, ...(level === "summary" ? {} : { decisions: records }),
  });
  let current = make([], input.seq);
  let currentBytes = bytes(current);
  if (currentBytes > LIMITS[level]) throw new RangeError("The summary exceeds the batch byte limit.");
  if (level !== "summary") {
    for (const record of input.decisions) {
      const mapped = decision(record);
      const count = current.decisions?.length ?? 0;
      const addedBytes = Buffer.byteLength(JSON.stringify(mapped), "utf8") + (count ? 1 : 0);
      if (count >= MAX_RECORDS || currentBytes + addedBytes > LIMITS[level]) {
        batches.push(current);
        current = make([mapped], input.seq + batches.length);
        currentBytes = bytes(current);
        if (currentBytes > LIMITS[level]) throw new RangeError("A decision exceeds the batch byte limit.");
      } else {
        current = make([...current.decisions ?? [], mapped], current.seq);
        currentBytes += addedBytes;
      }
    }
  }
  batches.push(current);
  if (level === "full" && (input.extra !== undefined || (input.backstoryConsent && input.backstory))) {
    const extras = {
      ...(input.extra === undefined ? {} : { extra: strip(input.extra) as Record<string, unknown> }),
      ...(input.backstoryConsent && input.backstory ? { backstory_consent: true as const, backstory: input.backstory } : {}),
    };
    const withExtras = { ...current, ...extras };
    if (bytes(withExtras) <= LIMITS.full) batches[batches.length - 1] = withExtras;
    else {
      const separate = { ...make([], input.seq + batches.length), ...extras };
      if (bytes(separate) > LIMITS.full) throw new RangeError("The full run log exceeds the batch byte limit.");
      batches.push(separate);
    }
  }
  if (summary.outcome.ended) {
    const last = batches.length - 1;
    batches[last] = { ...batches[last]!, summary };
    if (bytes(batches[last]!) > LIMITS[level]) {
      const final = { ...make([], input.seq + batches.length), summary };
      if (bytes(final) > LIMITS[level]) throw new RangeError("The final summary exceeds the batch byte limit.");
      batches[last] = { ...batches[last]!, summary: running };
      batches.push(final);
    }
  }
  return batches;
}

export function previewBatch(input: BatchInput, level: ConsentLevel): string {
  const first = buildBatches(input, level)[0];
  return first === undefined ? "" : JSON.stringify(first, null, 2);
}
