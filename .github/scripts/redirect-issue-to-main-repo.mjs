#!/usr/bin/env node
/**
 * Redirect an issue opened directly on a mod repo into the consolidated
 * neostryder/neo-angband tracker, so every issue lives in one place
 * regardless of which repo a reporter happened to file it on.
 *
 * Reused byte-for-byte across the mod repositories - only the repository
 * name (used to derive the repo:X label) varies, and that's read from the
 * environment rather than hardcoded per copy.
 *
 * Env vars:
 *   MOD_REPO      "owner/name" of the repo this ran in, e.g.
 *                 "neostryder/neo-angband-mod-borg"
 *   ISSUE_NUMBER  the just-opened issue's number
 *   ISSUE_URL     the just-opened issue's URL
 *   ISSUE_TITLE   the just-opened issue's title
 *   ISSUE_BODY    the just-opened issue's body (may be empty)
 *   ISSUE_AUTHOR  the reporter's GitHub username
 *   ISSUE_LABELS  comma-separated label names already on the issue
 *   GH_TOKEN      a token with issue read/write on both this repo and
 *                 neostryder/neo-angband (the default per-repo
 *                 GITHUB_TOKEN can't write to a different repository)
 *
 * Before filing a new issue, searches the main repo (open and closed) for
 * a likely existing match by title. This is a keyword heuristic, not a
 * content-level check - it catches "someone already reported/fixed this
 * under a different title-ish issue" but can't tell that a PR's actual
 * code change already exists in a sibling repo's shipped tree. That
 * heavier check is a separate, Loremaster-backed project.
 *
 * Deliberately does not label a freshly-created issue source:community -
 * it's still genuinely "opened directly on GitHub", now on the repo the
 * rest of the pipeline watches, so the existing GitHub-native announcement
 * scan (neo-angband-issue-webhook.py's announce_github_native_issues) picks
 * it up and gives it a Discord thread automatically, attributed to the real
 * reporter. This script's only job is getting the issue onto the right repo
 * (new or existing) with the right labels - Discord visibility is already
 * handled downstream.
 */

import { execFileSync } from "node:child_process";

const MAIN_REPO = "neostryder/neo-angband";
const DUPLICATE_SIMILARITY_THRESHOLD = 0.6;
const STOPWORDS = new Set([
  "a", "an", "the", "of", "to", "in", "on", "for", "and", "or", "is", "are",
  "with", "at", "from", "into", "when", "while", "still", "not", "it", "its",
]);

const MOD_REPO = requireEnv("MOD_REPO");
const ISSUE_NUMBER = requireEnv("ISSUE_NUMBER");
const ISSUE_URL = requireEnv("ISSUE_URL");
const ISSUE_TITLE = requireEnv("ISSUE_TITLE");
const ISSUE_BODY = process.env.ISSUE_BODY || "(no description provided)";
const ISSUE_AUTHOR = requireEnv("ISSUE_AUTHOR");
const ISSUE_LABELS = (process.env.ISSUE_LABELS || "").split(",").map((s) => s.trim()).filter(Boolean);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var ${name}`);
    process.exit(1);
  }
  return value;
}

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8" }).trim();
}

// "neostryder/neo-angband-mod-borg" -> "mod-borg"
function productKeyFor(repoFullName) {
  const name = repoFullName.split("/")[1];
  const key = name.replace(/^neo-angband-/, "");
  return key || "neo-angband";
}

function titleTokens(title) {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 1 && !STOPWORDS.has(word)),
  );
}

function titleSimilarity(a, b) {
  const tokensA = titleTokens(a);
  const tokensB = titleTokens(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let overlap = 0;
  for (const token of tokensA) if (tokensB.has(token)) overlap += 1;
  const union = new Set([...tokensA, ...tokensB]).size;
  return overlap / union;
}

// Best-guess existing issue on the main repo, by title keyword overlap.
// Not a content-level check - a conservative heuristic, biased toward
// "create a new issue" on anything less than a confident match, since a
// suppressed real report is worse than an extra one a human can merge.
function findExistingIssue(title) {
  const query = [...titleTokens(title)].join(" ");
  if (!query) return null;

  let candidates;
  try {
    const raw = gh([
      "issue", "list",
      "--repo", MAIN_REPO,
      "--search", query,
      "--state", "all",
      "--json", "number,title,url,state",
      "--limit", "5",
    ]);
    candidates = raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error(`Dedup search failed, falling back to create: ${err.message}`);
    return null;
  }

  let best = null;
  for (const candidate of candidates) {
    const score = titleSimilarity(title, candidate.title);
    if (!best || score > best.score) best = { ...candidate, score };
  }
  if (best && best.score >= DUPLICATE_SIMILARITY_THRESHOLD) return best;
  return null;
}

function main() {
  const productKey = productKeyFor(MOD_REPO);
  const category = ISSUE_LABELS.includes("enhancement") ? "enhancement" : "bug";

  const existing = findExistingIssue(ISSUE_TITLE);
  let newIssueUrl;

  if (existing) {
    gh([
      "issue", "comment", String(existing.number),
      "--repo", MAIN_REPO,
      "--body", [
        `Also reported on [${MOD_REPO}#${ISSUE_NUMBER}](${ISSUE_URL}) by @${ISSUE_AUTHOR}:`,
        "",
        ISSUE_BODY,
      ].join("\n"),
    ]);
    newIssueUrl = existing.url;
    console.log(`Matched existing ${existing.state} issue ${existing.url} (similarity ${existing.score.toFixed(2)}) - commented instead of creating.`);
  } else {
    const body = [
      ISSUE_BODY,
      "",
      "---",
      `Originally opened on ${MOD_REPO}#${ISSUE_NUMBER} by @${ISSUE_AUTHOR}: ${ISSUE_URL}`,
    ].join("\n");

    newIssueUrl = gh([
      "issue", "create",
      "--repo", MAIN_REPO,
      "--title", ISSUE_TITLE,
      "--body", body,
      "--label", category,
      "--label", `repo:${productKey}`,
    ]).trim().split("\n").pop();

    gh([
      "issue", "comment", newIssueUrl,
      "--repo", MAIN_REPO,
      "--body", `Originally opened on [${MOD_REPO}#${ISSUE_NUMBER}](${ISSUE_URL}) by @${ISSUE_AUTHOR}.`,
    ]);
  }

  gh([
    "issue", "comment", ISSUE_NUMBER,
    "--repo", MOD_REPO,
    "--body",
    `All neo-angband issues are tracked in one place, so this has been moved to ${newIssueUrl} - closing this copy so all discussion happens there. Thanks for the report!`,
  ]);

  gh(["issue", "close", ISSUE_NUMBER, "--repo", MOD_REPO, "--reason", "not planned"]);

  console.log(`Redirected ${MOD_REPO}#${ISSUE_NUMBER} -> ${newIssueUrl}`);
}

main();
