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

- [Visible] **Squire plays the whole game when a model is set up.** Press Ctrl-Z and Squire asks Jev, Laya or another System One server what to do each time something changes, and plays on until you take the keyboard back. It fights, shoots, throws oil, aims wands, casts attack and healing spells, drinks healing potions, reads Phase Door and Teleportation, backs away, rests, eats, picks things up, learns new spells, wears better gear, maps a new level with a scroll, rod or spell, explores, takes the stairs, and leaves a level once worm masses or other breeders fill it. In town it buys healing, escapes, food, light and oil, and it reads Word of Recall to restock and go back down. Squire uses items only by the names you can see and reads a shop's stock only while standing in it. If the model can't be reached, it retries a few times, then gives you the keyboard and says how to resume. With no model, Squire runs its errands as before.
- [Visible] [UI] **The Squire panel.** A dockable panel with five tabs. Setup picks the model and any backup Laya servers to try when the first is busy, stores its key, tests the connection and sets spend limits. The others are Persona, Lessons, Report, and a Dashboard that shows a depth chart and the latest decisions. Its text grows with the window, and the A- and A+ buttons change its size.
- [Visible] **Personas.** Sliders, favourite and hated lists, quirks and a backstory shape how Squire plays, starting from Default, a random persona or an archetype such as coward, berserker or miser. Squire asks for the best move and the in-character move and blends them, and a safety floor keeps it out of fights it would certainly lose unless the persona has a death wish. Personas can be exported and imported.
- [Visible] **Knight's Lessons.** While you play, Squire forms its own choice at each moment that matters, notes where yours differed and learns your style. It issues no commands. It offers "Why, sir?" reasons and "Watch this" demonstrations, rises through three ranks, infers a persona from your play that you can save, gives exams, and can show a hint when it disagrees.
- [Visible] **Run reports.** When a character Squire played dies, wins or retires, the Report tab shows the outcome, depth, top kills, uniques, lessons, the apprenticeship and tokens used, and saves the report as Markdown or JSON, a share card image, or the full decision log.
- [Visible] **Roll-on.** After a death, Setup can have Squire start the next character, like the last one or with a random race and class, and keep playing. The new character inherits some of what its ancestors learned.
- [Visible] [Security] **Telemetry, off by default.** Setup lists what each level sends to squire.rpgm.tools, from a run summary up to every decision, and a backstory is sent only with its own consent. "Delete what I have sent" removes everything this install has sent.
- [Visible] **Train Laya while Jev plays.** When switched on in Setup, Squire also sends each decision to Laya and never acts on Laya's answer. Every Jev decision is saved as a training row, and a Knight's Lessons row carries your own choice as its label. "Save Laya training rows" downloads them.

### Removed

- [Internal] **Removed this repo's own Discord release announcer.** Its workflow, script and test are gone. The releases site at releases.rpgm.tools now posts each new release to the Neo Angband announcements forum.

### Fixed

- [Visible] **The fighting errand stops when the character is afraid.** The game refuses every blow from an afraid character without using a turn, so the errand swung at the same creature hundreds of times while nothing else moved. An errand whose commands pass no game time now ends as well.
- [Visible] **Exploring goes through closed doors.** A room whose only ways out were closed doors counted as fully explored, so the errand stopped with most of the level unseen.
- [Visible] **Exploring keeps a step away from creatures in view.** The route no longer walks past a mushroom patch or a sleeping creature when there is another way, and it treats a creature the character cannot see as not there, as the player would.

## 0.1.1 - 2026-09-26

### Changed

- [Visible] [UI] **Squire's settings and status lines read more plainly.** Errand and stop-condition descriptions, and a disturbance message, are rewritten for clarity; every errand behaves as before.
- [Visible] [Docs] **The README explains in plainer words why Squire picks up only what lies underfoot and plans paths over ground the character remembers.** The terms and AI usage policy are reworded too.

## 0.1.0 - 2026-09-11

First release.

### Added

- [Visible] [UI] **Squire runs one bounded errand and then hands the keyboard back.** Three errands ship: engage one creature and stop, walk out the unexplored part of a floor and stop, and a longer errand that carries the character until there is nothing left to do on the floor. Which short errand runs is read from the world at handover, so handing over with something in sight fights it and handing over in an empty corridor explores. An errand that ends stops issuing commands, and the game's own hatch gives the keyboard back on the next key pressed.

- [Visible] [UI] **Every short errand ends on a disturbance rather than playing through one.** A creature that was not in sight arriving, a loss of hit points, a status effect landing, the floor changing underfoot, and death all end an errand on the decision they happen. The exploring errand ends on the first point of damage; the fighting errand keeps going and ends at half hit points instead, since damage during a fight is the fight. None of it is read from message text, so the conditions hold in every language.

- [Visible] [UI] **Eight settings, each a labelled toggle.** Three choose which errands are offered, two choose which disturbances end one, and three cover attacking sleeping creatures, picking things up, and taking the stairs down during the long errand.

- [Visible] [Balance] **A sleeping creature is never chosen as a target on its own.** Waking something the character had walked quietly past is a decision a player makes; a target the player set with the game's own targeting command is honoured whether it is asleep or not. The behaviour can be switched on.

- [Internal] [Modding-API] **Routing plans only over ground the character remembers.** Paths are poured as a breadth-first flow field over remembered, walkable, non-burning ground, and the only move that is not planned that way is a step into an unexplored grid next to the character. The map view's floor-object count reports the live floor rather than the player's knowledge, so nothing routes toward it and collecting is limited to what is underfoot.

- [Internal] [Modding-API] **Terrain is classified from the bound feature registry by flag rather than by code.** A mod's own staircase, door or burning ground is recognised on exactly the same terms as the base game's. A missing registry degrades to an errand that walks the floor without taking stairs or opening doors, and says so in the log.
