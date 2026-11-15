import { describe, expect, it } from "vitest";
import { turnEnergy as gameTurnEnergy } from "@rpgm-tools/neo-angband-core";
import { turnEnergy } from "./energy.js";

describe("turnEnergy", () => {
  it("gives the game's own energy at every speed, including past both ends of the table", () => {
    for (let speed = -20; speed <= 220; speed++) expect(turnEnergy(speed), `speed ${String(speed)}`).toBe(gameTurnEnergy(speed));
  });

  it("gives 10 at normal speed", () => {
    expect(turnEnergy(110)).toBe(10);
  });
});
