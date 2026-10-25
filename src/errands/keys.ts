/**
 * The errand key, and how Squire answers a key pressed while it drives.
 *
 * The host fixes Escape and Ctrl-Z as the way back to the keyboard and never
 * passes them here, so nothing below can trap a player. What reaches this
 * handler is every other key. The errand key opens or closes the errand menu,
 * a digit picks an errand while the menu is open, and anything else keeps
 * Squire playing with a one-line notice of how to take over.
 *
 * The handler answers synchronously and never throws. The host treats a throw
 * as a fault in the mod and hands the keyboard back, which is the right outcome
 * but the wrong way to reach it: a failure here answers release itself, with a
 * reason the player can read.
 */

import type { ControllerKeyAnswer, ControllerKeyPress } from "@rpgm-tools/neo-angband-core";
import { ERRAND_TEXT } from "./text.js";

/**
 * Keys no game command uses in either the original or the roguelike keyset,
 * so pressing one while Squire drives can never be mistaken for a command meant
 * for the game. Enter is not here: it opens the game's command menu.
 */
export const ERRAND_KEYS = ["&", "!", "#", "$", "%", "(", "_"] as const;
export type ErrandKey = (typeof ERRAND_KEYS)[number];
export const DEFAULT_ERRAND_KEY: ErrandKey = "&";

/** What the key handler drives. The errand driver implements it. */
export interface KeyTarget {
  /** The stored errand key. */
  errandKey(): string;
  /** Whether the errand menu is showing. */
  menuOpen(): boolean;
  openMenu(): void;
  closeMenu(): void;
  /**
   * Start the errand at this 1-based menu position. Returns null once it has
   * started, or the reason it cannot, for the message line.
   */
  pick(position: number): string | null;
  log(message: string): void;
}

/** The key as the log names it. */
export function keyName(press: ControllerKeyPress): string {
  const name = press.key === " " ? "Space" : press.key;
  return [press.ctrl ? "Ctrl" : "", press.alt ? "Alt" : "", press.meta ? "Meta" : "", name].filter((part) => part !== "").join("-");
}

function plain(press: ControllerKeyPress): boolean {
  return !press.ctrl && !press.alt && !press.meta;
}

function answer(target: KeyTarget, press: ControllerKeyPress): ControllerKeyAnswer {
  const key = target.errandKey();
  if (plain(press) && press.key === key) {
    if (press.repeat) return { kind: "keep" };
    if (target.menuOpen()) {
      target.closeMenu();
      return { kind: "keep", message: ERRAND_TEXT.menuClosed };
    }
    target.openMenu();
    return { kind: "keep", message: ERRAND_TEXT.menuHint(key) };
  }
  if (target.menuOpen() && plain(press) && /^[1-9]$/.test(press.key)) {
    if (press.repeat) return { kind: "keep" };
    const refused = target.pick(Number(press.key));
    return refused === null ? { kind: "keep" } : { kind: "keep", message: refused };
  }
  return { kind: "keep", message: ERRAND_TEXT.notice(key) };
}

/** The `onKey` handler the host calls. */
export function keyHandler(target: KeyTarget): (press: ControllerKeyPress) => ControllerKeyAnswer {
  return (press) => {
    try {
      const result = answer(target, press);
      target.log(`Squire answered ${keyName(press)}: ${result.kind}${result.kind === "keep" && result.message !== undefined ? ` (${result.message})` : ""}`);
      return result;
    } catch (error) {
      try {
        target.log(`Squire could not answer ${keyName(press)}, so it hands the keyboard back: ${String(error)}`);
      } catch {
        /* A log that throws as well still leaves the answer below. */
      }
      return { kind: "release", reason: ERRAND_TEXT.keyFailed };
    }
  };
}
