import { expect, it } from "vitest";
import { world } from "./harness.js";
import { memoryStore } from "./memory/kv.js";
import { createRuntime } from "./runtime.js";
import { defaultCfg } from "./settings.js";

it("records the player's segment after a take-over that comes before Squire's first command", () => {
  const w = world({ map: ["#######", "#.@...#", "#######"] });
  const rt = createRuntime({ log: () => {} }, { store: memoryStore() });
  const controller = rt.controllerFor({ ...defaultCfg(), useModel: false }, w.terrain, () => () => null);
  expect(controller(w.view, w.act)).toBeNull();
  rt.recordCommand({ code: "walk", dir: 6 }, w.view);
  expect(rt.character().segment?.open).toBe(true);
});
