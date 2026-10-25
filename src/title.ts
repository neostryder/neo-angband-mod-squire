/**
 * The title screen's "New Squire character" row. An autoplayer's games want
 * their own options, mod settings and roster, so the row offers a separate
 * profile first and this profile second, and starts character creation with
 * Squire armed in either.
 *
 * Without the title and profile seams (a mod the game does not give the
 * management namespace) the row is not registered.
 */

import type { Api2Manage, Api2Profile, Api2ProfileAction, Api2Title } from "@rpgm-tools/neo-angband-mod-sdk";
import type { KvStore } from "./memory/kv.js";

/** The parts of the plugin context the row reads. */
export interface TitleCtx {
  readonly id?: string;
  readonly title?: Api2Title;
  readonly profiles?: Api2Manage["profiles"];
}

export const TITLE_LABEL = "New Squire character";
/** Core keeps P, N, O, R, M, I, U and Q for its own rows. */
export const TITLE_KEY = "S";
/** Install-level, so every profile sees the profiles Squire made. */
export const PROFILES_KEY = "squire/profiles";

export const WHERE_PROMPT = "Where should the new Squire character live?";
export const WHERE_SEPARATE = "In a separate profile, with its own options, mods and characters";
export const WHERE_HERE = "In this profile";
export const WHICH_PROMPT = "Which profile should Squire use?";
export const WHICH_FRESH = "Start a fresh profile";
export const WHICH_COPY = "Copy an existing profile";
export const COPY_PROMPT = "Copy which profile? Its options, mods and mod settings come across, but not its characters.";
export const FALLBACK_HERE = "Start the character in this profile";
export const GIVE_UP = "Back to the title";

const ARMED: Api2ProfileAction = { kind: "create-character", armController: true };

/** The player's choice, or null for Escape or a game that cannot ask. */
async function ask(title: Api2Title, label: string, choices: readonly string[]): Promise<number | null> {
  const answer = await title.choose(label, choices);
  return answer.ok ? answer.value : null;
}

async function remembered(store: KvStore): Promise<string[]> {
  const saved = await store.get(PROFILES_KEY).catch(() => undefined);
  return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : [];
}

/** "Squire", then "Squire 2" and onward, skipping names already in use. */
export function freshName(taken: readonly string[]): string {
  const used = new Set(taken.map((name) => name.toLowerCase()));
  if (!used.has("squire")) return "Squire";
  for (let n = 2; ; n++) if (!used.has(`squire ${String(n)}`)) return `Squire ${String(n)}`;
}

/** Register the row when the host offers both seams. Returns whether it did. */
export function registerSquireTitle(ctx: TitleCtx, store: KvStore): boolean {
  const title = ctx.title;
  const profiles = ctx.profiles;
  if (title === undefined || profiles === undefined) return false;
  const self = ctx.id ?? "squire";

  async function here(): Promise<void> {
    const active = await profiles!.list();
    const id = active.ok ? active.value.find((profile) => profile.active)?.id ?? null : null;
    const started = await profiles!.switchTo(id, ARMED);
    if (!started.ok) await ask(title!, `Squire could not start the character: ${started.message}`, [GIVE_UP]);
  }

  /** A refusal on the way to a separate profile falls back to this one. */
  async function refused(reason: string): Promise<void> {
    const answer = await ask(title!, `Squire could not use a separate profile: ${reason}`, [FALLBACK_HERE]);
    if (answer === 0) await here();
  }

  async function separate(): Promise<void> {
    const listed = await profiles!.list();
    if (!listed.ok) return refused(listed.message);
    const all = listed.value;
    const ours = new Set(await remembered(store));
    const made = all.filter((profile) => profile.id !== null && ours.has(profile.id));
    const which = await ask(title!, WHICH_PROMPT, [WHICH_FRESH, WHICH_COPY, ...made.map((profile) => `Use ${profile.name}`)]);
    if (which === null) return;
    let target: Api2Profile;
    if (which >= 2) {
      const chosen = made[which - 2];
      if (chosen === undefined) return;
      target = chosen;
    } else {
      let copyFrom: string | null | undefined;
      if (which === 1) {
        const source = await ask(title!, COPY_PROMPT, all.map((profile) => profile.name));
        if (source === null) return;
        const picked = all[source];
        if (picked === undefined) return;
        copyFrom = picked.id;
      }
      const created = await profiles!.create(freshName(all.map((profile) => profile.name)), copyFrom);
      if (!created.ok) return refused(created.message);
      target = created.value;
      if (target.id === null) return refused("the new profile has no id");
      /* A copy keeps the loadout it was copied for; a fresh profile needs Squire, which depends on no other mod. */
      if (copyFrom === undefined) {
        const enabled = await profiles!.setEnabledMods(target.id, [self]);
        if (!enabled.ok) return refused(enabled.message);
      }
      await store.set(PROFILES_KEY, [...ours, target.id]).catch(() => undefined);
    }
    const switched = await profiles!.switchTo(target.id, ARMED);
    if (!switched.ok) return refused(switched.message);
  }

  void title.registerRow({
    id: "squire:new-character",
    label: TITLE_LABEL,
    key: TITLE_KEY,
    async run() {
      const where = await ask(title, WHERE_PROMPT, [WHERE_SEPARATE, WHERE_HERE]);
      if (where === 0) await separate();
      else if (where === 1) await here();
    },
  }).catch(() => undefined);
  return true;
}
