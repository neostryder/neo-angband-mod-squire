/**
 * The model servers Squire can ask, and one call to any of them.
 *
 * Every call goes through the host's `ctx.net`. In the desktop app the host's
 * main process sends it, so neither Jev nor a Laya server needs CORS headers,
 * and an API key is filled into the header by the host and never held by this
 * mod. In a browser tab the host falls back to `fetch` and CORS applies.
 *
 * A failed call comes back as a `Failure` with a kind the brain acts on and a
 * sentence the player reads. Nothing here throws.
 */

import { parseReply, type Answer, type SystemOneRequest, type Usage } from "./systemone.js";

/** What Squire needs from `ctx.net`, declared here so the mod builds without the host's source. */
export interface NetLike {
  readonly transport: "relay" | "page";
  request(request: {
    readonly url: string;
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly timeoutMs?: number;
  }): Promise<
    | { readonly ok: true; readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly body: string }
    | { readonly ok: false; readonly code: string; readonly problem: string }
  >;
}

export type BackendKind = "jev" | "laya" | "custom";

/** One model server. */
export interface Backend {
  readonly kind: BackendKind;
  /** The name shown in setup and reports. */
  readonly label: string;
  readonly url: string;
  /**
   * More addresses for the same kind of server, tried in order after `url`
   * when it is busy, not ready or not answering. Empty for a single server.
   */
  readonly fallbacks?: readonly string[];
  /** Sent as the request's `model`, when the server wants one. */
  readonly model?: string;
  /** The `ctx.net` secret that holds this server's key, when it takes one. */
  readonly secret?: string;
  /** The server charges per token, so the tally shows a cost and spend caps apply. */
  readonly metered: boolean;
  /** US dollars per million input tokens, for the cost estimate on a metered server. */
  readonly usdPerMillionInput: number;
  readonly timeoutMs: number;
}

/**
 * Hosted Jev. The price is an estimate: a two-question decision uses about 700
 * input tokens, and 1,000 of them cost about 3 cents.
 */
export const JEV: Backend = Object.freeze({
  kind: "jev",
  label: "Jev",
  url: "https://api.typesafe.ai/v1/systemone",
  model: "jev-latest",
  secret: "jev",
  metered: true,
  usdPerMillionInput: 0.04,
  timeoutMs: 15_000,
});

/** Environment variables the desktop app may read Jev's key from, after the player agrees. */
export const JEV_KEY_VARIABLES: readonly string[] = Object.freeze(["TYPESAFE_API_KEY", "JEV_API_KEY"]);

/** A Laya server, or any unmetered server with the same request shape. */
export function selfHosted(kind: "laya" | "custom", label: string, url: string, model?: string, fallbacks: readonly string[] = []): Backend {
  const others = fallbacks.filter((f) => f !== "" && f !== url);
  return Object.freeze({
    kind,
    label,
    url,
    ...(others.length === 0 ? {} : { fallbacks: Object.freeze([...others]) }),
    ...(model === undefined ? {} : { model }),
    metered: false,
    usdPerMillionInput: 0,
    timeoutMs: 30_000,
  });
}

/** Why a call failed, grouped by what Squire does about it. */
export type FailureKind =
  /** No response arrived: no network, the server is not running, or it timed out. */
  | "unreachable"
  /** The server refused the key, or there is no key. */
  | "key-refused"
  /** The server asked Squire to slow down. */
  | "rate-limited"
  /** The server answered with an error of its own. */
  | "server-error"
  /** The server answered, but not with answers to the questions asked. */
  | "bad-reply"
  /** The manifest does not name this server, so the host will not send to it. */
  | "not-allowed"
  /** A spend cap the player set has been reached. */
  | "over-cap";

export interface Failure {
  readonly kind: FailureKind;
  /** A sentence for the player: what happened, then what to do. */
  readonly message: string;
  /** Trying again later might work. */
  readonly retryable: boolean;
  /** How long the server asked Squire to wait, when it said. */
  readonly retryAfterMs?: number;
}

export type AskResult =
  | {
      readonly ok: true;
      readonly answers: Readonly<Record<string, Answer>>;
      readonly usage: Usage;
      readonly model: string | null;
      readonly latencyMs: number;
      /** The address that answered. */
      readonly server: string;
    }
  | { readonly ok: false; readonly failure: Failure; readonly latencyMs: number };

/**
 * Servers recently found busy or not answering, and until when to pass them
 * over: a busy one for a few seconds, one that did not answer for longer.
 */
export type ServerMemory = Map<string, { readonly until: number; readonly reason: string }>;

const SHARED_MEMORY: ServerMemory = new Map();
const BUSY_SKIP_MS = 5_000;
const DOWN_SKIP_MS = 30_000;
const PROBE_TIMEOUT_MS = 600;

/** The server's own address, where Laya reports its load at `/load`. */
function originOf(url: string): string {
  const match = /^(https?:\/\/[^/]+)/i.exec(url);
  return match?.[1] ?? url;
}

/**
 * Ask a Laya server whether it can take a request. Null means go ahead; a
 * server with no load report is taken as ready.
 */
async function busyReason(net: NetLike, url: string): Promise<{ reason: string; skipMs: number } | null> {
  const reply = await net.request({ url: `${originOf(url)}/load`, method: "GET", timeoutMs: PROBE_TIMEOUT_MS });
  if (!reply.ok) return { reason: `not answering (${reply.problem})`, skipMs: DOWN_SKIP_MS };
  if (reply.status === 404) return null;
  if (reply.status !== 200) return { reason: `load check answered HTTP ${String(reply.status)}`, skipMs: DOWN_SKIP_MS };
  try {
    const load = JSON.parse(reply.body) as { busy?: unknown; ready?: unknown };
    if (load.busy === true) return { reason: "busy", skipMs: BUSY_SKIP_MS };
    if (load.ready === false) return { reason: "not ready", skipMs: BUSY_SKIP_MS };
  } catch { /* An unreadable load report is not a reason to pass the server over. */ }
  return null;
}

function retryAfter(headers: Readonly<Record<string, string>>): number | undefined {
  const value = headers["retry-after"];
  if (value === undefined) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

/** Turn an HTTP status that is not 200 into a failure. */
export function statusFailure(
  backend: Backend,
  status: number,
  headers: Readonly<Record<string, string>>,
): Failure {
  if (status === 401 || status === 403) {
    return {
      kind: "key-refused",
      message: `${backend.label} refused the API key. Check the key in Squire's setup and try again.`,
      retryable: false,
    };
  }
  if (status === 429) {
    const after = retryAfter(headers);
    return {
      kind: "rate-limited",
      message: `${backend.label} asked Squire to slow down. Squire will try again shortly.`,
      retryable: true,
      ...(after === undefined ? {} : { retryAfterMs: after }),
    };
  }
  if (status >= 500) {
    return {
      kind: "server-error",
      message: `${backend.label} had a problem of its own (HTTP ${String(status)}). Squire will try again shortly.`,
      retryable: true,
    };
  }
  return {
    kind: "bad-reply",
    message: `${backend.label} turned the request down (HTTP ${String(status)}). This is likely a bug in Squire; please report it.`,
    retryable: false,
  };
}

/**
 * Send one request and check the answers. A backend with fallback addresses
 * tries each in order, passing over one that is busy, not ready, answering
 * with a server error, or not answering at all. A refusal of the request
 * itself (an HTTP 4xx) is not retried elsewhere, since another server would
 * refuse it too.
 */
export async function ask(
  net: NetLike,
  backend: Backend,
  request: SystemOneRequest,
  now: () => number,
  memory: ServerMemory = SHARED_MEMORY,
): Promise<AskResult> {
  const fallbacks = backend.fallbacks ?? [];
  if (fallbacks.length === 0) return askOne(net, backend, request, now);
  const started = now();
  const passed: string[] = [];
  for (const url of [backend.url, ...fallbacks]) {
    const skipped = memory.get(url);
    if (skipped !== undefined && skipped.until > now()) {
      passed.push(`${url} ${skipped.reason}`);
      continue;
    }
    const busy = await busyReason(net, url);
    if (busy !== null) {
      memory.set(url, { until: now() + busy.skipMs, reason: busy.reason });
      passed.push(`${url} ${busy.reason}`);
      continue;
    }
    const result = await askOne(net, { ...backend, url }, request, now);
    if (result.ok) return { ...result, latencyMs: now() - started };
    const kind = result.failure.kind;
    if (kind === "unreachable" || kind === "server-error") {
      const reason = kind === "unreachable" ? "not answering" : "server error";
      memory.set(url, { until: now() + (kind === "unreachable" ? DOWN_SKIP_MS : BUSY_SKIP_MS), reason });
      passed.push(`${url} ${reason}`);
      continue;
    }
    return { ...result, latencyMs: now() - started };
  }
  return {
    ok: false,
    latencyMs: now() - started,
    failure: {
      kind: "unreachable",
      message: `No ${backend.label} server could take the request: ${passed.join("; ")}. Squire will try again shortly.`,
      retryable: true,
    },
  };
}

async function askOne(
  net: NetLike,
  backend: Backend,
  request: SystemOneRequest,
  now: () => number,
): Promise<AskResult> {
  const started = now();
  const body = JSON.stringify(backend.model === undefined ? request : { model: backend.model, ...request });
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (backend.secret !== undefined) headers["Authorization"] = `Bearer {secret:${backend.secret}}`;

  const reply = await net.request({ url: backend.url, method: "POST", headers, body, timeoutMs: backend.timeoutMs });
  const latencyMs = now() - started;

  if (!reply.ok) {
    if (reply.code === "not-declared") {
      return {
        ok: false,
        latencyMs,
        failure: {
          kind: "not-allowed",
          message: `Squire is not allowed to reach ${backend.url}. Pick a server Squire's permissions name, or report this if you expected it to work.`,
          retryable: false,
        },
      };
    }
    if (reply.code === "secret-missing") {
      return {
        ok: false,
        latencyMs,
        failure: {
          kind: "key-refused",
          message: `No API key is set for ${backend.label}. Add one in Squire's setup.`,
          retryable: false,
        },
      };
    }
    return {
      ok: false,
      latencyMs,
      failure: { kind: "unreachable", message: `Could not reach ${backend.label}: ${reply.problem}`, retryable: true },
    };
  }

  if (reply.status !== 200) {
    return { ok: false, latencyMs, failure: statusFailure(backend, reply.status, reply.headers) };
  }

  const parsed = parseReply(request, body, reply.body);
  if (!parsed.ok) {
    return {
      ok: false,
      latencyMs,
      failure: {
        kind: "bad-reply",
        message: `${backend.label} answered, but ${parsed.problem}. Squire will try again shortly.`,
        retryable: true,
      },
    };
  }
  return { ok: true, answers: parsed.answers, usage: parsed.usage, model: parsed.model, latencyMs, server: backend.url };
}
