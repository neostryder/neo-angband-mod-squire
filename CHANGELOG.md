# Changelog

All notable changes to this mod are recorded here. Versions follow the mod's own
`manifest.json`, which is what the game reads, and each released version has a
matching git tag that an install pins itself to.

An entry has to matter to somebody running the mod. Documentation wording,
internal refactoring and test-only additions are not recorded here. Bug fixes
are, however small.

An entry opens with one or more bracketed tags. `[Visible]` marks a change a
player would notice in the game or mod itself; `[Internal]` marks one that
touches only code, tooling, or a maintainer's own workflow, with nothing for a
player to see. A further tag (`[Security]`, `[Balance]`, `[UI]`, `[Modding-API]`,
`[Localization]`, `[Save-Compat]`, `[Docs]`, `[Content]`, `[Compatibility]`, and
others as they come up) names what kind of change it is. Lists appear in this
order and each is omitted when empty for a release: Added, Changed, Removed,
Fixed.

## [Unreleased]

### Added

- [Visible] [UI] **Squire runs one bounded errand and then hands the keyboard back.** Three errands ship: engage one creature and stop, walk out the unexplored part of a floor and stop, and a longer errand that carries the character until there is nothing left to do on the floor. Which short errand runs is read from the world at handover, so handing over with something in sight fights it and handing over in an empty corridor explores. An errand that ends stops issuing commands, and the game's own hatch gives the keyboard back on the next key pressed.

- [Visible] [UI] **Every short errand ends on a disturbance rather than playing through one.** A creature that was not in sight arriving, a loss of hit points, a status effect landing, the floor changing underfoot, and death all end an errand on the decision they happen. The exploring errand ends on the first point of damage; the fighting errand keeps going and ends at half hit points instead, since damage during a fight is the fight. None of it is read from message text, so the conditions hold in every language.

- [Visible] [UI] **Eight settings, each a labelled toggle.** Three choose which errands are offered, two choose which disturbances end one, and three cover attacking sleeping creatures, picking things up, and taking the stairs down during the long errand.

- [Visible] [Balance] **A sleeping creature is never chosen as a target on its own.** Waking something the character had walked quietly past is a decision a player makes; a target the player set with the game's own targeting command is honoured whether it is asleep or not. The behaviour can be switched on.

- [Internal] [Modding-API] **Routing plans only over ground the character remembers.** Paths are poured as a breadth-first flow field over remembered, walkable, non-burning ground, and the only move that is not planned that way is a step into an unexplored grid next to the character. The map view's floor-object count reports the live floor rather than the player's knowledge, so nothing routes toward it and collecting is limited to what is underfoot.

- [Internal] [Modding-API] **Terrain is classified from the bound feature registry by flag rather than by code.** A mod's own staircase, door or burning ground is recognised on exactly the same terms as the base game's. A missing registry degrades to an errand that walks the floor without taking stairs or opening doors, and says so in the log.
