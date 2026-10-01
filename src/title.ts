/**
 * The title screen's "New Squire character" row. An autoplayer's games want
 * their own options, mod settings and roster, so the row offers a separate
 * profile first and this profile second, and starts character creation with
 * Squire armed in either.
 *
 * Without the title and profile seams (an older game) the row is not
 * registered and Squire behaves as it did before.
 */

import type { ModProfile, ModProfiles, ModTitle, ModTitleRow, ProfileResult } from "@rpgm-tools/neo-angband-core";
import type { KvStore } from "./memory/kv.js";

/** The parts of the plugin context the row reads. */
export interface TitleCtx {
  readonly id?: string;
  readonly title?: ModTitle;
  readonly profiles?: ModProfiles;
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

const ARMED = { kind: "create-character", armController: true } as const;

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
    const active = profiles!.list();
    const id = active.ok ? active.value.find((profile) => profile.active)?.id ?? null : null;
    const started = profiles!.switchTo(id, ARMED);
    if (!started.ok) await title!.choose(`Squire could not start the character: ${started.reason}`, [GIVE_UP]);
  }

  /** A refusal on the way to a separate profile falls back to this one. */
  async function refused(reason: string): Promise<void> {
    const answer = await title!.choose(`Squire could not use a separate profile: ${reason}`, [FALLBACK_HERE]);
    if (answer === 0) await here();
  }

  async function separate(): Promise<void> {
    const listed = profiles!.list();
    if (!listed.ok) return refused(listed.reason);
    const all = listed.value;
    const ours = new Set(await remembered(store));
    const made = all.filter((profile) => profile.id !== null && ours.has(profile.id));
    const which = await title!.choose(WHICH_PROMPT, [WHICH_FRESH, WHICH_COPY, ...made.map((profile) => `Use ${profile.name}`)]);
    if (which === null) return;
    let target: ModProfile;
    if (which >= 2) {
      const chosen = made[which - 2];
      if (chosen === undefined) return;
      target = chosen;
    } else {
      let copyFrom: string | null | undefined;
      if (which === 1) {
        const source = await title!.choose(COPY_PROMPT, all.map((profile) => profile.name));
        if (source === null) return;
        const picked = all[source];
        if (picked === undefined) return;
        copyFrom = picked.id;
      }
      const created = profiles!.create(freshName(all.map((profile) => profile.name)), copyFrom === undefined ? {} : { copyFrom });
      if (!created.ok) return refused(created.reason);
      target = created.value;
      if (target.id === null) return refused("the new profile has no id");
      /* A copy keeps the loadout it was copied for; a fresh profile needs Squire, which depends on no other mod. */
      if (copyFrom === undefined) {
        const enabled = profiles!.setEnabledMods(target.id, [self]);
        if (!enabled.ok) return refused(enabled.reason);
      }
      await store.set(PROFILES_KEY, [...ours, target.id]).catch(() => undefined);
    }
    const switched = profiles!.switchTo(target.id, ARMED);
    if (!switched.ok) return refused(switched.reason);
  }

  title.registerRow({
    label: TITLE_LABEL,
    key: TITLE_KEY,
    async run() {
      const where = await title.choose(WHERE_PROMPT, [WHERE_SEPARATE, WHERE_HERE]);
      if (where === 0) await separate();
      else if (where === 1) await here();
    },
  });
  return true;
}
