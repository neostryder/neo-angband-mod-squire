/** Parallel Laya calls collect training answers without entering the play loop or tally. */

import { ask, selfHosted, type NetLike } from "../brain/backend.js";
import type { DecisionRecord } from "../brain/brain.js";
import type { Answer, SystemOneRequest } from "../brain/systemone.js";
import { rowId, type LayaRow, type Pilot } from "./rows.js";

const PILOTS: readonly [string, Pilot][] = [["goal", "squire_goal"], ["in_character", "squire_in_character"]];

export interface RowSink {
  append(row: LayaRow, seq: number): Promise<void>;
  attachLaya(id: string, adapter: string, answers: Readonly<Record<string, Answer>>, server?: string): Promise<void>;
}

/** Capture the routing field while the normal backend parser checks the answers. */
function capturingNet(net: NetLike, adapter: (value: string) => void): NetLike {
  return {
    transport: net.transport,
    async request(request) {
      const reply = await net.request(request);
      if (reply.ok) {
        try {
          const raw: unknown = JSON.parse(reply.body);
          if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
            const routing = (raw as Record<string, unknown>)["routing"];
            if (routing !== null && typeof routing === "object" && !Array.isArray(routing)) {
              const named = (routing as Record<string, unknown>)["adapter"];
              if (typeof named === "string") adapter(named);
            }
          }
        } catch { /* The backend parser will report invalid JSON. */ }
      }
      return reply;
    },
  };
}

export function createShadow(options: {
  readonly net: NetLike | null;
  readonly rows: RowSink;
  readonly install: Promise<string>;
  readonly runId: string;
  readonly now: () => number;
  readonly log: (message: string) => void;
}) {
  const busy = new Set<Pilot>();
  const pendingRows = new Set<Promise<void>>();
  let reportedFailure = false;

  function failed(): void {
    if (reportedFailure) return;
    reportedFailure = true;
    options.log("Squire could not reach Laya for training. Check the Laya address in Setup.");
  }

  return {
    /** One teacher row is saved per known pilot, including when shadowing is off. */
    record(record: DecisionRecord<unknown>, seq: number, enabled: boolean, url: string, fallbacks: readonly string[] = []): Promise<void> {
      if (record.backend !== "Jev") return Promise.resolve();
      const ts = new Date(options.now()).toISOString();
      const tasks: Promise<void>[] = [];
      for (const [questionId, pilot] of PILOTS) {
        const question = record.request.questions[questionId];
        const answer = record.answers[questionId];
        if (question === undefined || answer === undefined) continue;
        const shouldSend = enabled && record.backend === "Jev" && options.net !== null && !busy.has(pilot);
        if (shouldSend) busy.add(pilot);
        let rowWritten = (): void => {};
        const written = new Promise<void>((resolve) => { rowWritten = resolve; });
        pendingRows.add(written);
        tasks.push((async () => {
          try {
            const install = await options.install;
            const id = rowId(install, options.runId, seq, pilot);
            const questions = { [questionId]: question };
            const row: LayaRow = {
              id,
              pilot,
              ts,
              state: record.request.state,
              questions,
              jev: { model: record.model ?? "jev-latest", answers: { [questionId]: answer } },
              outcome: { plan: record.outcome },
            };
            await options.rows.append(row, seq);
            rowWritten();
            if (!shouldSend || options.net === null) return;
            let adapter = "base";
            const request: SystemOneRequest = { state: record.request.state, questions };
            const backend = selfHosted("laya", "Laya", url, `laya:${pilot}`, fallbacks);
            const result = await ask(capturingNet(options.net, (value) => { adapter = value; }), backend, request, options.now);
            if (!result.ok) { failed(); return; }
            await options.rows.attachLaya(id, adapter, result.answers, backend.fallbacks === undefined ? undefined : result.server);
          } catch {
            failed();
          } finally {
            rowWritten();
            pendingRows.delete(written);
            if (shouldSend) busy.delete(pilot);
          }
        })());
      }
      return Promise.all(tasks).then(() => {});
    },
    async rowsReady(): Promise<void> { await Promise.all([...pendingRows]); },
  };
}
