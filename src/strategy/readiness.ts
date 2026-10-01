/** Preparation uses reported abilities and named supplies, never unidentified item effects. */

import type { AgentView } from "@rpgm-tools/neo-angband-core";
import { canRead, detectionSources, hungry, readPack } from "../brain/pack.js";
import { shownName } from "../town/needs.js";
import { TV } from "../gear/compare.js";

const TV_FLASK = 27;

export interface Supplies {
  readonly cures: number;
  readonly critical: number;
  readonly serious: number;
  readonly phase: number;
  readonly escapes: number;
  readonly recall: number;
  readonly food: number;
  readonly fuel: number;
  readonly lastingLight: boolean;
  readonly workingLight: boolean;
}

function namedCount(view: AgentView, pattern: RegExp): number {
  return view.inventory().reduce((sum, item) => sum + (pattern.test(shownName(item) ?? "") ? item.number : 0), 0);
}

export function supplies(view: AgentView): Supplies {
  const player = view.player();
  const light = view.equipment().find((item) => item !== null && item.tval === TV.LIGHT) ?? null;
  const permanent = light !== null && (light.artifact || light.flags.includes("NO_FUEL"));
  const workingLight = light !== null && (light.timeout > 0 || permanent);
  /* A lantern refills from flasks of oil; a torch is replaced by a spare torch. */
  const lantern = light !== null && /\bLantern\b/i.test(shownName(light) ?? "");
  const pack = readPack(view);
  const reliable = pack.escapeSpell.filter((spell) => spell.fail <= 15);
  const lastingLight = player.classFlags.includes("UNLIGHT") || player.objectFlags.includes("NO_FUEL") || permanent;
  return {
    cures: namedCount(view, /\bPotions? of Cure (Light|Serious|Critical) Wounds\b/i),
    critical: namedCount(view, /\bPotions? of Cure Critical Wounds\b/i),
    serious: namedCount(view, /\bPotions? of Cure (Serious|Critical) Wounds\b/i),
    phase: namedCount(view, /\bScrolls? of Phase Door\b/i) + (reliable.some((spell) => /^(Phase Door|Blink|Shadow Shift)$/i.test(spell.name)) ? 2 : 0),
    escapes: namedCount(view, /\bScrolls? of (Teleportation|Teleport Level)\b/i) + view.inventory().reduce((sum, item) => {
      const name = shownName(item) ?? "";
      const charges = /\((\d+) charges?\)/i.exec(name);
      return sum + (/\bStaff of Teleportation\b/i.test(name) && charges !== null ? Number(charges[1]) : 0);
    }, 0) + (reliable.some((spell) => /^(Teleport Self|Portal|Warp)$/i.test(spell.name)) ? 2 : 0),
    recall: namedCount(view, /\bScrolls? of Word of Recall\b/i),
    food: view.inventory().reduce((sum, item) => sum + (pack.food.some((food) => food.handle === item.handle) ? item.number : 0), 0),
    fuel: view.inventory().reduce((sum, item) => {
      const name = shownName(item) ?? "";
      const matches = lantern ? item.tval === TV_FLASK && /\bFlasks? of Oil\b/i.test(name) :
        item.tval === TV.LIGHT && /\bWooden (Torch|Torches)\b/i.test(name) && item.timeout > 0;
      return sum + (matches ? item.number : 0);
    }, 0),
    lastingLight,
    workingLight,
  };
}

export interface Requirement {
  readonly kind: "level" | "hp" | "light" | "food" | "healing" | "phase" | "recall" | "protection";
  readonly reason: string;
}

/** Unknown classes use the strictest early class floor. */
function classFloor(cls: string, depth: number): readonly [number, number] {
  if (depth < 5) {
    if (["Warrior", "Blackguard", "Paladin", "Ranger"].includes(cls)) return [50, 4];
    if (cls === "Rogue") return [50, 8];
    if (["Priest", "Druid"].includes(cls)) return [40, 9];
    return [60, 11];
  }
  if (["Warrior", "Blackguard", "Paladin", "Ranger"].includes(cls)) return [60, 6];
  if (cls === "Rogue") return [60, 10];
  if (["Priest", "Druid"].includes(cls)) return [60, 15];
  return [80, 15];
}

/** The actual destination is checked even when the command starts in town. */
export function missingPreparation(view: AgentView, depth: number): Requirement[] {
  if (depth <= 1) return [];
  const player = view.player();
  const stock = supplies(view);
  const level = Number.isFinite(player.maxLevel) ? player.maxLevel : player.level;
  const out: Requirement[] = [];
  const need = (kind: Requirement["kind"], enough: boolean, reason: string) => { if (!enough) out.push({ kind, reason }); };
  const [hpFloor, classLevel] = depth >= 3 ? classFloor(player.cls, player.depth === 0 ? Math.min(depth, 4) : depth) : [30, 2];
  const caster = ["Mage", "Necromancer"].includes(player.cls);
  const levelFloor = Math.max(depth, classLevel, depth >= 10 && caster && level <= 28 ? depth + 5 : 0);
  need("level", level >= levelFloor || level >= 50, `maximum character level ${String(levelFloor)}`);
  need("hp", player.maxHp >= hpFloor, `${String(hpFloor)} maximum hit points`);
  need("light", (depth >= 10 && player.cls !== "Necromancer" ? player.light >= 2 : stock.workingLight) || player.classFlags.includes("UNLIGHT"), depth >= 10 ? "light radius 2" : "working light");
  need("food", stock.food >= 5 && !hungry(view), "five food units and no hunger");
  if (depth >= 3 && level < 30) need("healing", stock.cures >= 2, "two Cure Light, Serious or Critical Wounds potions");
  if (depth >= 5) need("recall", stock.recall >= 1 && canRead(view), "one usable Word of Recall");
  if (depth >= 6) need("phase", stock.phase >= 1 && canRead(view), "one usable Phase Door");
  if (depth >= 10) {
    need("phase", stock.escapes >= (depth > 25 ? 6 : 2) && canRead(view), depth > 25 ? "six long escapes" : "two long escapes");
    if (level < 30) need("healing", depth > 25 ? stock.serious >= 10 : stock.critical >= 3, depth > 25 ? "ten Cure Serious or Critical Wounds potions" : "three Cure Critical Wounds potions");
    const detectsInvisible = detectionSources(view).some((source) => {
      if (!/^(Detection|Reveal Monsters)$|Rods? of Detection/i.test(source.name) || /charging/i.test(source.name)) return false;
      return source.kind !== "cast" || view.spellbooks().some((book) => book.spells.some((spell) => spell.sidx === source.sidx && spell.fail <= 15));
    });
    need("protection", player.objectFlags.includes("SEE_INVIS") || player.objectFlags.includes("TELEPATHY") || detectsInvisible, "See Invisible, telepathy or usable detection of invisible creatures");
  }
  if (depth >= 20) need("protection", player.objectFlags.includes("FREE_ACT"), "Free Action");
  if (depth > 20) {
    /* Only known equipped resistance is evidence; an item's raw hidden resists are not. */
    const inspect = view as AgentView & { inspectItem?: (handle: number) => { readonly text: string } | null };
    const texts = view.equipment().flatMap((item) => item === null ? [] : [inspect.inspectItem?.(item.handle)?.text ?? ""]);
    const has = (element: string) => texts.some((text) => [...text.matchAll(/Provides (?:(?:resistance|immunity) to|protection from) ([^.\n]+)/gi)].some((line) => new RegExp(`\\b${element}\\b`, "i").test(line[1] ?? "")));
    const basics = ["acid", "lightning", "fire", "cold"].filter(has);
    need("protection", has("fire") && basics.length >= (depth > 25 ? 4 : 3), depth > 25 ? "all four basic resistances" : "fire resistance and two other basic resistances");
    need("protection", player.stats.length >= 5 && [0, 3, 4, ...(caster ? [1] : ["Priest", "Druid", "Paladin"].includes(player.cls) ? [2] : [])].every((index) => (player.stats[index] ?? 0) >= 7), "Strength, Dexterity, Constitution and the casting stat at least 7");
    if (depth >= 40) need("protection", has("poison") && has("confusion"), "poison and confusion resistance");
    if (depth >= 56) need("protection", has("blindness"), "blindness resistance");
    if (depth >= 60) need("protection", has("chaos") && has("disenchantment"), "chaos and disenchantment resistance");
  }
  if (depth >= 46) {
    need("hp", player.maxHp >= 500, "500 maximum hit points");
    const speed = depth >= 81 ? 20 : depth >= 60 ? 10 : 5;
    need("protection", player.speed >= 110 + speed, `+${String(speed)} speed`);
    need("healing", namedCount(view, /\bPotions? of (\*?Healing\*?|Life)\b/i) > 0, "large healing");
    if (level < 50) need("protection", player.objectFlags.includes("HOLD_LIFE"), "Hold Life before maximum character level 50");
  }
  if (depth >= 56) {
    need("protection", player.objectFlags.includes("TELEPATHY"), "telepathy");
    need("healing", namedCount(view, /\bPotions? of Healing\b/i) >= 2 || namedCount(view, /\bPotions? of (\*Healing\*|Life)/i) >= 1, "two Healing potions or one *Healing* or Life potion");
  }
  if (depth >= 100) {
    need("healing", namedCount(view, /\bPotions? of Healing\b/i) >= 5, "five Healing potions");
    need("healing", namedCount(view, /\bPotions? of (\*Healing\*|Life)/i) >= 15, "fifteen *Healing* or Life potions");
    need("protection", namedCount(view, /\bPotions? of Speed\b/i) >= 10, "ten Speed potions");
    if (player.maxSp > 100) need("healing", namedCount(view, /\bPotions? of Restore Mana\b/i) >= 15, "fifteen Restore Mana potions");
  }
  return out;
}

/** Town reserves are independent of the persona's optional stock targets. */
export function missingEssentials(view: AgentView): Requirement[] {
  const stock = supplies(view);
  const out: Requirement[] = [];
  if (stock.cures < 2) out.push({ kind: "healing", reason: "two healing potions" });
  if (stock.phase < 2 || !canRead(view)) out.push({ kind: "phase", reason: "two usable Phase Doors" });
  if (stock.food < 2) out.push({ kind: "food", reason: "two food units" });
  if (!stock.lastingLight && (!stock.workingLight || stock.fuel < 2)) out.push({ kind: "light", reason: "working light and two fuel units" });
  return out;
}

/** The return starts above the lower stay-on-level floor, leaving supplies for the route. */
export function supplyMargin(view: AgentView): string | null {
  const player = view.player();
  if (player.depth === 0) return null;
  const stock = supplies(view);
  if (stock.food <= (player.depth === 1 ? 1 : 3) || hungry(view)) return "food";
  if (!stock.lastingLight && (!stock.workingLight || stock.fuel <= 1)) return "light and fuel";
  if (stock.cures <= (player.depth >= 10 ? 3 : player.depth >= 6 ? 2 : 1)) return "healing";
  if (stock.phase <= 1) return "Phase Door";
  if (player.depth >= 10 && stock.escapes <= 2) return "long escapes";
  return null;
}
