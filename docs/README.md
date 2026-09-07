# Squire: quick reference

An alternative autoplayer. Where an autoplayer normally takes the character and
plays it, Squire runs one short errand and gives the keyboard back: clear what
is in front of you, walk out the rest of this floor, or play on until you say
stop.

This page is the short version: every setting, what the mod asks the game for,
and where the longer material is. The account of why each of these exists is in
[the repository README](../README.md).

## Settings

Each one is a named toggle on the game's own Mods screen, which shows the full
description. The identifier is the name a save and another mod see; where a
switch has no flag of its own, the game knows it by its section id instead.

| Setting | Identifier | Default | What it does |
| --- | --- | --- | --- |
| Errand: clear what is in front of me | `squire.errandAutofight` | on | Hand over with a creature in sight and Squire engages the nearest one it can reach, then stops. |
| Errand: explore this floor | `squire.errandAutoexplore` | on | Hand over with nothing in sight and Squire walks toward the nearest unmapped ground, then stops. |
| Errand: play on until I take the keyboard back | `squire.errandCampaign` | off | Take precedence over both short errands and carry the character instead: survive, fight, collect, explore, descend, in that order. |
| Stop when I am hurt | `squire.stopOnLowHealth` | on | End the errand when hit points fall below half. |
| Stop when something new appears | `squire.stopOnNewCreature` | on | End the errand the moment a creature that was not already in sight comes into view. |
| Attack sleeping creatures | `squire.wakeSleepers` | off | Let the fighting errand pick a sleeping creature as its target. |
| Pick things up on the way | `squire.collect` | on | During the long errand, pick up whatever is lying on a square the character has already walked onto. |
| Take the stairs down | `squire.descend` | on | During the long errand, walk to a known down staircase and use it once the floor has been walked out. |

## What it needs

- **Engine:** `>=1.8.0`
- **Shape:** `plugin`
- **Facets:** `plugin`
- **Capabilities:** `command:add`, `state:player.read`, `state:monsters.read`,
  `state:map.read`, `state:target.read`

What a capability string permits, and what a mod that asks for one cannot do
without it, is in [the mod lifecycle
document](https://github.com/neostryder/neo-angband/blob/master/docs/modding/MOD_LIFECYCLE.md).

## Elsewhere

- [README](../README.md), the full account
- [Changelog](../CHANGELOG.md), what changed in each version
- [Planned](../PLANNED.md), what is not built yet
- [Installing a
  mod](https://github.com/neostryder/neo-angband/blob/master/docs/MODS.md), the
  route every mod installs by
