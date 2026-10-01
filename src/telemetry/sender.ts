import type { NetLike } from "../brain/backend.js";
import type { KvStore } from "../memory/kv.js";
import type { Batch } from "./batch.js";

export const DEFAULT_ENDPOINT = "https://squire.rpgm.tools";
const QUEUE = "squire/telemetry/queue/";
const BACKOFF = [1_000, 4_000, 15_000, 60_000] as const;

interface UploadQueue {
  generation: number;
  pending: Promise<void>;
  cancelled: Promise<void>;
  cancel: () => void;
}

/* Setup and finished runs use separate senders over the same local queue. */
const queues = new WeakMap<KvStore, UploadQueue>();

function cancellation(): Pick<UploadQueue, "cancelled" | "cancel"> {
  let cancel = () => {};
  const cancelled = new Promise<void>((resolve) => { cancel = resolve; });
  return { cancelled, cancel };
}

export interface Chronicle {
  readonly run_id: string;
  readonly status: "posted" | "posted_without_name" | "held" | "over_limit" | "waiting";
  readonly flagged: "name" | "details" | "unchecked" | null;
  readonly category: "hate" | "sexual" | "harassment" | "contact" | "advert" | "general" | null;
  readonly review: "pending" | "done" | null;
  readonly decision: string | null;
  readonly message: string;
}

export type SendResult =
  | { readonly ok: true; readonly chronicle?: Chronicle; readonly duplicate?: boolean }
  | { readonly ok: false; readonly queued: boolean; readonly reason: string; readonly field?: string };

export type InstallResult =
  | { readonly ok: true; readonly data: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly reason: string; readonly field?: string };

export interface SenderOptions {
  readonly net: NetLike;
  readonly store: KvStore;
  readonly endpoint: string;
  readonly now: () => number;
  readonly log: (message: string) => void;
  /** A clock hook lets tests advance retries without waiting for wall time. */
  readonly sleep?: (ms: number) => Promise<void>;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function body(text: string): Record<string, unknown> | null {
  try { return object(JSON.parse(text)); } catch { return null; }
}

function header(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
}

function retryAfter(headers: Readonly<Record<string, string>>, now: number): number | undefined {
  const value = header(headers, "retry-after");
  if (value === undefined) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

export function createSender(options: SenderOptions) {
  const { net, store, endpoint, now, log } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let queue = queues.get(store);
  if (queue === undefined) {
    queue = { generation: 0, pending: Promise.resolve(), ...cancellation() };
    queues.set(store, queue);
  }
  const uploads = queue;
  const generations = new Map<string, number>();
  let lastStamp = 0;
  let stampOrder = 0;

  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = uploads.pending.then(operation);
    uploads.pending = result.then(() => {}, () => {});
    return result;
  }

  function deleted(): SendResult {
    return { ok: false, queued: false, reason: "Deletion removed this batch from the upload queue." };
  }

  async function request(method: string, path: string, payload?: string) {
    return net.request({
      url: `${endpoint.replace(/\/$/, "")}${path}`,
      method,
      headers: { "Content-Type": "application/json" },
      ...(payload === undefined ? {} : { body: payload }),
      timeoutMs: 15_000,
    });
  }

  async function post(batch: Batch, generation: number): Promise<SendResult> {
    const cancelled = uploads.cancelled;
    const pause = (ms: number) => Promise.race([sleep(ms), cancelled]);
    for (let attempt = 0; attempt <= BACKOFF.length; attempt++) {
      if (generation !== uploads.generation) return deleted();
      try {
        const reply = await request("POST", "/v1/batches", JSON.stringify(batch));
        if (reply.ok) {
          const parsed = body(reply.body);
          if ((reply.status === 202 || reply.status === 200) && parsed?.["ok"] === true) {
            const chronicle = object(parsed["chronicle"]);
            return {
              ok: true,
              ...(reply.status === 200 && parsed["duplicate"] === true ? { duplicate: true } : {}),
              ...(chronicle === null ? {} : { chronicle: chronicle as unknown as Chronicle }),
            };
          }
          if (reply.status === 400 || reply.status === 413) {
            const field = typeof parsed?.["field"] === "string" ? parsed["field"] : "batch";
            const reason = typeof parsed?.["error"] === "string" ? parsed["error"] : `HTTP ${String(reply.status)}`;
            log(`Telemetry batch was refused at ${field}: ${reason} Check the telemetry data before sending again.`);
            return { ok: false, queued: false, reason, field };
          }
          if (reply.status !== 429 && reply.status < 500) {
            return { ok: false, queued: true, reason: `Telemetry returned HTTP ${String(reply.status)}. Check the endpoint and try again.` };
          }
          if (attempt < BACKOFF.length) {
            await pause(reply.status === 429 ? retryAfter(reply.headers, now()) ?? BACKOFF[attempt]! : BACKOFF[attempt]!);
            continue;
          }
        } else if (attempt < BACKOFF.length) {
          await pause(BACKOFF[attempt]!);
          continue;
        }
      } catch {
        if (attempt < BACKOFF.length) {
          try { await pause(BACKOFF[attempt]!); } catch { break; }
          continue;
        }
      }
      break;
    }
    return { ok: false, queued: true, reason: "Telemetry could not be sent. It remains queued for another try." };
  }

  async function drainOnce(generation: number): Promise<Map<string, SendResult>> {
    const results = new Map<string, SendResult>();
    if (!endpoint) return results;
    try {
      for (const key of (await store.keys(QUEUE)).sort()) {
        if (generation !== uploads.generation) break;
        const batch = await store.get(key);
        if (object(batch) === null) {
          await store.delete(key);
          continue;
        }
        const result = await post(batch as Batch, generation);
        results.set(key, result);
        if (result.ok || !result.queued) await store.delete(key);
        else break;
      }
    } catch {
      log("Telemetry queue could not be read. Try sending again later.");
    }
    return results;
  }

  return {
    async send(batch: Batch): Promise<SendResult> {
      if (!endpoint) return { ok: false, queued: false, reason: "Telemetry is disabled. Set an endpoint to send batches." };
      /* A split run's remaining batches were recorded before any later deletion. */
      const recording = `${batch.run_id}/${batch.sent_at}`;
      const generation = generations.get(recording) ?? uploads.generation;
      generations.set(recording, generation);
      return exclusive(async () => {
        if (generation !== uploads.generation) return deleted();
        try {
          const stamp = Math.max(now(), lastStamp);
          stampOrder = stamp === lastStamp ? stampOrder + 1 : 0;
          lastStamp = stamp;
          const key = `${QUEUE}${String(stamp).padStart(16, "0")}-${String(stampOrder).padStart(8, "0")}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
          await store.set(key, batch);
          const results = await drainOnce(generation);
          if (generation !== uploads.generation) return deleted();
          return results.get(key) ?? { ok: false, queued: true, reason: "Telemetry is queued behind an earlier batch. Try again later." };
        } catch {
          return { ok: false, queued: false, reason: "Telemetry could not be saved. Check local storage and try again." };
        }
      });
    },
    async drain(): Promise<void> {
      const generation = uploads.generation;
      await exclusive(async () => { if (generation === uploads.generation) await drainOnce(generation); });
    },
    async status(installId: string): Promise<InstallResult> {
      if (!endpoint) return { ok: false, reason: "Telemetry is disabled. Set an endpoint to check status." };
      try {
        const reply = await request("GET", `/v1/installs/${encodeURIComponent(installId)}`);
        if (!reply.ok) return { ok: false, reason: reply.problem };
        const parsed = body(reply.body);
        return reply.status === 200 && parsed?.["ok"] === true
          ? { ok: true, data: parsed }
          : { ok: false, reason: String(parsed?.["error"] ?? `HTTP ${String(reply.status)}`), ...(typeof parsed?.["field"] === "string" ? { field: parsed["field"] } : {}) };
      } catch { return { ok: false, reason: "Telemetry status could not be loaded. Try again later." }; }
    },
    async deleteInstall(installId: string): Promise<InstallResult> {
      uploads.generation++;
      uploads.cancel();
      Object.assign(uploads, cancellation());
      return exclusive(async () => {
        try {
          for (const key of await store.keys(QUEUE)) await store.delete(key);
          if (!endpoint) return { ok: false, reason: "Telemetry is disabled. Set an endpoint to delete an install." };
          const reply = await request("DELETE", `/v1/installs/${encodeURIComponent(installId)}`);
          if (!reply.ok) return { ok: false, reason: reply.problem };
          const parsed = body(reply.body);
          return reply.status === 200 && parsed?.["ok"] === true
            ? { ok: true, data: parsed }
            : { ok: false, reason: String(parsed?.["error"] ?? `HTTP ${String(reply.status)}`), ...(typeof parsed?.["field"] === "string" ? { field: parsed["field"] } : {}) };
        } catch { return { ok: false, reason: "Telemetry could not be deleted. Try again later." }; }
      });
    },
  };
}
