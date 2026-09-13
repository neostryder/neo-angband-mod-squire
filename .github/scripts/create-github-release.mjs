#!/usr/bin/env node
/**
 * Create the GitHub Release for an already-pushed version tag.
 *
 * The release body is the matching CHANGELOG.md section, including its
 * heading, with no generated or paraphrased text. A missing section is an
 * error: publishing a release with invented notes would make the Ledger less
 * trustworthy than leaving the release for a human to resolve.
 *
 * Env vars:
 *   REPO  "owner/name", e.g. "neostryder/neo-angband-mod-squire"
 *   TAG   pushed version tag, e.g. "v0.1.0"
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DISPLAY_NAME = "Neo Angband: Squire";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`::error::${name} is required`);
    process.exit(1);
  }
  return value;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Return one exact version section, from its ## heading to the next ## heading. */
export function changelogSection(markdown, version) {
  const lines = markdown.split(/\r?\n/u);
  const heading = new RegExp(`^##\\s+(?:\\[)?${escapeRegExp(version)}(?:\\])?\\s+-\\s+.+$`, "u");
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/u.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function run() {
  const repo = requireEnv("REPO");
  const tag = requireEnv("TAG");
  const version = tag.replace(/^v/u, "");
  if (version === tag) {
    console.error(`::error::${tag} is not a v-prefixed version tag`);
    process.exit(1);
  }

  const notes = changelogSection(readFileSync("CHANGELOG.md", "utf8"), version);
  if (!notes) {
    console.error(`::error::no CHANGELOG.md section found for ${version}; release was not created`);
    process.exit(1);
  }

  const tempDirectory = mkdtempSync(join(tmpdir(), "neo-angband-release-"));
  const notesPath = join(tempDirectory, "notes.md");
  writeFileSync(notesPath, notes, "utf8");
  try {
    const args = [
      "release",
      "create",
      tag,
      "--repo",
      repo,
      "--title",
      `${DISPLAY_NAME} ${version}`,
      "--notes-file",
      notesPath,
      "--verify-tag",
    ];
    if (/^0\./u.test(version)) args.push("--prerelease");

    const result = spawnSync("gh", args, { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  } finally {
    rmSync(tempDirectory, { force: true, recursive: true });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) run();
