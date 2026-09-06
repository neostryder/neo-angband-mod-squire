# Planned

What this mod does not do yet, and what each item is actually waiting on. Nothing
here is in the shipped code; `CHANGELOG.md` is for what is.

## Waiting on a seam in the game

These are not mod-side omissions. Each one needs something the game does not
currently offer a mod, and building a workaround inside this repository would
either be worse than the gap or would not be possible at all.

### A key that starts an errand without a reload

**The gap.** One handover is one errand. When an errand ends, the mod stops
issuing commands and waits; the next key both returns control and releases the
mod, so asking for a second errand means pressing Ctrl-Z again, which reloads the
page.

**Why not fixed here.** There is no seam a mod can use to bind a key to its own
code during play. The keymap facade binds a trigger to a sequence of keystrokes,
not to a callback. The menu facade can add a runnable row to the Escape game
menu, but reaching that menu is itself a keypress, and a keypress while an
autoplayer holds the keyboard releases it before the menu opens. The declarative
keypress-command table is a presentation transform that cannot carry a new
runnable action.

**What a fix needs.** A way for a mod holding the autoplayer slot to be woken by
a key without that key being read as "take the keyboard back", or a way for a mod
to register a runnable player command with a binding. Either belongs in the game
rather than here, because it is the input door's decision and not this mod's.

### Numeric settings

**The gap.** The retreat line (half of maximum hit points) and a short errand's
decision allowance (two hundred) are the two boundaries an errand is measured
against, and neither is adjustable.

**Why not fixed here.** The manifest rule schema carries a boolean `default` and
nothing else. There is no numeric or range rule type to declare one with, and
spelling a number as a row of booleans would be worse than the gap.

**What a fix needs.** A numeric or range rule in the host's rule schema.

### A message the player reads when an errand ends

**The gap.** The reason an errand ended goes to the mod log. A player watching the
screen sees the character stop and has to infer why.

**Why not fixed here.** A controller returns a command, and "print this line" is
not one. The message sink is not part of the context a controller is handed.

**What a fix needs.** Either a message sink on the controller context, or a
message the host itself prints when an installed autoplayer stops issuing
commands.

## Errands not built yet

The issue this mod was opened against names several more, and each is a mission
in `src/missions/` with its own stop conditions once the errand-selection gap
above is closed. Selecting between five errands from the state of the world alone
is not going to work; they need a way to be asked for.

- **Search this floor for valuables.** Explore, then walk the floor collecting.
  Blocked on more than the key: the map view's object count is the live floor
  rather than the player's knowledge, so a fair version needs a knowledge-gated
  read of what is lying about.
- **Get me to the stairs.** The descend rung of the long errand, as an errand of
  its own with a disturbance stop attached.
- **Get me to the next unique.** Needs a way to tell a unique from an ordinary
  creature. `MonsterView.raceFlags` carries the flags, so this is mostly a matter
  of deciding what "get me to" should do when the unique is not in sight.
- **Rest until something happens.** The game's own rest command already stops on
  disturbance, so the errand is thin. It is listed because the interesting part is
  what it should do about a creature that arrives asleep.

## Decisions the errands do not make

Named here so the omissions are visible rather than looking like oversights. None
of them is required for a bounded errand, and each one is a fair amount of work.

- **No item use.** Nothing is quaffed, read, aimed or activated, including at low
  hit points: the survival rung backs away or rests instead. Reading an item well
  enough to use it correctly needs the object registry and the character's own
  awareness of a flavour, which is a body of work rather than a rung.
- **No equipment decisions.** Nothing is worn, taken off, bought or sold.
- **No spellcasting.**
- **No shopping.** Squire has no reason to enter a store and does not read them.
- **No detection or mapping.** An errand explores by walking.
