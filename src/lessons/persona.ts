import type { Runtime } from "../runtime.js";
import type { Persona } from "../persona/persona.js";
import { normalize } from "../persona/persona.js";

/** Keep existing library entries and make a saved style editable in Persona. */
export function saveInferredPersona(rt: Pick<Runtime, "config" | "saveConfig">, inferred: Persona,
  characterName: string, use: boolean): number {
  const config = rt.config();
  const added = [...config.personas, normalize({ ...inferred, name: `${characterName}'s style` })];
  const removed = Math.max(0, added.length - 50);
  const personas = added.slice(removed);
  const index = personas.length - 1;
  rt.saveConfig({ ...config, personas, activePersona: use ? index : Math.max(-1, config.activePersona - removed) });
  return index;
}
