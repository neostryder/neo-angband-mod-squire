import { describe, expect, it } from "vitest";
import { memoryStore, type KvStore } from "./memory/kv.js";
import {
  COPY_PROMPT, FALLBACK_HERE, freshName, PROFILES_KEY, registerSquireTitle, TITLE_KEY, TITLE_LABEL,
  WHERE_HERE, WHERE_PROMPT, WHERE_SEPARATE, WHICH_COPY, WHICH_FRESH, WHICH_PROMPT,
  type ProfileInfo, type ProfileResult, type ProfilesSeam, type TitleRow, type TitleSeam,
} from "./title.js";

interface Fake {
  readonly title: TitleSeam;
  readonly profiles: ProfilesSeam;
  readonly rows: TitleRow[];
  readonly asked: { title: string; choices: readonly string[] }[];
  readonly calls: string[];
  readonly profileList: ProfileInfo[];
}

/** A host whose prompts answer from `answers` in order, and whose profile calls can be refused by name. */
function host(answers: (number | null)[], options: { refuse?: Partial<Record<keyof ProfilesSeam, string>>; profiles?: ProfileInfo[] } = {}): Fake {
  const rows: TitleRow[] = [];
  const asked: Fake["asked"] = [];
  const calls: string[] = [];
  const profileList: ProfileInfo[] = options.profiles ?? [{ id: null, name: "Default", active: true }];
  const refusal = (name: keyof ProfilesSeam): { ok: false; reason: string } | null => {
    const reason = options.refuse?.[name];
    return reason === undefined ? null : { ok: false, reason };
  };
  const ok = <T,>(value: T): ProfileResult<T> => ({ ok: true, value });
  return {
    rows,
    asked,
    calls,
    profileList,
    title: {
      registerRow(row) { rows.push(row); return () => undefined; },
      choose(title, choices) { asked.push({ title, choices }); return Promise.resolve(answers.shift() ?? null); },
    },
    profiles: {
      list: () => refusal("list") ?? ok(profileList),
      create(name, opts) {
        calls.push(`create ${name} ${opts !== undefined && "copyFrom" in opts ? `from ${String(opts.copyFrom)}` : "fresh"}`);
        const no = refusal("create");
        if (no !== null) return no;
        const made = { id: `p${String(profileList.length)}`, name, active: false };
        profileList.push(made);
        return ok(made);
      },
      setEnabledMods(id, mods) { calls.push(`enable ${id} ${mods.join(",")}`); return refusal("setEnabledMods") ?? ok(undefined); },
      switchTo(id, action) { calls.push(`switch ${String(id)} ${action?.kind ?? "none"} ${String(action?.armController)}`); return refusal("switchTo") ?? ok(undefined); },
    },
  };
}

async function pick(fake: Fake, store: KvStore = memoryStore()): Promise<void> {
  expect(registerSquireTitle({ id: "squire", title: fake.title, profiles: fake.profiles }, store)).toBe(true);
  const row = fake.rows[0];
  if (row === undefined) throw new Error("no row");
  await row.run();
}

describe("the Squire title row", () => {
  it("registers nothing without the title and profile seams", () => {
    const fake = host([]);
    expect(registerSquireTitle({}, memoryStore())).toBe(false);
    expect(registerSquireTitle({ title: fake.title }, memoryStore())).toBe(false);
    expect(registerSquireTitle({ profiles: fake.profiles }, memoryStore())).toBe(false);
    expect(fake.rows).toHaveLength(0);
  });

  it("registers one row with its own key", async () => {
    const fake = host([null]);
    await pick(fake);
    expect(fake.rows.map((row) => [row.label, row.key])).toEqual([[TITLE_LABEL, TITLE_KEY]]);
    expect(fake.asked).toEqual([{ title: WHERE_PROMPT, choices: [WHERE_SEPARATE, WHERE_HERE] }]);
    expect(fake.calls).toEqual([]);
  });

  it("starts a fresh profile with Squire enabled, remembers it, and arms the controller there", async () => {
    const fake = host([0, 0]);
    const store = memoryStore();
    await pick(fake, store);
    expect(fake.asked[1]).toEqual({ title: WHICH_PROMPT, choices: [WHICH_FRESH, WHICH_COPY] });
    expect(fake.calls).toEqual(["create Squire fresh", "enable p1 squire", "switch p1 create-character true"]);
    expect(await store.get(PROFILES_KEY)).toEqual(["p1"]);
  });

  it("copies a chosen profile, keeping its loadout", async () => {
    const fake = host([0, 1, 1], { profiles: [{ id: null, name: "Default", active: true }, { id: "p1", name: "Ironman", active: false }] });
    await pick(fake);
    expect(fake.asked[2]).toEqual({ title: COPY_PROMPT, choices: ["Default", "Ironman"] });
    expect(fake.calls).toEqual(["create Squire from p1", "switch p2 create-character true"]);
  });

  it("copies the default profile by its null id", async () => {
    const fake = host([0, 1, 0]);
    await pick(fake);
    expect(fake.calls[0]).toBe("create Squire from null");
  });

  it("offers the profiles Squire made before, and names the next one plainly", async () => {
    const store = memoryStore();
    await store.set(PROFILES_KEY, ["p1", "gone"]);
    const fake = host([0, 2], { profiles: [{ id: null, name: "Default", active: true }, { id: "p1", name: "Squire", active: false }, { id: "p2", name: "Mine", active: false }] });
    await pick(fake, store);
    expect(fake.asked[1]?.choices).toEqual([WHICH_FRESH, WHICH_COPY, "Use Squire"]);
    expect(fake.calls).toEqual(["switch p1 create-character true"]);
    expect(freshName(["Default", "Squire", "Squire 2"])).toBe("Squire 3");
  });

  it("shows a refusal and starts the character in this profile instead", async () => {
    const fake = host([0, 0, 0], { refuse: { create: "Profiles are full." } });
    await pick(fake);
    expect(fake.asked[2]).toEqual({ title: "Squire could not use a separate profile: Profiles are full.", choices: [FALLBACK_HERE] });
    expect(fake.calls).toEqual(["create Squire fresh", "switch null create-character true"]);
  });

  it("starts the character in this profile with the controller armed", async () => {
    const fake = host([1], { profiles: [{ id: null, name: "Default", active: false }, { id: "p1", name: "Mine", active: true }] });
    await pick(fake);
    expect(fake.calls).toEqual(["switch p1 create-character true"]);
  });

  it("stops at Escape on any prompt", async () => {
    const fake = host([0, null]);
    await pick(fake);
    expect(fake.calls).toEqual([]);
    const copy = host([0, 1, null]);
    await pick(copy);
    expect(copy.calls).toEqual([]);
  });
});
