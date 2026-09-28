import { expect, it } from "vitest";
import { world } from "./harness.js";
import { memoryStore } from "./memory/kv.js";
import { createRuntime } from "./runtime.js";
import { attachSquire, type AttachHost } from "./attach.js";
import type { Apprentice, NotebookEntry } from "./knight.js";
import { signatureForView } from "./lessons/evidence.js";
import type { DecisionListener, Runtime } from "./runtime.js";
import type { DecisionRecord } from "./brain/brain.js";
import type { GoalDigest } from "./brain/goals.js";

it("persists command evidence and saves an inferred style", async () => {
  const w = world({ map: ["#####", "#@.>#", "#####"], player: { hp: 20, maxHp: 40 } });
  const store = memoryStore();
  const handlers = new Map<string, (name: string, payload: unknown) => void>();
  const host: AttachHost = {
    log: () => {}, flags: {}, state: {}, character: { key: () => "Mira" },
    core: { createAgentView: () => w.view },
    events: { on: (name, handler) => { handlers.set(name, handler); } },
  };
  const rt = createRuntime(host, { store });
  const lessons = attachSquire(host, rt);
  await Promise.resolve();
  await Promise.resolve();
  handlers.get("player-command")?.("player-command", { code: "rest" });
  w.setPlayer({ hp: 40 });
  handlers.get("player-command")?.("player-command", { code: "descend" });
  const saved = await store.get("squire/apprentice") as Apprentice;
  expect(saved.commands).toMatchObject([
    { kind: "rest", hpShare: 0.5, restedToFull: true },
    { kind: "descend", exploredShare: 1 },
  ]);
  lessons.savePersona(false);
  expect(rt.config().personas.at(-1)?.name).toBe("Mira's style");
  expect(rt.config().activePersona).toBe(0);
  lessons.savePersona(true);
  expect(rt.config().activePersona).toBe(rt.config().personas.length - 1);
});

it("stores the exam result after 20 Squire decisions", async () => {
  const w = world({ map: ["###", "#@#", "###"] });
  const store = memoryStore();
  const signature = signatureForView(w.view);
  const entry: NotebookEntry = { turn: 1, squire: "rest", knight: "explore", agreed: false,
    line: "Noted.", demonstration: false, signature };
  await store.set("squire/apprentice", { entries: Array.from({ length: 40 }, () => entry),
    agreed: 0, total: 40, commands: [], exams: [], examArmed: false, ghostHint: null });
  const host: AttachHost = { log: () => {}, flags: {} };
  const rt = createRuntime(host, { store });
  const listeners: DecisionListener[] = [];
  const examining = { ...rt, onDecision: (listener: DecisionListener) => { listeners.push(listener); return () => {}; },
    decisionView: () => w.view } satisfies Runtime;
  const lessons = attachSquire(host, examining);
  await Promise.resolve();
  await Promise.resolve();
  lessons.takeExam();
  expect(lessons.apprentice().examArmed).toBe(true);
  const record = { context: { offers: [{ goal: "explore" }] },
    answers: { goal: { type: "choice", choice: "explore" } } } as unknown as DecisionRecord<GoalDigest>;
  for (let i = 0; i < 20; i += 1) listeners[0]?.(record, i);
  const saved = await store.get("squire/apprentice") as Apprentice;
  expect(saved.exams).toEqual([{ matched: 20, scored: 20 }]);
  expect(saved.examArmed).toBe(false);
  expect(saved.entries.at(-1)?.line).toBe("Exam: matched your choice 20 of 20 times");
});

it("saves a Knight's Lessons decision as a Laya row with the knight's goal as its label", async () => {
  const store = memoryStore();
  const host: AttachHost = { log: () => {}, flags: {} };
  const rt = createRuntime(host, { store });
  const request = { state: { character: "Level 1 Human Mage" }, questions: { goal: { type: "choice" as const, instructions: "Which?", criteria: { fight: "Fight.", retreat: "Back off.", none_of_these: null } } } };
  const answers = { goal: { type: "choice" as const, choice: "fight", confidence: 0.7, probabilities: { fight: 0.8, retreat: 0.2 } } };
  await rt.recordLesson(request, answers, "jev-1.13.0", 3, "retreat");
  const rows = (await rt.exportLayaRows()).trim().split("\n").map((line) => JSON.parse(line) as { pilot: string; human?: Record<string, string>; jev: { model: string } });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ pilot: "squire_goal", human: { goal: "retreat" }, jev: { model: "jev-1.13.0" } });
});
