import { expect, it } from "vitest";
import { memoryStore } from "./kv.js";
import { installId } from "./install.js";

it("replaces a malformed install id with a stable lowercase version 4 UUID", async () => {
  const store = memoryStore();
  await store.set("squire/install-id", "WRONG");
  const first = await installId(store, () => 0.5);
  expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(await installId(store)).toBe(first);
});
