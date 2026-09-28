import { describe, expect, it, vi } from "vitest";
import { indexedDbStore, memoryStore } from "./kv.js";

describe("key-value stores", () => {
  it("filters keys by prefix", async () => {
    const store = memoryStore();
    await store.set("a/1", 1);
    await store.set("b/1", 2);
    expect(await store.keys("a/")).toEqual(["a/1"]);
    await store.delete("a/1");
    expect(await store.get("a/1")).toBeUndefined();
  });

  it("falls back when IndexedDB is unavailable", async () => {
    const store = indexedDbStore("missing-indexeddb");
    await expect(store.set("a/1", { count: 3 })).resolves.toBeUndefined();
    expect(await store.get("a/1")).toEqual({ count: 3 });
    expect(await store.keys("a/")).toEqual(["a/1"]);
    await expect(store.delete("a/1")).resolves.toBeUndefined();
    expect(await store.keys("a/")).toEqual([]);
  });

  it("falls back when IndexedDB throws while opening", async () => {
    vi.stubGlobal("indexedDB", { open() { throw new Error("blocked"); } });
    try {
      const store = indexedDbStore("blocked-indexeddb");
      await store.set("key", 4);
      expect(await store.get("key")).toBe(4);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
