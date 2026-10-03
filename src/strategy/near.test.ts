import { describe, expect, it } from "vitest";
import { suppliedWorld, world } from "../harness.js";
import { nearCandidates, nearEnded, nearProgress, pickNear, type NearFacts } from "./near.js";

const ROOM = ["#####", "#.@.#", "#####"];

function facts(viewDepth: number, terrain: NearFacts["terrain"] = null): NearFacts {
  return { terrain, persona: null, aims: [], memories: [], startDepth: viewDepth };
}

describe("near-term candidates", () => {
  it("offers rest while hurt and nothing is awake, and not once a creature wakes", () => {
    const hurt = world({ map: ROOM, player: { hp: 10, maxHp: 40 } });
    expect(nearCandidates(hurt.view, facts(1)).map((item) => item.kind)).toEqual(["rest"]);
    const awake = world({ map: ROOM, player: { hp: 10, maxHp: 40 }, monsters: [{ grid: { x: 3, y: 1 }, race: "kobold", level: 1 }] });
    expect(nearCandidates(awake.view, facts(1)).map((item) => item.kind)).not.toContain("rest");
  });

  it("offers a position for a visible stronger creature and ignores one the character cannot see", () => {
    const seen = world({ map: ROOM, player: { level: 5, hp: 40, maxHp: 40 }, monsters: [{ grid: { x: 3, y: 1 }, race: "ogre", level: 12 }] });
    const hidden = world({ map: ROOM, player: { level: 5, hp: 40, maxHp: 40 }, monsters: [{ grid: { x: 3, y: 1 }, race: "ogre", level: 12, visible: false }] });
    expect(nearCandidates(seen.view, facts(1)).map((item) => item.kind)).toContain("position");
    expect(nearCandidates(hidden.view, facts(1)).map((item) => item.kind)).toEqual(nearCandidates(world({ map: ROOM, player: { level: 5, hp: 40, maxHp: 40 } }).view, facts(1)).map((item) => item.kind));
  });

  it("treats a fast unique at low level as a reason to leave, not as a stronger creature by itself", () => {
    const w = world({ map: ROOM, player: { level: 3, hp: 40, maxHp: 40, depth: 2 }, monsters: [{ grid: { x: 3, y: 1 }, race: "Fang", level: 1, speed: 140, raceFlags: ["UNIQUE"] }] });
    const kinds = nearCandidates(w.view, facts(2)).map((item) => item.kind);
    expect(kinds).toContain("leave");
    expect(kinds).not.toContain("position");
  });

  it("offers an unknown item only while nothing is awake", () => {
    const quiet = world({ map: ROOM, player: { hp: 40, maxHp: 40 }, pack: ["a {??}"] });
    expect(nearCandidates(quiet.view, facts(1)).map((item) => item.kind)).toContain("try");
    const busy = world({ map: ROOM, player: { hp: 40, maxHp: 40 }, pack: ["a {??}"], monsters: [{ grid: { x: 3, y: 1 }, race: "kobold", level: 1 }] });
    expect(nearCandidates(busy.view, facts(1)).map((item) => item.kind)).not.toContain("try");
  });

  it("keeps the first candidate when nothing is chosen", () => {
    const hurt = world({ map: ROOM, player: { hp: 10, maxHp: 40 } });
    const list = nearCandidates(hurt.view, facts(1));
    expect(pickNear(list, {})?.kind).toBe("rest");
    expect(pickNear(list, { near_goal: { type: "choice", choice: "none_of_these", confidence: 1, probabilities: {} } })?.kind).toBe("rest");
    expect(pickNear(list, { near_goal: { type: "choice", choice: "rest", confidence: 1, probabilities: { rest: 1 } } })?.kind).toBe("rest");
  });
});

describe("a near-term goal ending", () => {
  it("meets rest when hit points are full, even after a level change", () => {
    const full = world({ map: ROOM, player: { depth: 4, hp: 40, maxHp: 40 } });
    expect(nearEnded("rest", full.view, facts(2))).toEqual({ end: "met", reason: "hit points and spell points are full" });
    const hurt = world({ map: ROOM, player: { depth: 2, hp: 10, maxHp: 40 }, monsters: [{ grid: { x: 3, y: 1 }, race: "kobold", level: 1 }] });
    expect(nearEnded("rest", hurt.view, facts(2))).toEqual({ end: "failed", reason: "a creature is awake in view" });
    const left = world({ map: ROOM, player: { depth: 3, hp: 10, maxHp: 40 } });
    expect(nearEnded("rest", left.view, facts(2))).toEqual({ end: "abandoned", reason: "the character left the level" });
  });

  it("meets explore only on the same level, once the frontier is gone", () => {
    const open = suppliedWorld({ map: ["#####", "#.@,#", "#####"], player: { depth: 2, hp: 60, maxHp: 60 } });
    const closed = world({ map: ROOM, player: { depth: 2 } });
    expect(nearEnded("explore", open.view, facts(2, open.terrain))).toBeNull();
    expect(nearEnded("explore", closed.view, facts(2, closed.terrain))).toEqual({ end: "met", reason: "the level has no unexplored frontier" });
    expect(nearEnded("explore", world({ map: ROOM, player: { depth: 3 } }).view, facts(2, closed.terrain))).toEqual({ end: "abandoned", reason: "the character left the level" });
  });

  it("meets a descent when the level increases and fails when it decreases", () => {
    const down = world({ map: ROOM, player: { depth: 4, hp: 40, maxHp: 40 } });
    const up = world({ map: ROOM, player: { depth: 1, hp: 40, maxHp: 40 } });
    expect(nearEnded("down", down.view, facts(2, down.terrain))?.end).toBe("met");
    expect(nearEnded("down", up.view, facts(2, up.terrain))).toEqual({ end: "failed", reason: "dungeon level decreased" });
  });

  it("meets recall in town, and abandons a level change that is still short of supplies", () => {
    const town = world({ map: ROOM, player: { depth: 0 }, pack: ["a Scroll of Word of Recall"] });
    expect(nearEnded("recall", town.view, facts(6))).toEqual({ end: "met", reason: "the character is in town" });
    const moved = world({ map: ROOM, player: { depth: 4, hp: 40, maxHp: 40 }, pack: ["a Scroll of Word of Recall"] });
    expect(nearEnded("recall", moved.view, facts(6))).toEqual({ end: "abandoned", reason: "the character left the level" });
  });

  it("meets a try once the unknown item is gone, including after a level change", () => {
    const gone = world({ map: ROOM, player: { depth: 5, hp: 40, maxHp: 40 } });
    expect(nearEnded("try", gone.view, facts(2))).toEqual({ end: "met", reason: "no unknown item is in the pack" });
  });

  it("meets a position once nothing stronger is in view", () => {
    const calm = world({ map: ROOM, player: { hp: 40, maxHp: 40 } });
    expect(nearEnded("position", calm.view, facts(1))).toEqual({ end: "met", reason: "no creature in view is stronger than the character" });
  });
  it("meets leave only by leaving the level, and names the danger read when it was chosen", () => {
    const felt = world({ map: ROOM, player: { depth: 3, hp: 40, maxHp: 40 }, messages: ["You feel anxious about this place."] });
    const leave = nearCandidates(felt.view, facts(3)).find((item) => item.kind === "leave");
    expect(leave?.danger).toBe("feeling");
    const quiet = world({ map: ROOM, player: { depth: 3, hp: 40, maxHp: 40 } });
    expect(nearEnded("leave", quiet.view, { ...facts(3), danger: "feeling" })).toBeNull();
    const gone = world({ map: ROOM, player: { depth: 4, hp: 40, maxHp: 40 } });
    expect(nearEnded("leave", gone.view, { ...facts(3), danger: "feeling" })).toEqual({ end: "met", reason: "the character got off a level that felt dangerous" });
  });

  it("keeps a recall goal while the recall counts down after the last scroll is read", () => {
    const counting = world({ map: ROOM, player: { depth: 6, hp: 40, maxHp: 40, recall: 20 } });
    expect(nearEnded("recall", counting.view, facts(6))).toBeNull();
    const idle = world({ map: ROOM, player: { depth: 6, hp: 40, maxHp: 40, recall: 0 } });
    expect(nearEnded("recall", idle.view, facts(6))).toEqual({ end: "failed", reason: "no Word of Recall is in the pack" });
    const unreported = world({ map: ROOM, player: { depth: 6, hp: 40, maxHp: 40 } });
    expect(nearEnded("recall", unreported.view, facts(6))).toBeNull();
  });

  it("counts hit points, and frontiers when the map is known", () => {
    const hurt = world({ map: ROOM, player: { hp: 10, maxHp: 40, sp: 2, maxSp: 8 } });
    expect(nearProgress("rest", hurt.view, null)).toBe("10 of 40 hit points, 2 of 8 spell points");
    const open = world({ map: ["#####", "#.@,#", "#####"] });
    expect(nearProgress("explore", open.view, open.terrain)).toContain("unexplored frontier");
    expect(nearProgress("down", hurt.view, null)).toBeNull();
  });
});
