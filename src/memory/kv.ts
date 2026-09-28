export interface KvStore {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}

export function memoryStore(): KvStore {
  const values = new Map<string, unknown>();
  return {
    async get(key) { return values.get(key); },
    async set(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); },
    async keys(prefix) { return [...values.keys()].filter((key) => key.startsWith(prefix)).sort(); },
  };
}

interface DbRequest<T> {
  result: T;
  error?: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded?: (() => void) | null;
}

interface DbTransaction {
  error?: unknown;
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  objectStore(name: string): {
    get(key: string): DbRequest<unknown>;
    put(value: unknown, key: string): DbRequest<unknown>;
    delete(key: string): DbRequest<unknown>;
    getAllKeys(): DbRequest<unknown[]>;
  };
}

interface Db {
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string): void;
  transaction(name: string, mode: "readonly" | "readwrite"): DbTransaction;
}

function request<T>(operation: DbRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
  });
}

function completed(transaction: DbTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** A mirrored map remains usable after storage is blocked or fails mid-session. */
export function indexedDbStore(dbName: string): KvStore {
  const fallback = memoryStore();
  let disabled = false;
  let opening: Promise<Db> | undefined;

  function database(): Promise<Db> {
    if (opening !== undefined) return opening;
    const factory = (globalThis as { indexedDB?: { open(name: string, version: number): DbRequest<Db> } }).indexedDB;
    if (factory === undefined) return Promise.reject(new Error("IndexedDB is unavailable"));
    opening = new Promise((resolve, reject) => {
      const open = factory.open(dbName, 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains("values")) open.result.createObjectStore("values");
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return opening;
  }

  async function run<T>(operation: (db: Db) => Promise<T>, otherwise: () => Promise<T>): Promise<T> {
    if (disabled) return otherwise();
    try {
      return await operation(await database());
    } catch {
      disabled = true;
      return otherwise();
    }
  }

  return {
    async get(key) {
      return run(async (db) => {
        const value = await request(db.transaction("values", "readonly").objectStore("values").get(key));
        if (value !== undefined) await fallback.set(key, value);
        return value;
      }, () => fallback.get(key));
    },
    async set(key, value) {
      await fallback.set(key, value);
      await run(async (db) => {
        const transaction = db.transaction("values", "readwrite");
        const done = completed(transaction);
        transaction.objectStore("values").put(value, key);
        await done;
      }, async () => {});
    },
    async delete(key) {
      await fallback.delete(key);
      await run(async (db) => {
        const transaction = db.transaction("values", "readwrite");
        const done = completed(transaction);
        transaction.objectStore("values").delete(key);
        await done;
      }, async () => {});
    },
    async keys(prefix) {
      return run(async (db) => {
        const keys = await request(db.transaction("values", "readonly").objectStore("values").getAllKeys());
        return keys.filter((key): key is string => typeof key === "string" && key.startsWith(prefix)).sort();
      }, () => fallback.keys(prefix));
    },
  };
}
