/** Preparation uses reported abilities and named supplies, never unidentified item effects. */

import type { AgentView, ItemView } from "../host-adapter.js";
import { canRead, detectionSources, hungry, readPack } from "../brain/pack.js";
import { shownName } from "../town/needs.js";
import { TV } from "../gear/compare.js";
import type { Persona } from "../persona/persona.js";
import { drive } from "./pursuits.js";
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
  readonly lightTurns: number;
  readonly flasks: number;
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
  const inventory = view.inventory();
  view = { ...view, inventory: () => inventory };
  const player = view.player();
  const light = view.equipment().find((item) => item !== null && item.tval === TV.LIGHT) ?? null;
  const permanent = light !== null && (light.artifact || light.flags.includes("NO_FUEL"));
  const lightTurns = light?.timeout ?? 0;
  const workingLight = light !== null && (lightTurns > 0 || permanent);
  /* A lantern refills from flasks of oil; a torch is replaced by a spare torch. */
  const lantern = light !== null && /\bLantern\b/i.test(shownName(light) ?? "");
  const pack = readPack(view);
  const reliable = pack.escapeSpell.filter((spell) => spell.fail <= RELIABLE_FAIL);
  const lastingLight = player.classFlags.includes("UNLIGHT") || player.objectFlags.includes("NO_FUEL") || permanent ||
    light === null && player.light > 0 && player.objectFlags.some((flag) => flag === "LIGHT_2" || flag === "LIGHT_3");
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
    lightTurns,
    flasks: inventory.reduce((sum, item) => sum + (item.tval === TV_FLASK ? item.number : 0), 0),
  };
}

/**
 * Current fuel can cover a shallow trip without a spare torch or oil flask.
 * Escapes are not trips: a staircase taken to survive is never held back by it.
 */
export function tripLight(view: AgentView, persona: Persona | null = null): boolean {
  const stock = supplies(view);
  return stock.lastingLight || stock.workingLight && (stock.fuel >= descentPolicy(persona).reserve ||
    view.player().depth < 5 && stock.lightTurns >= lightBudget(persona));
}

export function lightBudget(persona: Persona | null): number {
  return Math.ceil(500 * descentPolicy(persona).scale);
}

export interface Requirement {
  readonly kind: "level" | "hp" | "light" | "food" | "healing" | "phase" | "recall" | "protection";
  readonly reason: string;
  /** Immediate survival and deeper preparation retain their guard during ordinary readiness answers. */
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

/** Preparation and tempo share the same appetite so optional gates cannot restore a universal floor. */
export function descentPolicy(persona: Persona | null) {
  const s = persona?.sliders;
  const quirk = (name: "cowardice" | "forgetful" | "delusional" | "deathwish") => persona?.quirks[name].on === true ? persona.quirks[name].strength / 100 : 0;
  const appetite = Math.max(0, Math.min(1, 0.5 +
    0.003 * ((s?.ambition ?? 70) - 70) + 0.002 * ((s?.boldness ?? 65) - 65) +
    0.0025 * ((s?.impulsiveness ?? 50) - 50) - 0.002 * ((s?.selfpreservation ?? 55) - 55) -
    0.0015 * ((s?.patience ?? 50) - 50) - 0.001 * ((s?.paranoia ?? 50) - 50) -
    0.001 * ((s?.escapes ?? 50) - 50) - 0.001 * ((s?.levelfeel ?? 50) - 50) + 0.001 * ((s?.optimism ?? 50) - 50) -
    0.001 * ((s?.towntrips ?? 35) - 35) +
    0.25 * quirk("forgetful") + 0.15 * quirk("delusional") + 0.5 * quirk("deathwish") - 0.5 * quirk("cowardice")));
  return { appetite, scale: 1.5 - appetite, hpShare: 0.95 - 0.3 * appetite, recoveryShare: Math.min(1, 1.25 - 0.5 * appetite),
    reserve: Math.round(2 * (1 - appetite)), food: Math.round(4 * (1 - appetite)),
    risk: 0.1 + 0.7 * appetite, trainMinutes: 4 * (1 - appetite) ** 2,
    reversals: Math.round(1 + 4 * appetite), refreshes: Math.round(1 + 4 * (1 - appetite)) };
}

/** The default kit supports DL2 at level 1 and about 10 HP; later depths ask for growing capacity. */
function classFloor(cls: string, depth: number, persona: Persona | null): readonly [number, number] {
  const policy = descentPolicy(persona);
  const martial = ["Warrior", "Blackguard", "Paladin", "Ranger"].includes(cls);
  const scale = policy.scale;
  if (depth > 10) {
    const hp = martial || ["Rogue", "Priest", "Druid"].includes(cls) ? 60 : 80;
    const level = martial ? 6 : cls === "Rogue" ? 10 : 15;
    return [Math.ceil(hp * scale), Math.ceil(Math.max(depth, level) * scale)];
  }
  const caution = Math.max(0, 0.5 - policy.appetite);
  return [Math.ceil((10 + (depth - 2) * (martial ? 6 : 5) + 24 * caution) * scale),
    Math.max(1, Math.ceil((depth - 2) * 0.65 * scale + caution * 4))];
}

export function descentWait(persona: Persona | null): number {
  return descentPolicy(persona).trainMinutes;
}

export interface PreparationSource {
  readonly satisfiable: boolean;
  readonly why: string;
}

export interface DescentContext {
  readonly minutes: number;
  readonly turns: number;
  readonly overdue: boolean;
  readonly sources: Partial<Record<Requirement["kind"], PreparationSource>>;
}

/** Waiting for unavailable preparation spends the persona's patience, even while XP or loot grows. */
export function assessDescent(view: AgentView, depth: number, persona: Persona | null, context: DescentContext) {
  const policy = descentPolicy(persona);
  const player = view.player();
  const stock = supplies(view);
  const minutes = Math.max(context.minutes, context.turns / 600);
  const restlessness = minutes / (1 + 4 * (1 - policy.appetite) ** 2);
  const normal = missingPreparation(view, depth, persona, context.minutes);
  const checks = shallowDiveChecks(view, persona);
  const train = checks.ranged || policy.appetite > 0.85 || context.minutes >= policy.trainMinutes;
  const levers = "ambition,boldness,impulsiveness,patience,selfpreservation,paranoia,escapes,levelfeel,optimism,towntrips,quirks";
  const rows = [
    { name: "level", kind: "level", value: player.maxLevel, threshold: checks.levelFloor + (train ? 0 : Math.ceil(2 * policy.scale)) },
    { name: "maxHp", kind: "hp", value: player.maxHp, threshold: Math.ceil(checks.maxHpFloor * (train ? 1 : 1.25)) },
    { name: "light", kind: "light", value: stock.lastingLight || stock.workingLight && stock.fuel >= policy.reserve ? lightBudget(persona) : stock.lightTurns, threshold: lightBudget(persona) },
    { name: "food", kind: "food", value: hungry(view) ? 0 : stock.food, threshold: policy.food },
    { name: "healing", kind: "healing", value: stock.cures, threshold: policy.reserve },
    { name: "escapes", kind: "phase", value: canRead(view) || reliableEscapeSpell(view) ? stock.phase + stock.escapes : 0, threshold: policy.reserve },
    { name: "ranged", kind: "protection", value: checks.ranged || !["Mage", "Necromancer"].includes(player.cls) || player.maxLevel >= 8 * policy.scale || policy.appetite > 0.85 ? 1 : 0, threshold: 1 },
  ] as const;
  const requirements = rows.map((row) => {
    const source = context.sources[row.kind] ?? { satisfiable: false, why: "no checked source on this level" };
    const relaxation = depth <= 10 ? context.overdue ? 1 : Math.min(1, restlessness * (source.satisfiable ? 0.35 : 1)) : 0;
    const effective = row.threshold * (1 - relaxation);
    return { ...row, effective, levers, ...source, met: row.value >= row.threshold, accepted: row.value >= effective };
  });
  const remaining = depth <= 10 ? normal.filter((gap) => {
    if (gap.reason === "clear status before a planned descent") return true;
    return !requirements.some((row) => row.kind === gap.kind && row.accepted);
  }) : normal;
  const light = requirements.find((row) => row.name === "light")!;
  if (depth <= 10 && !light.accepted && !remaining.some((gap) => gap.kind === "light")) remaining.push({ kind: "light", reason: "light for the trip" });
  const hard = remaining.filter((gap) => HARD_GAPS.has(gap.kind) || gap.severe === true);
  const statusClear = [player.status.poisoned, player.status.cut, player.status.blind, player.status.confused, player.status.afraid, player.status.stun].every((value) => value === 0);
  const immediate = [
    { name: "currentHp", value: player.hp, threshold: player.maxHp * policy.hpShare, levers, satisfiable: true, why: "safe recovery can restore current HP; route safety is checked separately", met: player.hp >= player.maxHp * policy.hpShare, accepted: player.hp >= player.maxHp * policy.hpShare },
    { name: "statusClear", value: Number(statusClear), threshold: 1, levers: "immediate survival", satisfiable: true, why: "recovery or a usable cure must clear harmful status", met: statusClear, accepted: statusClear },
  ];
  return { hard, soft: remaining.filter((gap) => !hard.includes(gap)), requirements: [...requirements, ...immediate], restlessness,
    override: depth <= 10 && context.overdue, relaxed: requirements.some((row) => !row.met && row.accepted) };
}

export function earlyDescentReady(view: AgentView, reserves = 2, hpFraction = 1): boolean {
  const player = view.player();
  const pack = readPack(view);
  const caster = ["Mage", "Necromancer"].includes(player.cls);
  return player.hp >= player.maxHp * hpFraction && player.status.poisoned === 0 && player.status.cut === 0 &&
    player.status.blind === 0 && player.status.confused === 0 && player.status.afraid === 0 &&
    (!caster || pack.oil.length > 0 || pack.attackWand.length > 0 || pack.attackSpell.length > 0 || pack.launcher && pack.ammo.length > 0) &&
    supplies(view).cures + escapeItems(view) >= reserves;
}

export function shallowDiveChecks(view: AgentView, persona: Persona | null = null) {
  const player = view.player();
  const pack = readPack(view);
  const stock = supplies(view);
  const policy = descentPolicy(persona);
  const [maxHpFloor, levelFloor] = classFloor(player.cls, player.depth + 1, persona);
  const ranged = pack.oil.length > 0 || pack.attackWand.length > 0 || pack.attackSpell.length > 0 || pack.launcher && pack.ammo.length > 0;
  return {
    ranged, fullHp: player.hp === player.maxHp, hpReady: player.hp >= player.maxHp * policy.hpShare,
    casterAttack: ranged || !["Mage", "Necromancer"].includes(player.cls) || policy.appetite > 0.85,
    reserves: stock.cures + stock.phase + stock.escapes, levelFloor, maxHpFloor,
    tripLight: tripLight(view, persona), food: stock.food, hungry: hungry(view),
    statusReady: earlyDescentReady(view, 0, policy.hpShare),
    arrivalSupplies: stock.cures >= policy.reserve && stock.phase + stock.escapes >= policy.reserve &&
      (policy.reserve === 0 || canRead(view) || reliableEscapeSpell(view)),
  };
}

export function shallowDiveReady(view: AgentView, depth = view.player().depth + 1, persona: Persona | null = null): boolean {
  const player = view.player();
  if (player.depth < 1 || depth > 10 || depth !== player.depth + 1) return false;
  const checks = shallowDiveChecks(view, persona);
  return checks.ranged && checks.hpReady && missingPreparation(view, depth, persona).length === 0;
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
  const policy = descentPolicy(persona);
  const caster = ["Mage", "Necromancer"].includes(player.cls);
  const pack = readPack(view);
  const ranged = pack.oil.length > 0 || pack.attackWand.length > 0 || pack.attackSpell.length > 0 || pack.launcher && pack.ammo.length > 0;
  const equipped = ranged || policy.appetite > 0.85;
  const train = depth > 10 || equipped || depthMinutes >= policy.trainMinutes;
  const hpFloor = Math.ceil(classHp * (train ? 1 : 1.25));
  const levelFloor = classLevel + (train ? 0 : Math.ceil(2 * policy.scale));
  need("level", level >= levelFloor || level >= 50, `maximum character level ${String(levelFloor)}`, true);
  need("hp", player.maxHp >= hpFloor, `${String(hpFloor)} maximum hit points`, true);
  need("protection", [player.status.poisoned, player.status.cut, player.status.blind, player.status.confused, player.status.afraid, player.status.stun].every((value) => value === 0), "clear status before a planned descent", true);
  need("light", stock.workingLight || stock.lastingLight, "working light");
  need("food", stock.food >= policy.food && !hungry(view), `${String(policy.food)} food units and no hunger`);
  if (depth <= 10 || level < 30) need("healing", stock.cures >= policy.reserve, `${String(policy.reserve)} healing potion${policy.reserve === 1 ? "" : "s"}`);
  need("phase", stock.phase + stock.escapes >= policy.reserve && (policy.reserve === 0 || canRead(view) || reliableEscapeSpell(view)), `${String(policy.reserve)} usable escape${policy.reserve === 1 ? "" : "s"}`);
  need("protection", !caster || ranged || level >= 8 * policy.scale || policy.appetite > 0.85, "an affordable ranged attack", true);
  if (depth > 10) {
    need("recall", stock.recall >= Math.round(policy.scale) && canRead(view), "usable Word of Recall");
    need("phase", stock.escapes >= Math.ceil((depth > 25 ? 6 : 2) * policy.scale) && canRead(view), "long escapes for the persona's reserve");
    if (level < 30) need("healing", depth > 25 ? stock.serious >= Math.ceil(10 * policy.scale) : stock.critical >= Math.ceil(3 * policy.scale), "strong cures for the persona's reserve");
    const detectsInvisible = detectionSources(view).some((source) => {
      if (!/^(Detection|Reveal Monsters)$|Rods? of Detection/i.test(source.name) || /charging/i.test(source.name)) return false;
      return source.kind !== "cast" || view.spellbooks().some((book) => book.spells.some((spell) => spell.sidx === source.sidx && spell.fail <= 15));
    });
    need("protection", policy.appetite > 0.85 || player.objectFlags.includes("SEE_INVIS") || player.objectFlags.includes("TELEPATHY") || detectsInvisible, "See Invisible, telepathy or usable detection of invisible creatures");
  }
  const preparationDepth = depth * policy.scale;
  if (preparationDepth >= 20) need("protection", player.objectFlags.includes("FREE_ACT"), "Free Action");
  if (preparationDepth > 20) {
    /* Only known equipped resistance is evidence; an item's raw hidden resists are not. */
    const inspect = view as AgentView & { inspectItem?: (handle: number) => { readonly text: string } | null };
    const texts = view.equipment().flatMap((item) => item === null ? [] : [inspect.inspectItem?.(item.handle)?.text ?? ""]);
    const has = (element: string) => texts.some((text) => [...text.matchAll(/Provides (?:(?:resistance|immunity) to|protection from) ([^.\n]+)/gi)].some((line) => new RegExp(`\\b${element}\\b`, "i").test(line[1] ?? "")));
    /* Race, class and known worn flags count as well as item text: a Dwarf is never blinded. */
    const protects = (element: string, flag: string) => has(element) || player.objectFlags.includes(flag);
    const basics = ["acid", "lightning", "fire", "cold"].filter(has);
    need("protection", has("fire") && basics.length >= (preparationDepth > 25 ? 4 : 3), depth > 25 ? "all four basic resistances" : "fire resistance and two other basic resistances");
    need("protection", player.stats.length >= 5 && [0, 3, 4, ...(caster ? [1] : ["Priest", "Druid", "Paladin"].includes(player.cls) ? [2] : [])].every((index) => (player.stats[index] ?? 0) >= Math.ceil(7 * policy.scale)), `Strength, Dexterity, Constitution and the casting stat at least ${String(Math.ceil(7 * policy.scale))}`);
    if (preparationDepth >= 40) need("protection", has("poison") && protects("confusion", "PROT_CONF"), "poison and confusion resistance");
    if (preparationDepth >= 56) need("protection", protects("blindness", "PROT_BLIND"), "blindness resistance");
    if (preparationDepth >= 60) need("protection", has("chaos") && has("disenchantment"), "chaos and disenchantment resistance");
  }
  if (preparationDepth >= 46) {
    need("hp", player.maxHp >= Math.ceil(500 * policy.scale), `${String(Math.ceil(500 * policy.scale))} maximum hit points`);
    const speed = Math.ceil((preparationDepth >= 81 ? 20 : preparationDepth >= 60 ? 10 : 5) * policy.scale);
    need("protection", player.speed >= 110 + speed, `+${String(speed)} speed`);
    need("healing", namedCount(view, /\bPotions? of (\*?Healing\*?|Life)\b/i) > 0, "large healing");
    if (level < 50) need("protection", player.objectFlags.includes("HOLD_LIFE"), "Hold Life before maximum character level 50");
  }
  if (preparationDepth >= 56) {
    need("protection", player.objectFlags.includes("TELEPATHY"), "telepathy");
    need("healing", namedCount(view, /\bPotions? of Healing\b/i) >= Math.ceil(2 * policy.scale) || namedCount(view, /\bPotions? of (\*Healing\*|Life)/i) >= Math.round(policy.scale), "two Healing potions or one *Healing* or Life potion");
  }
  if (depth >= 100) {
    need("healing", namedCount(view, /\bPotions? of Healing\b/i) >= Math.ceil(5 * policy.scale), `${String(Math.ceil(5 * policy.scale))} Healing potions`);
    need("healing", namedCount(view, /\bPotions? of (\*Healing\*|Life)/i) >= Math.ceil(15 * policy.scale), `${String(Math.ceil(15 * policy.scale))} *Healing* or Life potions`);
    need("protection", namedCount(view, /\bPotions? of Speed\b/i) >= Math.ceil(10 * policy.scale), `${String(Math.ceil(10 * policy.scale))} Speed potions`);
    if (player.maxSp > 100) need("healing", namedCount(view, /\bPotions? of Restore Mana\b/i) >= Math.ceil(15 * policy.scale), `${String(Math.ceil(15 * policy.scale))} Restore Mana potions`);
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
  const urgency = descentPolicy(persona).appetite;
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

/** Town preparation keeps the persona's reserve preference when the trip begins. */
export function missingEssentials(view: AgentView, persona: Persona | null = null): Requirement[] {
  const stock = supplies(view);
  const { healing: cures, phase, food, light: fuel } = basketWants(persona);
  const out: Requirement[] = [];
  if (stock.cures < cures) out.push({ kind: "healing", reason: `${countWord(cures)} healing potion${cures === 1 ? "" : "s"}` });
  if (phase > 0 && (stock.phase < phase || !canRead(view))) out.push({ kind: "phase", reason: `${countWord(phase)} usable Phase Door${phase === 1 ? "" : "s"}` });
  if (stock.food < food) out.push({ kind: "food", reason: `${countWord(food)} food units` });
  if (!stock.lastingLight && (!stock.workingLight || stock.fuel < fuel)) out.push({ kind: "light", reason: `working light and ${countWord(fuel)} fuel unit${fuel === 1 ? "" : "s"}` });
  return out;
}

/** The default town basket asks for two of each essential; careless personas can leave with less. */
export function basketWants(persona: Persona | null): { readonly healing: number; readonly phase: number; readonly food: number; readonly light: number } {
  const policy = descentPolicy(persona);
  const count = Math.ceil(3 * (1 - policy.appetite));
  return { healing: count, phase: count, food: Math.max(count, policy.food), light: count };
}

function countWord(n: number): string {
  return ["no", "one", "two", "three", "four"][n] ?? String(n);
}

/**
 * The return starts above the lower stay-on-level floor, leaving supplies for the route.
 *
 * The first two levels tolerate spending individual potions or scrolls.
 * A persona that requires a reserve turns back before its next unsupported fight.
 */
export function supplyMargin(view: AgentView, persona: Persona | null = null): string | null {
  const player = view.player();
  if (player.depth === 0) return null;
  const stock = supplies(view);
  const policy = descentPolicy(persona);
  if (player.depth <= 10) {
    if (stock.food < policy.food || hungry(view)) return "food";
    if (!tripLight(view, persona)) return "light and fuel";
    if (player.depth <= 2) return stock.cures < policy.reserve || stock.phase + stock.escapes < policy.reserve ? "healing and Phase Door" : null;
    if (stock.cures < policy.reserve) return "healing";
    return stock.phase + stock.escapes < policy.reserve ? "Phase Door" : null;
  }
  if (stock.food <= Math.round((player.depth === 1 ? 1 : 3) * policy.scale) || hungry(view)) return "food";
  if (!stock.lastingLight && (!stock.workingLight || stock.fuel <= policy.reserve)) return "light and fuel";
  if (player.depth <= 2) {
    const reserve = policy.reserve;
    return stock.cures < reserve || stock.phase + stock.escapes < reserve ? "healing and Phase Door" : null;
  }
  if (stock.cures < Math.round((player.depth >= 10 ? 3 : player.depth >= 6 ? 2 : 1) * policy.scale)) return "healing";
  if (player.depth >= 6 && stock.phase < policy.reserve) return "Phase Door";
  if (player.depth >= 10 && stock.escapes < Math.round(2 * policy.scale)) return "long escapes";
  return null;
}
