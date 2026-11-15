import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";
import type { Api2ControllerContext } from "@rpgm-tools/neo-angband-mod-sdk";
import { describe, expect, it } from "vitest";
import plugin from "../plugin.js";

const root = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".fixture.ts") ? [path] : [];
  });
}

function insideFunction(node: ts.Node, source: ts.SourceFile, name: string): boolean {
  return source.statements.some((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name && statement.body !== undefined && node.getStart(source) >= statement.body.getStart(source) && node.end <= statement.body.end);
}

function forbiddenReads(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const report = (node: ts.Node, pattern: string): void => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.push(`${file}:${String(line + 1)}: forbidden ${pattern}`);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === "registries" || ts.isStringLiteralLike(node) && node.text === "registries") report(node, "registries");
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const key = ts.isPropertyAccessExpression(node) ? node.name.text : node.argumentExpression !== undefined && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : undefined;
      const receiver = node.expression;
      if (key === "engine" || ts.isIdentifier(receiver) && receiver.text === "engine") {
        if (file !== "plugin.ts" || !insideFunction(node, source, "characterAlreadyAutoplayed")) report(node, ".engine / engine?. access");
      }
      if (key === "state" && ts.isIdentifier(receiver) && ["ctx", "context", "host"].includes(receiver.text)) {
        /* These two API 1 leftovers are not on the API 2 path. */
        const legacy = file === "src/host-adapter.ts" && ["viewWorld", "autoplayedBefore"].some((name) => insideFunction(node, source, name));
        if (!legacy) report(node, `${receiver.text}.state`);
      }
    }
    /* The legacy exceptions depend on their imports staying type-only. */
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && /(?:^|\/)host-adapter\.js$/.test(node.moduleSpecifier.text)) {
      const clause = node.importClause;
      if (clause === undefined || !clause.isTypeOnly && (clause.name !== undefined || clause.namedBindings === undefined || !ts.isNamedImports(clause.namedBindings) || clause.namedBindings.elements.some((element) => !element.isTypeOnly))) report(node, "runtime import of API 1 host-adapter");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("Squire reads only what the player knows", () => {
  it("arms using only engine.state.actor.player.noscore", () => {
    for (const [noscore, armed] of [[0, false], [0x0001, false], [0x0020, true], [0x0021, true]] as const) {
      const reads: string[] = [];
      const only = (path: string, key: string, value: unknown): object => new Proxy({}, {
        get(_target, property) {
          if (property !== key) throw new Error(`Forbidden read: ${path}.${String(property)}`);
          reads.push(`${path}.${key}`);
          return value;
        },
      });
      const player = only("engine.state.actor.player", "noscore", noscore);
      const actor = only("engine.state.actor", "player", player);
      const state = only("engine.state", "actor", actor);
      const engine = only("engine", "state", state);
      const context = { id: "squire", flags: {}, armed: false, engine } as unknown as Api2ControllerContext;
      expect(() => {
        expect(plugin.armed?.(context)).toBe(armed);
      }).not.toThrow();
      expect(reads).toEqual(["engine.state", "engine.state.actor", "engine.state.actor.player", "engine.state.actor.player.noscore"]);
    }
  });

  it("forbids raw state access outside the arming check and legacy API 1 readers", () => {
    const files = [join(root, "plugin.ts"), ...sources(join(root, "src"))];
    const found = files.flatMap((file) => forbiddenReads(relative(root, file).replace(/\\/g, "/"), readFileSync(file, "utf8")));
    expect(found).toEqual([]);
  });
});
