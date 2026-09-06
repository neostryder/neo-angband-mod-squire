# Squire

**An Alternative Angband Autoplayer.**

An autoplayer plays the game. Squire runs an errand and hands the keyboard back.

That is the whole difference, and everything else in this repository follows from
it. Squire will clear what is in front of the character, or walk out the rest of
the floor, and then it stops. Its stop conditions are the feature rather than a
safety net attached to one: every errand is written from its ending backwards,
and a player never has to fight this mod for their own keyboard.

Squire is a **mod**. Nothing here is compiled into the game, it installs and
uninstalls like anything else in the mod manager, and it reaches the game only
through the frozen perceive and act agent seam that any third-party agent uses.
It has no privileged access to the engine.

## What it is not

- **Not a way to play better.** The decisions are deliberately simpler than a
  faithful autoplayer's. Squire has no shopping, no equipment decisions, no
  spellcasting and no depth model, and it dies sooner than something that has all
  four. What it is instead is legible and short.
- **Not a change to the game.** It adds no rule, no record and no system
  override. Every decision comes out as a command a player could have typed.
- **Not a second autoplayer running alongside another one.** The game installs a
  single autoplayer, so Squire and any other are alternatives. Enable both and
  the game refuses the second by name and says which one already has the
  keyboard.
- **Not a way to get a scored character.** Handing a character to any autoplayer
  marks the save permanently, and the game refuses that character a high score
  afterwards. That is the game's own rule and Squire is subject to it.

## The errands

| Errand | What it does | What ends it |
| --- | --- | --- |
| **Clear what is in front of me** | Picks one creature, walks to it, and fights until it is down. | The target falls, the target leaves, something new arrives, hit points cross the retreat line, a status effect lands, the walk is blocked. |
| **Explore this floor** | Walks toward the nearest unmapped ground until the floor is walked out. | The floor is finished, anything comes into view, any hit lands, a status effect lands, the character stops making progress. |
| **Play on until I take the keyboard back** | Carries the character: survive, fight, collect, explore, descend. | Death, or nothing left to do on the floor. Deliberately not disturbance. |

Every one of those endings is derived from the character and the creatures rather
than from the text of a message, so they hold in every language and in every
front end.

## Handing over, and getting the keyboard back

1. **Install and enable Squire.** Escape menu -> **Mods**. It has done nothing to
   the character yet, and it will not until it is asked.
2. **Press Ctrl-Z in play.** The game warns, confirms, and Squire takes over from
   the next turn.
3. **Press any key.** The keyboard comes back at once, the character stays exactly
   where it is, and the key that did it is swallowed rather than acted on. Ctrl-Z
   again does the same thing.

Step 3 is not something Squire implements. It is the game's own hatch, and it
works whether Squire has ended its errand or is in the middle of one.

### Which errand runs is read from the world

There is no errand menu, because the world already says what was meant. Hand over
with something in sight and Squire fights it; hand over in an empty corridor and
Squire explores. The long errand overrides both when it is switched on, and each
of the three can be switched off on its own.

**One handover is one errand.** When an errand ends, Squire stops issuing commands
and waits, and the next key both takes the keyboard back and releases the mod. A
second errand therefore means a second Ctrl-Z. See
[PLANNED.md](PLANNED.md) for what would make that a single keystroke and why the
change belongs in the game rather than here.

## Toggles

Every one of these is a labelled switch under Mods -> Squire.

| Toggle | Default | What it changes |
| --- | --- | --- |
| Errand: clear what is in front of me | on | Offer the fighting errand when something is in sight at handover. |
| Errand: explore this floor | on | Offer the exploring errand when nothing is. |
| Errand: play on until I take the keyboard back | off | Carry the character instead of running one short errand. |
| Stop when I am hurt | on | End a short errand when hit points fall below half. |
| Stop when something new appears | on | End a short errand the moment an unseen creature comes into view. |
| Attack sleeping creatures | off | Let the fighting errand choose a sleeping creature. |
| Pick things up on the way | on | During the long errand, take what is underfoot. |
| Take the stairs down | on | During the long errand, use a known down staircase. |

Two numbers are fixed rather than offered: the retreat line is half of maximum
hit points, and a short errand is allowed two hundred decisions. Neither is a
yes-or-no, and the game's rule schema carries a boolean and nothing else.

### Why a sleeping creature is left alone

The fighting errand will not choose one. Waking something the character had walked
quietly past changes the shape of the next ten minutes of play, and that is a
decision a player makes rather than one an errand makes on their behalf. Naming a
target first overrides this: using the game's own targeting command IS the
decision to wake it, and an errand that second-guessed that would make targeting
useless while this mod is installed.

### Why the exploring errand stops on the first point of damage

Not on the retreat line, which is where the fighting errand stops. The two errands
are asking different questions. Damage during a fight is the fight; damage while
walking about is something attacking a character that was not paying attention,
and the point of the errand is to give that decision back immediately rather than
once it has become serious.

### Why Squire will not walk toward loot it can see

The map view reports how many objects are lying on a grid, and it reports the live
floor rather than what the character remembers seeing. Routing toward a high count
would be walking to loot a player has no way to know is there. So collecting is
limited to what is underfoot on a grid the errand has already arrived at, where the
count and the character's own knowledge are the same thing.

The same line runs through the routing: a path is only ever planned over ground the
character remembers. The one move that is not is stepping into an unexplored grid
next to the character, which reads nothing about what is there and is exactly what a
person does when they walk into the dark.

### Why the long errand exists at all

A mod whose argument is that bounded actions beat an autoplayer still has to be able
to play, or the argument is untested. The short errands are made of the same
decisions, and decisions that cannot carry a character down a floor were not going
to clear a room either. It is off by default because it is not the reason to install
this.

## Installing

Two files: `manifest.json` and `plugin.js`. Any of:

- **In the game** - Mods -> **Install a mod...**, which fetches this repository at
  a release tag, never a branch, so what arrives cannot change under you
  afterwards. The install records a SHA-256 of every byte that arrived, which is
  what lets the manager answer later whether the copy on your machine has changed.
- **A folder** - clone this repository into your mods directory, or point the
  browser build at it with **Load mod folder**.

`plugin.js` is generated from `plugin.ts` and the sources under `src/`. It is
committed because that is what an install fetches. Edit the source, not that file,
and if you are reading it to decide whether to trust it, that is exactly why it
ships unminified.

## Building and testing the mod

```bash
pnpm install --frozen-lockfile
pnpm verify
```

That typechecks, runs the tests, and confirms the committed `plugin.js` is a
current build of the source. An install fetches the committed `plugin.js` from a
pinned tag and runs it as it is; nothing rebuilds it on the way in, so a stale
artefact can pass every other check and still be the file players run. `pnpm check`
is the only check that examines it.

```bash
pnpm build     # rebuild plugin.js after editing the source
```

No checkout of the game is needed. The engine types and the plugin builder are
published packages.

### How the tests work

The tests drive the decision code through a world described in a string rather
than through a booted game:

```
"########",
"#.@....#",
"#.#### #",
"########",
```

That is a deliberate choice for an autoplayer. Every interesting case here is a
shape of world - a corridor with one frontier left in it, a sleeping creature the
errand must walk past, a hit that lands while the character is walking - and a
generated level cannot be asked for one of those on demand. A map drawn in a string
can be, and each stop condition then has a test that fails when that condition stops
firing.

What that trades away is the guarantee that the real view reports what the harness
reports. That comes from the other direction: everything the harness builds is typed
as the engine's own `AgentView` and `AgentActions`, so a field the errands read that
changes shape in the engine fails the typecheck here.

## Releasing

A tag matching `vX.Y.Z` is the release: there is no separate publish step. A minor
or major bump posts an announcement to the RPGM Tools Discord's Neo Angband
announcements forum automatically, built from the matching
[CHANGELOG.md](CHANGELOG.md) heading. A patch-only bump stays quiet by design.

## Support and bug reports

[**The RPGM Tools Discord**](https://discord.gg/YegtwbHTBQ) is the fastest way to
ask anything - whether a behaviour is intended, how to get this installed, or what
you should try next. No GitHub account needed.

[Open an issue here](../../issues/new/choose) for a bug in **this mod**. Two things
belong against the game instead, and the forms will point you there: the mod
**system** (an install that fails, a load order that will not stick, a conflict
report that looks wrong), and the game **not matching Angband 4.2.6** once this mod
is switched off.

For anything that should not be public, including a security report:
**strider-angband (at) rpgm.tools**. See [SECURITY.md](SECURITY.md).

Asking about AI use in this project? [AI_USAGE_POLICY.md](AI_USAGE_POLICY.md) is the
complete answer.

[TERMS.md](TERMS.md) covers use of this mod. The core repository's
[PRIVACY.md](https://github.com/neostryder/neo-angband/blob/master/PRIVACY.md)
covers what is stored and what network requests the game makes. Project
participation is subject to the shared [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Licence

Same dual licence as Neo Angband and Angband: GPL v2 or the Angband licence. See
[LICENSE.md](LICENSE.md).

## Credits

Built by neostryder / RPGM Tools as part of Neo Angband. The bounded-automation
direction, and the separate requests for a single autofight command and an
autoexplore that keeps going to the next unexplored area, were raised on r/angband
by `angbandfourk`. Angband is the work of Ben Harrison, James E. Wilson, Robert A.
Koeneke and the Angband contributors.
