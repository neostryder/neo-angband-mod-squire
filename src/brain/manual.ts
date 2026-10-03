/**
 * Layer 1, the manual: what the game teaches a player about this character. The class and race
 * facts come from class.txt, p_race.txt and the code behind their flags; the birth facts come
 * from the game's birth options. A race or class a mod adds has no entry here and adds nothing.
 */

import type { AgentView } from "@rpgm-tools/neo-angband-core";

export interface BirthOption {
  readonly name: string;
  readonly value: boolean;
}

/** Each casting class's realm and casting stat (class.txt books, realm.txt). */
const CASTING: Readonly<Record<string, readonly [string, string]>> = {
  Mage: ["arcane spells", "Intelligence"],
  Rogue: ["arcane spells", "Intelligence"],
  Necromancer: ["shadow rituals", "Intelligence"],
  Blackguard: ["shadow rituals", "Intelligence"],
  Priest: ["divine prayers", "Wisdom"],
  Paladin: ["divine prayers", "Wisdom"],
  Druid: ["nature verses", "Wisdom"],
  Ranger: ["nature verses", "Wisdom"],
};

/** What a class flag does in play, in the order the class's facts are listed. */
const CLASS_FLAGS: readonly (readonly [string, string])[] = [
  ["NO_MANA", "casts no spells"],
  ["BRAVERY_30", "cannot be frightened from character level 30"],
  ["SHIELD_BASH", "may bash a visible creature with a worn shield before its blows"],
  ["BEAM", "often casts bolt spells as beams that hit every creature in the line"],
  ["BLESS_WEAPON", "deals 2 more damage with a hafted or blessed weapon"],
  ["FAST_SHOT", "shoots faster with a launcher as it gains levels"],
  ["UNLIGHT", "sees nearby grids with little or no light, resists darkness, and fails spells more often while standing on a lit grid"],
  ["EVIL", "resists nether but takes more harm from holy attacks"],
  ["COMBAT_REGEN", "regains mana by landing melee blows, while resting drains mana into hit points instead of restoring it"],
  ["STEAL", "can try to steal from a creature"],
];

/** Race abilities from p_race.txt, as a player reads them. */
const RACE_FACTS: Readonly<Record<string, string>> = {
  Elf: "resists light",
  Hobbit: "holds on to experience against draining and knows every mushroom",
  Gnome: "cannot be paralysed and learns what a wand, staff or rod does on picking it up",
  Dwarf: "cannot be blinded and senses nearby treasure veins",
  "Half-Orc": "resists darkness",
  "Half-Troll": "regenerates hit points quickly",
  "High-Elf": "sees invisible creatures and resists light",
  Kobold: "resists poison",
};

/**
 * Birth options that change how the game plays, stated only when set apart from the standard
 * game. Selling is stated either way because it decides where gold comes from.
 */
const BIRTH_FACTS: Readonly<Record<string, readonly [boolean, string]>> = {
  birth_force_descend: [true, "Up staircases are never made, so stairs lead only down."],
  birth_no_recall: [true, "Word of Recall does nothing."],
  birth_connect_stairs: [false, "Taking a staircase does not leave one under the character."],
  birth_levels_persist: [true, "A level left and entered again is the same level."],
  birth_lose_arts: [true, "An artifact left behind on a level is lost."],
  birth_know_runes: [true, "Every rune is known from the start."],
  birth_know_flavors: [true, "Every potion, scroll and device is recognised on sight."],
  birth_feelings: [false, "There are no level feelings."],
};

function article(word: string): string {
  return /^[AEIOU]/i.test(word) ? "An" : "A";
}

/** The character's class and race facts in two sentences, or undefined when neither is known. */
export function mechanicsOf(race: string, cls: string, classFlags: readonly string[]): string | undefined {
  const casting = CASTING[cls];
  const classFacts = [
    ...(casting === undefined ? [] : [`casts ${casting[0]} with ${casting[1]}`]),
    ...CLASS_FLAGS.filter(([flag]) => classFlags.includes(flag)).map(([, fact]) => fact),
  ];
  const raceFact = RACE_FACTS[race];
  const lines = [
    ...(classFacts.length === 0 ? [] : [`${article(cls)} ${cls} ${joinFacts(classFacts)}.`]),
    ...(raceFact === undefined ? [] : [`${article(race)} ${race} ${raceFact}.`]),
  ];
  return lines.length === 0 ? undefined : lines.join(" ");
}

/** The birth options that change play, in one line, or undefined when the game is standard. */
export function birthOf(options: readonly BirthOption[]): string | undefined {
  const set = new Map(options.map((option) => [option.name, option.value]));
  const lines = Object.entries(BIRTH_FACTS).flatMap(([name, [when, fact]]) => set.get(name) === when ? [fact] : []);
  const selling = set.get("birth_no_selling");
  if (selling !== undefined) lines.push(selling ? "Stores pay nothing for goods, and the dungeon drops more gold instead." : "Stores buy goods for gold.");
  return lines.length === 0 ? undefined : lines.join(" ");
}

function joinFacts(facts: readonly string[]): string {
  if (facts.length <= 1) return facts.join("");
  return `${facts.slice(0, -1).join(", ")} and ${facts.at(-1) ?? ""}`;
}

/**
 * The manual's character entries. They depend only on the race, the class and the birth options,
 * so they are compiled once per character and reused.
 */
export function createManual(birthOptions: () => readonly BirthOption[] = () => []) {
  let key = "";
  let entries: Readonly<Record<string, string | undefined>> = {};
  return (view: AgentView): Readonly<Record<string, string | undefined>> => {
    const player = view.player();
    let options: readonly BirthOption[] = [];
    try {
      options = birthOptions();
    } catch {
      /* A failed options read leaves the birth facts out rather than guessing them. */
    }
    const next = JSON.stringify([player.race, player.cls, player.classFlags, options.map((option) => [option.name, option.value])]);
    if (next !== key) {
      key = next;
      entries = { mechanics: mechanicsOf(player.race, player.cls, player.classFlags), birth: birthOf(options) };
    }
    return entries;
  };
}
