/**
 * Energy per game turn at each speed: the extract_energy table from game-world.c. Speed 110, the normal speed, gains 10. A mod cannot import the game at run time, so the table is copied here, and energy.test.ts checks it against the game's own.
 */
const EXTRACT_ENERGY: readonly number[] = [
  /* Slow */ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  /* Slow */ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  /* Slow */ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  /* Slow */ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  /* Slow */ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  /* Slow */ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  /* S-50 */ 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  /* S-40 */ 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
  /* S-30 */ 2, 2, 2, 2, 2, 2, 2, 3, 3, 3,
  /* S-20 */ 3, 3, 3, 3, 3, 4, 4, 4, 4, 4,
  /* S-10 */ 5, 5, 5, 5, 6, 6, 7, 7, 8, 9,
  /* Norm */ 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
  /* F+10 */ 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
  /* F+20 */ 30, 31, 32, 33, 34, 35, 36, 36, 37, 37,
  /* F+30 */ 38, 38, 39, 39, 40, 40, 40, 41, 41, 41,
  /* F+40 */ 42, 42, 42, 43, 43, 43, 44, 44, 44, 44,
  /* F+50 */ 45, 45, 45, 45, 45, 46, 46, 46, 46, 46,
  /* F+60 */ 47, 47, 47, 47, 47, 48, 48, 48, 48, 48,
  /* F+70 */ 49, 49, 49, 49, 49, 49, 49, 49, 49, 49,
  /* Fast */ 49, 49, 49, 49, 49, 49, 49, 49, 49, 49,
];

/** Energy gained per game turn at a speed, as turn_energy computes it with the normal move energy of 100. Speeds outside the table are clamped to its ends. */
export function turnEnergy(speed: number): number {
  const index = Math.min(Math.max(speed, 0), EXTRACT_ENERGY.length - 1);
  return EXTRACT_ENERGY[index] ?? 0;
}
