/**
 * Fails when manifest.json asks for more game state than the mod reads. A
 * wildcard grant such as `state:*.read` would also cover every state domain
 * the engine adds later, and `state:map-actual.read` shows squares the
 * character has never seen.
 */

import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const refused = (manifest.capabilities ?? []).filter((grant) => /^state:[^.]*\*/.test(grant) || grant === "state:map-actual.read");
if (refused.length > 0) {
  console.error(`manifest.json must name each state domain it reads and must not read the real map. Remove these grants: ${refused.join(", ")}`);
  process.exit(1);
}
