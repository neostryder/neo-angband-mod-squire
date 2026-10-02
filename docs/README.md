# Squire: quick reference

A learning Angband autoplayer. Press Ctrl-Z and Squire plays your character, asking a model what to do at each moment that matters. Press any key to take the keyboard back. With no model set up, it keeps playing by its own rules. You can choose a short errand under Mods, then Squire.

This page is the short version: every setting, what the mod asks the game for,
and where the longer material is. The account of why each of these exists is in
[the repository README](../README.md).

## Settings

Each one is a named toggle on the game's own Mods screen, which shows the full
description. The identifier is the name a save and another mod see; where a
switch has no flag of its own, the game knows it by its section id instead.

| Setting | Identifier | Default | What it does |
| --- | --- | --- | --- |
| Errand: clear what is in front of me | `squire.errandAutofight` | on | Hand over with a creature in sight and Squire attacks the nearest one it can reach. |
| Errand: explore this floor | `squire.errandAutoexplore` | on | Hand over with nothing in sight and Squire walks toward the nearest unmapped ground. |
| Errand: play on until I take the keyboard back | `squire.errandCampaign` | off | Take precedence over both short errands and play the character, with these priorities in order: survive, fight, collect, explore, descend. |
| Let a model choose what to do | `squire.useModel` | on | When a model is set up in the Squire panel, Squire asks it what to do at each decision and plays on until you take the keyboard back. With no model, Squire chooses from its current fight and travel offers. Switch this off to choose a short errand. |
| Stop when I am hurt | `squire.stopOnLowHealth` | on | End a short errand when hit points reach the retreat line. |
| Stop when something new appears | `squire.stopOnNewCreature` | on | End the errand the moment a creature that was not already in sight comes into view, so exploring does not walk your character into a room you did not choose to enter. |
| Retreat line | `squire.retreatPercent` | 50% | The share of maximum hit points at which a short errand ends, from 10% to 90%. |
| Short errand length | `squire.errandSteps` | 200 | How many decisions a short errand makes before it ends, from 50 to 500. |
| Attack sleeping creatures | `squire.wakeSleepers` | off | Let the fighting errand pick a sleeping creature as its target. |
| Pick things up on the way | `squire.collect` | on | During the long errand, pick up whatever is lying on a square the character has already walked onto. |
| Take the stairs down | `squire.descend` | on | During the long errand, walk to a known down staircase and use it once the floor has been walked out. |

## Shop memory

Squire learns a shop's stock when the character enters it. It saves the names, prices and quantities with the character, then plans purchases from those memories. It remembers exactly what it saw, though the shop may have sold the item or restocked by the time it comes back. Only a Forgetful persona lets those memories fade, sooner when it is impulsive and later when it is patient or greedy. A return visit replaces the remembered stock and owner. If an item it saved for has gone, Squire changes the aim and notes the disappointment in its log. Town trips also look into mapped shops whose stock is unknown or forgotten, once per shop during that trip.

## What it needs

- **Engine:** `>=1.21.1`
- **Shape:** `plugin`
- **Facets:** `plugin`
- **Capabilities:** `command:add`, `state:player.read`, `state:monsters.read`, `state:map.read`, `state:floor.read`, `state:target.read`, `state:inventory.read`, `state:spells.read`, `state:stores.read`, `state:constants.read`, `state:turn.read`, `state:messages.read`, `event:combat-outcome`, `event:player-command`, `ui:panel.mount`, `ui:birth.replace`, `ui:title`, `registry:command`, `keymap:write`, `saves:manage`, `profiles:manage`, `network:api.typesafe.ai`, `network:local`, `network:squire.rpgm.tools`

The model, panel and Setup choices (brain, key, personas, telemetry, roll-on, Knight's Lessons) live in the Squire panel rather than on the Mods screen. The errand settings above apply only when no model is choosing.

`saves:manage` is used only to start the next character when roll-on is switched on in Setup, and `ui:birth.replace` only to accept that one creation without the birth screens. `network:local` reaches a Laya or other server on this computer or your home network, and `network:squire.rpgm.tools` sends telemetry only when you turn it on.

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
