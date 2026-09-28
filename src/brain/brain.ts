/**
 * The controller that asks a model what to do, then carries out the answer.
 *
 * The host pumps an installed controller about once per tick and takes at most
 * one command per call. Returning null costs nothing: the game keeps waiting for
 * input and asks again on the next tick. So a model call never blocks the game.
 * While a request is out the controller returns null, and when the answer lands
 * it is used on a later tick.
 *
 * The brain moves between four states:
 *
 * - idle: no plan. The next call sends a question and moves to asking.
 * - asking: a request is out. Calls return null until it resolves.
 * - running: a plan is issuing commands. Each call checks the planner's
 *   triggers first, and a trigger drops the plan and asks again.
 * - waiting: the last request failed and Squire is backing off before it tries
 *   again.
 *
 * A failure that retrying cannot fix, or retries that run out, ends in stopped:
 * the controller says why and how to resume, then returns null for good.
 *
 * An answer is used only if the game is still at the input wait the question
 * was asked at. The input token says so. A stale answer is thrown away and the
 * question asked again about the game as it is now.
 */

import type { AgentActions, AgentCommand, AgentController, AgentView } from "@rpgm-tools/neo-angband-core";
import type { AskResult, Backend, Failure } from "./backend.js";
import type { Answer, SystemOneRequest, Usage } from "./systemone.js";
import type { Tally } from "./tally.js";

/** The input token, as `ctx.snapshot().token` reports it. */
export interface Token {
  readonly epoch: number;
  readonly revision: number;
}

export function sameToken(a: Token | null, b: Token | null): boolean {
  return a !== null && b !== null && a.epoch === b.epoch && a.revision === b.revision;
}

/** A course of action the brain has committed to. */
export interface Plan {
  /** What the plan is doing, for the status line and the log. */
  readonly label: string;
  /** The next command, or null when the plan is finished and a new decision is due. */
  step(view: AgentView, act: AgentActions): AgentCommand | null;
}

/** What a planner decides with. */
export interface Question<C> {
  readonly request: SystemOneRequest;
  /** Anything the planner needs later to read the answers: the options offered, the digest. */
  readonly context: C;
}

export type Choice = { readonly plan: Plan } | { readonly handBack: string };

/** The game-specific half of the brain: what to ask, and what an answer means. */
export interface Planner<C> {
  /** The question for this moment, or a reason to hand the keyboard back. */
  ask(view: AgentView): Question<C> | { readonly handBack: string };
  /** Turn the answers into a plan. */
  choose(answers: Readonly<Record<string, Answer>>, context: C, view: AgentView): Choice;
  /** A reason to drop the running plan and decide again, or null to keep going. */
  trigger(view: AgentView, plan: Plan): string | null;
}

/** One decision, for the decision log. */
export interface DecisionRecord<C> {
  readonly token: Token | null;
  readonly backend: string;
  readonly request: SystemOneRequest;
  readonly context: C;
  readonly answers: Readonly<Record<string, Answer>>;
  readonly usage: Usage;
  readonly model: string | null;
  readonly latencyMs: number;
  /** The plan chosen, or the reason for handing back. */
  readonly outcome: string;
}

export interface BrainDeps<C> {
  readonly backend: Backend;
  readonly planner: Planner<C>;
  readonly tally: Tally;
  /** Send one request. The plugin binds this to `ask` over `ctx.net`. */
  send(request: SystemOneRequest): Promise<AskResult>;
  /** The current input token, or null when there is no game. */
  token(): Token | null;
  now(): number;
  log(message: string): void;
  /** Publish the current task, through `ctx.controller.setStatus`. */
  status(label: string, reason?: string): void;
  onDecision?(record: DecisionRecord<C>): void;
}

/** Waits between retries, in milliseconds. Once these run out, Squire stops. */
export const BACKOFF_MS: readonly number[] = Object.freeze([1_000, 2_000, 4_000, 8_000, 15_000, 30_000]);

/** Longest wait Squire accepts from a server's Retry-After before it stops instead. */
const MAX_RETRY_AFTER_MS = 60_000;

/**
 * Decisions in a row that produced no command. A plan that finishes the moment
 * it starts would otherwise send a request on every tick.
 */
export const MAX_EMPTY_DECISIONS = 4;

/** How to get Squire going again, said the same way everywhere. */
export const RESUME_HINT = "Press any key to take the keyboard back, then Ctrl-Z to hand it to Squire again.";

type State<C> =
  | { readonly kind: "idle" }
  | { readonly kind: "asking"; readonly token: Token | null; readonly question: Question<C> }
  | { readonly kind: "running"; readonly plan: Plan }
  | { readonly kind: "waiting"; readonly until: number }
  | { readonly kind: "stopped"; readonly message: string };

export interface Brain {
  readonly controller: AgentController;
  /** The state name, for tests and the dashboard. */
  state(): "idle" | "asking" | "running" | "waiting" | "stopped";
  /** Why Squire stopped, or null while it is still playing. */
  stoppedBecause(): string | null;
}

export function createBrain<C>(deps: BrainDeps<C>): Brain {
  const { backend, planner, tally } = deps;
  let state: State<C> = { kind: "idle" };
  /* The settled result of the request in flight, picked up on the next call. */
  let landed: { readonly result: AskResult; readonly question: Question<C>; readonly token: Token | null } | null = null;
  let attempt = 0;
  let emptyDecisions = 0;

  function stopWith(message: string): null {
    state = { kind: "stopped", message };
    deps.log(message);
    deps.status("stopped", message);
    return null;
  }

  function failed(failure: Failure): null {
    if (!failure.retryable) return stopWith(`${failure.message} ${RESUME_HINT}`);
    /* A server's Retry-After sets how long to wait, never how many times. */
    const wait = attempt >= BACKOFF_MS.length ? undefined : failure.retryAfterMs ?? BACKOFF_MS[attempt];
    if (wait === undefined || wait > MAX_RETRY_AFTER_MS) {
      return stopWith(`${failure.message} Squire tried ${String(attempt)} times and has stopped. ${RESUME_HINT}`);
    }
    attempt += 1;
    state = { kind: "waiting", until: deps.now() + wait };
    deps.log(`${failure.message} Trying again in ${String(Math.ceil(wait / 1000))} s.`);
    deps.status("waiting", failure.message);
    return null;
  }

  function startAsking(view: AgentView): null {
    const capped = tally.overCap(backend, deps.now());
    if (capped !== null) return stopWith(`${capped.message} ${RESUME_HINT}`);

    const question = planner.ask(view);
    if ("handBack" in question) return stopWith(question.handBack);

    const token = deps.token();
    state = { kind: "asking", token, question };
    deps.status("thinking");
    deps.send(question.request).then(
      (result) => {
        landed = { result, question, token };
      },
      (error: unknown) => {
        /* `ask` never rejects; this guards a send that someone else wrote. */
        landed = {
          result: {
            ok: false,
            latencyMs: 0,
            failure: { kind: "unreachable", message: `The request failed: ${String(error)}`, retryable: true },
          },
          question,
          token,
        };
      },
    );
    return null;
  }

  function takeLanded(view: AgentView): null | "planned" {
    if (landed === null) return null;
    const { result, question, token } = landed;
    landed = null;

    if (!result.ok) {
      failed(result.failure);
      return null;
    }
    tally.record(backend, result.usage, deps.now());
    attempt = 0;

    if (!sameToken(token, deps.token())) {
      /* The game moved while the model was thinking: the player took the
       * keyboard back and gave it again, or a level changed. Ask afresh. */
      state = { kind: "idle" };
      return null;
    }

    const choice = planner.choose(result.answers, question.context, view);
    const outcome = "plan" in choice ? choice.plan.label : `hand back: ${choice.handBack}`;
    deps.onDecision?.({
      token,
      backend: backend.label,
      request: question.request,
      context: question.context,
      answers: result.answers,
      usage: result.usage,
      model: result.model,
      latencyMs: result.latencyMs,
      outcome,
    });
    if ("handBack" in choice) {
      stopWith(choice.handBack);
      return null;
    }
    state = { kind: "running", plan: choice.plan };
    deps.status(choice.plan.label);
    return "planned";
  }

  const controller: AgentController = (view, act) => {
    if (state.kind === "stopped") return null;

    if (state.kind === "asking") {
      if (takeLanded(view) === null) return null;
    }

    if (state.kind === "waiting") {
      if (deps.now() < state.until) return null;
      state = { kind: "idle" };
    }

    if (state.kind === "running") {
      const plan = state.plan;
      const reason = planner.trigger(view, plan);
      if (reason === null) {
        const command = plan.step(view, act);
        if (command !== null) {
          emptyDecisions = 0;
          return command;
        }
        deps.log(`finished: ${plan.label}`);
      } else {
        deps.log(`${plan.label}: ${reason}`);
      }
      emptyDecisions += 1;
      if (emptyDecisions > MAX_EMPTY_DECISIONS) {
        return stopWith(`Squire's last ${String(MAX_EMPTY_DECISIONS)} plans ended before doing anything, so it has stopped. ${RESUME_HINT}`);
      }
      state = { kind: "idle" };
    }

    if (state.kind === "idle") return startAsking(view);
    return null;
  };

  return {
    controller,
    state: () => state.kind,
    stoppedBecause: () => (state.kind === "stopped" ? state.message : null),
  };
}
