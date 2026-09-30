/**
 * The setup tab: which model Squire asks, the key or address, a connection
 * test, spend limits, telemetry consent, and what happens after a death.
 */

import type { Runtime } from "../runtime.js";
import type { BackendChoice, RollOn, SquireConfig } from "../config.js";
import { LAYA_DEFAULT_URL, MAX_INSTRUCTIONS_KEPT, MIN_INSTRUCTIONS_KEPT, parseAddresses } from "../config.js";
import { CHANNEL_HELP, CHANNEL_LABEL, CHANNEL_PLACEHOLDER, KEPT_HELP, KEPT_LABEL, ORDERS_HEADING } from "../orders/panel.js";
import { describeLevel, type ConsentLevel } from "../telemetry/consent.js";
import { DEFAULT_ENDPOINT, createSender } from "../telemetry/sender.js";
import { installId } from "../memory/install.js";
import { download, fill, h } from "./dom.js";

const BACKUP_HELP = "Squire tries these in order when the first server is busy or not answering, such as a second computer running Laya at http://192.168.1.21:8010/v1/systemone. Separate addresses with commas.";

const BRAINS: readonly [BackendChoice, string, string][] = [
  ["jev", "Jev", "TypeSafe's hosted model. Fast and strong; it needs an API key and charges a small amount per decision."],
  ["laya", "Laya", "An open model you run on your own computer or home network. Free to use, but it plays worse until it has been trained on Squire's decisions."],
  ["custom", "Another server", "Any server that answers the same System One requests."],
  ["none", "No model", "Squire runs its fixed errands and asks nothing."],
];

const LEVELS: readonly ConsentLevel[] = ["off", "summary", "decisions", "full"];

const ROLL_ON: readonly [RollOn, string][] = [
  ["wait", "Stop and wait for you to make the next character"],
  ["like", "Start a new character like the last one"],
  ["random", "Start a new character of a random race and class"],
];

export function mountSetup(body: HTMLElement, rt: Runtime, done: () => void): () => void {
  const status = h("p", { class: "muted" });
  const keyLine = h("p", { class: "muted" });
  let config = rt.config();

  function update(patch: Partial<SquireConfig>): void {
    config = { ...config, ...patch };
    rt.saveConfig(config);
  }

  function say(el: HTMLElement, text: string, good?: boolean): void {
    el.textContent = text;
    el.className = good === undefined ? "muted" : good ? "ok" : "bad";
  }

  const serverBox = h("div");
  function drawServer(): void {
    if (config.backend === "jev") {
      const key = h("input", { type: "password", placeholder: "Paste your Jev API key", autocomplete: "off" });
      fill(
        serverBox,
        h("label", {}, "Jev API key", key),
        h(
          "div",
          { class: "row" },
          h("button", { class: "act", onclick: async () => say(keyLine, await rt.setJevKey(key.value), true) }, "Save key"),
          h("button", { class: "act", onclick: async () => say(keyLine, await rt.jevKeyFromEnv()) }, "Use key from environment"),
        ),
        keyLine,
        h("p", { class: "muted" }, "To get a key, sign up at typesafe.ai and create an API key there. In the desktop app, Squire can instead read TYPESAFE_API_KEY or JEV_API_KEY from your environment after you agree."),
        h("h3", {}, "Spend limits"),
        h("p", { class: "muted" }, "Squire pauses when a limit is reached. Zero means no limit. A decision costs a few thousandths of a cent."),
        h(
          "div",
          { class: "row" },
          h("label", {}, "Per session ($)", numberInput(config.caps.perSessionUsd, (v) => update({ caps: { ...config.caps, perSessionUsd: v } }))),
          h("label", {}, "Per day ($)", numberInput(config.caps.perDayUsd, (v) => update({ caps: { ...config.caps, perDayUsd: v } }))),
        ),
      );
      void rt.hasJevKey().then((has) => {
        if (keyLine.textContent === "") say(keyLine, has ? "A key is set." : "No key is set yet.", has);
      });
    } else if (config.backend === "laya" || config.backend === "custom") {
      const url = h("input", { type: "text", value: config.serverUrl, placeholder: LAYA_DEFAULT_URL });
      url.addEventListener("change", () => update({ serverUrl: url.value.trim() }));
      const backups = h("input", { type: "text", value: config.serverFallbacks.join(", ") });
      backups.addEventListener("change", () => update({ serverFallbacks: parseAddresses(backups.value) }));
      const model = h("input", { type: "text", value: config.serverModel, placeholder: "Leave empty for the server's default" });
      model.addEventListener("change", () => update({ serverModel: model.value.trim() }));
      fill(
        serverBox,
        h("label", {}, "Server address", url),
        h("p", { class: "muted" }, "Use localhost or an IP address on your home network, such as http://192.168.1.20:8010/v1/systemone. A name like laya.lan is not allowed."),
        h("label", {}, "Backup server addresses", backups),
        h("p", { class: "muted" }, BACKUP_HELP),
        h("label", {}, "Model name", model),
        h("label", {}, "Context size (tokens)", numberInput(config.contextTokens, (v) => update({ contextTokens: Math.max(512, Math.round(v)) }))),
      );
    } else {
      fill(serverBox, h("p", { class: "muted" }, "With no model, a handover runs one errand: fight what is in front of you, explore the floor, or the long errand if it is switched on."));
    }
  }

  const brainBox = h("div");
  for (const [choice, label, help] of BRAINS) {
    const radio = h("input", { type: "radio", name: "squire-brain", checked: config.backend === choice });
    radio.addEventListener("change", () => {
      update({ backend: choice });
      drawServer();
    });
    brainBox.append(h("label", {}, radio, ` ${label}: `, h("span", { class: "muted" }, help)));
  }

  const test = h("button", {
    class: "act",
    onclick: async () => {
      say(status, "Testing...");
      const result = await rt.testConnection();
      say(status, result.message, result.ok);
    },
  }, "Test connection");

  const shadowEnabled = h("input", { type: "checkbox", checked: config.layaShadow.enabled });
  shadowEnabled.addEventListener("change", () => update({ layaShadow: { ...config.layaShadow, enabled: shadowEnabled.checked } }));
  const shadowUrl = h("input", { type: "text", value: config.layaShadow.url, placeholder: LAYA_DEFAULT_URL });
  shadowUrl.addEventListener("change", () => update({ layaShadow: { ...config.layaShadow, url: shadowUrl.value.trim() || LAYA_DEFAULT_URL } }));
  const shadowBackups = h("input", { type: "text", value: config.layaShadow.fallbacks.join(", ") });
  shadowBackups.addEventListener("change", () => update({ layaShadow: { ...config.layaShadow, fallbacks: parseAddresses(shadowBackups.value) } }));
  const rowCount = h("p", { class: "muted" }, "Counting saved rows...");
  void rt.layaRowCount().then((count) => { rowCount.textContent = `${String(count)} training rows saved.`; });
  const shadowBox = h(
    "div",
    {},
    h("h3", {}, "Train Laya while Jev plays"),
    h("label", {}, shadowEnabled, " Send decisions to Laya (off by default)"),
    h("p", { class: "muted" }, "Squire sends each decision to Laya too. It never acts on Laya's answer."),
    h("label", {}, "Laya address (default: localhost:8010)", shadowUrl),
    h("label", {}, "Backup server addresses", shadowBackups),
    h("p", { class: "muted" }, BACKUP_HELP),
    h("button", { class: "act", onclick: async () => download("squire-laya-rows.jsonl", await rt.exportLayaRows(), "application/x-ndjson") }, "Save Laya training rows"),
    rowCount,
  );

  const telemetry = telemetryBox(rt, () => config, update);

  const rollOn = h("select");
  for (const [value, label] of ROLL_ON) rollOn.append(h("option", { value, selected: config.rollOn === value }, label));
  rollOn.addEventListener("change", () => update({ rollOn: rollOn.value as RollOn }));

  const knights = h("input", { type: "checkbox", checked: config.knightsLessons.enabled });
  knights.addEventListener("change", () => update({ knightsLessons: { ...config.knightsLessons, enabled: knights.checked } }));

  const channelInput = h("input", { type: "text", value: config.channelUrl, placeholder: CHANNEL_PLACEHOLDER });
  channelInput.addEventListener("change", () => update({ channelUrl: channelInput.value.trim() }));

  body.append(
    h("h3", {}, "Pick a brain"),
    brainBox,
    serverBox,
    shadowBox,
    h("div", {}, test),
    status,
    h("h3", {}, "When a character dies"),
    rollOn,
    h("p", { class: "muted" }, "Only for characters Squire is playing. Your own characters are never replaced."),
    h("h3", {}, "Knight's Lessons"),
    h("label", {}, knights, " Learn from how I play while I have the keyboard"),
    h("h3", {}, ORDERS_HEADING),
    h("label", {}, KEPT_LABEL, keptInput(config.instructionsKept, (v) => update({ instructionsKept: v }))),
    h("p", { class: "muted" }, KEPT_HELP),
    h("label", {}, CHANNEL_LABEL, channelInput),
    h("p", { class: "muted" }, CHANNEL_HELP),
    telemetry,
    h("div", {}, h("button", { class: "act", onclick: () => { update({ setupDone: true }); done(); } }, "Next: choose a persona")),
  );
  drawServer();
  return () => {};
}

function keptInput(value: number, change: (v: number) => void): HTMLInputElement {
  const input = h("input", { type: "number", min: String(MIN_INSTRUCTIONS_KEPT), max: String(MAX_INSTRUCTIONS_KEPT), step: "1", value: String(value) });
  input.addEventListener("change", () => {
    const v = Math.round(Number(input.value));
    if (Number.isFinite(v)) change(Math.min(MAX_INSTRUCTIONS_KEPT, Math.max(MIN_INSTRUCTIONS_KEPT, v)));
  });
  return input;
}

function numberInput(value: number, change: (v: number) => void): HTMLInputElement {
  const input = h("input", { type: "number", min: "0", step: "any", value: String(value) });
  input.addEventListener("change", () => {
    const v = Number(input.value);
    if (Number.isFinite(v) && v >= 0) change(v);
  });
  return input;
}

function telemetryBox(rt: Runtime, config: () => SquireConfig, update: (patch: Partial<SquireConfig>) => void): HTMLElement {
  const describe = h("p", { class: "muted" }, describeLevel(config().telemetry.level));
  const level = h("select");
  for (const l of LEVELS) level.append(h("option", { value: l, selected: config().telemetry.level === l }, l === "off" ? "Off" : l[0]!.toUpperCase() + l.slice(1)));
  level.addEventListener("change", () => {
    const next = level.value as ConsentLevel;
    update({ telemetry: { ...config().telemetry, level: next, asked: true } });
    describe.textContent = describeLevel(next);
  });
  const backstory = h("input", { type: "checkbox", checked: config().telemetry.backstoryConsent });
  backstory.addEventListener("change", () => update({ telemetry: { ...config().telemetry, backstoryConsent: backstory.checked } }));
  const endpoint = h("input", { type: "text", value: config().telemetry.endpoint });
  endpoint.addEventListener("change", () => update({ telemetry: { ...config().telemetry, endpoint: endpoint.value.trim() } }));
  const result = h("p", { class: "muted" });

  return h(
    "div",
    {},
    h("h3", {}, "Share runs with the Squire project"),
    h("p", { class: "muted" }, "Finished runs can be sent to squire.rpgm.tools, which keeps them for 180 days and posts a short summary of each run to the Neo Angband Discord. The privacy note is at squire.rpgm.tools."),
    h("label", {}, "What to send", level),
    describe,
    h("label", {}, backstory, " Also send my persona's backstory, at the Full level"),
    h("label", {}, "Endpoint (empty sends nothing)", endpoint),
    h(
      "div",
      { class: "row" },
      h("button", {
        class: "act",
        onclick: async () => {
          const net = rt.net();
          if (net === null) {
            result.textContent = "This version of the game cannot send requests for mods.";
            return;
          }
          result.textContent = "Asking the server to delete everything from this install...";
          const id = await installId(rt.store());
          const sender = createSender({ net, store: rt.store(), endpoint: config().telemetry.endpoint || DEFAULT_ENDPOINT, now: Date.now, log: () => {} });
          const reply = await sender.deleteInstall(id);
          result.textContent = reply.ok ? "Everything sent from this install has been deleted." : `Could not delete: ${reply.reason}`;
        },
      }, "Delete what I have sent"),
    ),
    result,
  );
}
