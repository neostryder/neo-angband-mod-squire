import { describe, expect, it } from "vitest";
import type { ControllerKeyAnswer, ControllerKeyPress } from "@rpgm-tools/neo-angband-core";
import { DEFAULT_ERRAND_KEY, ERRAND_KEYS, keyHandler, keyName, type KeyTarget } from "./keys.js";
import { ERRAND_TEXT } from "./text.js";
import { defaultConfig, readConfig, writeConfig } from "../config.js";

function press(key: string, mods: Partial<Omit<ControllerKeyPress, "key">> = {}): ControllerKeyPress {
  return { key, ctrl: false, alt: false, shift: false, meta: false, repeat: false, ...mods };
}

interface Fake extends KeyTarget {
  readonly logs: string[];
  readonly picked: number[];
  open: boolean;
}

function target(overrides: Partial<KeyTarget> = {}, refuse: string | null = null): Fake {
  const fake: Fake = {
    logs: [],
    picked: [],
    open: false,
    errandKey: () => "&",
    menuOpen: () => fake.open,
    openMenu: () => { fake.open = true; },
    closeMenu: () => { fake.open = false; },
    pick: (position) => {
      fake.picked.push(position);
      return refuse;
    },
    log: (message) => fake.logs.push(message),
    ...overrides,
  };
  return fake;
}

/**
 * The host's rule for which keys reach a mod's handler, restated from the
 * game's autoplayer key module (which lives in the web shell, not in the
 * package a mod builds against): Escape and Ctrl-Z give the keyboard back
 * before the handler is asked.
 */
function host(handler: (press: ControllerKeyPress) => ControllerKeyAnswer, key: ControllerKeyPress): { reached: boolean; answer: ControllerKeyAnswer } {
  const ctrlZ = key.ctrl && !key.alt && !key.meta && key.key.toLowerCase() === "z";
  if (key.key === "Escape" || ctrlZ) return { reached: false, answer: { kind: "release" } };
  return { reached: true, answer: handler(key) };
}

describe("the errand keys", () => {
  it("offers only keys no game command uses, with & as the default", () => {
    expect(ERRAND_KEYS).toEqual(["&", "!", "#", "$", "%", "(", "_"]);
    expect(DEFAULT_ERRAND_KEY).toBe("&");
    for (const key of ERRAND_KEYS) expect(key).toMatch(/^[!-/:-@[-`{-~]$/);
  });

  it("is a stored setting that keeps only a key from the list", () => {
    expect(readConfig(undefined).errandKey).toBe("&");
    expect(readConfig(writeConfig({ ...defaultConfig(), errandKey: "%" })).errandKey).toBe("%");
    expect(readConfig(writeConfig({ ...defaultConfig(), errandKey: "q" as never })).errandKey).toBe("&");
  });

  it("names a key the way the log shows it", () => {
    expect(keyName(press(" "))).toBe("Space");
    expect(keyName(press("x", { ctrl: true, alt: true }))).toBe("Ctrl-Alt-x");
  });
});

describe("the key handler", () => {
  it("is never asked about Escape or Ctrl-Z: those give the keyboard back first", () => {
    const fake = target();
    let asked = 0;
    const handler = keyHandler(fake);
    const counted = (key: ControllerKeyPress) => {
      asked += 1;
      return handler(key);
    };
    expect(host(counted, press("Escape"))).toEqual({ reached: false, answer: { kind: "release" } });
    expect(host(counted, press("z", { ctrl: true })).reached).toBe(false);
    expect(host(counted, press("Z", { ctrl: true, shift: true })).reached).toBe(false);
    expect(asked).toBe(0);
    expect(fake.logs).toEqual([]);
  });

  it("opens the errand menu on the errand key, and closes it on a second press", () => {
    const fake = target();
    const handler = keyHandler(fake);
    expect(handler(press("&", { shift: true }))).toEqual({ kind: "keep", message: ERRAND_TEXT.menuHint("&") });
    expect(fake.open).toBe(true);
    expect(handler(press("&", { shift: true }))).toEqual({ kind: "keep", message: ERRAND_TEXT.menuClosed });
    expect(fake.open).toBe(false);
  });

  it("follows the stored errand key", () => {
    const fake = target({ errandKey: () => "%" });
    const handler = keyHandler(fake);
    expect(handler(press("&"))).toEqual({ kind: "keep", message: ERRAND_TEXT.notice("%") });
    expect(fake.open).toBe(false);
    expect(handler(press("%"))).toEqual({ kind: "keep", message: ERRAND_TEXT.menuHint("%") });
  });

  it("does not toggle the menu on a held key's repeats", () => {
    const fake = target();
    const handler = keyHandler(fake);
    handler(press("&"));
    expect(handler(press("&", { repeat: true }))).toEqual({ kind: "keep" });
    expect(fake.open).toBe(true);
  });

  it("does not treat the errand key with Ctrl or Alt as the errand key", () => {
    const fake = target();
    expect(keyHandler(fake)(press("&", { ctrl: true }))).toEqual({ kind: "keep", message: ERRAND_TEXT.notice("&") });
    expect(fake.open).toBe(false);
  });

  it("picks an errand by number while the menu is open", () => {
    const fake = target();
    const handler = keyHandler(fake);
    handler(press("&"));
    expect(handler(press("3"))).toEqual({ kind: "keep" });
    expect(fake.picked).toEqual([3]);
  });

  it("passes a refusal back as the message line", () => {
    const fake = target({}, ERRAND_TEXT.refused(ERRAND_TEXT.reasons.inTown));
    const handler = keyHandler(fake);
    handler(press("&"));
    expect(handler(press("2"))).toEqual({ kind: "keep", message: ERRAND_TEXT.refused(ERRAND_TEXT.reasons.inTown) });
  });

  it("does not read a digit as a pick while the menu is closed", () => {
    const fake = target();
    expect(keyHandler(fake)(press("3"))).toEqual({ kind: "keep", message: ERRAND_TEXT.notice("&") });
    expect(fake.picked).toEqual([]);
  });

  it("keeps playing on any other key, with a notice of how to take over", () => {
    const fake = target();
    const handler = keyHandler(fake);
    for (const key of ["x", "Enter", " ", "ArrowUp", "F1", "0"]) {
      expect(handler(press(key))).toEqual({ kind: "keep", message: ERRAND_TEXT.notice("&") });
    }
  });

  it("logs every key it answers", () => {
    const fake = target();
    const handler = keyHandler(fake);
    handler(press("x"));
    handler(press("&"));
    expect(fake.logs).toEqual([
      `Squire answered x: keep (${ERRAND_TEXT.notice("&")})`,
      "Squire answered &: keep (" + ERRAND_TEXT.menuHint("&") + ")",
    ]);
  });

  it("never throws: a failure gives the keyboard back with a reason", () => {
    const broken = target({ errandKey: () => { throw new Error("no config"); } });
    const answer = keyHandler(broken)(press("x"));
    expect(answer).toEqual({ kind: "release", reason: ERRAND_TEXT.keyFailed });
    expect(broken.logs.join("\n")).toContain("no config");
  });

  it("never throws even when the log throws as well", () => {
    const broken = target({ pick: () => { throw new Error("pick"); }, log: () => { throw new Error("log"); } });
    broken.open = true;
    const handler = keyHandler(broken);
    expect(() => handler(press("1"))).not.toThrow();
    expect(handler(press("1"))).toEqual({ kind: "release", reason: ERRAND_TEXT.keyFailed });
  });
});
