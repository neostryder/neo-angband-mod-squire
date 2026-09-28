import type { KvStore } from "./kv.js";

const KEY = "squire/install-id";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The injected source makes the fallback deterministic in tests and hosts without crypto. */
export async function installId(store: KvStore, rng: () => number = Math.random): Promise<string> {
  const saved = await store.get(KEY);
  if (typeof saved === "string" && UUID_V4.test(saved)) return saved;
  const random = globalThis.crypto?.randomUUID?.();
  let id = random !== undefined && UUID_V4.test(random) ? random : "";
  if (!id) {
    const bytes = Array.from({ length: 16 }, () => Math.floor(rng() * 256) & 255);
    bytes[6] = (bytes[6]! & 15) | 64;
    bytes[8] = (bytes[8]! & 63) | 128;
    const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
    id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  await store.set(KEY, id);
  return id;
}
