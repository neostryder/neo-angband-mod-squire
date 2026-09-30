import type { PlanEnd } from "../brain/brain.js";
import type { KvStore } from "./kv.js";

export interface LoggedDecision {
  readonly id: string;
  readonly runId: string;
  readonly seq: number;
  readonly at: number;
  readonly turn: number;
  readonly trigger: string;
  readonly backend: string;
  readonly question: string;
  readonly choice: string;
  readonly confidence: number | null;
  readonly probs: Readonly<Record<string, number>> | null;
  readonly state: Readonly<Record<string, unknown>>;
  readonly options: readonly string[];
  readonly plan: string;
  readonly latencyMs: number;
  /** The address that answered, when the backend has more than one. */
  readonly server?: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedTokens: boolean;
  /** How the decision's plan ended, in one line; null until it ends, and for good if the player took the keyboard first. */
  readonly outcome: string | null;
  /** The same ending in full, kept on this machine for measuring later decisions. */
  readonly result?: PlanEnd;
  readonly persona?: { readonly best: string; readonly inCharacter: string; readonly blended: string; readonly strength: number; readonly removed: boolean };
}

export type DecisionInput = Omit<LoggedDecision, "id" | "runId" | "seq" | "outcome" | "result"> & { readonly outcome?: string | null };

const CHUNK = 200;
const LIMIT = 20_000;
const PREFIX = "squire/log/";

function prefix(runId: string): string { return `${PREFIX}${runId}/`; }
function chunkKey(runId: string, index: number): string { return `${prefix(runId)}${String(index).padStart(8, "0")}`; }

/** Chunk numbers follow sequence numbers so trimming does not renumber stored history. */
export function createDecisionLog(store: KvStore, runId: string) {
  let entries: LoggedDecision[] = [];
  let nextSeq = 0;
  const dirty = new Set<number>();
  const removed = new Set<number>();

  return {
    append(input: DecisionInput): string {
      const seq = nextSeq++;
      const id = `${runId}/${String(seq)}`;
      entries.push({ ...input, id, runId, seq, outcome: input.outcome ?? null });
      dirty.add(Math.floor(seq / CHUNK));
      while (entries.length > LIMIT) {
        const index = Math.floor(entries[0]!.seq / CHUNK);
        entries = entries.filter((entry) => Math.floor(entry.seq / CHUNK) !== index);
        removed.add(index);
        dirty.delete(index);
      }
      return id;
    },
    attachOutcome(id: string, outcome: string, result?: PlanEnd): void {
      const index = entries.findIndex((entry) => entry.id === id);
      if (index < 0) return;
      const old = entries[index]!;
      entries[index] = { ...old, outcome, ...(result === undefined ? {} : { result }) };
      dirty.add(Math.floor(old.seq / CHUNK));
    },
    records(): readonly LoggedDecision[] { return entries.slice(); },
    async flush(): Promise<void> {
      for (const index of [...removed].sort((a, b) => a - b)) {
        await store.delete(chunkKey(runId, index));
        removed.delete(index);
      }
      for (const index of [...dirty].sort((a, b) => a - b)) {
        const chunk = entries.filter((entry) => Math.floor(entry.seq / CHUNK) === index);
        if (chunk.length) await store.set(chunkKey(runId, index), chunk);
        dirty.delete(index);
      }
    },
    exportJsonl(): string { return entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length ? "\n" : ""); },
    async load(): Promise<void> {
      const keys = await store.keys(prefix(runId));
      const loaded: LoggedDecision[] = [];
      for (const key of keys.sort()) {
        const chunk = await store.get(key);
        if (Array.isArray(chunk)) loaded.push(...chunk as LoggedDecision[]);
      }
      entries = loaded.sort((a, b) => a.seq - b.seq).slice(-LIMIT);
      nextSeq = (entries.at(-1)?.seq ?? -1) + 1;
      dirty.clear();
      removed.clear();
      for (const key of keys) {
        const index = Number(key.slice(prefix(runId).length));
        if (Number.isInteger(index) && !entries.some((entry) => Math.floor(entry.seq / CHUNK) === index)) removed.add(index);
      }
    },
  };
}

export async function listRuns(store: KvStore): Promise<string[]> {
  const keys = await store.keys(PREFIX);
  return [...new Set(keys.map((key) => key.slice(PREFIX.length).split("/")[0]).filter((id): id is string => !!id))].sort();
}

export async function deleteRun(store: KvStore, runId: string): Promise<void> {
  for (const key of await store.keys(prefix(runId))) await store.delete(key);
}
