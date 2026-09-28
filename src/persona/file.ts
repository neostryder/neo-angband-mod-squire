import { normalize } from "./persona.js";
import type { Persona } from "./persona.js";

export function exportPersona(persona: Persona): string {
  return JSON.stringify({ format: "neo-angband/squire/persona", schemaVersion: 1, data: normalize(persona) }, null, 2) + "\n";
}

export function importPersona(text: string): { ok: true; persona: Persona } | { ok: false; problem: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, problem: "This file is not valid JSON." };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, problem: "This file is not a Squire persona." };
  }
  const file = raw as Record<string, unknown>;
  if (file["format"] !== "neo-angband/squire/persona") {
    return { ok: false, problem: "This file is not a Squire persona." };
  }
  if (typeof file["schemaVersion"] === "number" && file["schemaVersion"] > 1) {
    return { ok: false, problem: "This file is from a newer Squire." };
  }
  if (file["schemaVersion"] !== 1 || file["data"] === null || typeof file["data"] !== "object" || Array.isArray(file["data"])) {
    return { ok: false, problem: "This file is not a supported Squire persona." };
  }
  return { ok: true, persona: normalize(file["data"]) };
}
