import { expect, it } from "vitest";
import { reportJson, reportMarkdown } from "./render.js";
import type { RunSummary } from "./summary.js";

const model = {
  headline: { name: "Mira", race: "Elf", class: "Mage", level: 12,
    deepestFeet: 750, turns: 100, outcome: "death", cause: "Killed by a troll" },
  topKills: [{ name: "Orc", count: 3 }],
  closeCalls: [{ kind: "near-death", turn: 90, depth: 15, text: "Fell to 2 HP", value: 2 }],
  lessonsLearned: ["Heal before the next blow."], lessonsInherited: ["Keep a way out."],
  tokens: { requests: 4, inputTokens: 400, outputTokens: 80, estimated: 0, usd: 0.01 },
  personaRadar: [], uniquesKilled: [], depthCurve: [], deathDecisions: [],
  divergence: { count: 0, rate: 0 }, spellsByUse: [], weaponsByUse: [],
  tokensByBackend: {}, calibration: {}, lineageNames: [], chronicleHighlights: [],
} satisfies RunSummary;

it("renders a readable run file and the versioned JSON envelope", () => {
  const markdown = reportMarkdown(model);
  expect(markdown).toContain("# Mira's run");
  expect(markdown).toContain("| Deepest | 750 ft |");
  expect(markdown).toContain("Orc: 3");
  expect(markdown).toContain("Heal before the next blow.");
  expect(markdown).toContain("| Input tokens | 400 |");
  expect(JSON.parse(reportJson(model))).toMatchObject({ format: "neo-angband/squire/report",
    schemaVersion: 1, data: { headline: { name: "Mira" } } });
});
