/** Compact facts used to find lore from a similar encounter. */
export interface SituationSignature {
  readonly depthBand: number;
  readonly classId: string;
  readonly levelBand: number;
  readonly families: readonly string[];
  readonly hpBand: 0 | 1 | 2 | 3;
  readonly resources: readonly string[];
}

export interface SignatureInput {
  readonly depth: number;
  readonly classId: string;
  readonly level: number;
  readonly races: readonly string[];
  readonly hp: number;
  readonly maxHp: number;
  readonly resources: readonly string[];
}

const FAMILIES: readonly [RegExp, string][] = [
  [/\bzephyr hound|\bhounds?\b/i, "hound"],
  [/\bdragons?|\bdrakes?\b/i, "dragon"],
  [/\bghosts?|\bwraiths?|\bspectres?|\bspirits?\b/i, "ghost"],
  [/\bzombies?|\bskeletons?|\bundead|\bliches?\b/i, "undead"],
  [/\b(?:jell(?:y|ies)|molds?)\b/i, "jelly"],
  [/\b(?:jackals?|dogs?|wolves?|canines?)\b/i, "dog"],
  [/\bspiders?\b/i, "spider"],
  [/\bsnakes?\b/i, "snake"],
  [/\brats?\b/i, "rat"],
  [/\bworms?\b/i, "worm"],
  [/\bbats?\b/i, "bat"],
  [/\bbirds?\b/i, "bird"],
  [/\binsects?\b/i, "insect"],
  [/\beyes?\b/i, "eye"],
  [/\b(?:orcs?|kobolds?|spiders?|snakes?|rats?|worms?|giants?|trolls?|ogres?|bats?|birds?|insects?|humans?|men|elf|elves|dwarf|dwarves|hobbits?|yeeks?|golems?|demons?|vortices|vortexes|vortex|eyes?)\b/i, ""],
];

const WORD_FAMILIES: Readonly<Record<string, string>> = {
  orc: "orc", kobold: "kobold", spider: "spider", snake: "snake", rat: "rat",
  worm: "worm", giant: "giant", troll: "troll", ogre: "ogre", bat: "bat",
  bird: "bird", insect: "insect", human: "human", man: "human", men: "human",
  elf: "elf", elves: "elf", dwarf: "dwarf", dwarves: "dwarf", hobbit: "hobbit",
  yeek: "yeek", golem: "golem", demon: "demon", vortex: "vortex",
  vortices: "vortex", vortexes: "vortex", eye: "eye", eyes: "eye",
};

/** Match whole words so a race name cannot match a family by accident. */
export function familyOf(race: string): string {
  for (const [pattern, family] of FAMILIES) {
    const match = pattern.exec(race);
    if (match !== null) {
      if (family) return family;
      const word = match[0].toLowerCase();
      return WORD_FAMILIES[word] ?? WORD_FAMILIES[word.replace(/s$/, "")] ?? "other";
    }
  }
  return "other";
}

export function signatureOf(input: SignatureInput): SituationSignature {
  const share = input.maxHp > 0 ? input.hp / input.maxHp : 1;
  const hpBand = share >= 0.9 ? 0 : share >= 0.6 ? 1 : share >= 0.35 ? 2 : 3;
  return {
    depthBand: Math.floor(Math.max(0, input.depth) / 5),
    classId: input.classId,
    levelBand: Math.floor(Math.max(0, input.level) / 5),
    families: [...new Set(input.races.map(familyOf))].sort(),
    hpBand,
    resources: [...new Set(input.resources)].sort(),
  };
}

function overlap(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  let shared = 0;
  for (const item of left) if (right.has(item)) shared += 1;
  return shared / union.size;
}

/** Families and depth dominate; distant levels still retain a small match. */
export function similarity(a: SituationSignature, b: SituationSignature): number {
  const depth = 1 / (1 + Math.abs(a.depthBand - b.depthBand));
  const level = 1 / (1 + Math.abs(a.levelBand - b.levelBand));
  return 0.4 * overlap(a.families, b.families) + 0.3 * depth
    + 0.1 * (a.classId === b.classId ? 1 : 0) + 0.1 * level
    + 0.05 * (1 - Math.abs(a.hpBand - b.hpBand) / 3)
    + 0.05 * overlap(a.resources, b.resources);
}
