/**
 * Word bands for the numbers in the state. A model compares "adjacent" with
 * "far" more reliably than 1 with 9, so every number Squire sends goes out
 * beside one of these words, the way a creature's danger goes out as a band.
 */

/** A word for the character's hit points, which the model reads more reliably than a ratio. */
export function healthBand(hp: number, maxHp: number): string {
  if (maxHp <= 0) return "unknown";
  const share = hp / maxHp;
  if (share >= 0.9) return "full";
  if (share >= 0.6) return "lightly hurt";
  if (share >= 0.35) return "badly hurt";
  return "near death";
}

/** Hit points lost, as a share of the character's maximum. */
export function lossBand(lost: number, maxHp: number): string {
  if (lost <= 0) return "none";
  if (maxHp <= 0) return "unknown";
  if (lost * 2 >= maxHp) return "over half of maximum HP";
  if (lost * 4 >= maxHp) return "a quarter to half of maximum HP";
  if (lost * 10 >= maxHp) return "a tenth to a quarter of maximum HP";
  return "under a tenth of maximum HP";
}

/** Distance in steps. */
export function stepsBand(steps: number): string {
  if (steps <= 0) return "here";
  if (steps <= 1) return "adjacent";
  if (steps <= 3) return "close";
  if (steps <= 7) return "near";
  return "far";
}

/** "3 steps (close)", for a distance in a sentence. */
export function stepsText(steps: number): string {
  return `${String(steps)} step${steps === 1 ? "" : "s"} (${stepsBand(steps)})`;
}

/** A chance to fail, in percent. */
export function failBand(percent: number): string {
  if (percent <= 0) return "never fails";
  if (percent <= 5) return "reliable";
  if (percent <= 20) return "usually works";
  if (percent <= 40) return "unreliable";
  return "likely to fail";
}

/** "12% chance to fail (usually works)". */
export function failText(percent: number): string {
  return `${String(percent)}% chance to fail (${failBand(percent)})`;
}

/** A count of game or player turns. */
export function turnsBand(turns: number): string {
  if (turns <= 1) return "at once";
  if (turns <= 5) return "soon";
  if (turns <= 20) return "a short wait";
  return "a long wait";
}

/** "2 turns (soon)", for the player turns a walk or a wait takes. */
export function turnsText(turns: number): string {
  return `${String(turns)} turn${turns === 1 ? "" : "s"} (${turnsBand(turns)})`;
}

/** How many of something. */
export function countBand(count: number): string {
  if (count <= 0) return "none";
  if (count === 1) return "one";
  if (count <= 3) return "a few";
  if (count <= 9) return "several";
  return "many";
}

/** A character level. */
export function levelBand(level: number): string {
  if (level < 10) return "novice";
  if (level < 25) return "seasoned";
  if (level < 40) return "veteran";
  return "champion";
}

/** A dungeon level, 0 being the town. */
export function depthBand(depth: number): string {
  if (depth <= 0) return "town";
  if (depth < 10) return "shallow";
  if (depth < 30) return "middle depths";
  if (depth < 60) return "deep";
  return "very deep";
}

/** Damage to a creature as a share of the hit points it has left. */
export function targetShare(damage: number, hp: number): string {
  if (damage <= 0) return "none of its health";
  if (hp > 0 && damage >= hp) return "enough to kill it";
  if (damage * 2 >= hp) return "over half its health";
  if (damage * 4 >= hp) return "a quarter to half its health";
  return "under a quarter of its health";
}

/** A part of a whole, such as the mana a spell costs out of what is left. */
export function shareBand(part: number, whole: number): string {
  if (part <= 0) return "none";
  if (whole <= 0 || part >= whole) return "all";
  if (part * 2 >= whole) return "over half";
  if (part * 4 >= whole) return "a quarter to half";
  return "under a quarter";
}

/** The status danger figure from the incoming-damage bound: paralysis 150, confusion 10, slowing 5. */
export function statusDangerBand(status: number): string {
  if (status <= 0) return "none";
  if (status >= 150) return "can leave it unable to act";
  if (status >= 10) return "can confuse it";
  return "can slow it";
}
