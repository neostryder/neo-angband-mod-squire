/**
 * The parts of an instruction's sorted form that need more than a keyword: the
 * hit point line a low-hp trigger names, the item uses an avoid response
 * forbids, and whether the character stands in a store.
 *
 * Numbers and names always come from code, never from the model.
 */

import type { AgentView } from "@rpgm-tools/neo-angband-core";
import type { BanVerb, HpLine, ItemBan } from "./types.js";

const BELOW = String.raw`(?:below|under|less than|beneath|lower than|at most|(?:drops?|falls?|gets?|goes?) (?:below|under|to))`;
const SHARES: Readonly<Record<string, number>> = {
  half: 0.5, "a half": 0.5, "a third": 1 / 3, "one third": 1 / 3, "a quarter": 0.25, "one quarter": 0.25,
  "a fourth": 0.25, "two thirds": 2 / 3, "three quarters": 0.75,
};
const SHARE_WORDS = Object.keys(SHARES).sort((a, b) => b.length - a.length).join("|");

/** The hit point line the words name, or null when they name none. */
export function readHpLine(text: string): HpLine | null {
  const t = text.toLowerCase();
  const percent = new RegExp(String.raw`${BELOW}\s+(\d{1,3})\s*(?:%|percent)`).exec(t);
  if (percent !== null) {
    const value = Number(percent[1]) / 100;
    return value > 0 && value <= 1 ? { kind: "share", value } : null;
  }
  const words = new RegExp(String.raw`${BELOW}\s+(${SHARE_WORDS})\b`).exec(t) ?? new RegExp(String.raw`\b(${SHARE_WORDS})\s+(?:hp|hit points|health)\b`).exec(t);
  if (words !== null) return { kind: "share", value: SHARES[words[1]!]! };
  /* A bare number after "below" is hit points unless a unit says it is feet, gold or a level. */
  const hp = new RegExp(String.raw`${BELOW}\s+(\d{1,5})(?!\s*(?:ft|feet|gold|gp|%|percent|\d|th\b|st\b|nd\b|rd\b))`).exec(t);
  if (hp !== null) {
    const value = Number(hp[1]);
    return value > 0 ? { kind: "hp", value } : null;
  }
  return null;
}

/** Whether hit points are under the line; half of maximum when the words named none. */
export function underHpLine(line: HpLine | undefined, hp: number, maxHp: number): boolean {
  if (maxHp <= 0) return false;
  if (line === undefined) return hp <= maxHp * 0.5;
  return line.kind === "hp" ? hp < line.value : hp < maxHp * line.value;
}

const VERBS: readonly (readonly [RegExp, BanVerb])[] = [
  [/^read/, "read"], [/^(?:quaff|drink)/, "quaff"], [/^zap/, "zap"], [/^aim/, "aim"], [/^us/, "use"],
];
const NOUNS: readonly (readonly [RegExp, BanVerb])[] = [
  [/^scrolls?$/, "read"], [/^potions?$/, "quaff"], [/^wands?$/, "aim"], [/^rods?$/, "zap"], [/^(?:staffs?|staves)$/, "use"],
  [/^(?:items?|devices?|objects?|anything|things?)$/, "use"],
];
const FIGHT = /\b(?:in (?:a )?fights?|in combat|in battle|while fighting|when fighting|during (?:a )?fights?|with (?:a |an )?(?:monster|creature|enemy)s? (?:in sight|nearby|around))\b/;
const UNKNOWN = /^(?:unknown|unidentified|untried|unrecogni[sz]ed|unfamiliar)$/;
const FILLER = /^(?:any|a|an|the|my|your|of|those|these)$/;

/** The item uses the words forbid, such as "never read unknown scrolls in a fight". */
export function readBans(text: string): ItemBan[] {
  const t = text.toLowerCase();
  const out: ItemBan[] = [];
  const pattern = /\b(?:never|do not|don't|avoid|refuse to)\s+(read(?:ing)?|quaff(?:ing)?|drink(?:ing)?|zap(?:ping)?|aim(?:ing)?|us(?:e|ing))\b([^.,;!?]*)/g;
  for (let m = pattern.exec(t); m !== null; m = pattern.exec(t)) {
    let verb = VERBS.find(([re]) => re.test(m![1]!))?.[1] ?? "use";
    const rest = m[2]!;
    const when = FIGHT.test(rest) ? "fight" : "always";
    const words = rest.replace(FIGHT, " ").replace(/\b(?:when|while|if|during|in|at|on)\b.*$/, " ").trim().split(/\s+/).filter((w) => w !== "");
    const at = words.findIndex((w) => NOUNS.some(([re]) => re.test(w)));
    let item: string | null = null;
    if (words.some((w) => UNKNOWN.test(w))) item = "unknown";
    if (at >= 0) {
      const nounVerb = NOUNS.find(([re]) => re.test(words[at]!))![1];
      if (verb === "use") verb = nounVerb;
      const after = words.slice(at + 1);
      if (item === null && after[0] === "of" && after.length > 1) item = after.slice(1).join(" ");
    } else if (item === null) {
      const named = words.filter((w) => !FILLER.test(w)).join(" ");
      item = named === "" ? null : named;
    }
    out.push({ verb, item, when });
  }
  return out;
}

/** The item verbs each option can spend an object with. */
const GOAL_USES: Readonly<Record<string, readonly BanVerb[]>> = {
  heal: ["quaff"],
  phase: ["read"],
  teleport: ["read", "use"],
  detect: ["read", "zap"],
  recall_town: ["read"],
  recall_dungeon: ["read"],
  buff: ["quaff", "read"],
  resist: ["quaff", "read"],
  device: ["use", "zap"],
  aim_wand: ["aim"],
  activate: ["use"],
};

function stem(text: string): string {
  return text.toLowerCase().replace(/\b(\w+?)e?s\b/g, "$1");
}

/** The offered options a ban forbids right now, read from what each option uses and names. */
export function bannedGoals(bans: readonly ItemBan[], offers: readonly { readonly goal: string; readonly criteria: string }[], fighting: boolean): string[] {
  const out = new Set<string>();
  for (const ban of bans) {
    if (ban.when === "fight" && !fighting) continue;
    for (const offer of offers) {
      const uses = GOAL_USES[offer.goal];
      if (uses === undefined || (ban.verb !== "use" && !uses.includes(ban.verb))) continue;
      const words = offer.criteria;
      const named = ban.item === null
        || (ban.item === "unknown" ? /\b(?:unknown|unidentified|untried)\b/i.test(words) : stem(words).includes(stem(ban.item)));
      if (named) out.add(offer.goal);
    }
  }
  return [...out];
}

/** Whether an awake creature is in sight, which is what "in a fight" means to a ban. */
export function fighting(view: AgentView): boolean {
  return view.monsters().some((m) => m.visible && !m.asleep);
}

/** Whether the character stands on a store's entrance in town, which is where the game opens the store. */
export function inStore(view: AgentView): boolean {
  const p = view.player();
  if (p.depth !== 0) return false;
  let feats: number[];
  try {
    feats = view.stores().map((s) => s.feat);
  } catch {
    return false;
  }
  const cell = view.cell(p.grid.x, p.grid.y);
  return cell !== null && feats.includes(cell.feat);
}
