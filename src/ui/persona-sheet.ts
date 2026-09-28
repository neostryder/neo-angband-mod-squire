/**
 * The persona tab: the persona library, presets, file import and export, and
 * the full sheet of traits, lists, quirks and backstory.
 *
 * Editing a library entry changes the persona new characters start with. A
 * character already in play keeps its own copy, which drifts with experience.
 */

import type { Runtime } from "../runtime.js";
import { GROUPS, PARAMETERS } from "../persona/catalog.js";
import type { GroupId, ListId, QuirkId, SliderId, ToggleId } from "../persona/catalog.js";
import { ARCHETYPES, archetype, defaultPersona, normalize, randomPersona, type ArchetypeId, type Persona } from "../persona/persona.js";
import { exportPersona, importPersona } from "../persona/file.js";
import { download, fill, h, pickFile } from "./dom.js";

const GROUP_NAMES: Readonly<Record<GroupId, string>> = {
  temperament: "Temperament",
  values: "Values",
  affinities: "Likes and dislikes",
  habits: "Habits",
  tactics: "Tactics",
  economy: "Money",
  quirks: "Quirks",
  lineage: "Lineage",
  patron: "Patron",
  meta: "How Squire plays it",
};

export function mountPersona(body: HTMLElement, rt: Runtime): () => void {
  const sheet = h("div");
  const message = h("p", { class: "muted" });
  let config = rt.config();
  let index = Math.max(0, config.activePersona);

  function current(): Persona {
    return config.personas[index] ?? defaultPersona();
  }

  function store(p: Persona): void {
    const personas = config.personas.slice();
    personas[index] = normalize(p);
    config = { ...config, personas };
    rt.saveConfig(config);
  }

  function add(p: Persona): void {
    const personas = [...config.personas, normalize(p)].slice(-50);
    index = personas.length - 1;
    config = { ...config, personas, activePersona: index };
    rt.saveConfig(config);
    draw();
  }

  const library = h("select");
  const active = h("input", { type: "checkbox" });
  active.addEventListener("change", () => {
    config = { ...config, activePersona: active.checked ? index : -1 };
    rt.saveConfig(config);
  });
  library.addEventListener("change", () => {
    index = Number(library.value);
    draw();
  });

  const presets = h("select");
  presets.append(h("option", { value: "" }, "Start a new persona from..."), h("option", { value: "default" }, "Default"), h("option", { value: "random" }, "Random"));
  for (const id of Object.keys(ARCHETYPES)) presets.append(h("option", { value: id }, id[0]!.toUpperCase() + id.slice(1)));
  presets.addEventListener("change", () => {
    const v = presets.value;
    presets.value = "";
    if (v === "default") add(defaultPersona("New persona"));
    else if (v === "random") add(randomPersona(Math.random, "Wanderer"));
    else if (v !== "") add(archetype(v as ArchetypeId));
  });

  function draw(): void {
    config = rt.config();
    fill(library, ...config.personas.map((p, i) => h("option", { value: String(i), selected: i === index }, p.name)));
    active.checked = config.activePersona === index;
    const p = current();
    const playing = rt.character().persona;

    const name = h("input", { type: "text", value: p.name, maxlength: "40" });
    name.addEventListener("change", () => {
      store({ ...current(), name: name.value.trim() || "Squire" });
      draw();
    });
    const backstory = h("textarea", { placeholder: "Who is this character? Where are they from, what do they want, what do they fear?" }, p.backstory);
    backstory.addEventListener("change", () => store({ ...current(), backstory: backstory.value }));

    const groups = GROUPS.map((group) => {
      const rows = PARAMETERS.filter((param) => param.group === group).map((param) => row(param, () => current(), store));
      return h("div", {}, h("h3", {}, GROUP_NAMES[group]), ...rows);
    });

    fill(
      sheet,
      playing === null ? null : h("p", { class: "muted" }, `This character plays as ${playing.name}. Changes here apply to new characters.`),
      h("label", {}, "Name", name),
      h("label", {}, "Backstory", backstory),
      ...groups,
    );
  }

  body.append(
    h("h3", {}, "Personas"),
    h("div", { class: "row" }, library, presets),
    h("label", {}, active, " New characters play as this persona"),
    h(
      "div",
      {},
      h("button", { class: "act", onclick: () => download(`${current().name.replace(/[^A-Za-z0-9_-]+/g, "_")}.persona.json`, exportPersona(current())) }, "Export"),
      h("button", {
        class: "act",
        onclick: async () => {
          const text = await pickFile(".json,application/json");
          if (text === null) return;
          const result = importPersona(text);
          if (result.ok) {
            add(result.persona);
            message.textContent = `Imported ${result.persona.name}.`;
          } else {
            message.textContent = result.problem;
          }
        },
      }, "Import"),
      h("button", {
        class: "act",
        onclick: () => {
          if (config.personas.length <= 1) return;
          const personas = config.personas.filter((_, i) => i !== index);
          index = 0;
          config = { ...config, personas, activePersona: Math.min(config.activePersona, personas.length - 1) };
          rt.saveConfig(config);
          draw();
        },
      }, "Delete"),
    ),
    message,
    sheet,
  );
  draw();
  return () => {};
}

type Param = (typeof PARAMETERS)[number];

function row(param: Param, get: () => Persona, save: (p: Persona) => void): HTMLElement {
  const [low, high] = param.scale.split(" to ");
  switch (param.kind) {
    case "slider": {
      const id = param.id as SliderId;
      const value = h("span", {}, String(get().sliders[id]));
      const input = h("input", { type: "range", min: "0", max: "100", value: String(get().sliders[id]), title: param.description });
      input.addEventListener("input", () => (value.textContent = input.value));
      input.addEventListener("change", () => save({ ...get(), sliders: { ...get().sliders, [id]: Number(input.value) } }));
      return h(
        "div",
        { title: param.description },
        h("div", { class: "slider" }, h("span", {}, param.name), input, value),
        h("div", { class: "slider" }, h("span", {}), h("div", { class: "ends" }, h("span", {}, low ?? ""), h("span", {}, high ?? ""))),
      );
    }
    case "list": {
      const id = param.id as ListId;
      const input = h("input", { type: "text", value: get().lists[id].join(", "), placeholder: param.scale });
      input.addEventListener("change", () =>
        save({ ...get(), lists: { ...get().lists, [id]: input.value.split(",").map((s) => s.trim()).filter((s) => s !== "") } }),
      );
      return h("label", { title: param.description }, param.name, input);
    }
    case "quirk": {
      const id = param.id as QuirkId;
      const on = h("input", { type: "checkbox", checked: get().quirks[id].on });
      const strength = h("input", { type: "range", min: "0", max: "100", value: String(get().quirks[id].strength) });
      const update = () => save({ ...get(), quirks: { ...get().quirks, [id]: { on: on.checked, strength: Number(strength.value) } } });
      on.addEventListener("change", update);
      strength.addEventListener("change", update);
      return h("div", { class: "slider", title: param.description }, h("label", {}, on, ` ${param.name}`), strength, h("span", {}));
    }
    case "toggle": {
      const id = param.id as ToggleId;
      const on = h("input", { type: "checkbox", checked: get().toggles[id] });
      on.addEventListener("change", () => save({ ...get(), toggles: { ...get().toggles, [id]: on.checked } }));
      return h("label", { title: param.description }, on, ` ${param.name}: `, h("span", { class: "muted" }, param.description));
    }
    case "number": {
      const input = h("input", { type: "number", min: "0", max: "4000", value: String(get().backstoryCap) });
      input.addEventListener("change", () => save({ ...get(), backstoryCap: Number(input.value) }));
      return h("label", { title: param.description }, `${param.name} (tokens)`, input);
    }
  }
}
