import { describe, expect, it } from "vitest";
import { createRunLog, fromJson } from "./events.js";

describe("run log", () => {
  it("tallies kills and keeps the observed route and close calls", () => {
    const log = createRunLog();
    log.record({ kind: "descend", turn: 10, depth: 2, text: "Took the stairs" });
    log.record({ kind: "kill", turn: 12, depth: 2, text: "an orc", race: "Orc" });
    log.record({ kind: "unique-kill", turn: 14, depth: 2, text: "an orc captain", race: "Orc" });
    log.record({ kind: "near-death", turn: 15, depth: 2, text: "Fell to 3 HP", value: 3 });
    expect(log.topKills(1)).toEqual([{ name: "Orc", count: 2 }]);
    expect(log.depthCurve()).toEqual([{ turn: 10, depth: 2 }]);
    expect(log.hpLowPoints()).toEqual([{ turn: 15, depth: 2, hp: 3 }]);
    expect(log.closeCalls()).toHaveLength(1);
    expect(log.runClock()).toEqual({ startTurn: 10, endTurn: 15, turns: 6 });
    expect(fromJson(log.toJson()).events()).toEqual(log.events());
  });

  it("never throws for bad JSON and skips invalid events", () => {
    expect(fromJson("{").events()).toEqual([]);
    expect(fromJson(JSON.stringify({ format: "neo-angband/squire/run-log", schemaVersion: 1,
      events: [null, { kind: "kill", turn: "bad", depth: 1, text: "bad" },
        { kind: "kill", turn: 1, depth: 1, text: "a rat", race: "Rat" }] })).topKills(2))
      .toEqual([{ name: "Rat", count: 1 }]);
  });
});
