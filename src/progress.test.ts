import { describe, expect, it } from "vitest";
import { advance, alreadyCollected, markCollected, newProgress } from "./progress.js";

describe("progress", () => {
  it("starts with nothing spent and nowhere recorded", () => {
    const progress = newProgress(3);
    expect(progress.steps).toBe(0);
    expect(progress.idle).toBe(0);
    expect(progress.at).toBeNull();
    expect(progress.depth).toBe(3);
  });

  it("counts every decision, moving or not", () => {
    const progress = newProgress(1);
    advance(progress, { x: 1, y: 1 });
    advance(progress, { x: 2, y: 1 });
    expect(progress.steps).toBe(2);
  });

  it("does not count the first decision as idle, since there was nowhere to be", () => {
    const progress = newProgress(1);
    advance(progress, { x: 1, y: 1 });
    expect(progress.idle).toBe(0);
  });

  it("counts decisions that left the character where it was", () => {
    const progress = newProgress(1);
    advance(progress, { x: 1, y: 1 });
    advance(progress, { x: 1, y: 1 });
    advance(progress, { x: 1, y: 1 });
    expect(progress.idle).toBe(2);
  });

  it("forgets the idle run the moment the character moves", () => {
    const progress = newProgress(1);
    advance(progress, { x: 1, y: 1 });
    advance(progress, { x: 1, y: 1 });
    advance(progress, { x: 2, y: 2 });
    expect(progress.idle).toBe(0);
  });

  it("remembers which grids have been picked over", () => {
    const progress = newProgress(1);
    const at = { x: 4, y: 7 };
    expect(alreadyCollected(progress, at)).toBe(false);
    markCollected(progress, at);
    expect(alreadyCollected(progress, at)).toBe(true);
    expect(alreadyCollected(progress, { x: 7, y: 4 })).toBe(false);
  });
});
