import { describe, expect, it } from "vitest";
import type { AgentCommand } from "@rpgm-tools/neo-angband-core";
import { closeSegment, noteCommand, noteKill, readSegment, segmentLine, startSegment } from "./segment.js";
import { world } from "../harness.js";

const walk = (dir: number): AgentCommand => ({ code: "walk", dir }) as AgentCommand;

describe("the player's segment", () => {
  it("says nothing when the player did nothing", () => {
    const w = world({ map: ["#####", "#.@.#", "#####"] });
    expect(segmentLine(closeSegment(startSegment(w.view), w.view))).toBeNull();
  });

  it("records where the character went, what it fought, used and killed", () => {
    const w = world({ map: ["#######", "#.@g..#", "#######"], monsters: [{ grid: { x: 3, y: 1 }, race: "cave spider" }], pack: ["a Potion of Cure Light Wounds"] });
    let segment = startSegment(w.view);
    segment = noteCommand(segment, walk(6), w.view);
    segment = noteCommand(segment, { code: "quaff", args: { handle: 1 } } as AgentCommand, w.view);
    segment = noteKill(segment, "cave spider");
    segment = noteKill(segment, "cave spider");
    w.setPlayer({ depth: 3 });
    w.advance(50);
    segment = closeSegment(segment, w.view);
    expect(segment.open).toBe(false);
    expect(segment.fought).toEqual(["cave spider"]);
    expect(segment.used).toEqual(["a Potion of Cure Light Wounds"]);
    const line = segmentLine(segment);
    expect(line).toContain("2 commands over 50 game turns");
    expect(line).toContain("went from level 1 to level 3");
    expect(line).toContain("killed 2 cave spider");
    expect(line).toContain("Squire's earlier plan may no longer apply.");
  });

  it("survives the save as plain data, and rejects anything else", () => {
    const w = world({ map: ["#####", "#.@.#", "#####"] });
    const segment = noteKill(startSegment(w.view), "jackal");
    expect(readSegment(JSON.parse(JSON.stringify(segment)))).toEqual(segment);
    expect(readSegment(null)).toBeNull();
    expect(readSegment([1])).toBeNull();
    expect(readSegment({ commands: "many", killed: [1, "kobold"] })).toMatchObject({ commands: 0, killed: ["kobold"], open: false });
  });
});
