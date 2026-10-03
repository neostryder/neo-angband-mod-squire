import { describe, expect, it } from "vitest";
import { world } from "./harness.js";
import { messagesOnce } from "./runtime.js";

describe("messagesOnce", () => {
  it("drains the game's message buffer once and gives every reader the same lines", () => {
    const w = world({ map: ["###", "#@#", "###"] });
    let buffer = ["You feel something in the air.", "You hear a door burst open!"];
    let drains = 0;
    const live = {
      ...w.view,
      messages: () => {
        drains += 1;
        const out = buffer;
        buffer = [];
        return out;
      },
    };
    const view = messagesOnce(live);
    expect(view.messages()).toEqual(["You feel something in the air.", "You hear a door burst open!"]);
    expect(view.messages()).toEqual(["You feel something in the air.", "You hear a door burst open!"]);
    expect(drains).toBe(1);
  });
});
