/**
 * Combat preparation: the buffs and devices a character may use before a hard
 * fight, and the resist potions it may drink before a creature it knows breathes.
 *
 * Everything here reads names the player can see and the creature recall the
 * game already keeps. A creature's breath is only known from that recall, so a
 * view without it never offers a resist; the same is true of every other read.
 */

import type { AgentView, ItemView, MonsterView } from "@rpgm-tools/neo-angband-core";
import { shownName } from "../town/needs.js";
import { inspecting } from "./threat-model.js";

/** One usable object or spell, with how the game consumes it. */
export type CombatUse =
  | { readonly how: "quaff" | "read"; readonly handle: number; readonly name: string }
  | { readonly how: "cast"; readonly sidx: number; readonly name: string }
  | { readonly how: "staff" | "rod"; readonly handle: number; readonly name: string }
  | { readonly how: "activate"; readonly handle: number; readonly name: string };

const BUFF_ITEMS: readonly [RegExp, "quaff" | "read"][] = [
  [/\bPotions? of (Heroism|Berserk Strength|Speed)\b/i, "quaff"],
  [/\bScrolls? of (Blessing|Heroism)\b/i, "read"],
];

const BUFF_SPELLS: readonly RegExp[] = [/^(Heroism|Blessing|Berserk Strength|Haste Self)$/i];

const CURING: readonly [RegExp, "staff" | "rod"][] = [
  [/\bStaffs? of Curing\b/i, "staff"],
  [/\bRods? of Curing\b/i, "rod"],
];

function held(view: AgentView): { readonly item: ItemView; readonly name: string }[] {
  return view.inventory().flatMap((item) => {
    const name = shownName(item);
    return name === null ? [] : [{ item, name }];
  });
}

/** A spell the character can cast right now. */
function castable(view: AgentView): { readonly sidx: number; readonly name: string }[] {
  const sp = view.player().sp;
  const out: { sidx: number; name: string }[] = [];
  for (const book of view.spellbooks()) {
    for (const spell of book.spells) {
      if (spell.learned && !spell.forgotten && spell.mana <= sp && spell.fail <= 50) out.push({ sidx: spell.sidx, name: spell.name });
    }
  }
  return out;
}

/** Whether the character is already under one of the combat buffs. */
function alreadyBuffed(view: AgentView): boolean {
  const s = view.player().status;
  return s.hero > 0 || s.shero > 0 || s.blessed > 0 || s.fast > 0 || s.sprint > 0;
}

/** A heroism, blessing, berserk or speed source the character is not already under. */
export function buffUse(view: AgentView): CombatUse | null {
  if (alreadyBuffed(view)) return null;
  for (const { item, name } of held(view)) {
    const found = BUFF_ITEMS.find(([pattern]) => pattern.test(name));
    if (found !== undefined) return { how: found[1], handle: item.handle, name };
  }
  for (const spell of castable(view)) {
    if (BUFF_SPELLS.some((pattern) => pattern.test(spell.name))) return { how: "cast", sidx: spell.sidx, name: spell.name };
  }
  return null;
}

/** A resist potion or scroll the character can drink before a known breather. */
export function resistUse(view: AgentView): CombatUse | null {
  for (const { item, name } of held(view)) {
    if (/\bPotions? of Resist/i.test(name)) return { how: "quaff", handle: item.handle, name };
    if (/\bScrolls? of Resist/i.test(name)) return { how: "read", handle: item.handle, name };
  }
  return null;
}

/** A staff or rod of Curing, which restores hit points and closes a cut. */
export function deviceHealUse(view: AgentView): CombatUse | null {
  for (const { item, name } of held(view)) {
    const found = CURING.find(([pattern]) => pattern.test(name));
    if (found !== undefined) return { how: found[1], handle: item.handle, name };
  }
  return null;
}

/** A carried object with an activation that is ready to use. */
export function activationUse(view: AgentView): CombatUse | null {
  for (const { item, name } of held(view)) {
    if (item.activation && item.timeout <= 0) return { how: "activate", handle: item.handle, name };
  }
  return null;
}

/** A visible, awake creature whose recall says it breathes, and the element. */
export function breatherInSight(view: AgentView, monsters: readonly MonsterView[]): { readonly race: string; readonly element: string | null } | null {
  const recall = inspecting(view).monsterRecall;
  if (recall === undefined) return null;
  for (const monster of monsters) {
    if (!monster.visible || monster.asleep) continue;
    const info = recall.call(view, monster.raceIndex);
    if (info === null || info === undefined || !/\bbreathe/i.test(info.text)) continue;
    const element = /\bbreathe[s]?\s+([a-z]+)/i.exec(info.text)?.[1] ?? null;
    return { race: monster.race, element };
  }
  return null;
}
