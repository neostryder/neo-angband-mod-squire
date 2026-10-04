/**
 * Fails when manifest.json asks for more of the game than Squire may see. Squire reads only what the character knows, so it may not ask for the real map, for a wildcard state grant, or for any raw core, state or registry access. A wildcard grant such as `state:*.read` would also cover every state domain the game adds later, and `state:map-actual.read` shows squares the character has never seen.
 *
 * The manifest is a schema 2 document, so its grants sit under `data.capabilities`. A bare schema 1 manifest still works here, which keeps the check usable on an older checkout. A path argument checks that file instead of the repository's manifest.json.
 *
 * `registry:command` is the one registry grant allowed. It reaches the command host behind the order command, not the game's records, and it stays until Core gives commands an API 2 home (docs/API2-MIGRATION.md).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The registry grants Squire may hold. */
const ALLOWED_REGISTRY = new Set(["registry:command"]);

/** The reason a grant is refused, or null when Squire may hold it. */
export function refusal(grant) {
  if (grant === "state:map-actual.read") return "it reads the real map";
  if (/^state:[^.]*\*/.test(grant)) return "it is a wildcard state grant";
  if (grant.startsWith("state:") && !/^state:[a-z][a-z-]*\.read$/.test(grant)) return "it is state access beyond reading one known domain";
  if (/^(truth|core|registries)(:|\.|$)/.test(grant)) return "it asks for truth, core or registries access";
  if (grant.startsWith("registry:") && !ALLOWED_REGISTRY.has(grant)) return "it reaches a game registry";
  return null;
}

/** The grants a manifest declares, from a schema 2 document or a bare schema 1 manifest. */
export function grantsOf(manifest) {
  const fields = manifest !== null && typeof manifest === "object" && manifest.format === "neo-angband/mod/manifest" ? manifest.data : manifest;
  const declared = fields?.capabilities ?? [];
  if (!Array.isArray(declared)) return [];
  return declared.filter((grant) => typeof grant === "string");
}

/** Every refused grant in a manifest, each with its reason. */
export function refusedGrants(manifest) {
  return grantsOf(manifest).flatMap((grant) => {
    const why = refusal(grant);
    return why === null ? [] : [`${grant} (${why})`];
  });
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const path = process.argv[2] ?? fileURLToPath(new URL("../manifest.json", import.meta.url));
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  const refused = refusedGrants(manifest);
  if (refused.length > 0) {
    console.error(`manifest.json must name each state domain it reads and must not ask for the real map or for raw core, state or registry access. Remove these grants: ${refused.join(", ")}`);
    process.exit(1);
  }
}
