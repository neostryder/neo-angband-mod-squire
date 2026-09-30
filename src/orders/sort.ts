/**
 * Sorting an instruction into Squire's own vocabulary.
 *
 * The player's words always reach the decision state as written. Sorting is the
 * second path: it puts the right options on the list, since the decision model
 * only chooses among what Squire offers. One request holds a typed question for
 * each part (aim, trigger, response, store, kind, how often), each with "none
 * of these"; a code reading of the words stands in when no model is set up, the
 * spend cap is reached, or the request fails. Numbers always come from code.
 */

import type { AskResult, Backend } from "../brain/backend.js";
import type { Answer, ChoiceQuestion, SystemOneRequest } from "../brain/systemone.js";
import type { Tally } from "../brain/tally.js";
import type { Frequency, InstructionKind, OrderAim, ResponseKind, Sorted, TriggerKind } from "./types.js";

export const NONE = "none_of_these";

/** The store names a sorted instruction can point at. */
export const STORES: readonly string[] = ["General Store", "Armoury", "Weapon Smiths", "Bookseller", "Alchemy shop", "Magic shop", "Black market", "Home"];

const AIM_CHOICES: Readonly<Record<string, string>> = {
  armour: "Wear armour on the empty or weak slots.",
  weapon: "Get a better weapon.",
  spellbook: "Get the next spellbook.",
  lantern: "Get a lantern or a better light.",
  item: "Buy, find or keep a particular item.",
  depth: "Reach a certain depth.",
  gold: "Save a sum of gold.",
  [NONE]: "The instruction states no aim of this sort.",
};

const TRIGGER_CHOICES: Readonly<Record<TriggerKind, string> | Record<string, string>> = {
  unique: "A unique creature comes into view.",
  "low-hp": "Hit points fall below a line.",
  "new-level": "The character arrives on a new level.",
  "in-store": "The character enters a store.",
  always: "The instruction names no trigger; it applies all the time.",
};

const RESPONSE_CHOICES: Readonly<Record<string, string>> = {
  flee: "Run away or escape.",
  fight: "Attack.",
  "leave-level": "Leave the level by the stairs.",
  descend: "Go deeper.",
  buy: "Buy something.",
  rest: "Rest.",
  avoid: "Never do a certain thing.",
  [NONE]: "The instruction states no response of this sort.",
};

const KIND_CHOICES: Readonly<Record<InstructionKind, string>> = {
  order: "A task that ends once it is done.",
  standing: "A rule that keeps applying until it is retired.",
};

const FREQUENCY_CHOICES: Readonly<Record<Frequency["mode"], string>> = {
  once: "It applies the first time only.",
  always: "It applies every time.",
  "until-level": "It applies until the character reaches a level.",
};

const NUMBER_WORDS: Readonly<Record<string, number>> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** Goal names an avoid response can name, by the words that name them. */
const AVOID_WORDS: readonly (readonly [RegExp, string])[] = [
  [/\b(fight|melee|attack)/i, "fight"],
  [/\b(shoot|fire)\b/i, "shoot"],
  [/\b(descend|dive|stairs down|go deeper)\b/i, "descend"],
  [/\brest/i, "rest"],
  [/\b(phase|teleport)\b/i, "phase"],
  [/\b(shop|buy)/i, "shop"],
];

function wordsOf(text: string): string {
  return text.toLowerCase();
}

/** The whole answer, read from the words by keyword. Always available. */
export function sortByCode(text: string): { readonly sorted: Sorted; readonly kind: InstructionKind } {
  const t = wordsOf(text);
  let aim: OrderAim | null = null;
  let item: string | null = null;
  let count = 1;
  let depth: number | null = null;
  let deadlineLevel: number | null = null;
  let gold: number | null = null;

  const feet = /(\d[\d,]*)\s*(?:ft|feet)\b/.exec(t);
  const goldMatch = /(\d[\d,]*)\s*(?:gold|gp)\b/.exec(t);
  const before = /\b(?:before|by)\s+(?:character\s+)?level\s+(\d+)/.exec(t);
  const itemMatch = /\b(?:bring back|bring|keep|carry|buy|get|find|fetch|stock up on)\s+(?:(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten)\s+)?(?:of\s+)?((?:potions?|scrolls?|flasks?|rations?|wands?|rods?|staffs?|staves|rings?|amulets?|arrows?|bolts?|shots?|pebbles?)\b[^.,;]*)/.exec(t);

  if (feet !== null) {
    depth = Math.max(1, Math.round(Number(feet[1]!.replace(/,/g, "")) / 50));
    aim = "depth";
  } else if (/\b(?:reach|dive to|descend to|get to)\s+(?:dungeon\s+)?level\s+(\d+)/.exec(t) !== null) {
    depth = Number(/level\s+(\d+)/.exec(t)![1]);
    aim = "depth";
  }
  if (before !== null) deadlineLevel = Number(before[1]);
  if (aim === null && itemMatch !== null) {
    aim = "item";
    const raw = itemMatch[1];
    count = raw === undefined ? 1 : /^\d+$/.test(raw) ? Number(raw) : (NUMBER_WORDS[raw] ?? 1);
    item = itemMatch[2]!.replace(/\b(?:from|at|in|with|for|when|before)\b.*$/, "").replace(/\s+/g, " ").trim().replace(/s$/, "");
  }
  if (aim === null && goldMatch !== null && /\b(save|keep|hold|hoard|have|bank)\b/.test(t)) {
    aim = "gold";
    gold = Number(goldMatch[1]!.replace(/,/g, ""));
  }
  if (aim === null) {
    if (/\b(armou?r|suit up|helm|shield|boots|gloves|cloak|gauntlets)\b/.test(t)) aim = "armour";
    else if (/\b(weapon|sword|axe|blade|polearm|mace)\b/.test(t)) aim = "weapon";
    else if (/\b(spellbook|magic book|prayer book|book of)\b/.test(t)) aim = "spellbook";
    else if (/\b(lantern|torch|light source)\b/.test(t)) aim = "lantern";
  }

  const store = STORES.find((s) => t.includes(s.toLowerCase())) ?? (/\barmou?r(?:y| shop| store)\b/.test(t) ? "Armoury" : /\b(weaponsmith|weapon smith)/.test(t) ? "Weapon Smiths" : /\b(alchemist)\b/.test(t) ? "Alchemy shop" : null);

  let trigger: TriggerKind = "always";
  if (/\bunique/.test(t)) trigger = "unique";
  else if (/\b(hit points|hp|health|wounded|badly hurt|low on)\b/.test(t)) trigger = "low-hp";
  else if (/\b(new level|arriv\w+ (?:on|at)|each level|every level|first arrive)\b/.test(t)) trigger = "new-level";
  else if (/\benter\w*\s+(?:a\s+|the\s+)?(?:store|shop)\b/.test(t)) trigger = "in-store";

  const avoidWords = /\b(never|do not|don't|avoid|refuse to|stay out of)\b/.test(t);
  /* The named action must follow the negation closely: "never read scrolls in a fight" avoids reading, not fighting. */
  const avoids = avoidWords ? AVOID_WORDS.filter(([pattern]) => new RegExp(`\\b(?:never|do not|don't|avoid|refuse to|stay out of)\\s+(?:\\w+\\s+){0,2}?${pattern.source}`, "i").test(text)).map(([, goal]) => goal) : [];
  let response: ResponseKind | null = null;
  if (avoidWords && avoids.length > 0) response = "avoid";
  else if (/\b(flee|run away|run from|escape|retreat|get away|back off)\b/.test(t)) response = "flee";
  else if (/\b(fight|attack|kill|charge|slay|engage)\b/.test(t)) response = "fight";
  else if (/\b(leave the level|take the stairs|leave level|use the stairs)\b/.test(t)) response = "leave-level";
  else if (/\b(descend|dive|go deeper|go down)\b/.test(t) && aim !== "depth") response = "descend";
  else if (/\b(buy|purchase|shop)\b/.test(t) && aim !== "item") response = "buy";
  else if (/\brest\b/.test(t)) response = "rest";

  let frequency: Frequency = { mode: "always" };
  const until = /\buntil\s+(?:character\s+)?level\s+(\d+)/.exec(t);
  if (/\b(first time|the first|just once|once)\b/.test(t)) frequency = { mode: "once" };
  else if (until !== null) frequency = { mode: "until-level", level: Number(until[1]) };

  const standing = /\b(always|never|whenever|every time|each time|the first time|until level|any time|when(?:ever)? you|if you see)\b/.test(t) || avoidWords;
  return {
    kind: standing ? "standing" : "order",
    sorted: { aim, trigger, response, avoids, store, depth, deadlineLevel, item, count, gold, frequency },
  };
}

function choice(instructions: string, criteria: Readonly<Record<string, string>>): ChoiceQuestion {
  return { type: "choice", instructions, criteria: { ...criteria } };
}

/** The one request that sorts an instruction: a typed question for each part, each with "none of these". */
export function sortRequest(text: string): SystemOneRequest {
  return {
    state: {
      rules: "A squire has been given an instruction in plain words. Sort it into the squire's own vocabulary. Answer none_of_these for any part the words do not state.",
      instruction: text,
    },
    questions: {
      kind: choice("Is this an order that ends when done, or a standing instruction that keeps applying?", { ...KIND_CHOICES, [NONE]: "Neither fits." }),
      aim: choice("What is the instruction aiming for?", AIM_CHOICES),
      trigger: choice("What situation triggers it?", { ...TRIGGER_CHOICES, [NONE]: "It names no trigger." }),
      response: choice("What should the squire do in response?", RESPONSE_CHOICES),
      store: choice("Which store does it name, if any?", { ...Object.fromEntries(STORES.map((s) => [s, `The ${s}.`])), [NONE]: "It names no store." }),
      frequency: choice("How often does it apply?", { ...FREQUENCY_CHOICES, [NONE]: "It does not say." }),
    },
  };
}

function picked(answers: Readonly<Record<string, Answer>>, key: string, allowed: readonly string[]): string | null {
  const answer = answers[key];
  if (answer?.type !== "choice" || answer.choice === NONE) return null;
  return allowed.includes(answer.choice) ? answer.choice : null;
}

const AIM_KINDS: readonly string[] = ["armour", "weapon", "spellbook", "lantern", "item", "depth", "gold"];
const TRIGGERS: readonly string[] = ["unique", "low-hp", "new-level", "in-store", "always"];
const RESPONSES: readonly string[] = ["flee", "fight", "leave-level", "descend", "buy", "rest", "avoid"];

/**
 * The model's parts laid over the code reading. A part the model answers with
 * "none of these" keeps the code's reading, and numbers always come from code.
 */
export function readSort(text: string, answers: Readonly<Record<string, Answer>>): { readonly sorted: Sorted; readonly kind: InstructionKind } {
  const code = sortByCode(text);
  const aim = picked(answers, "aim", AIM_KINDS);
  const trigger = picked(answers, "trigger", TRIGGERS);
  const response = picked(answers, "response", RESPONSES);
  const store = picked(answers, "store", STORES);
  const kind = picked(answers, "kind", ["order", "standing"]);
  const mode = picked(answers, "frequency", ["once", "always", "until-level"]);
  const seen = code.sorted.frequency;
  const frequency: Frequency = mode === null || mode === seen.mode ? seen : mode === "until-level" ? seen : mode === "once" ? { mode: "once" } : { mode: "always" };
  const chosenResponse = (response as ResponseKind | null) ?? code.sorted.response;
  return {
    kind: (kind as InstructionKind | null) ?? code.kind,
    sorted: {
      ...code.sorted,
      aim: (aim as OrderAim | null) ?? code.sorted.aim,
      trigger: (trigger as TriggerKind | null) ?? code.sorted.trigger,
      response: chosenResponse,
      store: store ?? code.sorted.store,
      frequency,
    },
  };
}

export interface SortDeps {
  backend(): Backend | null;
  send(request: SystemOneRequest): Promise<AskResult>;
  readonly tally: Tally;
  now(): number;
}

/** Sort with the model when there is one to ask, else by code. Never rejects. */
export async function sortInstruction(text: string, deps: SortDeps): Promise<{ readonly sorted: Sorted; readonly kind: InstructionKind; readonly source: "model" | "code" }> {
  const fallback = (): { readonly sorted: Sorted; readonly kind: InstructionKind; readonly source: "code" } => ({ ...sortByCode(text), source: "code" });
  const backend = deps.backend();
  if (backend === null) return fallback();
  if (deps.tally.overCap(backend, deps.now()) !== null) return fallback();
  let result: AskResult;
  try {
    result = await deps.send(sortRequest(text));
  } catch {
    return fallback();
  }
  if (!result.ok) return fallback();
  deps.tally.record(backend, result.usage, deps.now());
  return { ...readSort(text, result.answers), source: "model" };
}
