/**
 * The report tab: the last run's report, saved files, a share card and share
 * links. Nothing is uploaded: a player saves the files and shares them where
 * they like.
 */

import type { Runtime } from "../runtime.js";
import { drawCard, shareLinks, type CardContext } from "../report/card.js";
import { reportJson, reportMarkdown } from "../report/render.js";
import type { RunSummary } from "../report/summary.js";
import { download, fill, h } from "./dom.js";
import { drawRadar } from "../lessons/radar.js";
import { defaultPersona } from "../persona/persona.js";

export function mountReport(body: HTMLElement, rt: Runtime): () => void {
  const view = h("div");
  body.append(view);

  function draw(model: RunSummary | null): void {
    const exportDecisions = h("button", { class: "act", onclick: () => download("squire-decisions.jsonl", rt.exportDecisions(), "application/x-ndjson") }, "Save decision log");
    if (model === null) {
      fill(
        view,
        h("p", { class: "muted" }, "The report is made when a character Squire played dies, wins or retires. The decision log for this run can be saved now."),
        exportDecisions,
      );
      return;
    }
    const hl = model.headline;
    const card = h("canvas", { width: "1200", height: "630" });
    const g = card.getContext("2d");
    if (g !== null) drawCard(g as unknown as CardContext, model);
    const text = `${hl.name}, a level ${String(hl.level)} ${hl.race} ${hl.class}, reached ${String(hl.deepestFeet)} ft in Neo Angband with Squire. ${hl.outcome === "death" ? `Killed by ${hl.cause}.` : hl.outcome === "winner" ? "Won the game." : "Retired."}`;
    const links = shareLinks(text);
    const apprenticeship = model.apprenticeship;
    const radar = apprenticeship === undefined ? null : h("canvas", { width: "600", height: "260" });
    const radarCtx = radar?.getContext("2d");
    if (radarCtx !== null && radarCtx !== undefined && apprenticeship !== undefined) {
      const squire = defaultPersona();
      const knight = defaultPersona();
      for (const trait of apprenticeship.squireRadar) squire.sliders[trait.id] = trait.value;
      for (const trait of apprenticeship.knightRadar) knight.sliders[trait.id] = trait.value;
      drawRadar(radarCtx, squire, 150, 130, 70, "#d9ac64");
      drawRadar(radarCtx, knight, 450, 130, 70, "#8fd18f",
        Object.fromEntries(apprenticeship.knightRadar.map((trait) => [trait.id, trait.confidence])));
    }
    const base = hl.name.replace(/[^A-Za-z0-9_-]+/g, "_") || "squire";
    fill(
      view,
      h("h3", {}, `${hl.name}, level ${String(hl.level)} ${hl.race} ${hl.class}`),
      h("p", {}, `${hl.outcome === "death" ? `Killed by ${hl.cause}` : hl.outcome === "winner" ? "Won the game" : "Retired"} at ${String(hl.deepestFeet)} ft after ${hl.turns.toLocaleString()} turns.`),
      model.topKills.length === 0 ? null : h("p", {}, `Most killed: ${model.topKills.slice(0, 5).map((k) => `${k.name} (${String(k.count)})`).join(", ")}`),
      model.uniquesKilled.length === 0 ? null : h("p", {}, `Uniques killed: ${model.uniquesKilled.join(", ")}`),
      h("p", {}, `Went against advice ${String(model.divergence.count)} times. Used ${model.tokens.inputTokens.toLocaleString()} input tokens${model.tokens.usd > 0 ? `, about $${model.tokens.usd.toFixed(3)}` : ""}.`),
      model.chronicleHighlights.length === 0 ? null : h("div", {}, h("h3", {}, "Chronicle"), ...model.chronicleHighlights.map((l) => h("div", { class: "entry" }, l))),
      model.lessonsLearned.length === 0 ? null : h("div", {}, h("h3", {}, "Lessons"), ...model.lessonsLearned.slice(-8).map((l) => h("div", { class: "entry" }, l))),
      apprenticeship === undefined ? null : h("div", {}, h("h3", {}, "Apprenticeship"),
        h("p", {}, `${apprenticeship.rank} rank, agreed ${String(Math.round(apprenticeship.agreementShare * 100))}%.`),
        h("p", {}, apprenticeship.latestExam === null ? "No exam yet." : `Exam: matched your choice ${String(apprenticeship.latestExam.matched)} of ${String(apprenticeship.latestExam.scored)} times`),
        ...apprenticeship.surprises.map((line) => h("div", { class: "entry" }, line)),
        h("div", { class: "row" }, h("span", {}, "Squire"), h("span", {}, "Your style")), radar),
      h("h3", {}, "Share"),
      card,
      h(
        "div",
        {},
        h("button", { class: "act", onclick: () => card.toBlob((blob) => blob && saveBlob(`${base}-card.png`, blob)) }, "Save card image"),
        h("button", { class: "act", onclick: () => download(`${base}-report.md`, reportMarkdown(model), "text/markdown") }, "Save report"),
        h("button", { class: "act", onclick: () => download(`${base}-report.json`, reportJson(model)) }, "Save report data"),
        exportDecisions,
      ),
      h(
        "p",
        {},
        h("a", { href: links.x, target: "_blank", rel: "noopener" }, "Post on X"),
        " / ",
        h("a", { href: links.reddit, target: "_blank", rel: "noopener" }, "Post on Reddit"),
      ),
    );
  }

  void rt.lastSummary().then(draw);
  return () => {};
}

function saveBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
