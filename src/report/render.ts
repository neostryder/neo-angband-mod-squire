import type { RunSummary } from "./summary.js";

function cell(text: string | number): string {
  return String(text).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function lines(items: readonly string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- None recorded";
}

export function reportMarkdown(model: RunSummary): string {
  const h = model.headline;
  return [
    `# ${h.name}'s run`, "",
    "| Stat | Value |", "| --- | --- |",
    `| Character | ${cell(`${h.race} ${h.class}`)} |`,
    `| Outcome | ${cell(h.outcome)} |`,
    `| Cause | ${cell(h.cause)} |`,
    `| Level | ${cell(h.level)} |`,
    `| Deepest | ${cell(h.deepestFeet)} ft |`,
    `| Turns | ${cell(h.turns)} |`, "",
    "## Kills", "", lines(model.topKills.map((kill) => `${kill.name}: ${String(kill.count)}`)), "",
    "## Close calls", "", lines(model.closeCalls.map((event) => `Turn ${String(event.turn)}, ${String(event.depth * 50)} ft: ${event.text}`)), "",
    "## Lessons learned", "", lines(model.lessonsLearned), "",
    "## Lessons inherited", "", lines(model.lessonsInherited), "",
    "## Token tally", "",
    "| Measure | Total |", "| --- | ---: |",
    `| Calls | ${String(model.tokens.requests)} |`,
    `| Input tokens | ${String(model.tokens.inputTokens)} |`,
    `| Output tokens | ${String(model.tokens.outputTokens)} |`,
    `| Estimated calls | ${String(model.tokens.estimated)} |`,
    `| Cost (USD) | ${model.tokens.usd.toFixed(4)} |`, "",
  ].join("\n");
}

export function reportJson(model: RunSummary): string {
  return JSON.stringify({ format: "neo-angband/squire/report", schemaVersion: 1, data: model });
}
