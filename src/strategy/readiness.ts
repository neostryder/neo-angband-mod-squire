/** Preparation uses reported abilities and named supplies, never unidentified item effects. */

import type { AgentView, ItemView } from "../host-adapter.js";
import { canRead, detectionSources, hungry, readPack } from "../brain/pack.js";
import { shownName } from "../town/needs.js";
import { TV } from "../gear/compare.js";
import type { Persona } from "../persona/persona.js";
import { drive, readinessExtra } from "./pursuits.js";
import { depthBand } from "../brain/bands.js";

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

export const HEALING_POTION = /\bPotions? of Cure (Light|Serious|Critical) Wounds\b/i;
const PHASE_SCROLL = /\bScrolls? of Phase Door\b/i;
const TELEPORT_SCROLL = /\bScrolls? of (Teleportation|Teleport Level)\b/i;
const TELEPORT_STAFF = /\bStaff of Teleportation\b/i;
const PHASE_SPELL = /^(Phase Door|Blink|Shadow Shift)$/i;
const TELEPORT_SPELL = /^(Teleport Self|Portal|Warp)$/i;
/** Fail rate, in percent, above which an escape spell is too unreliable to count. */
const RELIABLE_FAIL = 15;

function staffCharges(view: AgentView): number {
  return view.inventory().reduce((sum, item) => {
    const name = shownName(item) ?? "";
    const charges = /\((\d+) charges?\)/i.exec(name);
    return sum + (TELEPORT_STAFF.test(name) && charges !== null ? Number(charges[1]) : 0);
  }, 0);
}

/** Whether using this item is an escape: a Phase Door or teleport scroll, or a Staff of Teleportation. */
export function escapeItem(item: ItemView): boolean {
  const name = shownName(item) ?? "";
  return PHASE_SCROLL.test(name) || TELEPORT_SCROLL.test(name) || TELEPORT_STAFF.test(name);
}

/** Escape scrolls and Staff of Teleportation charges in the pack. Spells are not counted. */
export function escapeItems(view: AgentView): number {
  return namedCount(view, PHASE_SCROLL) + namedCount(view, TELEPORT_SCROLL) + staffCharges(view);
}

/** Whether the character knows an escape spell it casts reliably. */
export function reliableEscapeSpell(view: AgentView): boolean {
  return readPack(view).escapeSpell.some((spell) => spell.fail <= RELIABLE_FAIL && (PHASE_SPELL.test(spell.name) || TELEPORT_SPELL.test(spell.name)));
}

export function supplies(view: AgentView): Supplies {
  const player = view.player();
  const light = view.equipment().find((item) => item !== null && item.tval === TV.LIGHT) ?? null;
  const permanent = light !== null && (light.artifact || light.flags.includes("NO_FUEL"));
  const workingLight = light !== null && (light.timeout > 0 || permanent);
  /* A lantern refills from flasks of oil; a torch is replaced by a spare torch. */
  const lantern = light !== null && /\bLantern\b/i.test(shownName(light) ?? "");
  const pack = readPack(view);
  const reliable = pack.escapeSpell.filter((spell) => spell.fail <= RELIABLE_FAIL);
  const lastingLight = player.classFlags.includes("UNLIGHT") || player.objectFlags.includes("NO_FUEL") || permanent;
  return {
    cures: namedCount(view, HEALING_POTION),
    critical: namedCount(view, /\bPotions? of Cure Critical Wounds\b/i),
    serious: namedCount(view, /\bPotions? of Cure (Serious|Critical) Wounds\b/i),
    phase: namedCount(view, PHASE_SCROLL) + (reliable.some((spell) => PHASE_SPELL.test(spell.name)) ? 2 : 0),
    escapes: namedCount(view, TELEPORT_SCROLL) + staffCharges(view) + (reliable.some((spell) => TELEPORT_SPELL.test(spell.name)) ? 2 : 0),
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

/**
 * A prepared trip down requires lasting light or working light with spare fuel.
 * The departure guard also permits a bounded earning trip with enough current fuel.
 * Escapes are not trips: a staircase taken to survive is never held back by it.
 */
export function tripLight(view: AgentView): boolean {
  const stock = supplies(view);
  return stock.lastingLight || stock.workingLight && stock.fuel >= 1;
}

export interface Requirement {
  readonly kind: "level" | "hp" | "light" | "food" | "healing" | "phase" | "recall" | "protection";
  readonly reason: string;
  /** A survival shortfall cannot be waived by readiness or stagnation. */
  readonly severe?: true;
}

/** The poison timer must expire before it consumes the persona's health reserve. */
export function poisonRecovery(view: AgentView, persona: Persona | null): boolean {
  const player = view.player();
  return player.status.poisoned > 0 && player.status.cut === 0 &&
    player.hp > player.status.poisoned + player.maxHp * (0.2 + 0.2 * (1 - drive(persona)));
}

export function restRestoresMana(cls: string): boolean {
  return cls !== "Blackguard";
}

/** Unknown classes use the strictest early class floor. */
function classFloor(cls: string, depth: number, persona: Persona | null): readonly [number, number] {
  if (depth === 2) {
    const hp = ["Warrior", "Blackguard", "Paladin", "Ranger"].includes(cls) ? 30
      : cls === "Rogue" ? 26 : ["Priest", "Druid"].includes(cls) ? 24
      : ["Mage", "Necromancer"].includes(cls) ? 20 : 30;
    const scale = 1 + 0.3 * (drive(null) - drive(persona));
    return [Math.ceil(hp * scale), Math.max(3, Math.ceil(3 * scale))];
  }
  if (depth < 5) {
    const martial = ["Warrior", "Blackguard", "Paladin", "Ranger"].includes(cls);
    const hp = martial ? 40 : cls === "Rogue" ? 34 : 28;
    const scale = 1 + 0.3 * (drive(null) - drive(persona));
    return [Math.ceil(hp * scale), Math.max(depth + 1, Math.ceil(4 * scale))];
  }
  if (depth <= 10 && ["Mage", "Necromancer"].includes(cls)) return [36 + 4 * (depth - 5), 15];
  if (["Warrior", "Blackguard", "Paladin", "Ranger"].includes(cls)) return [60, 6];
  if (cls === "Rogue") return [60, 10];
  if (["Priest", "Druid"].includes(cls)) return [60, 15];
  return [80, 15];
}

/** Ambition shortens the wait before an early dive can use its timed preparation floor. */
export function descentWait(persona: Persona | null): number {
  return 2.5 - 1.5 * Math.max(0, Math.min(1, (persona?.sliders.ambition ?? 50) / 100));
}

export function earlyDescentReady(view: AgentView, reserves = 2): boolean {
  const player = view.player();
  const pack = readPack(view);
  const caster = ["Mage", "Necromancer"].includes(player.cls);
  return player.hp === player.maxHp && player.status.poisoned === 0 && player.status.cut === 0 &&
    player.status.blind === 0 && player.status.confused === 0 && player.status.afraid === 0 &&
    (!caster || pack.oil.length > 0 || pack.attackWand.length > 0 || pack.attackSpell.length > 0 || pack.launcher && pack.ammo.length > 0) &&
    supplies(view).cures + escapeItems(view) >= reserves;
}

/** The actual destination is checked even when the command starts in town. */
export function missingPreparation(view: AgentView, depth: number, persona: Persona | null = null, depthMinutes = 0, earlyStair = false, stairEscape = false): Requirement[] {
  if (depth <= 1) return [];
  const player = view.player();
  const stock = supplies(view);
  const level = Number.isFinite(player.maxLevel) ? player.maxLevel : player.level;
  const out: Requirement[] = [];
  const need = (kind: Requirement["kind"], enough: boolean, reason: string, severe = false) => { if (!enough) out.push(severe ? { kind, reason, severe } : { kind, reason }); };
  const [classHp, classLevel] = classFloor(player.cls, depth, persona);
  const caster = ["Mage", "Necromancer"].includes(player.cls);
  const pack = readPack(view);
  const ranged = pack.oil.length > 0 || pack.attackWand.length > 0 || pack.attackSpell.length > 0 || pack.launcher && pack.ammo.length > 0;
  /* Lower caster HP is viable only while a known ranged attack is available. */
  const normalHp = caster && depth <= 10 && !ranged ? Math.max(classHp, classFloor("Warrior", depth, persona)[0]) : classHp;
  const timed = depth >= 2 && depth <= 4 && depthMinutes >= descentWait(persona) && earlyDescentReady(view, 0) &&
    stock.cures >= 1 && (stairEscape || stock.phase + stock.escapes >= 1 && canRead(view));
  const hpFloor = timed ? Math.ceil(normalHp * 0.6) : normalHp;
  const normalLevel = Math.max(depth, classLevel, depth >= 10 && caster && level <= 28 ? depth + 5 : 0);
  const stocked = stock.phase + stock.escapes >= 2 || earlyStair && depth <= 5;
  const paced = timed && player.maxHp >= hpFloor || depth <= 10 && earlyDescentReady(view) && stocked && player.maxHp >= hpFloor &&
    (depthMinutes >= descentWait(persona) || earlyStair && depth <= 5);
  /* Level 2 apprentices still rule out sending a level 2 character deeper. */
  const levelFloor = paced ? Math.min(normalLevel, Math.max(3, Math.ceil(depth * 0.6) + 1)) : normalLevel;
  need("level", level >= levelFloor || level >= 50, `maximum character level ${String(levelFloor)}`, depth <= 10 || level < depth || level * 2 < levelFloor);
  need("hp", player.maxHp >= hpFloor, `${String(hpFloor)} maximum hit points`, depth <= 10 || player.maxHp * 2 < hpFloor);
  need("light", (depth >= 10 && player.cls !== "Necromancer" ? player.light >= 2 : stock.workingLight) || player.classFlags.includes("UNLIGHT"), depth >= 10 ? "light radius 2" : "working light");
  need("food", stock.food >= 5 && !hungry(view), "five food units and no hunger");
  if (depth >= 2 && level < 30) need("healing", stock.cures >= (timed ? 1 : 2), timed ? "one Cure Light, Serious or Critical Wounds potion" : "two Cure Light, Serious or Critical Wounds potions");
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
    /* Race, class and known worn flags count as well as item text: a Dwarf is never blinded. */
    const protects = (element: string, flag: string) => has(element) || player.objectFlags.includes(flag);
    const basics = ["acid", "lightning", "fire", "cold"].filter(has);
    need("protection", has("fire") && basics.length >= (depth > 25 ? 4 : 3), depth > 25 ? "all four basic resistances" : "fire resistance and two other basic resistances");
    need("protection", player.stats.length >= 5 && [0, 3, 4, ...(caster ? [1] : ["Priest", "Druid", "Paladin"].includes(player.cls) ? [2] : [])].every((index) => (player.stats[index] ?? 0) >= 7), "Strength, Dexterity, Constitution and the casting stat at least 7");
    if (depth >= 40) need("protection", has("poison") && protects("confusion", "PROT_CONF"), "poison and confusion resistance");
    if (depth >= 56) need("protection", protects("blindness", "PROT_BLIND"), "blindness resistance");
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

/** Food and light remain mandatory when pacing lowers early preparation floors. */
const HARD_GAPS: ReadonlySet<Requirement["kind"]> = new Set(["light", "food"]);

/**
 * The preparation a level asks for, split into gaps that always forbid the trip and gaps the
 * model weighs against the persona's readiness threshold.
 */
export function descentGaps(view: AgentView, depth: number, persona: Persona | null = null, depthMinutes = 0, earlyStair = false, stairEscape = false): { readonly hard: Requirement[]; readonly soft: Requirement[] } {
  const all = missingPreparation(view, depth, persona, depthMinutes, earlyStair, stairEscape);
  const hard = (gap: Requirement) => HARD_GAPS.has(gap.kind) || gap.severe === true;
  return { hard: all.filter(hard), soft: all.filter((gap) => !hard(gap)) };
}

/**
 * How sure the model must be that the character is ready before it goes down with soft gaps.
 * Early stagnation lowers the bar while the survival checks still apply.
 */
export function readinessThreshold(persona: Persona | null, depth = 5, turnsWithoutExperience = 0): number {
  const urgency = drive(persona);
  const base = Math.min(0.85, Math.max(0.3, 0.8 - 0.6 * urgency));
  if (depth >= 5) return base;
  const minimum = 0.2 + 0.1 * (1 - urgency);
  return Math.max(minimum, base - 0.1 * urgency - turnsWithoutExperience / (2000 * (2 - urgency)));
}

/** One sentence on what the next level down still asks for, for the purpose layer. */
export function gapFacts(view: AgentView, persona: Persona | null = null, depthMinutes = 0, earlyStair = false, stairEscape = false): string | undefined {
  const depth = view.player().depth + 1;
  const gaps = missingPreparation(view, depth, persona, depthMinutes, earlyStair, stairEscape);
  if (depth <= 1) return undefined;
  const phase = persona !== null && depth < 6 && supplies(view).phase === 0
    ? ` Optional escape warning: this persona wants ${String(Math.max(1, Math.ceil(persona.sliders.escapes / 50)))} Phase Door scrolls, but carries none.` : "";
  if (gaps.length === 0) return `The character is prepared for dungeon level ${String(depth)} (${depthBand(depth)}).${phase}`;
  return `For dungeon level ${String(depth)} (${depthBand(depth)}) the character still lacks: ${gaps.map((gap) => gap.reason).join("; ")}.${phase}`;
}

/**
 * The town basket. Its death-safety floor is two healing potions, two Phase
 * Doors, two food units and working light with two fuel units; above that floor
 * the persona's drive sets the extra wants (`readinessExtra`), so a cautious
 * character stocks higher. With no persona the default extra of one asks the
 * floor.
 */
export function missingEssentials(view: AgentView, persona: Persona | null = null): Requirement[] {
  const stock = supplies(view);
  const { healing: cures, phase, food, light: fuel } = basketWants(persona);
  const out: Requirement[] = [];
  if (stock.cures < cures) out.push({ kind: "healing", reason: `${countWord(cures)} healing potion${cures === 1 ? "" : "s"}` });
  if (stock.phase < phase || !canRead(view)) out.push({ kind: "phase", reason: `${countWord(phase)} usable Phase Door${phase === 1 ? "" : "s"}` });
  if (stock.food < food) out.push({ kind: "food", reason: `${countWord(food)} food units` });
  if (!stock.lastingLight && (!stock.workingLight || stock.fuel < fuel)) out.push({ kind: "light", reason: `working light and ${countWord(fuel)} fuel unit${fuel === 1 ? "" : "s"}` });
  return out;
}

/** How many of each basket item the persona wants before it leaves town. Two healing and two Phase Doors hold for every persona. */
export function basketWants(persona: Persona | null): { readonly healing: number; readonly phase: number; readonly food: number; readonly light: number } {
  const extra = readinessExtra(persona);
  return {
    healing: Math.max(2, 1 + extra),
    phase: Math.max(2, 1 + extra),
    food: Math.max(2, 2 + Math.max(0, extra - 1)),
    /* Two spares, because the level 1 margin turns back at one. */
    light: 2 + Math.max(0, extra - 1),
  };
}

function countWord(n: number): string {
  return ["no", "one", "two", "three", "four"][n] ?? String(n);
}

/**
 * The return starts above the lower stay-on-level floor, leaving supplies for the route.
 *
 * The first two levels tolerate spending individual potions or scrolls.
 * When both reserves fall low, the return starts before the next fight.
 */
export function supplyMargin(view: AgentView, persona: Persona | null = null): string | null {
  const player = view.player();
  if (player.depth === 0) return null;
  const stock = supplies(view);
  if (stock.food <= (player.depth === 1 ? 1 : 3) || hungry(view)) return "food";
  if (!stock.lastingLight && (!stock.workingLight || stock.fuel <= 1)) return "light and fuel";
  if (player.depth <= 2) {
    const reserve = Math.max(1, Math.ceil(2 * (1 - drive(persona))));
    return stock.cures < reserve && stock.phase < reserve ? "healing and Phase Door" : null;
  }
  if (stock.cures < (player.depth >= 10 ? 4 : player.depth >= 6 ? 2 : 1)) return "healing";
  if (player.depth >= 6 && stock.phase < 2) return "Phase Door";
  if (player.depth >= 10 && stock.escapes <= 2) return "long escapes";
  return null;
}
