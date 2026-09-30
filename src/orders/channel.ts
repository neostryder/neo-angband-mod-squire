/**
 * Viewers' orders from a chat channel.
 *
 * Squire Link reads Twitch or Discord chat on the player's computer and keeps
 * the orders viewers give there. While Squire plays, this collects them from
 * the address set in Setup every few seconds and queues each one as the panel
 * would, with the viewer's name kept on it. With no address it asks nothing.
 *
 * A failed collection is logged once and tried again later. Nothing here throws.
 */

import type { NetLike } from "../brain/backend.js";
import { MAX_VIEWER } from "./types.js";

/** Time between two collections while Squire plays. */
export const CHANNEL_POLL_MS = 5_000;
/** Time before trying again after a failed collection. */
export const CHANNEL_RETRY_MS = 30_000;
/** Longest order taken from a channel, as Squire Link caps it. */
export const CHANNEL_MAX_TEXT = 300;
/** Most orders taken from one reply. */
const MAX_PER_REPLY = 50;
/** Most replies read in one collection while the channel says more are waiting. */
export const MAX_PAGES = 10;
const TIMEOUT_MS = 4_000;

export interface ChannelOrder {
  readonly text: string;
  /** Empty when the channel named nobody. */
  readonly viewer: string;
  readonly platform: string;
}

export interface ChannelDeps {
  /** The address to collect from. Empty means none. */
  url(): string;
  net(): NetLike | null;
  /** Queue one order. */
  queue(order: ChannelOrder): void;
  /** Called once after a collection queued orders, so their sorting can go in one request. */
  flush?(): void;
  log(message: string): void;
  now(): number;
}

export interface ChannelPoller {
  /** Called while Squire plays; collects when one is due. */
  tick(): void;
  /** Forget any collection in flight, for a new character: what it brings back is dropped. */
  reset(): void;
  /** Resolves when no collection is in flight. */
  settled(): Promise<void>;
}

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

/**
 * The orders in a reply body and whether more are waiting, or null when the
 * body is neither a list of orders nor `{ "orders": [...], "more": bool }`.
 */
export function readChannelReply(body: string): { readonly orders: ChannelOrder[]; readonly more: boolean } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  let list: unknown = parsed;
  let more = false;
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    const r = parsed as Record<string, unknown>;
    list = r["orders"];
    more = r["more"] === true;
  }
  if (!Array.isArray(list)) return null;
  const out: ChannelOrder[] = [];
  for (const raw of list.slice(0, MAX_PER_REPLY)) {
    if (raw === null || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const text = clean(r["text"], CHANNEL_MAX_TEXT);
    if (text === "") continue;
    out.push({ text, viewer: clean(r["user"], MAX_VIEWER), platform: clean(r["platform"], 20) });
  }
  return { orders: out, more };
}

/** The orders in a reply body, or null when the body is not a list of them. */
export function readChannelOrders(body: string): ChannelOrder[] | null {
  return readChannelReply(body)?.orders ?? null;
}

export function createChannelPoller(deps: ChannelDeps): ChannelPoller {
  let dueAt = 0;
  let inFlight: Promise<void> | null = null;
  let generation = 0;
  /* Set while collections keep failing, so the log gets one line per outage. */
  let failing = false;

  function failed(url: string, problem: string): void {
    dueAt = deps.now() + CHANNEL_RETRY_MS;
    if (failing) return;
    failing = true;
    deps.log(`Squire couldn't collect viewer orders from ${url}: ${problem}. It will try again in ${String(CHANNEL_RETRY_MS / 1000)} seconds.`);
  }

  async function collect(net: NetLike, url: string, mine: number): Promise<void> {
    const stale = (): boolean => mine !== generation || deps.url().trim() !== url;
    const orders: ChannelOrder[] = [];
    let more = true;
    for (let page = 0; more && page < MAX_PAGES; page += 1) {
      const reply = await net.request({ url, method: "GET", timeoutMs: TIMEOUT_MS });
      if (stale()) return;
      /* Orders already taken from earlier pages are gone from the channel, so they are queued even if a later page fails. */
      if (!reply.ok) { failed(url, reply.problem); break; }
      if (reply.status !== 200) { failed(url, `HTTP ${String(reply.status)}`); break; }
      const read = readChannelReply(reply.body);
      if (read === null) { failed(url, "the reply is not a list of orders"); break; }
      if (failing) deps.log("Squire is collecting viewer orders again.");
      failing = false;
      orders.push(...read.orders);
      more = read.more;
    }
    if (more && !failing) dueAt = deps.now();
    for (const order of orders) deps.queue(order);
    if (orders.length > 0) deps.flush?.();
  }

  return {
    tick() {
      const url = deps.url().trim();
      if (url === "" || inFlight !== null || deps.now() < dueAt) return;
      const net = deps.net();
      if (net === null) return;
      dueAt = deps.now() + CHANNEL_POLL_MS;
      inFlight = collect(net, url, generation)
        .catch((error: unknown) => failed(url, error instanceof Error ? error.message : String(error)))
        .finally(() => { inFlight = null; });
    },
    reset() {
      generation += 1;
      dueAt = 0;
    },
    settled: () => inFlight ?? Promise.resolve(),
  };
}
