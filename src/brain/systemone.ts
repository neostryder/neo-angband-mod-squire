/**
 * The System One request and answer shapes, and a parser that checks an answer
 * against the questions it was sent for.
 *
 * Jev, Laya and any other server on `/v1/systemone` take a `state` object and a
 * set of named, typed questions, and return one answer per question. A Noul is a
 * yes/no probability, a Choice picks one option from a set, and a Score places the
 * state on an ordered list of levels. The parser never throws: a reply that is
 * missing an answer, or answers a question with the wrong type, comes back as a
 * problem string the player can read, so the brain can stop cleanly instead of
 * acting on half an answer.
 */

/** A yes/no question. */
export interface NoulQuestion {
  readonly type: "noul";
  readonly instructions: string;
  readonly criteria: { readonly true: string; readonly false: string };
}

/** Pick one option. Every Choice Squire asks includes `none_of_these`. */
export interface ChoiceQuestion {
  readonly type: "choice";
  readonly instructions: string;
  readonly criteria: Readonly<Record<string, string | null>>;
}

/** Place the state on ordered levels, lowest first. */
export interface ScoreQuestion {
  readonly type: "score";
  readonly instructions: string;
  readonly criteria: readonly string[];
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

/** One request body. */
export interface SystemOneRequest {
  readonly model?: string;
  readonly state: Readonly<Record<string, unknown>>;
  readonly questions: Readonly<Record<string, Question>>;
}

export interface NoulAnswer {
  readonly type: "noul";
  /** Probability of true, 0 to 1. */
  readonly p: number;
}

export interface ChoiceAnswer {
  readonly type: "choice";
  readonly choice: string;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

export interface ScoreAnswer {
  readonly type: "score";
  /** Expected level, 0-indexed, possibly fractional. */
  readonly score: number;
  readonly confidence: number;
  /** Probability per level, indexed like the criteria. */
  readonly probabilities: readonly number[];
}

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

/** Tokens one request used. `estimated` is true when the server did not say. */
export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimated: boolean;
}

export type Parsed =
  | {
      readonly ok: true;
      readonly model: string | null;
      readonly answers: Readonly<Record<string, Answer>>;
      readonly usage: Usage;
    }
  | { readonly ok: false; readonly problem: string };

/**
 * Rough token count for a body the server gave no usage for. Four characters per
 * token is close enough for a tally and a spend cap; it is never billed.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseOne(name: string, question: Question, raw: unknown): Answer | string {
  if (!isRecord(raw)) return `the server sent no answer to "${name}"`;
  if (raw["type"] !== question.type) {
    return `the server answered "${name}" as a ${String(raw["type"])}, not a ${question.type}`;
  }
  switch (question.type) {
    case "noul": {
      const p = num(raw["noul"]);
      if (p === null) return `the answer to "${name}" had no probability`;
      return { type: "noul", p };
    }
    case "choice": {
      const choice = raw["choice"];
      const probs = raw["probabilities"];
      if (typeof choice !== "string" || !(choice in question.criteria)) {
        return `the answer to "${name}" picked an option that was not offered`;
      }
      if (!isRecord(probs)) return `the answer to "${name}" had no probabilities`;
      const probabilities: Record<string, number> = {};
      for (const option of Object.keys(question.criteria)) {
        probabilities[option] = num(probs[option]) ?? 0;
      }
      return { type: "choice", choice, confidence: num(raw["confidence"]) ?? 0, probabilities };
    }
    case "score": {
      const score = num(raw["score"]);
      const probs = raw["probabilities"];
      if (score === null) return `the answer to "${name}" had no score`;
      const probabilities = question.criteria.map((_, i) =>
        isRecord(probs) ? (num(probs[String(i)]) ?? 0) : 0,
      );
      return { type: "score", score, confidence: num(raw["confidence"]) ?? 0, probabilities };
    }
  }
}

/** Check a reply body against the request it answers. */
export function parseReply(request: SystemOneRequest, requestBody: string, replyBody: string): Parsed {
  let raw: unknown;
  try {
    raw = JSON.parse(replyBody);
  } catch {
    return { ok: false, problem: "the server's reply was not JSON" };
  }
  if (!isRecord(raw) || !isRecord(raw["answers"])) {
    return { ok: false, problem: "the server's reply had no answers" };
  }
  const answersRaw = raw["answers"];
  const answers: Record<string, Answer> = {};
  for (const [name, question] of Object.entries(request.questions)) {
    const parsed = parseOne(name, question, answersRaw[name]);
    if (typeof parsed === "string") return { ok: false, problem: parsed };
    answers[name] = parsed;
  }
  const usageRaw = isRecord(raw["usage"]) ? raw["usage"] : {};
  const inputTokens = num(usageRaw["input_tokens"]);
  const outputTokens = num(usageRaw["output_tokens"]);
  const usage: Usage =
    inputTokens === null
      ? { inputTokens: estimateTokens(requestBody), outputTokens: outputTokens ?? 0, estimated: true }
      : { inputTokens, outputTokens: outputTokens ?? 0, estimated: false };
  const model = typeof raw["model"] === "string" ? raw["model"] : null;
  return { ok: true, model, answers, usage };
}
