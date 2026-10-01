# Planned

What this mod does not do yet, and what each item is waiting on. Where part of an item already works, the entry says which part. `CHANGELOG.md` records what has shipped.

## Waiting on a seam in the game

The item below needs a change to Neo Angband itself. Squire cannot work around it from inside the mod.

### A key that starts an errand without a reload

**The gap.** One handover is one errand. When an errand ends, the mod stops issuing commands and waits; the next key both returns control and releases the mod, so asking for a second errand means pressing Ctrl-Z again, which reloads the page.

**Why not fixed here.** A mod can register a command and bind a key to it during play, which is how Squire's order key works. A second errand still needs more, because a keypress while an autoplayer holds the keyboard releases it before any command runs.

**What a fix needs.** A way for a mod holding the autoplayer slot to be woken by a key without that key being read as "take the keyboard back". That belongs in the game rather than here, because it is the input door's decision and not this mod's.

## Errands not built yet

The issue this mod was opened against names several more, and each is a mission in `src/missions/` with its own stop conditions once the errand-selection gap above is closed. Selecting between five errands from the state of the world alone is not going to work; they need a way to be asked for.

- **Search this floor for valuables.** Explore, then walk the floor collecting. When a model is playing, Squire already walks over to worthwhile items on ground the character remembers. The missing piece is an errand that does only that, and to be fair it has to read what the character knows is lying about. The map view counts every object on the floor, seen or not.
- **Get me to the stairs.** The descend rung of the long errand, as an errand of its own with a disturbance stop attached.
- **Get me to the next unique.** Needs a way to tell a unique from an ordinary creature. `MonsterView.raceFlags` carries the flags, so this is mostly a matter of deciding what "get me to" should do when the unique is not in sight.
- **Rest until something happens.** The game's own rest command already stops on disturbance, so the errand is thin. It is listed because the interesting part is what it should do about a creature that arrives asleep.

## Decisions the errands do not make

The errands run only when no model is set up. With a model, Squire also uses its items and spells and shops in town. The errands themselves use no items, cast nothing, make no equipment decisions, never enter a shop and explore only by walking.

## Not built yet

- **A message the player reads when an errand ends.** The reason a fixed errand ended goes only to the mod log, so a player watching the screen sees the character stop and has to work out why. When Squire stops during continuing play with a model, it already passes the reason to the game as the autoplayer's status.
- **An adjustable retreat line.** The retreat line (half of maximum hit points) and a short errand's two hundred decisions are fixed.
- **Wider gear trading.** Squire wears better gear it finds, and in town it buys an affordable weapon or piece of armour that one of its aims calls for. It sells only plain spare weapons and armour, and only when the persona's Selling is 60 or more. Buying gear no aim calls for, and selling anything else, are not built.
- **Playing on a phone through Squire Link.** Squire Link can run beside the model and be published over HTTPS, but Squire's permissions reach only this computer and your home network, so Squire can't use a published address yet.
- **Patron mode.** Watching Squire play and stepping in now and then, with a meter that refills over time, comes in the release after 1.0.
- **Class-themed run cards** (neostryder/neo-angband#303). Drawn card designs themed by class, with a tombstone for a death and a trophy for a win, shared by the share card and the run's Discord post. The Report tab already draws a plain share card and saves it as an image.
