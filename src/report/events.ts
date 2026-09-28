/** Facts Squire records while a run is still in progress. */
export interface RunEvent {
  readonly kind: "kill" | "unique-kill" | "near-death" | "escape" | "level-up" | "descend" | "item-found" | "death" | "divergence" | "lesson" | "lineage";
  readonly turn: number;
  readonly depth: number;
  readonly text: string;
  readonly race?: string;
  /** Hit points for a near-death event, or an event-specific numeric fact. */
  readonly value?: number;
}

export interface RunLog {
  record(event: RunEvent): void;
  events(): readonly RunEvent[];
  topKills(n: number): readonly { readonly name: string; readonly count: number }[];
  depthCurve(): readonly { readonly turn: number; readonly depth: number }[];
  hpLowPoints(): readonly { readonly turn: number; readonly depth: number; readonly hp: number }[];
  closeCalls(): readonly RunEvent[];
  /** Observed turn span, inclusive of the first recorded turn. */
  runClock(): { readonly startTurn: number; readonly endTurn: number; readonly turns: number };
  toJson(): string;
}

const KINDS = new Set<RunEvent["kind"]>([
  "kill", "unique-kill", "near-death", "escape", "level-up", "descend", "item-found", "death", "divergence", "lesson", "lineage",
]);

function eventFrom(value: unknown): RunEvent | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!KINDS.has(raw["kind"] as RunEvent["kind"]) || typeof raw["text"] !== "string"
    || typeof raw["turn"] !== "number" || !Number.isFinite(raw["turn"])
    || typeof raw["depth"] !== "number" || !Number.isFinite(raw["depth"])) return null;
  return {
    kind: raw["kind"] as RunEvent["kind"], turn: raw["turn"], depth: raw["depth"], text: raw["text"],
    ...(typeof raw["race"] === "string" ? { race: raw["race"] } : {}),
    ...(typeof raw["value"] === "number" && Number.isFinite(raw["value"]) ? { value: raw["value"] } : {}),
  };
}

export function createRunLog(): RunLog {
  const entries: RunEvent[] = [];
  return {
    record(event) { entries.push(event); },
    events: () => entries.slice(),
    topKills(n) {
      const counts = new Map<string, number>();
      for (const event of entries) {
        if ((event.kind === "kill" || event.kind === "unique-kill") && event.race) {
          counts.set(event.race, (counts.get(event.race) ?? 0) + 1);
        }
      }
      return [...counts].map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, Math.max(0, Math.floor(n)));
    },
    depthCurve() {
      const curve: { turn: number; depth: number }[] = [];
      for (const event of entries) {
        if (curve.at(-1)?.depth !== event.depth) curve.push({ turn: event.turn, depth: event.depth });
      }
      return curve;
    },
    hpLowPoints() {
      const lows: { turn: number; depth: number; hp: number }[] = [];
      let lowest = Infinity;
      for (const event of entries) {
        if (event.kind === "near-death" && event.value !== undefined && event.value < lowest) {
          lowest = event.value;
          lows.push({ turn: event.turn, depth: event.depth, hp: event.value });
        }
      }
      return lows;
    },
    closeCalls: () => entries.filter((event) => event.kind === "near-death"),
    runClock() {
      if (entries.length === 0) return { startTurn: 0, endTurn: 0, turns: 0 };
      let startTurn = entries[0]!.turn;
      let endTurn = startTurn;
      for (const event of entries) {
        startTurn = Math.min(startTurn, event.turn);
        endTurn = Math.max(endTurn, event.turn);
      }
      return { startTurn, endTurn, turns: endTurn - startTurn + 1 };
    },
    toJson: () => JSON.stringify({ format: "neo-angband/squire/run-log", schemaVersion: 1, events: entries }),
  };
}

/** Imported logs may be old or damaged; keep valid facts and discard the rest. */
export function fromJson(json: string): RunLog {
  const log = createRunLog();
  try {
    const raw: unknown = JSON.parse(json);
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return log;
    const data = raw as Record<string, unknown>;
    if (data["format"] !== "neo-angband/squire/run-log" || data["schemaVersion"] !== 1 || !Array.isArray(data["events"])) return log;
    for (const item of data["events"]) {
      const event = eventFrom(item);
      if (event !== null) log.record(event);
    }
  } catch { /* A broken saved log is an empty log. */ }
  return log;
}
