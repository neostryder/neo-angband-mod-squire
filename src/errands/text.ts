/**
 * Every line the errand menu and the key handler show a player, in one place
 * so the wording can be read and changed together.
 *
 * Plain ASCII, short and literal. The manifest's copy of the setting's label
 * and help is checked against this table by a test, since a JSON file cannot
 * import it.
 */

import type { ErrandId } from "./catalog.js";

export const ERRAND_TEXT = {
  /** The message line, for a key that is not Escape, Ctrl-Z or the errand key. */
  notice: (key: string): string => `Squire is playing. Press Escape to take over, or ${key} for errands.`,
  /** The message line when the menu opens. */
  menuHint: (key: string): string => `Choose an errand by number. ${key} closes the list. Escape takes over.`,
  menuClosed: "Squire goes on playing.",
  /** The message line when Squire cannot read a key and gives the keyboard back. */
  keyFailed: "Squire could not read that key. The keyboard is yours.",

  menuTitle: "Errands",
  /** Heading over the model's short list. */
  suggested: "Suggested now",
  allErrands: "All errands",
  /** Shown beside an errand that cannot start, before its reason. */
  notNow: "Not now:",
  /** The menu's footer. */
  menuFooter: (key: string): string => `Press a number to choose. ${key} closes this list. Escape takes the keyboard back.`,

  labels: {
    loot: "Collect the valuable loot",
    town: "Return to town",
    down: "Find a down staircase",
    up: "Find an up staircase",
    leave: "Get off this level",
    explore: "Explore this level",
    clear: "Clear this level",
    restock: "Restock",
  } satisfies Record<ErrandId, string>,

  /** Why an errand cannot start right now. */
  reasons: {
    inTown: "The character is already in town.",
    noUpInTown: "Town has no up staircase.",
    onDownStair: "The character is standing on a down staircase.",
    onUpStair: "The character is standing on an up staircase.",
    noLoot: "No valuable loot is known on this level.",
    explored: "Everything reachable here is explored.",
    townClear: "Town creatures keep coming back, so town is never clear.",
    notInTown: "Restock works only in town.",
    dead: "The character has died.",
    notYet: "Squire has not looked at the game yet.",
  },

  /** The message line when a listed errand that cannot start is chosen. */
  refused: (reason: string): string => `That errand cannot start: ${reason}`,
  /** The message line when the number matches no errand. */
  noSuchErrand: "There is no errand with that number.",

  /** Squire's status while an errand runs. */
  running: (label: string): string => `Errand: ${label}`,
  /** Status label when an errand ends. */
  endedLabel: "Errand ended",
  done: (label: string, detail: string): string => `${label}: done. ${detail}`,
  stopped: (label: string, detail: string): string => `${label}: stopped. ${detail}`,

  /** The Mods screen switch. */
  colourTitle: "Let the persona colour errands",
  colourHelp: "The persona's traits change how an errand from the errand menu is done: the route, the risks it takes and what it picks up. The errand is still done. Off, every errand runs the plain way.",

  /** The Setup tab's errand key picker. */
  keyTitle: "Errand key",
  keyHelp: "Opens the errand menu while Squire plays. No game command uses these keys. Escape always takes the keyboard back.",
} as const;

/** How each errand ends when it finishes on its own, for the status line. */
export const ERRAND_DONE: Readonly<Record<ErrandId, string>> = {
  loot: "No more valuable loot is known on this level.",
  town: "The character is in town.",
  down: "The character is on a down staircase.",
  up: "The character is on an up staircase.",
  leave: "The character has left the level.",
  explore: "Everything reachable here is explored.",
  clear: "Nothing hostile is known on this level.",
  restock: "The shopping is done.",
};
