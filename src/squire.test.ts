import { describe, expect, it } from "vitest";
import { chooseMission, createSquire, type Squire } from "./squire.js";
import { defaultCfg, type SquireCfg } from "./settings.js";
import { world, type MonsterSpec, type World } from "./harness.js";
import { stopText } from "./mission.js";

const HALL = [
  "#########",
  "#.......#",
  "#.@.....#",
  "#.......#",
  "#########",
];

const OPEN_END = [
  "########",
  "#.@....#",
  "#.#### #",
  "########",
];

const HERE = { x: 2, y: 2 };

interface Scene {
  readonly w: World;
  readonly squire: Squire;
  readonly logged: string[];
  readonly status: string[];
}

function squireOver(
  map: readonly string[],
  overrides: Partial<SquireCfg> = {},
  monsters: readonly MonsterSpec[] = [],
): Scene {
  const w = world({ map, monsters });
  const logged: string[] = [];
  const status: string[] = [];
  const squire = createSquire({
    cfg: { ...defaultCfg(), useModel: false, ...overrides },
    terrain: w.terrain,
    log: (message) => logged.push(message),
    status: (reason) => status.push(reason),
  });
  return { w, squire, logged, status };
}

describe("stopText", () => {
  it("gives every end reason one short player-facing sentence", () => {
    const cases = [
      ["done", "The target is down.", "The errand is complete."],
      ["nothing-to-do", "There is nothing to do.", "There was nothing to do."],
      ["unsafe", "A cave spider is awake and in sight.", "A cave spider is awake and in sight."],
      ["target-gone", "The cave spider is out of sight.", "The cave spider is out of sight."],
      ["creature-appeared", "cave spider came into view.", "Stopped: cave spider came into view."],
      ["hurt", "Hit points are down to 20 of 40.", "Hit points are down to 20 of 40."],
      ["afflicted", "The character is confused.", "The character is confused."],
      ["level-changed", "The depth changed from 1 to 2.", "The character changed depth."],
      ["blocked", "The way is blocked.", "The way is blocked."],
      ["budget", "The fight ran longer than a short errand should.", "The errand reached its decision limit."],
      ["dead", "The character died.", "The character died."],
    ] as const;
    for (const [reason, detail, expected] of cases) {
      expect(stopText({ reason, detail })).toBe(expected);
      expect(expected.endsWith(".")).toBe(true);
    }
  });
});

describe("chooseMission", () => {
  it("fights when something is in sight to fight", () => {
    const w = world({ map: HALL, monsters: [{ grid: { x: 5, y: 2 } }] });
    expect(chooseMission({ ...defaultCfg(), useModel: false }, HERE, w.view.monsters())?.id).toBe("autofight");
  });

  it("explores when nothing is", () => {
    const w = world({ map: HALL });
    expect(chooseMission({ ...defaultCfg(), useModel: false }, HERE, w.view.monsters())?.id).toBe("autoexplore");
  });

  it("explores past a sleeping creature, because it is not a target", () => {
    const w = world({ map: HALL, monsters: [{ grid: { x: 5, y: 2 }, asleep: true }] });
    expect(chooseMission({ ...defaultCfg(), useModel: false }, HERE, w.view.monsters())?.id).toBe("autoexplore");
  });

  it("takes the long errand over both short ones when it is switched on", () => {
    const w = world({ map: HALL, monsters: [{ grid: { x: 5, y: 2 } }] });
    const cfg = { ...defaultCfg(), useModel: false, errandCampaign: true };
    expect(chooseMission(cfg, HERE, w.view.monsters())?.id).toBe("campaign");
  });

  it("falls through to exploring when fighting is switched off", () => {
    const w = world({ map: HALL, monsters: [{ grid: { x: 5, y: 2 } }] });
    const cfg = { ...defaultCfg(), useModel: false, errandAutofight: false };
    expect(chooseMission(cfg, HERE, w.view.monsters())?.id).toBe("autoexplore");
  });

  it("chooses nothing when every errand is switched off", () => {
    const w = world({ map: HALL });
    const cfg = {
      ...defaultCfg(),
      useModel: false,
      errandAutofight: false,
      errandAutoexplore: false,
      errandCampaign: false,
    };
    expect(chooseMission(cfg, HERE, w.view.monsters())).toBeNull();
  });
});

describe("createSquire", () => {
  it("runs the errand it chose and names it", () => {
    const { w, squire } = squireOver(OPEN_END);
    expect(squire.controller(w.view, w.act)).toEqual({ code: "walk", dir: 6 });
    expect(squire.mission()).toBe("autoexplore");
    expect(squire.outcome()).toBeNull();
  });

  it("returns null for good once the errand has ended", () => {
    /* This is the whole claim, in one test. Returning null is the agent seam's
     * own way of yielding: the game reports that it needs input and waits, and
     * the host's own interrupt gives the keyboard back on the first real key. */
    const { w, squire } = squireOver(["#####", "#...#", "#.@.#", "#####"]);
    expect(squire.controller(w.view, w.act)).toBeNull();
    expect(squire.outcome()?.reason).toBe("done");
    expect(squire.controller(w.view, w.act)).toBeNull();
    expect(squire.controller(w.view, w.act)).toBeNull();
    expect(w.issued).toHaveLength(0);
  });

  it("issues nothing at all when a declining errand is chosen", () => {
    const { w, squire } = squireOver(OPEN_END, { errandAutofight: false }, [
      { grid: { x: 5, y: 1 } },
    ]);
    expect(squire.controller(w.view, w.act)).toBeNull();
    expect(squire.outcome()?.reason).toBe("unsafe");
    expect(w.issued).toHaveLength(0);
  });

  it("says so and stops when the player has switched every errand off", () => {
    const { w, squire, logged } = squireOver(OPEN_END, {
      errandAutofight: false,
      errandAutoexplore: false,
      errandCampaign: false,
    });
    expect(squire.controller(w.view, w.act)).toBeNull();
    expect(squire.outcome()?.reason).toBe("nothing-to-do");
    expect(logged.join("\n")).toContain("switched off");
  });

  it("logs why the errand ended, and how to take the keyboard back", () => {
    const { w, squire, logged, status } = squireOver(["#####", "#...#", "#.@.#", "#####"]);
    squire.controller(w.view, w.act);
    const said = logged.join("\n");
    expect(said).toContain("errand ended (done)");
    expect(said).toContain("press any key");
    expect(status).toEqual(["The errand is complete."]);
  });

  it("holds one errand for the whole handover rather than re-choosing each turn", () => {
    const { w, squire } = squireOver(OPEN_END);
    squire.controller(w.view, w.act);
    /* A creature arriving would have made a fresh choice pick the fighting
     * errand. The errand in hand keeps the decision instead, and ends. */
    w.setMonsters([{ grid: { x: 6, y: 1 } }]);
    expect(squire.controller(w.view, w.act)).toBeNull();
    expect(squire.mission()).toBe("autoexplore");
    expect(squire.outcome()?.reason).toBe("creature-appeared");
  });
});
