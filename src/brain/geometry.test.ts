import { describe, expect, it } from "vitest";
import { world } from "../harness.js";
import { chokeLine, compass, hazardLine, hazardsNear, neighbourKind, neighbourLine, seenBy, sightBreakLine, sightBreaks, stairLine } from "./geometry.js";

const free = () => ({ damage: 0, status: 0 });

describe("neighbours", () => {
  it("reads the eight squares around the character clockwise from north, naming a creature", () => {
    const w = world({ map: ["#####", "#.+~#", "#.@.#", "#####"], monsters: [{ grid: { x: 1, y: 2 }, race: "cave orc" }], traps: [{ x: 3, y: 2 }] });
    expect(neighbourLine(w.view, w.terrain)).toBe("Next to the character: north door, north-east hazard (burning ground), east hazard (a trap), south-east wall, south wall, south-west wall, west creature (cave orc), north-west floor.");
  });

  it("calls a square the character has never seen unknown, not floor", () => {
    const w = world({ map: ["#,#", "#@#", "###"] });
    expect(neighbourKind(w.view, w.terrain, { x: 1, y: 0 })).toBe("unknown");
  });

  it("names compass directions from one grid toward another", () => {
    expect(compass({ x: 5, y: 5 }, { x: 7, y: 3 })).toBe("north-east");
    expect(compass({ x: 5, y: 5 }, { x: 5, y: 9 })).toBe("south");
    expect(compass({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe("here");
  });
});

describe("line-of-sight breaks", () => {
  /* An archer down the corridor; the side room off the corridor is out of its line. */
  const MAP = [
    "#########",
    "#...@...#",
    "####.####",
    "####.####",
    "#########",
  ];
  const archer = { grid: { x: 1, y: 1 }, race: "kobold archer" };

  it("lists the nearest squares no awake creature can see, within the reach", () => {
    const w = world({ map: MAP, monsters: [archer] });
    expect(seenBy(w.view, w.view.monsters())).toBe(true);
    const breaks = sightBreaks(w.view, w.terrain, w.view.monsters(), free, 40, 2);
    /* The corridor mouth is still in the archer's line past the corner; one step further down is not. */
    expect(breaks.map((b) => b.at)).toEqual([{ x: 4, y: 3 }]);
    expect(breaks[0]!.route).toEqual([{ x: 4, y: 2 }, { x: 4, y: 3 }]);
    expect(sightBreakLine(w.view, breaks, true)).toBe("Line of sight breaks from every awake creature in view: 2 steps (close) south, 2 turns (soon).");
  });

  it("finds nothing to break when no creature can see the character, and says so", () => {
    const w = world({ map: MAP, monsters: [{ ...archer, asleep: false, grid: { x: 4, y: 3 } }] });
    w.moveTo({ x: 7, y: 1 });
    expect(sightBreaks(w.view, w.terrain, w.view.monsters(), free, 40, 2)).toEqual([]);
    expect(sightBreakLine(w.view, [], false)).toBe("Line of sight: no awake creature in view can see the character.");
  });

  it("leaves out a walk that could kill, and never walks through burning ground or a visible trap", () => {
    const w = world({ map: ["#########", "#...@...#", "####~####", "####.####", "#########"], monsters: [archer] });
    expect(sightBreaks(w.view, w.terrain, w.view.monsters(), free, 40, 2)).toEqual([]);
    const trapped = world({ map: MAP, monsters: [archer], traps: [{ x: 4, y: 2 }] });
    expect(sightBreaks(trapped.view, trapped.terrain, trapped.view.monsters(), free, 40, 2)).toEqual([]);
    const open = world({ map: MAP, monsters: [archer] });
    expect(sightBreaks(open.view, open.terrain, open.view.monsters(), () => ({ damage: 50, status: 0 }), 40, 2)).toEqual([]);
  });
});

describe("stairs", () => {
  it("gives the walk and the turns to the nearest staircase each way", () => {
    const w = world({ map: ["#########", "#<..@..>#", "#########"] });
    expect(stairLine(w.view, w.terrain)).toBe("Stairs: the nearest up staircase is 3 steps (close) away, 4 turns (soon) to reach and take; the nearest down staircase is 3 steps (close) away, 4 turns (soon) to reach and take.");
  });

  it("says when a staircase is underfoot or no remembered ground reaches it", () => {
    const w = world({ map: ["#######", "#@.#.<#", "#######"] });
    w.moveTo({ x: 1, y: 1 });
    expect(stairLine(w.view, w.terrain)).toBe("Stairs: an up staircase is known but no remembered ground leads to it; no down staircase is known.");
    const on = world({ map: ["#####", "#.>.#", "#####"] });
    on.moveTo({ x: 2, y: 1 });
    expect(stairLine(on.view, on.terrain)).toContain("a down staircase is underfoot, 1 turn (at once) to take");
  });
});

describe("hazards and choke points", () => {
  it("lists burning ground and visible traps within the reach, with the steps to each", () => {
    const w = world({ map: ["##########", "#@..~....#", "##########"], traps: [{ x: 3, y: 1 }] });
    const hazards = hazardsNear(w.view, w.terrain);
    expect(hazards).toEqual([{ at: { x: 3, y: 1 }, kind: "trap", steps: 2 }]);
    expect(hazardLine(w.view, hazards)).toBe("Hazards on the way: trap 2 steps (close) east, 2 turns (soon). Squire's routes never cross burning ground, and a walk out of sight steps around traps too.");
    expect(hazardLine(w.view, [])).toBe("Hazards: none known within 5 steps.");
  });

  it("names choke points nearest first, and says when the character stands in one", () => {
    const w = world({ map: ["#####", "#@..#", "#####"] });
    expect(chokeLine(w.view, [{ at: { x: 3, y: 1 }, steps: 2, door: false, walls: 2 }, { at: { x: 2, y: 1 }, steps: 1, door: true, walls: 2 }], true))
      .toBe("The character stands in a choke point now. Choke points: 1 step (adjacent) east (a doorway), 1 turn (at once); 2 steps (close) east (a corridor), 2 turns (soon).");
    expect(chokeLine(w.view, [], false)).toBe("Choke points: none within a few steps along a checked route.");
  });
});
