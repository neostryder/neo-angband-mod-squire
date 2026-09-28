/**
 * The dashboard tab: what Squire is doing, what it has spent, how often it
 * went against advice, a depth chart, recent decisions and the Chronicle.
 * Decisions come far too fast to read one by one, so this shows the shape of
 * the run rather than a scrolling transcript.
 */

import type { Runtime } from "../runtime.js";
import { fill, h } from "./dom.js";

interface Row {
  readonly turn: number;
  readonly pick: string;
  readonly confidence: number;
  readonly against: boolean;
}

export function mountDashboard(body: HTMLElement, rt: Runtime): () => void {
  const stats = h("div");
  const chart = h("canvas", { width: "600", height: "140" });
  const recent = h("div");
  const chronicle = h("div");
  const rows: Row[] = [];

  function drawStats(): void {
    const t = rt.tally().session();
    const brain = rt.brain();
    const state = brain === null ? "not playing" : brain.state();
    const divergent = rows.filter((r) => r.against).length;
    fill(
      stats,
      h(
        "p",
        {},
        h("span", { class: "stat" }, "Squire is ", h("b", {}, state)),
        h("span", { class: "stat" }, "Decisions ", h("b", {}, String(t.requests))),
        h("span", { class: "stat" }, "Tokens ", h("b", {}, t.inputTokens.toLocaleString())),
        t.usd > 0 ? h("span", { class: "stat" }, "Cost ", h("b", {}, `$${t.usd.toFixed(3)}`)) : null,
        rows.length > 0 ? h("span", { class: "stat" }, "Against advice ", h("b", {}, `${String(Math.round((divergent / rows.length) * 100))}%`)) : null,
      ),
      brain?.stoppedBecause() ? h("p", { class: "bad" }, brain.stoppedBecause() ?? "") : null,
    );
  }

  function drawChart(): void {
    const g = chart.getContext("2d");
    if (g === null) return;
    const points = rt.journal().runLog().depthCurve();
    g.fillStyle = "#0c0b09";
    g.fillRect(0, 0, chart.width, chart.height);
    if (points.length < 2) {
      g.fillStyle = "#9b917a";
      g.font = "12px system-ui";
      g.fillText("The depth chart fills in as the character goes down.", 10, 20);
      return;
    }
    const first = points[0]!.turn;
    const span = Math.max(1, points[points.length - 1]!.turn - first);
    const deepest = Math.max(1, ...points.map((p) => p.depth));
    g.strokeStyle = "#f2c66d";
    g.lineWidth = 2;
    g.beginPath();
    points.forEach((p, i) => {
      const x = 10 + ((p.turn - first) / span) * (chart.width - 20);
      const y = 10 + (p.depth / deepest) * (chart.height - 20);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.stroke();
    g.fillStyle = "#9b917a";
    g.font = "11px system-ui";
    g.fillText(`deepest ${String(deepest * 50)} ft`, 10, chart.height - 4);
  }

  function drawRecent(): void {
    fill(
      recent,
      rows.length === 0 ? h("p", { class: "muted" }, "No decisions yet. Hand the keyboard to Squire with Ctrl-Z.") : null,
      ...rows
        .slice(-12)
        .reverse()
        .map((r) =>
          h("div", { class: r.against ? "entry disagree" : "entry" }, `Turn ${String(r.turn)}: ${r.pick.replace(/_/g, " ")} (${String(Math.round(r.confidence * 100))}%)${r.against ? ", against advice" : ""}`),
        ),
    );
  }

  function drawChronicle(): void {
    const lines = rt.journal().chronicle();
    fill(chronicle, lines.length === 0 ? h("p", { class: "muted" }, "Notable moments land here.") : null, ...lines.slice(-15).reverse().map((l) => h("div", { class: "entry" }, l)));
  }

  function drawAll(): void {
    drawStats();
    drawChart();
    drawRecent();
    drawChronicle();
  }

  const offDecision = rt.onDecision((record, turn) => {
    const goal = record.answers["goal"];
    const trace = record.context.trace;
    rows.push({
      turn,
      pick: trace?.pick ?? (goal?.type === "choice" ? goal.choice : "?"),
      confidence: goal?.type === "choice" ? goal.confidence : 0,
      against: trace !== undefined && trace.pick !== trace.advice,
    });
    if (rows.length > 500) rows.splice(0, rows.length - 500);
    drawAll();
  });
  const offChronicle = rt.onChronicle(() => drawChronicle());
  /* The brain's state changes between decisions too: waiting, stopped. */
  const timer = setInterval(drawStats, 1000);

  body.append(h("h3", {}, "Now"), stats, h("h3", {}, "Depth"), chart, h("h3", {}, "Recent decisions"), recent, h("h3", {}, "Chronicle"), chronicle);
  drawAll();
  return () => {
    offDecision();
    offChronicle();
    clearInterval(timer);
  };
}
