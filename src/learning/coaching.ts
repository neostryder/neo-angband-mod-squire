import type { LoggedDecision } from "../memory/log.js";

export type CoachingSource = "takeover" | "watch" | "why";

export interface CoachingExample {
  readonly situation: Readonly<Record<string, unknown>>;
  readonly offered: readonly string[];
  readonly squirePick: string;
  readonly playerPick: string;
  readonly question: string;
  readonly source: CoachingSource;
  readonly reason?: string;
  readonly weight: number;
}

/** Watch-this commands are demonstrations and count twice in worked examples. */
export function coachingExample(record: LoggedDecision, playerChoice: string, source: CoachingSource, reason?: string): CoachingExample {
  return {
    situation: record.state, offered: [...record.options], squirePick: record.choice,
    playerPick: playerChoice, question: record.question, source,
    ...(reason === undefined ? {} : { reason }), weight: source === "watch" ? 2 : 1,
  };
}

/** Demonstrations count twice in the agreement share. */
export function agreement(examples: readonly CoachingExample[], family?: string): number {
  const selected = family === undefined ? examples : examples.filter((example) => example.question === family);
  if (selected.length === 0) return 0;
  const total = selected.reduce((sum, example) => sum + example.weight, 0);
  if (total === 0) return 0;
  return selected.reduce((sum, example) => sum + (example.squirePick === example.playerPick ? example.weight : 0), 0) / total;
}

/** Return corrections between two options as short criteria-ready sentences. */
export function workedExamples(examples: readonly CoachingExample[], optionA: string, optionB: string, limit: number): string[] {
  return examples.filter((example) =>
    example.squirePick !== example.playerPick
    && [optionA, optionB].includes(example.squirePick)
    && [optionA, optionB].includes(example.playerPick))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, Math.max(0, Math.floor(limit)))
    .map((example) => {
      const summary = typeof example.situation["summary"] === "string" ? example.situation["summary"].slice(0, 100) : "this situation";
      return `For ${summary}, prefer ${example.playerPick} over ${example.squirePick}${example.reason ? `: ${example.reason}` : "."}`;
    });
}
