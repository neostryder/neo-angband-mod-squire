/** One sentence for a goal the character holds, and one for a goal that has ended. */

export type GoalLevel = "long" | "mid" | "near";
export type GoalEnd = "met" | "failed" | "abandoned";

export interface GoalOutcome {
  readonly level: GoalLevel;
  readonly goal: string;
  readonly end: GoalEnd;
  readonly reason: string;
  readonly held: number;
  readonly startDepth: number;
  readonly endDepth: number;
  /** The aim's own detail, when a met aim has one. */
  readonly reward: string | null;
}

function cap(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/** The goal, its progress when the code has a number, and the trigger that chose it. */
export function goalSentence(label: string, progress: string | null, trigger: string): string {
  const head = `${cap(label)}.`;
  const why = `Chosen ${trigger}.`;
  return progress === null ? `${head} ${why}` : `${head} ${cap(progress)}. ${why}`;
}

/** The level, the goal, how it ended, how long it was held, and the depths at each end. */
export function outcomeSentence(outcome: GoalOutcome): string {
  const name = outcome.level === "long" ? "long-term" : outcome.level === "mid" ? "mid-term" : "near-term";
  const verb = outcome.end === "abandoned" ? "was abandoned" : outcome.end === "met" ? "was met" : "failed";
  const line = `The ${name} goal ${outcome.goal} ${verb} after ${String(outcome.held)} turns, from dungeon level ${String(outcome.startDepth)} to dungeon level ${String(outcome.endDepth)}, because ${outcome.reason}.`;
  if (outcome.end !== "met" || outcome.reward === null || outcome.reward.length === 0) return line;
  return `${line} ${outcome.reward.endsWith(".") ? outcome.reward : `${outcome.reward}.`}`;
}
