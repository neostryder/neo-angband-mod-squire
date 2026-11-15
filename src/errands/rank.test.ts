import { describe, expect, it } from "vitest";
import type { AskResult } from "../brain/backend.js";
import type { Answer } from "../brain/systemone.js";
import { RANK_TIMEOUT_MS, rankErrands, rankRequest, shortList } from "./rank.js";
import { errandMenu, type ErrandEntry } from "./catalog.js";
import { world } from "../harness.js";

const DUNGEON = world({ map: ["#######", "#.@.>.,,", "#.<...#", "#######"] });
const entries = errandMenu(DUNGEON.view, DUNGEON.terrain);

function choice(probabilities: Record<string, number>): Answer {
  return { type: "choice", choice: Object.keys(probabilities)[0] ?? "", confidence: 0.5, probabilities };
}

function answered(probabilities: Record<string, number>): AskResult {
  return { ok: true, answers: { errand: choice(probabilities) }, usage: { inputTokens: 1, outputTokens: 1, estimated: false }, model: null, latencyMs: 10, server: "test" };
}

const never = (): Promise<void> => new Promise<void>(() => {});
const now = (): Promise<void> => Promise.resolve();

describe("the errand short list", () => {
  it("asks only about errands that can start, with their purpose", () => {
    const request = rankRequest(DUNGEON.view, entries);
    const question = request?.questions["errand"];
    expect(question?.type).toBe("choice");
    const criteria = (question as { criteria: Record<string, string> }).criteria;
    expect(Object.keys(criteria)).toEqual(["town", "down", "up", "leave", "explore", "clear"]);
    expect(request?.state["place"]).toBe("dungeon level 1");
  });

  it("asks nothing when fewer than two errands can start", () => {
    const one: ErrandEntry[] = entries.map((entry) => (entry.id === "leave" ? entry : { ...entry, reason: "no" }));
    expect(rankRequest(DUNGEON.view, one)).toBeNull();
  });

  it("keeps the top three that can start, best first", () => {
    expect(shortList(choice({ leave: 0.1, down: 0.4, loot: 0.9, explore: 0.3, clear: 0.2 }), entries)).toEqual(["down", "explore", "clear"]);
  });

  it("ignores names that are not errands, and answers of the wrong type", () => {
    expect(shortList(choice({ dance: 0.9, up: 0.1 }), entries)).toEqual(["up"]);
    expect(shortList({ type: "score", score: 1 } as unknown as Answer, entries)).toEqual([]);
    expect(shortList(undefined, entries)).toEqual([]);
  });

  it("gives the short list from an answer in time", async () => {
    const list = await rankErrands({ send: () => Promise.resolve(answered({ down: 0.6, up: 0.3 })), wait: never }, DUNGEON.view, entries);
    expect(list).toEqual(["down", "up"]);
  });

  it("goes without one when the answer is late", async () => {
    let waited = 0;
    const list = await rankErrands({ send: () => new Promise<AskResult>(() => {}), wait: (ms) => { waited = ms; return now(); } }, DUNGEON.view, entries);
    expect(list).toBeNull();
    expect(waited).toBe(RANK_TIMEOUT_MS);
  });

  it("goes without one when the request fails or the answer is empty", async () => {
    expect(await rankErrands({ send: () => Promise.reject(new Error("down")), wait: never }, DUNGEON.view, entries)).toBeNull();
    expect(await rankErrands({ send: () => Promise.resolve({ ok: false, reason: "busy" } as unknown as AskResult), wait: never }, DUNGEON.view, entries)).toBeNull();
    expect(await rankErrands({ send: () => Promise.resolve(answered({ loot: 1 })), wait: never }, DUNGEON.view, entries)).toBeNull();
  });
});
