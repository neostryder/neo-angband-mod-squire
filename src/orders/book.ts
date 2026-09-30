/**
 * The squire's book of orders and standing instructions.
 *
 * It owns their life cycle (given, followed, done, abandoned, forgotten,
 * retired), sorts them, recomputes adherence at review points, fades memory,
 * prunes past the number the player allows, and answers the planner's
 * questions: the state lines, the weight on each option, and which options may
 * pass the death-risk ceiling.
 */

import type { AgentView } from "@rpgm-tools/neo-angband-core";
import type { AskResult, Backend } from "../brain/backend.js";
import type { Answer, ChoiceQuestion, SystemOneRequest } from "../brain/systemone.js";
import type { Tally } from "../brain/tally.js";
import { applyDrift } from "../persona/drift.js";
import { defaultPersona, type Persona } from "../persona/persona.js";
import { candidateAims, type Aim } from "../strategy/aims.js";
import { reviewDue, type ReviewMemory } from "../strategy/review.js";
import { GIVE_UP_REVIEWS, PASS_ADHERENCE, goalsOf, nextAdherence, stanceOf, weigh } from "./adherence.js";
import { FAINT, FORGET_BELOW, REMEMBERED_AT, comesBack, fade, isForgotten, refreshed } from "./memory.js";
import { NONE, sortByCode, sortInstruction, type SortDeps } from "./sort.js";
import { MAX_TEXT, MAX_VIEWER, isLive, type Instruction, type InstructionKind, type InstructionSource, type Sorted } from "./types.js";

/** What the book keeps between sessions. */
export interface OrdersState {
  readonly items: readonly Instruction[];
}

export interface OrdersDeps extends SortDeps {
  persona(): Persona | null;
  setPersona(persona: Persona): void;
  /** How many live instructions the squire holds before it drops one. */
  kept(): number;
  /** A journal line. `notable` puts it in the Chronicle as well. */
  note(text: string, notable: boolean, turn: number, depth: number): void;
  log(message: string): void;
  save(state: OrdersState): void;
  rng?: () => number;
}

export type GiveResult =
  | { readonly ok: true; readonly instruction: Instruction; readonly repeated: boolean }
  | { readonly ok: false; readonly problem: string };

export interface GiveOptions {
  readonly kind?: InstructionKind;
  readonly familyCreed?: boolean;
  /** The chat viewer who gave it, kept so the Orders tab and journal can name them. */
  readonly viewer?: string;
}

export interface Correction {
  readonly kind?: InstructionKind;
  readonly familyCreed?: boolean;
  readonly sorted?: Partial<Sorted>;
}

export interface Orders {
  /** Every instruction, live and ended, newest last. */
  list(): readonly Instruction[];
  /** The ones that still reach the decision state. */
  live(): readonly Instruction[];
  give(text: string, source: InstructionSource, options?: GiveOptions): GiveResult;
  /** End an instruction for the player: an order is abandoned, a standing instruction is done. */
  retire(id: string): boolean;
  correct(id: string, patch: Correction): boolean;
  /** Standing instructions marked as family creeds, for the heir. */
  creeds(): readonly Instruction[];
  /** Take on creeds inherited from a parent. */
  adopt(creeds: readonly Instruction[], turn: number): void;
  /** Look at the game every turn: fade memory, test orders, remember, review. */
  observe(view: AgentView): void;
  /** The planner picked this goal. */
  decided(goal: string, view: AgentView): void;
  /** Lines for the decision state, or null when nothing applies. */
  note(view: AgentView, gold?: number): string | null;
  /** One typed question per instruction that applies, over the offered options. */
  ask(offers: readonly { readonly goal: string; readonly criteria: string }[], view: AgentView): Record<string, ChoiceQuestion>;
  /** Weigh the options by every applicable instruction, beside the persona weights. */
  weigh(dist: Readonly<Record<string, number>>, answers: Readonly<Record<string, Answer>>, view: AgentView): Record<string, number>;
  /** Options an order calls for at an adherence high enough to pass the death-risk ceiling. */
  passes(view: AgentView): ReadonlySet<string>;
  /** Aims with those an order names moved to the front. */
  promote(aims: readonly Aim[]): readonly Aim[];
  state(): OrdersState;
  load(state: OrdersState): void;
  /** Forget every instruction, for a new character. */
  reset(): void;
  /** Resolves when no sorting or pruning request is in flight. */
  settled(): Promise<void>;
}

/** How many ended instructions are kept for the panel. */
const KEEP_ENDED = 20;
/** Most instructions put to the model in one decision. */
const ASKED = 3;
/** Game turns between two journal lines for the same instruction acting. */
const NOTE_GAP = 500;
/** Resentment a disliked order leaves behind when it is done. */
const RESENT_STEP = 5;
/** Gratitude a liked order leaves behind when it is done, and a followed disliked one. */
const THANKS = 3;
const GRUDGING_THANKS = 2;
const HALF_HP = 0.5;

const STANCE_WORDS: Readonly<Record<string, string>> = {
  following: "You intend to follow it.",
  grudgingly: "You intend to follow it grudgingly.",
  ignoring: "You mean to ignore it.",
};

function normal(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function short(text: string): string {
  const one = text.trim().replace(/\s+/g, " ");
  return one.length > 90 ? `${one.slice(0, 87)}...` : one;
}

function noun(kind: InstructionKind): string {
  return kind === "order" ? "order" : "standing instruction";
}

export function createOrders(deps: OrdersDeps): Orders {
  const rng = deps.rng ?? Math.random;
  let items: Instruction[] = [];
  let counter = 0;
  let lastTurn = 0;
  let lastDepth = 0;
  let review: ReviewMemory | null = null;
  /* Set on arrival and cleared when the planner next decides, so a "new level" trigger applies to one decision. */
  let arrived = false;
  let generation = 0;
  let inFlight: Promise<void> = Promise.resolve();
  const corrected = new Set<string>();
  const explicit = new Set<string>();
  const rolled = new Set<string>();
  const notedAt = new Map<string, number>();
  let asked: string[] = [];

  const persona = (): Persona => deps.persona() ?? defaultPersona();

  function persist(): void {
    const ended = items.filter((i) => !isLive(i.state));
    const drop = new Set(ended.slice(0, Math.max(0, ended.length - KEEP_ENDED)).map((i) => i.id));
    if (drop.size > 0) items = items.filter((i) => !drop.has(i.id));
    deps.save({ items });
  }

  function say(text: string, notable: boolean): void {
    deps.log(text);
    deps.note(text, notable, lastTurn, lastDepth);
  }

  function replace(id: string, patch: Partial<Instruction>): Instruction | undefined {
    const at = items.findIndex((i) => i.id === id);
    if (at < 0) return undefined;
    const next = { ...items[at]!, ...patch };
    items = [...items.slice(0, at), next, ...items.slice(at + 1)];
    return next;
  }

  function restance(i: Instruction, previous: number | null): Instruction {
    const p = persona();
    const adherence = nextAdherence(previous, i.sorted, p);
    return { ...i, adherence, state: stanceOf(adherence, i.sorted, p) };
  }

  function triggerActive(i: Instruction, view: AgentView): boolean {
    const p = view.player();
    switch (i.sorted.trigger) {
      case "always": return true;
      case "unique": return view.monsters().some((m) => m.visible && m.raceFlags.includes("UNIQUE"));
      case "low-hp": return p.maxHp > 0 && p.hp <= p.maxHp * HALF_HP;
      case "new-level": return arrived;
      case "in-store": return p.depth === 0;
    }
  }

  function applicable(view: AgentView): Instruction[] {
    return items.filter((i) => isLive(i.state) && i.memory >= FORGET_BELOW && triggerActive(i, view));
  }

  function finish(i: Instruction, state: "done" | "abandoned" | "forgotten", why: string): void {
    const was = i;
    const next = replace(i.id, { state, memory: state === "forgotten" && i.kind === "standing" ? FAINT : i.memory });
    if (next === undefined) return;
    if (state === "done") {
      say(`${why} ${short(was.text)}`, true);
      if (was.kind === "order") answerPatron(was);
    } else if (state === "forgotten") {
      say(`Forgot the ${noun(was.kind)}: ${short(was.text)}`, true);
    } else {
      say(`${why} ${short(was.text)}`, false);
    }
    persist();
  }

  /**
   * A disliked order that is done builds Resentment, and Gratitude too when the
   * squire followed it after all, for the patron's thanks. A liked order that
   * is done counts as a blessing: it builds Devotion and Gratitude.
   */
  function answerPatron(i: Instruction): void {
    const p = deps.persona();
    if (p === null) return;
    const grateful = (persona: Persona, step: number): Persona => ({ ...persona, sliders: { ...persona.sliders, gratitude: Math.min(100, persona.sliders.gratitude + step) } });
    if (i.disliked) {
      let next: Persona = { ...p, sliders: { ...p.sliders, resentment: Math.min(100, p.sliders.resentment + RESENT_STEP) } };
      if (i.state === "grudgingly") next = grateful(next, GRUDGING_THANKS);
      if (next.sliders.resentment !== p.sliders.resentment || next.sliders.gratitude !== p.sliders.gratitude) deps.setPersona(next);
      return;
    }
    const drift = applyDrift(p, "patron-blessing", rng);
    const next = grateful(drift.persona, THANKS);
    if (drift.changes.length > 0 || next.sliders.gratitude !== p.sliders.gratitude) deps.setPersona(next);
  }

  function complete(view: AgentView, i: Instruction): string | null {
    const s = i.sorted;
    const p = view.player();
    if (s.frequency.mode === "once" && i.acted >= 1) return "Instruction done:";
    if (s.frequency.mode === "until-level" && p.level >= s.frequency.level) return `Reached level ${String(s.frequency.level)}, so the instruction lapsed:`;
    if (i.kind !== "order") return null;
    if (s.aim === "depth" && s.depth !== null && p.maxDepth >= s.depth) return "Order done:";
    if (s.aim === "gold" && s.gold !== null && p.gold >= s.gold) return "Order done:";
    if (s.aim === "item" && s.item !== null) {
      const stem = (t: string): string => t.toLowerCase().replace(/\b(\w+?)e?s\b/g, "$1");
      const want = stem(s.item);
      const held = view.inventory().filter((it) => stem(it.label).includes(want)).reduce((n, it) => n + it.number, 0);
      if (held >= s.count) return "Order done:";
    }
    return null;
  }

  function reviewNow(view: AgentView): void {
    const p = view.player();
    let aims: readonly Aim[] | null = null;
    for (const i of items.filter((x) => isLive(x.state))) {
      let now = restance(items.find((x) => x.id === i.id) ?? i, i.adherence);
      now = { ...now, lowReviews: now.state === "ignoring" ? now.lowReviews + 1 : 0, disliked: now.state !== "following" };
      replace(i.id, now);
      if (i.kind === "order" && i.sorted.deadlineLevel !== null && p.level >= i.sorted.deadlineLevel && complete(view, i) === null) {
        finish(now, "abandoned", "Order dropped, out of time:");
        continue;
      }
      let done = complete(view, now);
      if (done === null && i.kind === "order" && (i.sorted.aim === "armour" || i.sorted.aim === "weapon" || i.sorted.aim === "spellbook" || i.sorted.aim === "lantern")) {
        aims ??= candidateAims(view);
        const kind = i.sorted.aim;
        if (!aims.some((a) => a.kind === kind)) done = "Order done:";
      }
      if (done !== null) {
        finish(now, "done", done);
        continue;
      }
      if (now.kind === "order" && now.lowReviews >= GIVE_UP_REVIEWS) finish(now, "abandoned", "Order dropped, never followed:");
    }
    persist();
  }

  async function prune(mine: number): Promise<void> {
    while (mine === generation) {
      const live = items.filter((i) => isLive(i.state));
      if (live.length <= Math.max(1, Math.floor(deps.kept()))) return;
      const fallback = [...live].sort((a, b) => a.adherence * a.memory - b.adherence * b.memory || a.createdTurn - b.createdTurn)[0]!;
      let target = fallback;
      const backend: Backend | null = deps.backend();
      if (backend !== null && deps.tally.overCap(backend, deps.now()) === null) {
        const criteria: Record<string, string | null> = {};
        for (const i of live) criteria[i.id] = `${short(i.text)} (it is ${i.state})`;
        criteria[NONE] = "None of these stands out.";
        const request: SystemOneRequest = {
          state: { rules: "A squire holds more instructions than it will keep. One must be dropped.", persona: persona().name },
          questions: { drop: { type: "choice", instructions: "Which instruction is least like this persona, the one it follows least readily?", criteria } },
        };
        let result: AskResult | null = null;
        try {
          result = await deps.send(request);
        } catch {
          result = null;
        }
        if (mine !== generation) return;
        if (result !== null && result.ok) {
          deps.tally.record(backend, result.usage, deps.now());
          const answer = result.answers["drop"];
          const named = answer?.type === "choice" ? live.find((i) => i.id === answer.choice) : undefined;
          if (named !== undefined) target = named;
        }
      }
      const still = items.find((i) => i.id === target.id);
      if (still === undefined || !isLive(still.state)) return;
      replace(target.id, { state: "abandoned" });
      say(`Dropped the ${noun(target.kind)} to keep the number down: ${short(target.text)}`, false);
      persist();
    }
  }

  function chain(work: (mine: number) => Promise<void>): void {
    const mine = generation;
    inFlight = inFlight.then(() => work(mine)).catch((error: unknown) => {
      deps.log(`Squire could not sort its orders: ${String(error)}`);
    });
  }

  async function refine(id: string, text: string, mine: number): Promise<void> {
    const sorted = await sortInstruction(text, deps);
    if (mine !== generation || corrected.has(id)) return;
    const current = items.find((i) => i.id === id);
    if (current === undefined || !isLive(current.state)) return;
    const kind = explicit.has(id) ? current.kind : sorted.kind;
    const next = restance({ ...current, sorted: sorted.sorted, kind, familyCreed: kind === "standing" && current.familyCreed }, current.adherence);
    replace(id, next);
    persist();
  }

  const self: Orders = {
    list: () => items,
    live: () => items.filter((i) => isLive(i.state)),
    give(text, source, options = {}) {
      const trimmed = text.trim().slice(0, MAX_TEXT);
      if (trimmed === "") return { ok: false, problem: "Write the instruction first." };
      const same = items.find((i) => normal(i.text) === normal(trimmed) && (isLive(i.state) || (i.state === "forgotten" && i.kind === "standing")));
      if (same !== undefined) {
        const again = replace(same.id, { memory: 1, seenTurn: lastTurn, state: isLive(same.state) ? same.state : "following" });
        persist();
        return { ok: true, instruction: again ?? same, repeated: true };
      }
      const code = sortByCode(trimmed);
      const kind = options.kind ?? code.kind;
      const viewer = options.viewer?.trim().slice(0, MAX_VIEWER) ?? "";
      counter += 1;
      const id = `i${String(counter)}`;
      if (options.kind !== undefined) explicit.add(id);
      const made = restance({
        id, text: trimmed, kind, source, ...(viewer === "" ? {} : { viewer }), sorted: code.sorted, state: "following", memory: 1, adherence: 0.5,
        familyCreed: kind === "standing" && options.familyCreed === true, createdTurn: lastTurn, seenTurn: lastTurn,
        acted: 0, lowReviews: 0, disliked: false,
      }, null);
      items = [...items, { ...made, disliked: made.state !== "following" }];
      say(`New ${noun(kind)}${viewer === "" ? "" : ` from viewer ${viewer}`}: ${short(trimmed)}`, false);
      persist();
      chain((mine) => refine(id, trimmed, mine));
      chain((mine) => prune(mine));
      return { ok: true, instruction: items.find((i) => i.id === id)!, repeated: false };
    },
    retire(id) {
      const i = items.find((x) => x.id === id);
      if (i === undefined || !isLive(i.state)) return false;
      finish(i, i.kind === "order" ? "abandoned" : "done", i.kind === "order" ? "Order withdrawn:" : "Standing instruction retired:");
      return true;
    },
    correct(id, patch) {
      const i = items.find((x) => x.id === id);
      if (i === undefined) return false;
      corrected.add(id);
      const kind = patch.kind ?? i.kind;
      const next = restance({
        ...i, kind, sorted: { ...i.sorted, ...patch.sorted },
        familyCreed: kind === "standing" && (patch.familyCreed ?? i.familyCreed),
      }, i.adherence);
      replace(id, next);
      persist();
      return true;
    },
    creeds: () => items.filter((i) => i.kind === "standing" && i.familyCreed && isLive(i.state)),
    adopt(creeds, turn) {
      for (const c of creeds) {
        if (items.some((i) => normal(i.text) === normal(c.text))) continue;
        counter += 1;
        items = [...items, { ...c, id: `i${String(counter)}`, kind: "standing", familyCreed: true, source: "creed", state: "following", createdTurn: turn, seenTurn: turn, acted: 0, lowReviews: 0 }];
      }
      items = items.map((i) => (isLive(i.state) ? restance(i, null) : i));
      persist();
    },
    observe(view) {
      const p = view.player();
      if (p.dead) return;
      const turn = view.turn();
      if (turn < lastTurn) review = null;
      const levelMoved = p.depth !== lastDepth ? 1 : 0;
      if (levelMoved === 1) arrived = true;
      const persona_ = persona();
      for (const i of items) {
        if (isLive(i.state)) {
          const memory = fade(i.memory, Math.max(0, turn - i.seenTurn), levelMoved, persona_);
          if (memory !== i.memory || i.seenTurn !== turn) {
            const next = replace(i.id, { memory, seenTurn: turn });
            if (next !== undefined && isForgotten(memory)) finish(next, "forgotten", "");
          }
        } else if (i.state === "forgotten" && i.kind === "standing") {
          const on = triggerActive(i, view);
          if (!on) rolled.delete(i.id);
          else if (!rolled.has(i.id)) {
            rolled.add(i.id);
            if (comesBack(persona_, rng())) {
              replace(i.id, { state: "following", memory: REMEMBERED_AT, seenTurn: turn });
              const back = restance(items.find((x) => x.id === i.id)!, null);
              replace(i.id, back);
              say(`Remembered: ${short(i.text)}`, false);
            }
          }
        }
      }
      lastTurn = turn;
      lastDepth = p.depth;
      const due = reviewDue(review, { depth: p.depth, level: p.level, turn });
      review = { depth: p.depth, level: p.level, reviewTurn: due === null ? (review?.reviewTurn ?? turn) : turn };
      if (due !== null) reviewNow(view);
    },
    decided(goal, view) {
      const active = new Set(applicable(view).map((x) => x.id));
      arrived = false;
      const turn = view.turn();
      for (const i of items.filter((x) => active.has(x.id))) {
        if (!goalsOf(i.sorted).serves.includes(goal)) continue;
        const updated = replace(i.id, { acted: i.acted + 1, memory: refreshed(i.memory, false) });
        const last = notedAt.get(i.id);
        if (updated !== undefined && (last === undefined || turn - last >= NOTE_GAP)) {
          notedAt.set(i.id, turn);
          say(`Acted on the ${noun(i.kind)} (${goal.replace(/_/g, " ")}): ${short(i.text)}`, i.acted === 0);
        }
        if (updated !== undefined && i.sorted.frequency.mode === "once") finish(updated, "done", "Did as told, once:");
      }
    },
    note(view, gold) {
      const now = applicable(view).sort((a, b) => b.adherence * b.memory - a.adherence * a.memory).slice(0, 6);
      if (now.length === 0) return null;
      const p = persona();
      const lines = now.map((i) => {
        const who = i.kind === "order" ? "Your patron ordered" : "Your patron's standing instruction";
        const faint = i.memory < 0.35 ? " You only faintly remember it." : "";
        return `${who}: "${i.text}". ${STANCE_WORDS[i.state] ?? ""}${faint}${routeHint(i, p, gold ?? view.player().gold)}`;
      });
      return lines.join(" ");
    },
    ask(offers, view) {
      const out: Record<string, ChoiceQuestion> = {};
      asked = [];
      if (offers.length === 0) return out;
      const now = applicable(view).sort((a, b) => b.adherence * b.memory - a.adherence * a.memory).slice(0, ASKED);
      const criteria: Record<string, string | null> = {};
      for (const o of offers) criteria[o.goal] = o.criteria;
      criteria[NONE] = "None of these carries it out.";
      for (const i of now) {
        asked.push(i.id);
        out[`order_${i.id}`] = { type: "choice", instructions: `The patron told the squire: "${i.text}". Which option best carries that out?`, criteria: { ...criteria } };
      }
      return out;
    },
    weigh(dist, answers, view) {
      let out: Record<string, number> = { ...dist };
      for (const i of applicable(view)) {
        const serves = new Set<string>();
        const answer = asked.includes(i.id) ? answers[`order_${i.id}`] : undefined;
        if (answer?.type === "choice" && answer.choice !== NONE && (answer.probabilities[answer.choice] ?? 0) >= 0.4) serves.add(answer.choice);
        out = weigh(out, i, serves);
      }
      return out;
    },
    passes(view) {
      const out = new Set<string>();
      for (const i of applicable(view)) {
        if (i.kind !== "order" || i.state === "ignoring" || i.adherence < PASS_ADHERENCE || i.memory < 0.5) continue;
        for (const goal of goalsOf(i.sorted).serves) out.add(goal);
      }
      return out;
    },
    promote(aims) {
      const named = new Set<string>();
      for (const i of items) if (isLive(i.state) && i.kind === "order" && i.sorted.aim !== null && i.state !== "ignoring") named.add(i.sorted.aim);
      if (named.size === 0) return aims;
      return [...aims.filter((a) => named.has(a.kind)), ...aims.filter((a) => !named.has(a.kind))];
    },
    state: () => ({ items }),
    load(state) {
      items = [...state.items];
      counter = items.reduce((n, i) => Math.max(n, Number(/^i(\d+)$/.exec(i.id)?.[1] ?? 0)), 0);
    },
    reset() {
      items = [];
      counter = 0;
      review = null;
      arrived = false;
      generation += 1;
      corrected.clear();
      explicit.clear();
      rolled.clear();
      notedAt.clear();
      asked = [];
      inFlight = Promise.resolve();
    },
    settled: () => inFlight,
  };
  return self;
}

/** How this persona would go about an order that needs an item, for the model to read. Not a plan Squire runs. */
function routeHint(i: Instruction, p: Persona, gold: number): string {
  const s = i.sorted;
  if (i.kind !== "order" || s.aim === null || !["armour", "weapon", "item", "spellbook", "lantern"].includes(s.aim)) return "";
  const store = s.store ?? (s.aim === "armour" ? "Armoury" : s.aim === "weapon" ? "Weapon Smiths" : "store");
  const thrifty = p.sliders.pricesense >= 65 || p.sliders.savings >= 65 || gold < 100;
  const parts: string[] = [];
  if (thrifty) parts.push("You would look in the dungeon first and buy only what it does not turn up.");
  else if (p.sliders.patience <= 35 || gold >= 500) parts.push(`You would go to the ${store} and buy.`);
  if (p.sliders.curiosity >= 70) parts.push("You would try unknown pieces found on the way.");
  if (p.sliders.pride >= 70 || p.sliders.ambition >= 70) parts.push("You want the best you can afford.");
  return parts.length === 0 ? "" : ` ${parts.join(" ")}`;
}
