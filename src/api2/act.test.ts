import { describe, expect, it } from "vitest";
import { createActFacade, intentOf } from "./act.js";

describe("the act facade", () => {
  it("builds the commands the decision code asks for, with the arguments the game used", () => {
    const { act } = createActFacade();
    expect(act.move(4)).toEqual({ code: "walk", dir: 4 });
    expect(act.melee(6)).toEqual({ code: "walk", dir: 6 });
    expect(act.quaff(7)).toEqual({ code: "quaff", args: { handle: 7 } });
    expect(act.wear(3)).toEqual({ code: "wield", args: { handle: 3 } });
    expect(act.cast(2)).toEqual({ code: "cast", args: { spell: 2 } });
    expect(act.descend()).toEqual({ code: "descend" });
  });

  it("rests until done when no count is given", () => {
    const { act } = createActFacade();
    expect(act.rest()).toEqual({ code: "rest", args: { count: -2 } });
    expect(act.rest(5)).toEqual({ code: "rest", args: { count: 5 } });
  });

  it("carries a quantity only when one is asked for", () => {
    const { act } = createActFacade();
    expect(act.drop(1)).toEqual({ code: "drop", args: { handle: 1 } });
    expect(act.drop(1, 3)).toEqual({ code: "drop", args: { handle: 1, quantity: 3 } });
    expect(act.shopBuy(0, 2)).toEqual({ code: "shop-buy", args: { index: 0, quantity: 2 } });
    expect(act.shopSell(4)).toEqual({ code: "shop-sell", args: { handle: 4 } });
  });

  it("records target choices in order and hands them over once", () => {
    const facade = createActFacade();
    expect(facade.act.setTargetMonster(9)).toBe(true);
    facade.act.setTargetLocation(3, 4);
    expect(facade.take()).toEqual([{ kind: "target", midx: 9 }, { kind: "target", x: 3, y: 4 }]);
    expect(facade.take()).toEqual([]);
  });
});

describe("intentOf", () => {
  it("wraps a command with only the parts it has", () => {
    expect(intentOf({ code: "hold" } as never)).toEqual({ kind: "command", command: { code: "hold" } });
    expect(intentOf({ code: "walk", dir: 2 } as never)).toEqual({ kind: "command", command: { code: "walk", dir: 2 } });
    expect(intentOf({ code: "quaff", args: { handle: 5 } } as never)).toEqual({ kind: "command", command: { code: "quaff", args: { handle: 5 } } });
  });
});
