import { describe, expect, it } from "vitest";
import { world } from "../harness.js";
import { defaultPersona } from "../persona/persona.js";
import { defaultConfig } from "../config.js";
import type { DecisionListener, Runtime } from "../runtime.js";
import type { DecisionRecord } from "../brain/brain.js";
import type { GoalDigest } from "../brain/goals.js";
import type { NotebookEntry } from "../knight.js";
import { commandEvidence, signatureForView } from "./evidence.js";
import { ghostAfterCommand, ghostHint } from "./ghost.js";
import { saveInferredPersona } from "./persona.js";
import { drawRadar, type RadarContext } from "./radar.js";
import { scoreExam, styleGoal, subscribeExam } from "./exam.js";

describe("Knight's Lessons", () => {
  it("collects command evidence from the view before the command", () => {
    const w = world({ map: ["#####", "#@..#", "#...#", "#####"],
      player: { hp: 20, maxHp: 40, level: 5 },
      monsters: [{ grid: { x: 2, y: 1 }, race: "cave orc", level: 8 }] });
    expect(commandEvidence({ code: "walk", dir: 6 }, "fight", w.view)).toMatchObject({
      kind: "melee", turn: 1, dangerousNear: true, hpShare: 0.5,
    });
    expect(commandEvidence({ code: "descend" }, "descend", w.view)?.exploredShare).toBe(1);
    expect(commandEvidence({ code: "rest" }, "rest", w.view)?.kind).toBe("rest");
    expect(commandEvidence({ code: "quaff" }, "heal", w.view)?.hpShare).toBe(0.5);
    expect(signatureForView(w.view).families).toEqual(["orc"]);
  });

  it("draws known radar points and fades labels with little evidence", () => {
    const moves: number[][] = [];
    const labels: { text: string; alpha: number }[] = [];
    const ctx: RadarContext = {
      beginPath: () => {}, moveTo: (...point) => { moves.push(point); },
      lineTo: (...point) => { moves.push(point); }, closePath: () => {}, stroke: () => {}, fill: () => {},
      fillText(text) { labels.push({ text, alpha: this.globalAlpha }); }, save: () => {}, restore: () => {},
      strokeStyle: "", fillStyle: "", lineWidth: 0, globalAlpha: 1, font: "", textAlign: "left",
    };
    const persona = defaultPersona();
    persona.sliders.boldness = 100;
    drawRadar(ctx, persona, 100, 100, 50, "red", { boldness: 1, patience: 0.05 });
    expect(moves).toContainEqual([100, 50]);
    expect(labels.find((label) => label.text === "boldness")?.alpha).toBe(1);
    expect(labels.find((label) => label.text === "patience")?.alpha).toBe(0.2);
  });

  it("saves a named style and only activates it when requested", () => {
    let config = defaultConfig();
    const rt = { config: () => config, saveConfig: (next: typeof config) => { config = next; } };
    const inferred = defaultPersona();
    inferred.sliders.boldness = 80;
    saveInferredPersona(rt, inferred, "Mira", false);
    expect(config.personas[1]).toMatchObject({ name: "Mira's style", sliders: { boldness: 80 } });
    expect(config.activePersona).toBe(0);
    saveInferredPersona(rt, inferred, "Mira", true);
    expect(config.activePersona).toBe(2);
  });

  it("shows a target in the ghost hint and clears it on a match", () => {
    const w = world({ map: ["#####", "#@..#", "#####"], monsters: [{ grid: { x: 2, y: 1 }, race: "cave orc" }] });
    expect(ghostHint("throw_oil", "retreat", w.view)).toBe("Squire would: throw oil at the cave orc");
    expect(ghostHint("throw_oil", "throw_oil", w.view)).toBeNull();
    expect(ghostAfterCommand("Squire would: throw oil", "throw_oil", "retreat")).toBe("Squire would: throw oil");
    expect(ghostAfterCommand("Squire would: throw oil", "throw_oil", "throw_oil")).toBeNull();
  });

  it("arms on the next decision, scores similar moments, and stops at 20", () => {
    const w = world({ map: ["###", "#@#", "###"] });
    const signature = signatureForView(w.view);
    const entries: NotebookEntry[] = [{ turn: 1, squire: "rest", knight: "explore", agreed: false,
      line: "noted", demonstration: false, signature }];
    expect(styleGoal(entries, signature)).toBe("explore");
    expect(styleGoal([], signature)).toBeNull();
    expect(scoreExam({ decisions: 20, scored: 18, matched: 14 }, "explore", "explore"))
      .toEqual({ decisions: 20, scored: 18, matched: 14 });
    const listeners: DecisionListener[] = [];
    const results: { matched: number; scored: number }[] = [];
    const rt = { onDecision: (next: DecisionListener) => { listeners.push(next); return () => {}; },
      decisionView: () => w.view } as unknown as Runtime;
    const exam = subscribeExam(rt, () => entries, (result) => results.push(result));
    const record = { context: { offers: [{ goal: "explore" }] }, answers: { goal: { type: "choice", choice: "explore" } } };
    const decision = record as unknown as DecisionRecord<GoalDigest>;
    listeners[0]?.(decision, 1);
    expect(results).toEqual([]);
    exam.arm();
    for (let i = 0; i < 20; i += 1) listeners[0]?.(decision, i);
    expect(results).toEqual([{ matched: 20, scored: 20 }]);
    listeners[0]?.(decision, 21);
    expect(results).toHaveLength(1);
    exam.dispose();
  });
});
