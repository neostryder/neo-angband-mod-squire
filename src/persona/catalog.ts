/** The catalog keeps editor labels and decision descriptions in one place. */
export const GROUPS = [
  "temperament", "values", "affinities", "habits", "tactics", "economy",
  "quirks", "lineage", "patron", "meta",
] as const;

export type GroupId = (typeof GROUPS)[number];

type Parameter = {
  readonly id: string;
  readonly group: GroupId;
  readonly name: string;
  readonly kind: "slider" | "list" | "quirk" | "toggle" | "number";
  readonly scale: string;
  readonly description: string;
  readonly default?: number | boolean;
};

export const PARAMETERS = [
  { id: "boldness", group: "temperament", name: "Boldness", kind: "slider", scale: "timid to fearless", description: "How much danger the character accepts before it backs off." },
  { id: "impulsiveness", group: "temperament", name: "Impulsiveness", kind: "slider", scale: "deliberate to rash", description: "How often the character acts on its first instinct." },
  { id: "patience", group: "temperament", name: "Patience", kind: "slider", scale: "restless to patient", description: "Resting fully, waiting in corridors, and reading a level before descending." },
  { id: "composure", group: "temperament", name: "Composure", kind: "slider", scale: "panics to ice-cold", description: "How decisions change at low hit points." },
  { id: "stubbornness", group: "temperament", name: "Stubbornness", kind: "slider", scale: "flexible to never backs down", description: "How hard it is to abandon a chosen fight or goal." },
  { id: "curiosity", group: "temperament", name: "Curiosity", kind: "slider", scale: "incurious to must know", description: "Trying unknown items and exploring every corner." },
  { id: "paranoia", group: "temperament", name: "Paranoia", kind: "slider", scale: "trusting to sees danger everywhere", description: "Detecting, avoiding unknown monsters, and keeping escapes." },
  { id: "optimism", group: "temperament", name: "Optimism", kind: "slider", scale: "expects the worst to expects the best", description: "Shifts perceived threat bands by one step." },
  { id: "volatility", group: "temperament", name: "Volatility", kind: "slider", scale: "steady to mood swings", description: "How much persona strength wanders between decisions." },
  { id: "pride", group: "temperament", name: "Pride", kind: "slider", scale: "humble to glory-seeking", description: "Hunting uniques and chasing depth records." },
  { id: "selfpreservation", group: "values", name: "Self-preservation", kind: "slider", scale: "reckless to survival first", description: "Sets the death-risk ceiling unless Death wish is on.", default: 70 },
  { id: "greed", group: "values", name: "Greed", kind: "slider", scale: "indifferent to gold-hungry", description: "Detours for known gold and loot." },
  { id: "ambition", group: "values", name: "Ambition", kind: "slider", scale: "content to driven to win", description: "Controls the dive rate." },
  { id: "honour", group: "values", name: "Honour", kind: "slider", scale: "fights dirty to fights fair", description: "Attacking sleepers and using corridor tactics." },
  { id: "mercy", group: "values", name: "Mercy", kind: "slider", scale: "kills everything to spares the harmless", description: "Whether to attack harmless or fleeing creatures." },
  { id: "glory", group: "values", name: "Renown", kind: "slider", scale: "private to showboat", description: "Weights Chronicle-worthy moves above equally effective safer moves." },
  { id: "hated", group: "affinities", name: "Hated monster families", kind: "list", scale: "orcs, dragons, undead", description: "Fights these on sight and takes more risk against them." },
  { id: "feared", group: "affinities", name: "Feared monster families", kind: "list", scale: "spiders, ghosts", description: "Avoids these and leaves levels early when they appear." },
  { id: "weapons", group: "affinities", name: "Favoured weapons", kind: "list", scale: "blades, hafted, polearms, bows", description: "Keeps a favoured type when another is slightly better." },
  { id: "distrusted", group: "affinities", name: "Distrusted things", kind: "list", scale: "magic devices, unknown scrolls", description: "Uses these only when necessary." },
  { id: "elements", group: "affinities", name: "Favoured spells or elements", kind: "list", scale: "fire, lightning, healing", description: "Prefers these spells when several work." },
  { id: "superstitions", group: "affinities", name: "Superstitions", kind: "list", scale: "never reads scrolls at 1300 ft", description: "Harmless rules the character keeps." },
  { id: "hoarding", group: "habits", name: "Pack weight", kind: "slider", scale: "travels light to carries everything", description: "How much the character carries." },
  { id: "tidiness", group: "habits", name: "Tidiness", kind: "slider", scale: "ignores junk rules to ignores aggressively", description: "How eagerly it sets ignore rules." },
  { id: "home", group: "habits", name: "Home use", kind: "slider", scale: "never uses the home to stashes treasures", description: "Whether spare gear goes home." },
  { id: "towntrips", group: "habits", name: "Town trips", kind: "slider", scale: "rarely returns to returns often", description: "When low supplies prompt a return to town." },
  { id: "detection", group: "habits", name: "Detection habit", kind: "slider", scale: "never detects to detects on arrival", description: "Use of detection and mapping on a new level." },
  { id: "levelfeel", group: "habits", name: "Level thoroughness", kind: "slider", scale: "takes the first stairs to clears every level", description: "How much ground is explored before descending." },
  { id: "range", group: "tactics", name: "Engagement range", kind: "slider", scale: "melee to ranged and kiting", description: "Closing to melee versus firing from afar." },
  { id: "escapes", group: "tactics", name: "Escape readiness", kind: "slider", scale: "keeps none to keeps many", description: "How many escapes to keep before descending." },
  { id: "healat", group: "tactics", name: "Heal threshold", kind: "slider", scale: "heals late to heals early", description: "Hit-point level at which healing becomes an option." },
  { id: "retreatat", group: "tactics", name: "Retreat threshold", kind: "slider", scale: "holds to the end to leaves early", description: "Hit-point level at which fleeing becomes an option." },
  { id: "targets", group: "tactics", name: "Target priority", kind: "slider", scale: "weakest first to most dangerous first", description: "Which monster in a group is attacked first." },
  { id: "consumables", group: "tactics", name: "Consumable use", kind: "slider", scale: "saves for emergencies to uses freely", description: "How readily potions, scrolls, and charges are spent." },
  { id: "corridors", group: "tactics", name: "Corridor discipline", kind: "slider", scale: "fights in the open to always backs into a corridor", description: "Pulling groups into corridors before fighting." },
  { id: "pricesense", group: "economy", name: "Price sense", kind: "slider", scale: "pays anything to buys only bargains", description: "How prices weigh against want in stores." },
  { id: "savings", group: "economy", name: "Savings goal", kind: "slider", scale: "spends it all to saves for the big item", description: "Whether gold is held for an expensive purchase." },
  { id: "selling", group: "economy", name: "Selling", kind: "slider", scale: "keeps everything to sells everything", description: "Selling where birth options permit it." },
  { id: "forgetful", group: "quirks", name: "Forgetful", kind: "quirk", scale: "on or off, with strength", description: "Randomly drops a lesson from the state." },
  { id: "delusional", group: "quirks", name: "Delusional", kind: "quirk", scale: "on or off, with strength", description: "Randomly reads some threat bands wrong." },
  { id: "compulsive", group: "quirks", name: "Compulsive collector", kind: "quirk", scale: "on or off", description: "Must pick up everything it walks over." },
  { id: "pyromaniac", group: "quirks", name: "Pyromaniac", kind: "quirk", scale: "on or off", description: "Reaches for fire in every form." },
  { id: "deathwish", group: "quirks", name: "Death wish", kind: "quirk", scale: "on or off", description: "Allows options above the safety ceiling." },
  { id: "cowardice", group: "quirks", name: "Craven", kind: "quirk", scale: "on or off", description: "Flees from anything new, then circles back." },
  { id: "inheritance", group: "lineage", name: "Inheritance", kind: "slider", scale: "nothing passes to everything passes", description: "How much ancestral lore an heir starts with." },
  { id: "grudges", group: "lineage", name: "Blood grudges", kind: "toggle", scale: "on or off", description: "An heir hates or fears whatever killed its ancestors, and the feeling grows with each one it killed.", default: true },
  { id: "resemblance", group: "lineage", name: "Family resemblance", kind: "slider", scale: "each heir is new to heirs take after parents", description: "How much personality an heir inherits." },
  { id: "devotion", group: "patron", name: "Devotion", kind: "slider", scale: "ignores you to obeys you", description: "Whether a patron's spoken command is followed." },
  { id: "gratitude", group: "patron", name: "Gratitude", kind: "slider", scale: "takes gifts for granted to deeply grateful", description: "How much a blessing lifts mood and Devotion." },
  { id: "resentment", group: "patron", name: "Resentment", kind: "slider", scale: "forgives trials to holds a grudge", description: "How much a trial lowers Devotion." },
  { id: "strength", group: "meta", name: "Persona strength", kind: "slider", scale: "plays by advice to plays in character", description: "Blends the best move and in-character answers.", default: 35 },
  { id: "backstory", group: "meta", name: "Backstory weight", kind: "slider", scale: "ignored to rules everything", description: "How much backstory the state carries." },
  { id: "backstorycap", group: "meta", name: "Backstory cap", kind: "number", scale: "tokens", description: "Maximum backstory tokens per decision.", default: 600 },
  { id: "learning", group: "meta", name: "Learning rate", kind: "slider", scale: "slow to quick", description: "How fast lessons form and fade." },
  { id: "drift", group: "meta", name: "Trait drift", kind: "slider", scale: "fixed to shaped by experience", description: "How far experience moves traits.", default: 30 },
  { id: "confidence", group: "meta", name: "Confidence gate", kind: "slider", scale: "acts on anything to asks again when unsure", description: "When the brain asks a second question." },
  { id: "depth", group: "meta", name: "Thinking depth", kind: "slider", scale: "fast to thorough", description: "How many questions a decision asks." },
  { id: "chronicle", group: "meta", name: "Chronicle voice", kind: "slider", scale: "terse to chatty", description: "How many events reach the Chronicle." },
] as const satisfies readonly Parameter[];

export type SliderId = Extract<(typeof PARAMETERS)[number], { readonly kind: "slider" }>["id"];
export type ListId = Extract<(typeof PARAMETERS)[number], { readonly kind: "list" }>["id"];
export type QuirkId = Extract<(typeof PARAMETERS)[number], { readonly kind: "quirk" }>["id"];
export type ToggleId = Extract<(typeof PARAMETERS)[number], { readonly kind: "toggle" }>["id"];
