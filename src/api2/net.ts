/**
 * The model server's requests and the key it needs, over API 2's `net`.
 *
 * Squire writes a header as `Bearer {secret:jev}` and reads a reply as
 * `{ ok, status, body }` or `{ ok: false, problem }`. API 2 names the key in the
 * header value (`net.credential("jev", "Bearer ")`) and answers a request with a
 * result. This file keeps Squire's request shape on top of that, so the model
 * backend, the Laya shadow, the orders channel and telemetry need no change.
 */

import type { Api2Net, Api2NetRequest, Api2Result, NetMethod, NetRequest } from "@rpgm-tools/neo-angband-mod-sdk";
import type { ModNet, ModNetResponse, ModNetSecrets, ModSecretResult, ModSecretStorage } from "@rpgm-tools/neo-angband-core";

/** `prefix{secret:name}suffix`: the one placeholder shape Squire sends. */
const PLACEHOLDER = /^(.*)\{secret:([^}]+)\}$/s;

function headersOf(net: Api2Net, headers: NetRequest["headers"]): Api2NetRequest["headers"] {
  if (headers === undefined) return undefined;
  const out: Record<string, string | ReturnType<Api2Net["credential"]>> = {};
  for (const [name, value] of Object.entries(headers)) {
    const match = typeof value === "string" ? PLACEHOLDER.exec(value) : null;
    if (match === null) { out[name] = String(value); continue; }
    out[name] = net.credential(match[2] as string, match[1] === "" ? undefined : (match[1] as string));
  }
  return out;
}

function problem(result: Exclude<Api2Result<unknown>, { ok: true }>): string {
  return result.message;
}

function failure(result: Exclude<Api2Result<unknown>, { ok: true }>): Extract<ModNetResponse, { ok: false }> {
  const code = result.reason === "refused" && result.code !== "" ? result.code : "unreachable";
  return { ok: false, code: code as Extract<ModNetResponse, { ok: false }>["code"], problem: problem(result) };
}

/** Where the most recent credential call said the key is kept. Starts as the desktop app's, which is where it stays unless the host says "page". */
type Storage = ModSecretStorage;

/** A `ModNet` for Squire's code, made from `mod.net`. */
export function netFromApi2(net: Api2Net): ModNet {
  let storage: Storage = "os";
  const note = (kept: { readonly storage?: Storage } | undefined): void => {
    if (kept?.storage !== undefined) storage = kept.storage;
  };
  const secrets: ModNetSecrets = {
    get storage() { return storage === "page" ? "page" : "os"; },
    async set(name, value, options): Promise<ModSecretResult> {
      const result = await net.credentials.set(name, value, options.hosts);
      if (!result.ok) return { ok: false, problem: problem(result) };
      note(result.value);
      return { ok: true, storage: result.value.storage };
    },
    async fromEnv(name, variables, options): Promise<ModSecretResult> {
      const result = await net.credentials.fromEnvironment(name, variables, options.hosts);
      if (!result.ok) return { ok: false, problem: problem(result) };
      note(result.value);
      return { ok: true, storage: result.value.storage };
    },
    async has(name) {
      const result = await net.credentials.status(name);
      if (!result.ok) return { present: false };
      note(result.value);
      return result.value.storage === undefined ? { present: result.value.present } : { present: result.value.present, storage: result.value.storage };
    },
    async delete(name) {
      const result = await net.credentials.remove(name);
      return { ok: result.ok };
    },
  };
  return {
    get transport() { return storage === "page" ? "page" : "relay"; },
    secrets,
    async request(request): Promise<ModNetResponse> {
      const headers = headersOf(net, request.headers);
      const result = await net.request({
        url: request.url,
        ...(request.method === undefined ? {} : { method: request.method as NetMethod }),
        ...(headers === undefined ? {} : { headers }),
        ...(request.body === undefined ? {} : { body: request.body }),
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
      });
      if (!result.ok) return failure(result);
      return { ok: true, status: result.value.status, headers: result.value.headers, body: result.value.body };
    },
  };
}
