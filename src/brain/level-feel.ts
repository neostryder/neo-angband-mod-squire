/**
 * The level feeling, read from the game's own messages.
 *
 * A new level announces how dangerous it looks and how rich it looks, in the
 * wording cmd-cave.c uses. Only the lines that say a level is dangerous or
 * picked clean count as bad here: a level that reads that way is one to leave
 * rather than clear, and the caller names the line it read in the offer.
 */

/** Monster-feeling lines (mon_feeling_text, cmd-cave.c) that mark a level as bad. */
const BAD_MONSTER: readonly RegExp[] = [
  /Omens of death haunt this place/i,
  /This place seems murderous/i,
  /This place seems terribly dangerous/i,
  /You feel anxious about this place/i,
];

/** Object-feeling lines (obj_feeling_text, cmd-cave.c) that mark a level as bad. */
const BAD_OBJECT: readonly RegExp[] = [
  /there is naught but cobwebs here/i,
  /there are only scraps of junk here/i,
];

/** The bad level-feeling line among these messages, or null when none says so. */
export function badLevelFeeling(messages: readonly string[]): string | null {
  for (const message of messages) {
    if ([...BAD_MONSTER, ...BAD_OBJECT].some((pattern) => pattern.test(message))) return message;
  }
  return null;
}

/** Every monster-feeling opening (mon_feeling_text, cmd-cave.c); the game prints one on arrival at each new level. */
const ARRIVAL: readonly string[] = [
  "You are still uncertain about this place",
  "Omens of death haunt this place",
  "This place seems murderous",
  "This place seems terribly dangerous",
  "You feel anxious about this place",
  "You feel nervous about this place",
  "This place does not seem too risky",
  "This place seems reasonably safe",
  "This seems a tame, sheltered place",
  "This seems a quiet, peaceful place",
  "Looks like a typical town",
];

/** Whether these messages include the feeling a new level announces, which marks a fresh floor even at the same depth. */
export function arrivalFeeling(messages: readonly string[]): boolean {
  return messages.some((message) => ARRIVAL.some((line) => message.startsWith(line)));
}
