export type ConsentLevel = "off" | "summary" | "decisions" | "full";

export interface Consent {
  readonly level: ConsentLevel;
  readonly backstoryConsent: boolean;
}

export function describeLevel(level: ConsentLevel): string {
  switch (level) {
    case "off": return "Sends nothing from this install.";
    case "summary": return "Sends how each run ended, its deepest level, top kills and token counts, with your character's name, race and class.";
    case "decisions": return "Sends the run summary and each decision's turn, kind, question, choice, confidence, probabilities and outcome.";
    case "full": return "Sends the run summary, decisions and extra run log; backstory is sent only with separate backstory consent.";
  }
}
