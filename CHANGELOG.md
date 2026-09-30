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
- [Visible] **Each decision in the log shows what came of it.** When a plan stops, its entry notes whether it ran to the end, got interrupted or gave you back the keyboard. It also counts the commands sent and any the game ignored, and gives the hit points gained or lost. You'll find this in the saved log, and it goes out with telemetry if you send every decision.
- [Visible] **Fewer model calls.** Squire no longer asks the model about moves with only one sensible answer. With no awake creature in sight it lights a torch, wears a known upgrade, learns a spell, reads a detection scroll on a new level, or waits for a recall to fire. If only one safe move is left, it takes it, and while nothing changes it repeats the model's last choice for a few turns. The decision log lists these as reflexes, and they use no tokens.
- [Visible] **Lessons now say what went wrong.** When a battle-scarred veteran hits a level 1 mage for 8 as it walks up, the lesson reads "prefer range or avoid it below 16 HP" instead of "Nearly died after choosing to fight". Squire learns this way from heavy blows, paralysis and other disabling attacks, breath and spells it sees, attacks a creature shrugs off, breeders and escapes that fail. It never blames resting, and killing a unique no longer adds a lesson.
- [Visible] **Another look at the exits.** If the model turns down every option while the character is in trouble, Squire adds the escapes it had held back, such as the nearest stairs, and asks once more. After that it goes with the model's likeliest choice, as before.
- [Visible] **Squire sizes up a creature by what it knows of it.** Once the character has seen a creature's blows, spells or breeding, those set its rating, so a level 1 mage treats a battle-scarred veteran that can hit for 12 a round as dangerous before the first blow lands. Low hit points, a crowd close by and a faster foe raise the rating further. Squire also casts the attack spell that does the most damage for its mana, holds its fire when a wall or another creature is in the way, and aims ball spells where they catch the most creatures.
- [Visible] **Refused moves aren't offered again right away.** If the game won't carry out a move, Squire leaves it out until the character steps elsewhere, its health or status changes, or a creature moves. When it can tell why, such as confusion, it says so to the model.
- [Visible] **Roll-on.** After a death, Setup can have Squire start the next character, like the last one or with a random race and class, and keep playing. The new character inherits some of what its ancestors learned.
- [Visible] [Security] **Telemetry, off by default.** Setup lists what each level sends to squire.rpgm.tools, from a run summary up to every decision, and a backstory is sent only with its own consent. "Delete what I have sent" removes everything this install has sent.
- [Visible] **Train Laya while Jev plays.** When switched on in Setup, Squire also sends each decision to Laya and never acts on Laya's answer. Every Jev decision is saved as a training row, and a Knight's Lessons row carries your own choice as its label. "Save Laya training rows" downloads them.
- [Visible] **Squire keeps shooting at the creature it picked.** Arrows, flasks of oil, wands and bolt spells go on at one target until it dies, leaves sight, the line of fire closes or the ammunition or mana runs out, with no new model call per shot. A ball spell is still aimed afresh each cast, so the blast stays off the character. With nothing in view, Squire now walks to stairs and unexplored ground with the game's own travel and run commands, and when it flees it heads for a known staircase before it just backs away.
- [Visible] [UI] **Squire works toward aims.** On each new level, after a town trip, on gaining a level and every 2,000 game turns, Squire lists what it wants next (its next spellbook, a lantern, armour for empty slots, a magic weapon, free action, see invisible and a target depth) and has the model rank them. Moves that serve an aim say so and count for a little more with an ambitious persona, and a recall to town comes up once an aim is affordable. The list shows under Aims in the Squire panel.
- [Visible] [UI] **Give Squire orders.** Write an order ("reach 500 ft before level 15") or a standing instruction ("always run from uniques") in the new Orders tab, or press Ctrl+Shift+O while the panel is open. Squire weighs each one in every decision, and how readily it obeys depends on its Devotion, Resentment and persona: a devoted squire may follow an order past its usual risk limit, and a proud one follows grudgingly. Instructions fade over time, faster for a Forgetful squire. Creed files save and load a set of standing instructions, a family creed passes to heirs, and "Instructions kept" in Setup caps how many it holds.
- [Visible] **Squire uses more of what it finds.** It judges floor items before walking to them, drops junk when the pack is full, and on a town trip buys the item of an aim it can now afford. Before a hard fight it drinks Heroism, Berserk or Speed or reads Blessing, it drinks a resist potion before a known breather, and it uses curing devices and activations. It disarms traps, tunnels through rubble that blocks its way, and leaves a level whose feeling is bad.
- [Visible] **Heirs carry on the family's aims, and orders have their own key.** An heir inherits its predecessor's depth target and a weapon the line was hunting, as strongly as the Inheritance slider allows, and an unambitious heir can drop a deep depth target; aims tied to the old character's kit start fresh. Squire's order key (O, or the next free key) opens the order prompt during play whether or not the panel is open. An order Squire liked, or one it followed and was thanked for, now builds its Gratitude.
- [Visible] **Viewers can give Squire orders.** With a "Viewer orders address" from Squire Link in Setup, Squire collects orders from Twitch or Discord chat every few seconds while it plays and weighs each as a viewer's request, which counts for less than your own orders unless the squire is very devoted. The Orders tab and journal name the viewer who gave each one.

### Removed

- [Internal] **Removed this repo's own Discord release announcer.** Its workflow, script and test are gone. The releases site at releases.rpgm.tools now posts each new release to the Neo Angband announcements forum.

### Fixed
- [Visible] **Squire goes deeper and no longer loops.** Retreat below town takes a down staircase unless the danger is pressing, and in town it steps away instead of taking the stairs into the dungeon. Leaving a level prefers the way down. Townspeople are no longer rated dangerous before they have hit, a known worm mass no longer stops each walk, and exploring no longer paces beside a creature that drops in and out of sight. A choice that makes no game time pass is dropped after three tries on one turn, and Squire rests instead of waiting for a recall.

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
