/** Training rows are keyed by run and decision sequence so a reload cannot change their ids. */

import type { Answer, Question } from "../brain/systemone.js";
import type { KvStore } from "../memory/kv.js";

export type Pilot = "squire_goal" | "squire_in_character" | "squire_gate";

export interface LayaRow {
  readonly id: string;
  readonly pilot: Pilot;
  readonly ts: string;
  readonly state: Readonly<Record<string, unknown>>;
  readonly questions: Readonly<Record<string, Question>>;
  readonly jev: { readonly model: string; readonly answers: Readonly<Record<string, Answer>> };
  readonly laya?: { readonly adapter: string; readonly answers: Readonly<Record<string, Answer>>; readonly server?: string };
  readonly outcome: { readonly plan: string };
  readonly human?: Readonly<Record<string, string>>;
}

const PREFIX = "squire/laya/";

/**
 * Where goal question row numbers start: above every decision and below every
 * Knight's Lessons row, so goal chunks outlast old decision chunks and the
 * kinds never share an id.
 */
export const GOAL_SEQ_BASE = 250_000;
const GOAL_SUFFIXES: readonly string[] = ["long", "mid", "near"];
const CHUNK = 100;
const MAX_CHUNKS = 50;
let activeHuman: ((rowId: string, answers: Readonly<Record<string, string>>) => Promise<void>) | null = null;

function chunkKey(runId: string, seq: number): string {
  return `${PREFIX}${runId}/${String(Math.floor(seq / CHUNK)).padStart(8, "0")}`;
}

/** The pilot's fixed slot makes each id unique without adding a variable suffix. Yes-or-no gates came later and take a fixed suffix, and the goal questions take their own, so older ids keep their train or test side. */
export function rowId(install: string, runId: string, seq: number, pilot: Pilot, suffix?: string): string {
  if (suffix !== undefined) return `squire-${install}-${runId}-${String(seq)}-${suffix}`;
  if (pilot === "squire_gate") return `squire-${install}-${runId}-${String(seq)}-gate`;
  return `squire-${install}-${runId}-${String(seq * 2 + (pilot === "squire_goal" ? 0 : 1))}`;
}

/** Read all runs in key order, preserving the stored row shape. */
export async function allRows(store: KvStore): Promise<LayaRow[]> {
  const rows: LayaRow[] = [];
  for (const key of await store.keys(PREFIX)) {
    const chunk = await store.get(key);
    if (Array.isArray(chunk)) rows.push(...chunk as LayaRow[]);
  }
  return rows;
}

/** A trailing newline lets command line JSON Lines readers consume the last row. */
export async function exportRows(store: KvStore): Promise<string> {
  const rows = await allRows(store);
  return rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length > 0 ? "\n" : "");
}

export async function countRows(store: KvStore): Promise<number> {
  return (await allRows(store)).length;
}

/** The current runtime supplies the store, so a later lesson only needs the row id. */
export function attachHuman(rowId: string, answers: Readonly<Record<string, string>>): Promise<void> {
  if (activeHuman === null) return Promise.reject(new Error("Laya rows are not open"));
  return activeHuman(rowId, answers);
}

/** Serialize writes so a fast Laya reply cannot overwrite an adjacent append. */
export function createRows(store: KvStore, runId: string) {
  let pending: Promise<unknown> = Promise.resolve();

  function write<T>(operation: () => Promise<T>): Promise<T> {
    const next = pending.then(operation, operation);
    pending = next.catch(() => {});
    return next;
  }

  async function change(rowId: string, patch: Partial<Pick<LayaRow, "laya" | "human">>, allRuns = false): Promise<void> {
    for (const key of await store.keys(allRuns ? PREFIX : `${PREFIX}${runId}/`)) {
      const value = await store.get(key);
      if (!Array.isArray(value)) continue;
      const rows = value as LayaRow[];
      const index = rows.findIndex((row) => row.id === rowId);
      if (index < 0) continue;
      const next = rows.slice();
      next[index] = { ...rows[index]!, ...patch };
      await store.set(key, next);
      return;
    }
  }

  activeHuman = (rowId, answers) => write(() => change(rowId, { human: answers }, true));

  return {
    append(row: LayaRow, seq: number): Promise<void> {
      return write(async () => {
        const slot = seq * 2 + (row.pilot === "squire_goal" ? 0 : 1);
        const key = chunkKey(runId, slot);
        const old = await store.get(key);
        const rows = Array.isArray(old) ? old as LayaRow[] : [];
        await store.set(key, [...rows.filter((entry) => entry.id !== row.id), row]);
        const keys = await store.keys(`${PREFIX}${runId}/`);
        for (const stale of keys.slice(0, -MAX_CHUNKS)) await store.delete(stale);
      });
    },
    attachLaya(rowId: string, adapter: string, answers: Readonly<Record<string, Answer>>, server?: string): Promise<void> {
      return write(() => change(rowId, { laya: { adapter, answers, ...(server === undefined ? {} : { server }) } }));
    },
    /** Knight's Lessons can add a correction without changing the stable row id. */
    attachHuman(rowId: string, answers: Readonly<Record<string, string>>): Promise<void> {
      return write(() => change(rowId, { human: answers }));
    },
    /** The highest sequence number among this run's rows with one of these id suffixes, or null when there are none. */
    lastSeq(suffixes: readonly string[]): Promise<number | null> {
      return write(async () => {
        let best: number | null = null;
        for (const key of await store.keys(`${PREFIX}${runId}/`)) {
          const value = await store.get(key);
          if (!Array.isArray(value)) continue;
          for (const row of value as LayaRow[]) {
            const match = /-(\d+)-([a-z]+)$/.exec(row.id);
            if (match === null || !suffixes.includes(match[2]!)) continue;
            const seq = Number(match[1]);
            if (best === null || seq > best) best = seq;
          }
        }
        return best;
      });
    },
    async idle(): Promise<void> { await pending; },
  };
}

/** Goal question row numbers for one run, continuing from the stored rows so a reload never reuses an id. */
export function goalSeqCounter(rows: { lastSeq(suffixes: readonly string[]): Promise<number | null> }): () => Promise<number> {
  let last = rows.lastSeq(GOAL_SUFFIXES).then((seq) => Math.max(GOAL_SEQ_BASE - 1, seq ?? -1), () => GOAL_SEQ_BASE - 1);
  return () => {
    last = last.then((seq) => seq + 1);
    return last;
  };
}
