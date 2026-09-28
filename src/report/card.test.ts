import { expect, it } from "vitest";
import { drawCard, shareLinks, type CardContext } from "./card.js";
import type { RunSummary } from "./summary.js";

function recordingContext() {
  const text: string[] = [];
  const rects: number[][] = [];
  let paths = 0;
  const ctx: CardContext = {
    fillRect: (...args) => { rects.push(args); },
    fillText: (value) => { text.push(value); },
    measureText: (value) => ({ width: value.length * 10 }),
    beginPath: () => { paths += 1; }, moveTo: () => {}, lineTo: () => {}, closePath: () => {},
    fill: () => {}, stroke: () => {}, arc: () => {},
    font: "", fillStyle: "", strokeStyle: "", lineWidth: 1, textAlign: "left", textBaseline: "alphabetic",
    save: () => {}, restore: () => {},
  };
  return { ctx, text, rects, paths: () => paths };
}

it("draws the character, run facts and persona polygon on a 1200 by 630 card", () => {
  const fake = recordingContext();
  const model = {
    headline: { name: "Mira", race: "Elf", class: "Mage", level: 12,
      deepestFeet: 750, turns: 100, outcome: "death", cause: "Killed by a troll" },
    topKills: [{ name: "Orc", count: 3 }], chronicleHighlights: ["Cut down Bullroarer."],
    personaRadar: [{ id: "boldness", name: "Boldness", value: 80 },
      { id: "patience", name: "Patience", value: 30 }, { id: "mercy", name: "Mercy", value: 60 }],
    uniquesKilled: [], depthCurve: [], closeCalls: [], deathDecisions: [],
    divergence: { count: 0, rate: 0 }, spellsByUse: [], weaponsByUse: [],
    tokens: { requests: 0, inputTokens: 0, outputTokens: 0, estimated: 0, usd: 0 },
    tokensByBackend: {}, calibration: {}, lessonsLearned: [], lessonsInherited: [], lineageNames: [],
  } satisfies RunSummary;
  drawCard(fake.ctx, model);
  expect(fake.rects).toContainEqual([0, 0, 1200, 630]);
  expect(fake.text).toContain("Mira");
  expect(fake.text).toContain("Cut down Bullroarer.");
  expect(fake.paths()).toBe(2);
});

it("encodes share text and supplies Facebook only when there is a URL", () => {
  expect(shareLinks("Mira & the troll").x).toBe("https://twitter.com/intent/tweet?text=Mira%20%26%20the%20troll");
  expect(shareLinks("Mira").facebook).toBeUndefined();
  expect(shareLinks("Mira", "https://example.test/a b").facebook)
    .toBe("https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fexample.test%2Fa%20b");
  expect(shareLinks("Mira & the troll").reddit).toContain("title=Mira%20%26%20the%20troll");
});

it("prints the apprenticeship share line on a card", () => {
  const fake = recordingContext();
  const model = { headline: { name: "Mira", race: "Elf", class: "Mage", level: 12,
    deepestFeet: 750, turns: 100, outcome: "death", cause: "troll" },
    topKills: [], chronicleHighlights: [], personaRadar: [],
    apprenticeship: { rank: "Squire", agreementShare: 0.68, surprises: [], latestExam: null,
      squireRadar: [], knightRadar: [] },
  } as unknown as RunSummary;
  drawCard(fake.ctx, model);
  expect(fake.text).toContain("Apprentice: Squire rank, agreed 68%");
});
