/**
 * Counts the tokens each request uses and checks the spend caps a player can
 * set for a server that charges.
 *
 * Free servers such as Laya are counted too, for the reports. Only a server that
 * charges has a cost, so only it can hit a cap, and Squire checks the cap before
 * each request rather than stopping one already sent.
 */

import type { Backend, Failure } from "./backend.js";
import type { Usage } from "./systemone.js";

/** Spend caps in US dollars. Zero means no cap. */
export interface Caps {
  readonly perSessionUsd: number;
  readonly perDayUsd: number;
}

export interface TallyTotals {
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Requests whose input tokens were estimated because the server did not report them. */
  readonly estimated: number;
  readonly usd: number;
}

const ZERO: TallyTotals = Object.freeze({ requests: 0, inputTokens: 0, outputTokens: 0, estimated: 0, usd: 0 });

function add(totals: TallyTotals, usage: Usage, usd: number): TallyTotals {
  return {
    requests: totals.requests + 1,
    inputTokens: totals.inputTokens + usage.inputTokens,
    outputTokens: totals.outputTokens + usage.outputTokens,
    estimated: totals.estimated + (usage.estimated ? 1 : 0),
    usd: totals.usd + usd,
  };
}

/** The local calendar day, as the key the day's spend is kept under. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface Tally {
  record(backend: Backend, usage: Usage, now: number): void;
  session(): TallyTotals;
  /** Totals per backend label, this session. */
  byBackend(): Readonly<Record<string, TallyTotals>>;
  /** Today's spend on metered backends, including earlier sessions passed in at creation. */
  todayUsd(now: number): number;
  /** The cap that stops the next request, or null when the request may go. */
  overCap(backend: Backend, now: number): Failure | null;
}

/**
 * Build a tally.
 *
 * `earlierToday` carries the spend of earlier sessions on the same day, which
 * the caller loads from storage, so a day cap holds across a reload.
 */
export function createTally(caps: Caps, earlierToday?: { readonly day: string; readonly usd: number }): Tally {
  let session = ZERO;
  const perBackend: Record<string, TallyTotals> = {};
  let day = earlierToday?.day ?? "";
  let dayUsd = earlierToday?.usd ?? 0;

  function rollDay(now: number): void {
    const today = dayKey(now);
    if (today !== day) {
      day = today;
      dayUsd = 0;
    }
  }

  return {
    record(backend, usage, now) {
      rollDay(now);
      const usd = backend.metered ? (usage.inputTokens / 1_000_000) * backend.usdPerMillionInput : 0;
      session = add(session, usage, usd);
      perBackend[backend.label] = add(perBackend[backend.label] ?? ZERO, usage, usd);
      dayUsd += usd;
    },
    session: () => session,
    byBackend: () => ({ ...perBackend }),
    todayUsd(now) {
      rollDay(now);
      return dayUsd;
    },
    overCap(backend, now) {
      if (!backend.metered) return null;
      rollDay(now);
      if (caps.perSessionUsd > 0 && session.usd >= caps.perSessionUsd) {
        return {
          kind: "over-cap",
          message: `Squire has reached this session's spend limit for ${backend.label} ($${caps.perSessionUsd.toFixed(2)}). Raise the limit in Squire's settings, or reload to start a new session.`,
          retryable: false,
        };
      }
      if (caps.perDayUsd > 0 && dayUsd >= caps.perDayUsd) {
        return {
          kind: "over-cap",
          message: `Squire has reached today's spend limit for ${backend.label} ($${caps.perDayUsd.toFixed(2)}). Raise the limit in Squire's settings, or wait until tomorrow.`,
          retryable: false,
        };
      }
      return null;
    },
  };
}
