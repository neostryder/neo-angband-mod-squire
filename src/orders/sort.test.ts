import { describe, expect, it } from "vitest";
import { JEV, type AskResult } from "../brain/backend.js";
import { createTally } from "../brain/tally.js";
import type { Answer, ChoiceQuestion, SystemOneRequest } from "../brain/systemone.js";
import { NONE, readSort, sortByCode, sortInstruction, sortRequest } from "./sort.js";

function choice(value: string): Answer {
  return { type: "choice", choice: value, confidence: 0.9, probabilities: { [value]: 0.9 } };
}

function reply(answers: Record<string, Answer>): AskResult {
  return { ok: true, answers, usage: { inputTokens: 50, outputTokens: 5, estimated: false }, model: null, latencyMs: 1, server: "test" };
}

function deps(send: (r: SystemOneRequest) => Promise<AskResult>, backend: typeof JEV | null = JEV, caps = { perSessionUsd: 0, perDayUsd: 0 }) {
  const requests: SystemOneRequest[] = [];
  const tally = createTally(caps);
  return {
    requests, tally,
    d: { backend: () => backend, send: (r: SystemOneRequest) => { requests.push(r); return send(r); }, tally, now: () => 0 },
  };
}

describe("sorting by code", () => {
  it("reads the design's example orders", () => {
    const suit = sortByCode("Suit up in the armor shop.");
    expect(suit.kind).toBe("order");
    expect(suit.sorted).toMatchObject({ aim: "armour", store: "Armoury" });

    const potion = sortByCode("Bring back a Potion of Cure Light Wounds.");
    expect(potion.sorted).toMatchObject({ aim: "item", count: 1 });
    expect(potion.sorted.item).toContain("cure light wound");

    const dive = sortByCode("Reach 500 ft before level 15.");
    expect(dive.sorted).toMatchObject({ aim: "depth", depth: 10, deadlineLevel: 15 });
  });

  it("reads the design's standing instructions", () => {
    const flee = sortByCode("Always run away the first time you see a unique.");
    expect(flee.kind).toBe("standing");
    expect(flee.sorted).toMatchObject({ trigger: "unique", response: "flee", frequency: { mode: "once" } });

    const oil = sortByCode("Keep two Flasks of Oil.");
    expect(oil.sorted).toMatchObject({ aim: "item", count: 2 });

    const scrolls = sortByCode("Never read unknown scrolls in a fight.");
    expect(scrolls.kind).toBe("standing");
    expect(scrolls.sorted.avoids).toEqual([]);
  });

  it("reads until-level and avoid responses", () => {
    expect(sortByCode("Fight everything until level 20.").sorted.frequency).toEqual({ mode: "until-level", level: 20 });
    expect(sortByCode("Never fight when you are wounded.").sorted).toMatchObject({ response: "avoid", avoids: ["fight"], trigger: "low-hp" });
  });

  it("keeps text that fits nothing with an empty sorted form", () => {
    const odd = sortByCode("Sing to the moon");
    expect(odd.sorted).toMatchObject({ aim: null, response: null, trigger: "always", store: null });
  });
});

describe("sorting with a model", () => {
  it("sends one request with a typed question for each part, each with none_of_these", async () => {
    const { d, requests } = deps(() => Promise.resolve(reply({})));
    await sortInstruction("Suit up", d);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.state["instruction"]).toBe("Suit up");
    expect(Object.keys(requests[0]!.questions).sort()).toEqual(["aim", "frequency", "kind", "response", "store", "trigger"]);
    for (const q of Object.values(requests[0]!.questions)) expect(Object.keys((q as ChoiceQuestion).criteria)).toContain(NONE);
  });

  it("lays the model's answers over the code reading and records the spend", async () => {
    const { d, tally } = deps(() => Promise.resolve(reply({ aim: choice("weapon"), trigger: choice("low-hp"), response: choice("flee"), store: choice("Weapon Smiths"), kind: choice("standing") })));
    const out = await sortInstruction("Sing to the moon", d);
    expect(out.source).toBe("model");
    expect(out.kind).toBe("standing");
    expect(out.sorted).toMatchObject({ aim: "weapon", trigger: "low-hp", response: "flee", store: "Weapon Smiths" });
    expect(tally.session().requests).toBe(1);
  });

  it("keeps the code reading for a part answered none_of_these or with an unknown word", () => {
    const out = readSort("Reach 500 ft", { aim: choice(NONE), response: choice("dance"), trigger: choice(NONE) });
    expect(out.sorted).toMatchObject({ aim: "depth", depth: 10, response: null, trigger: "always" });
  });

  it("takes numbers from code even when the model names the aim", () => {
    const out = readSort("Reach 500 ft", { aim: choice("depth") });
    expect(out.sorted.depth).toBe(10);
  });
});

describe("sorting without a model", () => {
  const never = () => Promise.reject(new Error("unexpected request"));

  it("falls back to code with no backend", async () => {
    const { d, requests } = deps(never, null);
    const out = await sortInstruction("Suit up in the armor shop", d);
    expect(out.source).toBe("code");
    expect(out.sorted.aim).toBe("armour");
    expect(requests).toHaveLength(0);
  });

  it("falls back to code when the spend cap is reached", async () => {
    const { d, tally, requests } = deps(never, JEV, { perSessionUsd: 0.000001, perDayUsd: 0 });
    tally.record(JEV, { inputTokens: 1_000_000, outputTokens: 1_000_000, estimated: false }, 0);
    const out = await sortInstruction("Suit up in the armor shop", d);
    expect(out.source).toBe("code");
    expect(requests).toHaveLength(0);
  });

  it("falls back to code when the request fails or throws", async () => {
    const failed = deps(() => Promise.resolve({ ok: false, latencyMs: 1, failure: { kind: "unreachable", message: "x" } } as unknown as AskResult));
    expect((await sortInstruction("Suit up", failed.d)).source).toBe("code");
    const thrown = deps(never);
    expect((await sortInstruction("Suit up", thrown.d)).source).toBe("code");
  });

  it("builds a request that is plain data", () => {
    expect(() => JSON.stringify(sortRequest("x"))).not.toThrow();
  });
});
