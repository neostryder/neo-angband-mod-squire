/**
 * Roll-on: after a character Squire played dies, the next one is born without
 * the birth screens, when the player turned that on in Setup.
 *
 * The runtime asks the game for a new character (`ctx.saves.create`) and the
 * page reloads into character creation. This presenter takes that one creation
 * and accepts it at once, either as a copy of the dead character ("like") or as
 * a random race and class ("random"). Every other creation, including one the
 * player starts by hand later, gets the game's own screens: the presenter only
 * acts within a short window after Squire itself asked for the new character.
 */

import { activePersona, readConfig, writeConfig, type RollOn } from "./config.js";
import { namesakeFor, namesakeLog } from "./learning/flourishes.js";
import { defaultPersona } from "./persona/persona.js";

/** The part of the host's birth session this presenter uses. */
export interface BirthResultLike {
  readonly ok: boolean;
  readonly reason?: string;
}

export interface BirthSessionLike {
  catalogue(): {
    readonly races: readonly { readonly name: string }[];
    readonly classes: readonly { readonly name: string }[];
    readonly previous: { readonly race: string; readonly cls: string; readonly name: string } | null;
    readonly namePinned: boolean;
  };
  draft(): { readonly name: string };
  usePrevious(): BirthResultLike;
  setName(name: string): BirthResultLike;
  chooseRace(name: string): BirthResultLike;
  chooseClass(name: string): BirthResultLike;
  roll(): BirthResultLike;
  randomName(): BirthResultLike;
  accept(): BirthResultLike;
}

/** Somewhere to keep the roll-on mark across the reload into creation. */
export interface MarkStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const ROLL_ON_KEY = "squire/rollOnAt";
/**
 * Set when the presenter accepts a roll-on creation. The new character is not
 * marked as autoplayed yet, so `controller()` would decline it; this mark tells
 * it that this character is the heir Squire asked for. The host still decides
 * whether the controller installs without asking.
 */
export const HEIR_KEY = "squire/heirAt";
/** Long enough for the reload into creation, short enough that a later new character is the player's. */
export const ROLL_ON_WINDOW_MS = 120_000;

/** The tab's session storage, or null where it cannot be used. */
export function sessionMarks(): MarkStore | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Note that Squire is about to ask for the next character. */
export function markRollOn(store: MarkStore | null, now: number, key: string = ROLL_ON_KEY): void {
  try {
    store?.setItem(key, String(now));
  } catch {
    /* Without the mark the game shows its own birth screens, which is safe. */
  }
}

/** Whether a roll-on mark is fresh, clearing it either way so it is used once. */
export function takeRollOn(store: MarkStore | null, now: number, key: string = ROLL_ON_KEY): boolean {
  try {
    const raw = store?.getItem(key) ?? null;
    if (raw === null) return false;
    store?.removeItem(key);
    const at = Number(raw);
    return Number.isFinite(at) && now - at >= 0 && now - at <= ROLL_ON_WINDOW_MS;
  } catch {
    return false;
  }
}

/**
 * Fill in and accept the creation. Returns false, leaving the game's screens
 * to take over, when any step is refused.
 */
export function rollOnBirth(session: BirthSessionLike, mode: Exclude<RollOn, "wait">, random: () => number, log: (line: string) => void, namesake?: string): boolean {
  const cat = session.catalogue();
  const steps: (() => BirthResultLike)[] = [];
  if (mode === "like" && cat.previous !== null) {
    const previous = cat.previous;
    /* usePrevious copies race, class and stats but not the name, and the game
     * will not start a character without one. A pinned name is left alone. */
    steps.push(() => session.usePrevious());
    if (!cat.namePinned && previous.name.trim() !== "") steps.push(() => {
      const named = session.setName(previous.name);
      return named.ok ? named : session.randomName();
    });
  } else {
    const race = cat.races[Math.floor(random() * cat.races.length)];
    const cls = cat.classes[Math.floor(random() * cat.classes.length)];
    if (race === undefined || cls === undefined) return false;
    steps.push(() => session.chooseRace(race.name), () => session.chooseClass(cls.name), () => session.roll());
    if (!cat.namePinned) steps.push(() => session.randomName());
  }
  for (const step of steps) {
    const result = step();
    if (!result.ok) {
      log(`Squire left the next character to you: ${result.reason ?? "the game refused a step"}`);
      return false;
    }
  }
  /* The game refuses a blank name, and a previous character can have none. */
  if (!cat.namePinned && session.draft().name.trim() === "") {
    const named = session.randomName();
    if (!named.ok) {
      log(`Squire left the next character to you: ${named.reason ?? "the game refused a name"}`);
      return false;
    }
  }
  if (!cat.namePinned && namesake !== undefined) session.setName(namesake);
  const accepted = session.accept();
  if (!accepted.ok) log(`Squire left the next character to you: ${accepted.reason ?? "the game refused it"}`);
  return accepted.ok;
}

/** The host context a birth presenter receives, as far as this file reads it. */
export interface BirthHost {
  readonly prefs?: { get(): unknown; set?(value: unknown): void };
  readonly log: (msg: string) => void;
}

/** The presenter `plugin.birth` returns. */
export function rollOnPresenter(
  host: BirthHost,
  store: MarkStore | null = sessionMarks(),
  now: () => number = Date.now,
  random: () => number = Math.random,
): { show(session: BirthSessionLike): boolean | undefined } {
  return {
    show(session) {
      if (!takeRollOn(store, now())) return undefined;
      const config = readConfig(host.prefs?.get());
      const mode = config.rollOn;
      if (mode === "wait") return undefined;
      const heir = config.pendingHeir;
      const persona = activePersona(config) ?? defaultPersona();
      const namesake = heir === null || session.catalogue().namePinned ? null : namesakeFor(config.lineages[heir.lineage], heir.parent, persona, random);
      if (!rollOnBirth(session, mode, random, host.log, namesake?.name)) return undefined;
      const name = session.draft().name;
      if (heir !== null) host.prefs?.set?.(writeConfig({ ...config, pendingHeir: { ...heir, name } }));
      if (namesake !== null && name === namesake.name) host.log(namesakeLog({ ...persona, name }, namesake.ancestor));
      markRollOn(store, now(), HEIR_KEY);
      return true;
    },
  };
}
