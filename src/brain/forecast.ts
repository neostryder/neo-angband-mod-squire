import type { AgentView, MonsterView } from "../host-adapter.js";
import { key, steps, type Loc } from "../grid.js";
import { isWalkable, standingOnHarm } from "../map.js";
import type { Terrain } from "../terrain.js";
import { deviceFail, readPack } from "./pack.js";
import { shownName } from "../town/needs.js";
import { turnEnergy } from "../energy.js";
import { stateHash } from "./context.js";
import { attackOptions, targetHp, type AttackContext, type AttackOutcome, type HpRange } from "./combat-kit.js";
import { inLineOfFire, forecastExposure, type ExposureForecast, type ThreatFacts } from "./threat-model.js";

export type DamageLaw = readonly (readonly [number, number])[];

export interface ActionBinding {
  readonly frame: string;
  readonly goal: string;
  readonly target: number | null;
  readonly source: { readonly handle: number } | { readonly sidx: number } | null;
  readonly aim: Loc | null;
}

export interface TacticalAlternative {
  readonly meanLoss: number;
  readonly scenarioLoss: number;
  readonly after: number;
  readonly actions: number;
  readonly viable: boolean;
  readonly unknown: readonly string[];
  readonly blocker?: "resources" | "loss" | "status";
}

export function fightAlternative(fight: FightForecast): TacticalAlternative {
  return { meanLoss: fight.loss.mean, scenarioLoss: fight.loss.upper, after: fight.after, actions: fight.actions, viable: fight.viable, unknown: fight.unknown, ...(Number.isFinite(fight.commands.mean) && !fight.unknown.includes("blows") && !fight.unknown.includes("hp-prior") && fight.loss.mean >= fight.after + fight.loss.upper ? { blocker: "loss" as const } : fight.loss.status > 0 ? { blocker: "status" as const } : {}) };
}

export function escapeAlternative(escape: EscapeForecast, actions = 1): TacticalAlternative {
  return { meanLoss: escape.loss.mean, scenarioLoss: escape.loss.upper, after: escape.after, actions, viable: escape.viable, unknown: escape.loss.unknown };
}

export interface FightForecast {
  readonly action: ActionBinding;
  readonly hp: HpRange;
  readonly commands: { readonly low: number; readonly mean: number; readonly high: number };
  readonly actions: number;
  readonly loss: ExposureForecast;
  readonly after: number;
  readonly reserve: number;
  readonly viable: boolean;
  readonly resources: number;
  readonly limit: number;
  readonly complete: boolean;
  readonly unknown: readonly string[];
}

export interface EscapeForecast {
  readonly loss: ExposureForecast;
  readonly after: number;
  readonly viable: boolean;
  readonly escaped: boolean;
  readonly failure: number | null;
  readonly recontact: number;
  readonly complete: boolean;
}

export interface TacticalFrame {
  readonly view: AgentView;
  readonly context: AttackContext;
  readonly key: string;
  readonly one: ExposureForecast;
  readonly two: ExposureForecast;
  readonly fights: Map<string, FightForecast>;
}

export function tacticalKey(view: AgentView): string {
  return stateHash({ token: view.inputToken?.(), turn: view.turn(), floor: view.knownLevel?.()?.levelId,
    player: view.player(), monsters: view.monsters().filter((m) => m.visible), pack: view.inventory(), worn: view.equipment(), quiver: view.quiver?.() });
}

export function tacticalFrame(view: AgentView, context: AttackContext = {}): TacticalFrame {
  const facts = { ...context.facts, energy: context.facts?.energy ?? turnEnergy };
  return { view, context: { ...context, facts }, key: tacticalKey(view),
    one: forecastExposure(view, view.player().grid, 1, context.terrain, facts),
    two: forecastExposure(view, view.player().grid, 2, context.terrain, facts), fights: new Map() };
}

export function forecastContext(frame: TacticalFrame, alternatives: readonly { readonly goal: string; readonly action?: ActionBinding; readonly forecast?: TacticalAlternative }[], blocker: string): Readonly<Record<string, unknown>> {
  const number = (value: number) => Number.isFinite(value) ? Math.round(value * 10) / 10 : "unknown";
  const threats = frame.context.facts?.monsters ?? frame.view.monsters().filter((m) => m.visible);
  const ranked = [...threats].sort((a, b) => steps(a.grid, frame.view.player().grid) - steps(b.grid, frame.view.player().grid)).slice(0, 8).map((m) => ({ monster: m, exposure: forecastExposure(frame.view, frame.view.player().grid, 2, frame.context.terrain, { ...frame.context.facts, monsters: [m] }) }))
    .sort((a, b) => b.exposure.upper + b.exposure.status - a.exposure.upper - a.exposure.status || steps(a.monster.grid, frame.view.player().grid) - steps(b.monster.grid, frame.view.player().grid));
  const options = alternatives.filter((a) => a.forecast !== undefined).sort((a, b) => Number(b.forecast!.viable) - Number(a.forecast!.viable) || a.forecast!.actions - b.forecast!.actions);
  const selected: typeof options = [];
  for (const category of [["fight", "shoot", "throw_oil", "aim_wand", "cast_attack"], ["phase", "teleport", "cast_escape", "retreat", "break_sight", "leave_level"], ["heal", "cast_heal"]]) {
    const best = options.find((o) => category.includes(o.goal));
    if (best !== undefined) selected.push(best);
  }
  const pack = readPack(frame.view);
  const count = (items: readonly { readonly handle: number }[]) => {
    const handles = new Set(items.map((item) => item.handle));
    return frame.view.inventory().reduce((sum, item) => sum + (handles.has(item.handle) ? item.number : 0), 0);
  };
  return {
    pressure: `HP loss mean/scenario: 1a=${String(number(frame.one.mean))}/${String(number(frame.one.upper))} 2a=${String(number(frame.two.mean))}/${String(number(frame.two.upper))}; status=${String(frame.two.status)}; unknown=${frame.two.unknown.join(",") || "none"}`,
    threats: ranked.slice(0, 3).map(({ monster: m, exposure }) => {
      const hp = targetHp(m);
      const age = m.visible ? "" : ` age=${String(Math.max(0, frame.view.turn() - (frame.context.facts?.lastSeen?.get(m.id) ?? frame.view.turn())))}ticks`;
      return `m${String(m.id)} ${m.visible ? "seen" : "remembered"}${age} d${String(steps(m.grid, frame.view.player().grid))} HP~${String(number(hp.low))}..${String(number(hp.high))} speed${String(m.speed)} loss2=${String(number(exposure.upper))}`;
    }),
    omitted: Math.max(0, threats.length - 3),
    alternatives: selected.map((option) => {
      const f = option.forecast!;
      const source = option.action?.source;
      const binding = option.action === undefined ? "" : `:m${String(option.action.target ?? "-")}/${source === null || source === undefined ? "-" : "sidx" in source ? `s${String(source.sidx)}` : `i${String(source.handle)}`}`;
      return `${option.goal}${binding} a~${String(number(f.actions))} loss~${String(number(f.meanLoss))}/${String(number(f.scenarioLoss))} after~${String(number(f.after))} viable=${f.viable ? "yes" : "no"}`;
    }),
    reserves: `usable cure=${String(count(pack.heal))} phase=${String(count(pack.phase))} teleport=${String(count(pack.teleport))} escapeSpells=${String(pack.escapeSpell.length)}`,
    blocker,
    ...(() => {
      const evidence = [...(frame.context.facts?.observedDamage ?? [])].filter(([race]) => threats.some((m) => m.race === race)).slice(-1);
      return evidence.length === 0 ? {} : { evidence: evidence.map(([race, damage]) => `${race}: observed ${String(damage)} HP/action`).join("; ") };
    })(),
    interpretation: "a=100 energy; intervals and scenarios are estimates, not probabilities or absolute bounds",
  };
}

export function bindAttack(frame: TacticalFrame, target: MonsterView, attack: AttackOutcome): ActionBinding {
  const source = attack.source;
  return { frame: frame.key, goal: attack.kind, target: target.id,
    source: source === null ? null : "sidx" in source ? { sidx: source.sidx } : { handle: source.handle }, aim: { ...target.grid } };
}

function convolve(a: DamageLaw, b: DamageLaw): DamageLaw {
  const out = new Map<number, number>();
  for (const [x, p] of a) for (const [y, q] of b) out.set(x + y, (out.get(x + y) ?? 0) + p * q);
  return [...out];
}

function diceLaw(base: number, dice: number, sides: number, multiplier = 1): DamageLaw | null {
  if (dice < 0 || sides < 1 || dice * sides > 128) return null;
  let law: DamageLaw = [[base, 1]];
  for (let i = 0; i < dice; i++) law = convolve(law, Array.from({ length: sides }, (_, n) => [n + 1, 1 / sides] as const));
  return law.map(([x, p]) => [Math.max(0, Math.round(x * multiplier)), p]);
}

/** A zero-damage branch remains in the recurrence after a plausible killing hit. */
export function stationaryTtk(hp: number, law: DamageLaw): number {
  const zero = law.filter(([d]) => d === 0).reduce((sum, [, p]) => sum + p, 0);
  if (zero >= 1 - 1e-9) return Infinity;
  const damage = law.reduce((sum, [d, p]) => sum + d * p, 0);
  if (hp > 512) return hp / Math.max(1e-9, damage);
  const table = [0];
  for (let h = 1; h <= Math.ceil(hp); h++) {
    table[h] = (1 + law.reduce((sum, [d, p]) => d <= 0 ? sum : sum + p * table[Math.max(0, h - d)]!, 0)) / (1 - zero);
  }
  return table[Math.max(0, Math.ceil(hp))]!;
}

export function attackLaw(view: AgentView, attack: AttackOutcome): { law: DamageLaw; approximate: boolean } {
  if (attack.damage === null || attack.damage <= 0) return { law: [[0, 1]], approximate: true };
  const source = attack.source;
  let law: DamageLaw | null = null;
  let approximate = true;
  if (attack.kind === "throw_oil") { law = [[3, 0.25], [6, 0.25], [9, 0.25], [12, 0.25]]; approximate = false; }
  const text = source === null ? "" : "sidx" in source ? view.spellInfo?.(source.sidx)?.description ?? "" : source.name;
  const dice = /(?:(\d+)\+)?(\d+)d(\d+)/.exec(text);
  if (attack.kind === "cast_attack" && dice !== null) {
    law = diceLaw(Number(dice[1] ?? 0), Number(dice[2]), Number(dice[3]));
    approximate = false;
  }
  if (attack.kind === "fight" && view.player().blows >= 100) {
    const weapon = view.equipment().find((item) => item !== null && [6, 7, 8, 9].includes(item.tval));
    const name = weapon === undefined || weapon === null ? "" : shownName(weapon) ?? "";
    const weaponDice = /\((\d+)d(\d+)\)/.exec(name);
    const bonus = view.player().toDam + Number(/\([+-]?\d+,([+-]?\d+)\)/.exec(name)?.[1] ?? 0);
    const hit = weaponDice === null ? null : diceLaw(bonus, Number(weaponDice[1]), Number(weaponDice[2]));
    if (hit !== null) {
      const blowEnergy = Math.max(1, Math.trunc(10000 / view.player().blows));
      const count = Math.floor(100 / blowEnergy);
      law = [[0, 1]];
      const one: DamageLaw = [[0, attack.failure], ...hit.map(([d, p]) => [d, p * (1 - attack.failure)] as const)];
      for (let n = 0; n < count; n++) law = convolve(law, one);
      return { law, approximate: !attack.accuracyKnown };
    }
  }
  const perCommand = attack.kind === "shoot" ? attack.damage * 10 / Math.max(10, view.player().shots) : attack.damage;
  if (law === null) {
    const low = Math.floor(perCommand);
    law = low === perCommand ? [[low, 1]] : [[low, 1 - (perCommand - low)], [low + 1, perCommand - low]];
  }
  return { law: [[0, attack.failure], ...law.map(([d, p]) => [d, p * (1 - attack.failure)] as const)], approximate };
}

function resourceLimit(view: AgentView, attack: AttackOutcome): number {
  const source = attack.source;
  if (attack.kind === "fight") return Infinity;
  if (source === null) return 0;
  if ("sidx" in source) {
    const mana = view.spellInfo?.(source.sidx)?.mana ?? source.mana;
    return mana <= 0 ? Infinity : Math.max(0, Math.floor((view.player().sp - attack.manaReserve) / mana));
  }
  const item = [...view.inventory(), ...(view.quiver?.() ?? [])].find((item) => item.handle === source.handle);
  if (attack.kind === "aim_wand") return Number(/\((\d+) charges?\)/i.exec(source.name)?.[1] ?? 1);
  return Math.max(0, (item?.number ?? 0) - (attack.kind === "throw_oil" ? attack.fuelReserve : 0));
}

export function forecastFight(frame: TacticalFrame, target: MonsterView, attack: AttackOutcome): FightForecast {
  const action = bindAttack(frame, target, attack);
  const cacheKey = JSON.stringify([action.goal, action.target, action.source]);
  const prior = frame.fights.get(cacheKey);
  if (prior !== undefined) return prior;
  const view = frame.view;
  const hp = targetHp(target);
  const distribution = attackLaw(view, attack);
  const approach = attack.kind === "fight" ? Math.max(0, steps(view.player().grid, target.grid) - 1) : 0;
  const low = stationaryTtk(hp.low, distribution.law);
  const mean = stationaryTtk(hp.mean, distribution.law);
  const high = stationaryTtk(hp.high, distribution.law);
  const energy = (attack.energy ?? 100) / 100;
  const actions = approach + mean * energy;
  const horizon = Math.min(4, Math.max(energy, approach + high * energy));
  let loss = forecastExposure(view, view.player().grid, horizon, frame.context.terrain, frame.context.facts);
  const meanHorizon = Math.min(4, Math.max(energy, approach + mean * energy));
  if (meanHorizon !== horizon) loss = { ...loss, mean: forecastExposure(view, view.player().grid, meanHorizon, frame.context.terrain, frame.context.facts).mean };
  if (hp.exact && attack.minimum !== null && attack.minimum >= hp.high && attack.failure < 1) {
    const rest = forecastExposure(view, view.player().grid, Math.max(energy, Math.min(4, actions)), frame.context.terrain,
      { ...frame.context.facts, monsters: (frame.context.facts?.monsters ?? view.monsters().filter((m) => m.visible)).filter((m) => m.id !== target.id) });
    loss = { ...loss, mean: rest.mean + Math.max(0, frame.one.mean - rest.mean) * attack.failure / (1 - attack.failure) };
  }
  const tail = Number.isFinite(high) ? Math.max(0, approach + high * energy - horizon) : Infinity;
  const terminal = tail === 0 || frame.two.mean === 0 ? 0 : frame.two.mean / 2 * tail;
  const meanTail = Number.isFinite(mean) ? Math.max(0, approach + mean * energy - meanHorizon) : Infinity;
  const meanTerminal = meanTail === 0 || frame.two.mean === 0 ? 0 : frame.two.mean / 2 * meanTail;
  const upper = loss.upper + terminal * 1.5;
  const limit = resourceLimit(view, attack);
  const unknown = [...new Set([...loss.unknown, ...(hp.exact ? [] : [hp.prior ? "hp-prior" : "hp-spread"]), ...(attack.accuracyKnown ? [] : ["accuracy"]), ...(distribution.approximate ? ["damage-law"] : []), ...(attack.kind !== "fight" && view.projectionPath === undefined ? ["projection"] : []), ...(attack.kind === "cast_attack" ? ["spell-hit-save"] : []), ...(attack.kind === "aim_wand" && attack.source !== null && !/\(\d+ charges?\)/i.test(attack.source.name) ? ["device-charges"] : []), ...(tail > 0 ? ["terminal-tail"] : [])])];
  const reserve = Math.max(2, view.player().maxHp * 0.1);
  const remaining = (frame.context.facts?.monsters ?? view.monsters().filter((m) => m.visible)).filter((m) => m.id !== target.id);
  const escape = forecastExposure(view, view.player().grid, 2, frame.context.terrain, pursuitFacts(frame, remaining, Math.min(4, Number.isFinite(actions) ? actions : 4)));
  const after = view.player().hp - upper - escape.upper;
  const result: FightForecast = { action, hp, commands: { low, mean, high }, actions,
    loss: { ...loss, mean: loss.mean + meanTerminal, upper }, after, reserve,
    viable: after >= reserve && high <= limit && loss.status === 0 && !loss.unknown.includes("terrain-damage") && Number.isFinite(actions),
    resources: mean, limit, complete: tail === 0 && hp.high <= 512 && !distribution.approximate && unknown.length === 0, unknown };
  frame.fights.set(cacheKey, result);
  return result;
}

/** Pursuit advances along a walked escape; a sight break alone does not establish recovery. */
export function forecastWalk(frame: TacticalFrame, route: readonly Loc[], stair = false): EscapeForecast {
  const view = frame.view;
  const player = view.player();
  const monsters = frame.context.facts?.monsters ?? view.monsters().filter((m) => m.visible);
  let mean = 0;
  let upper = 0;
  let status = 0;
  let previous = player.grid;
  let valid = route.length > 0 && route.length <= 4;
  for (const [index, at] of route.slice(0, 4).entries()) {
    valid &&= steps(previous, at) === 1 && frame.context.terrain !== undefined && isWalkable(view, frame.context.terrain, at) && !standingOnHarm(view, frame.context.terrain, at);
    const exposure = forecastExposure(view, at, 1, frame.context.terrain, pursuitFacts(frame, monsters, index));
    mean += exposure.mean;
    upper += exposure.upper;
    status = Math.max(status, exposure.status);
    previous = at;
  }
  const tile = view.cell(previous.x, previous.y);
  const checkedStair = stair && tile !== null && frame.context.terrain !== undefined && (frame.context.terrain.isUpStair(tile.feat) || frame.context.terrain.isDownStair(tile.feat));
  const contact = forecastExposure(view, previous, checkedStair ? 1 : 2, frame.context.terrain, pursuitFacts(frame, monsters, route.length));
  if (checkedStair) { mean += contact.mean; upper += contact.upper; }
  const hidden = monsters.every((monster) => monster.raceFlags.includes("NEVER_MOVE") || !inLineOfFire(view, monster.grid, previous));
  const escaped = valid && (checkedStair || hidden && contact.upper === 0 && contact.status === 0);
  const loss = { mean, upper, status, unknown: escaped ? [] : ["pursuit"] };
  return { loss, after: player.hp - upper, viable: escaped && player.hp - upper >= Math.max(2, player.maxHp * 0.1) && status === 0,
    escaped, failure: valid ? 0 : 1, recontact: contact.upper, complete: valid && escaped };
}

function pursuitFacts(frame: TacticalFrame, monsters: readonly MonsterView[], actions: number): ThreatFacts {
  const energy = frame.context.facts?.energy ?? turnEnergy;
  const elapsed = Math.ceil(actions * 100 / energy(frame.view.player().speed));
  return { ...frame.context.facts, monsters: monsters.map((m) => ({ ...m, visible: false })),
    lastSeen: new Map(monsters.map((m) => [m.id, Math.min(frame.context.facts?.lastSeen?.get(m.id) ?? frame.view.turn(), frame.view.turn() - elapsed)])), energy };
}

/** Known landings are scenarios; unknown floor and monster energy keep teleport safety unresolved. */
export function forecastPhase(frame: TacticalFrame, failure: number | null = 0, long = false): EscapeForecast {
  const view = frame.view;
  const player = view.player();
  const candidates: Loc[] = [];
  const bounds = view.mapBounds();
  if (frame.context.terrain !== undefined) for (let y = Math.max(0, player.grid.y - 10); y < Math.min(bounds.height, player.grid.y + 11); y++) {
    for (let x = Math.max(0, player.grid.x - 10); x < Math.min(bounds.width, player.grid.x + 11); x++) {
      const at = { x, y };
      if (steps(player.grid, at) >= 5 && isWalkable(view, frame.context.terrain, at) && !standingOnHarm(view, frame.context.terrain, at) && !view.monsters().some((m) => key(m.grid) === key(at))) candidates.push(at);
    }
  }
  const sample = candidates.filter((_, index) => index % Math.max(1, Math.ceil(candidates.length / 16)) === 0).slice(0, 16);
  const exposures = sample.map((at) => forecastExposure(view, at, 2, frame.context.terrain, frame.context.facts));
  const landingMean = exposures.length === 0 ? frame.one.mean : exposures.reduce((sum, e) => sum + e.mean, 0) / exposures.length;
  const landingUpper = Math.max(player.maxHp * (long ? 0.05 : 0.1), ...exposures.map((e) => e.upper));
  const p = failure ?? 0.5;
  const upper = Math.max(landingUpper, p > 0 ? frame.one.upper : 0);
  return { loss: { mean: (1 - p) * landingMean + p * frame.one.mean, upper, status: p > 0 ? frame.one.status : 0, unknown: ["landing", ...(p > 0 ? frame.one.unknown : []), ...(failure === null ? ["escape-failure"] : [])] },
    after: player.hp - upper, viable: player.hp - upper >= Math.max(2, player.maxHp * 0.1) && !(p > 0 && frame.one.unknown.includes("terrain-damage")), escaped: false, failure, recontact: landingUpper, complete: false };
}

export interface HealForecast {
  readonly net: number;
  readonly kill: FightForecast | null;
  readonly escape: EscapeForecast;
  readonly after: number;
  readonly viable: boolean;
}

/** A cure must improve a following terminal action rather than merely survive its own turn. */
export function forecastHeal(frame: TacticalFrame, amount: number, failure = 0, mana = 0, curedStatus = frame.view.player().status): HealForecast {
  const player = frame.view.player();
  const healed = Math.min(player.maxHp, player.hp + amount);
  const curedView: AgentView = { ...frame.view, player: () => ({ ...player, status: curedStatus }) };
  const cureExposure = forecastExposure(curedView, player.grid, 1, frame.context.terrain, frame.context.facts);
  const after = healed - cureExposure.upper;
  const futureView: AgentView = { ...frame.view, player: () => ({ ...player, hp: Math.max(0, after), sp: Math.max(0, player.sp - mana), status: curedStatus }) };
  const futureContext = { ...frame.context, facts: pursuitFacts(frame, frame.context.facts?.monsters ?? frame.view.monsters().filter((m) => m.visible), 1) };
  const future = tacticalFrame(futureView, futureContext);
  const target = frame.view.monsters().find((m) => m.visible && !m.asleep);
  const kills = target === undefined ? [] : (["fight", "shoot", "throw_oil", "aim_wand", "cast_attack"] as const).flatMap((kind) =>
    attackOptions(futureView, target, kind, futureContext).map((attack) => forecastFight(future, target, attack)));
  const kill = kills.sort((a, b) => Number(b.viable) - Number(a.viable) || a.loss.upper - b.loss.upper || a.actions - b.actions)[0] ?? null;
  const pack = readPack(futureView);
  const escapes = [
    ...pack.phase.map(() => forecastPhase(future)),
    ...pack.teleport.map((item) => forecastPhase(future, /Staff/i.test(item.name) ? (deviceFail(futureView, item) ?? 50) / 100 : 0, true)),
    ...pack.escapeSpell.map((spell) => forecastPhase(future, (futureView.spellInfo?.(spell.sidx)?.failChance ?? spell.fail) / 100, !/Phase Door|Blink|Shadow Shift/i.test(spell.name))),
  ];
  const escape = escapes.sort((a, b) => Number(b.viable) - Number(a.viable) || b.after - a.after)[0] ?? { ...forecastPhase(future, 1), viable: false };
  return { net: healed - player.hp - cureExposure.mean, kill, escape, after,
    viable: after > 0 && !cureExposure.unknown.includes("terrain-damage") && (failure === 0 || player.hp > frame.one.upper) && (kill?.viable === true || escape.viable && (readPack(futureView).phase.length > 0 || readPack(futureView).teleport.length > 0 || readPack(futureView).escapeSpell.length > 0)) };
}
