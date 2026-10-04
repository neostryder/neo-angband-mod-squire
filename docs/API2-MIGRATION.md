# Moving Squire to mod API 2

Squire runs on mod API 1 today. This page takes each context member and plugin member Squire uses on the old API, says where it goes in API 2, and lists what Core still has to add. Squire is a first-party (P-tier) mod that plays the character for the player. It sees only what the character knows, so it uses `view`, `act`, `content`, `meta`, `store`, `ui`, `events` and `net`, never `truth`, and it declares no hooks.

`src/host-adapter-api2.ts` holds the API 2 form of every read in `src/host-adapter.ts` that has one. Nothing imports it yet. Once the game can load an API 2 mod from a folder and Core has the controller below, the port swaps that import and rebuilds the plugin members listed here on `start(mod)`.

## Where each member goes

The Status column has three values. **moved** means Squire no longer uses the old member, or reads it through `ctx.composedRecords`, which `content.records` replaces one for one. **home, not wired** means API 2 has a place for it and the code has not switched yet. **Core request** points to a numbered request in the next section.

| API 1 member | API 2 home or Core request | Status | Notes |
| --- | --- | --- | --- |
| `ctx.core.turnEnergy` | None needed | moved | `src/energy.ts` holds a copy of the game's energy table, and a test compares it with Core's `turnEnergy` for speeds -20 to 220. |
| `ctx.registries.features` | `content.records("terrain")` | moved | API 1 reads `ctx.composedRecords.terrain`. A test checks that all 25 stock features classify the same as through the registry. |
| `ctx.core.TF` | None needed | moved | `src/terrain.ts` numbers the flag names itself. |
| `ctx.core.createAgentView` with `ctx.state` | `view.world()` | home, not wired | `viewWorld` in the API 2 adapter. Some fields come back less exact, listed below the table. |
| `ctx.snapshot()` input token, driver and prompt | `view.input()` | home, not wired | `viewInput` in the API 2 adapter. |
| `ctx.composedRecords` terrain | `content.records("terrain")` | home, not wired | `contentTerrain` in the API 2 adapter. |
| `AgentView.messages()` | `events.on("message")` | home, not wired | `watchMessages` collects messages between decisions. The manifest needs `event:message` at the port, and `state:messages.read` can go then. |
| `register(host, ctx)` | `start(mod)` | home, not wired | Only the parts with an API 2 home can move. The registry host is request 2. |
| `ctx.log`, `ctx.flags`, `ctx.id` | `meta.log`, `meta.flags`, `meta.id` | home, not wired | |
| `ctx.settings.get` | `meta.settings()` | home, not wired | Squire reads the retreat percent and errand steps settings. |
| `ctx.prefs.get`, `ctx.prefs.set` | `store.prefs` | home, not wired | Declare `prefs: { version, migrate }` with a migration from version 0, so a player's saved Squire settings carry over. |
| `ctx.characterStore` | `store.character` | home, not wired | The record keeps its own `format` and `schemaVersion`. |
| `localStorage` key `squire/panelScale` | `store.prefs` | home, not wired | The panel's zoom level. It holds no secret. |
| `ctx.events.on("combat-outcome")` | `events.on("combat-outcome")` | home, not wired | Squire counts kills by race. An API 2 listener can only read `view` after the event, when the dead monster may be gone (request 20). |
| `ctx.events.on("player-command")` | `events.on("player-command")` | home, not wired | Knight's Lessons reads `args.handle` and `args.spell`, which the API 2 payload drops (request 21). |
| `ctx.net.request` | `net.request` | home, not wired | Used for the model backend, the Laya shadow, the orders channel and telemetry. |
| `ctx.net.secrets.set`, `has`, `delete`, `fromEnv` | `net.credentials.set`, `status`, `remove`, `fromEnvironment` | home, not wired | The key name is `jev`. |
| `Authorization: Bearer {secret:jev}` header | `net.credential("jev")` | home, not wired | API 2 fills in the whole header value, and Squire's header has a `Bearer ` prefix (request 19). |
| `ctx.net.secrets.storage` | `storage` in the `net.credentials` answers | home, not wired | Squire tells the player when the key sits in page storage (request 18). |
| `ctx.net.transport` | A refusal from `net.credentials.fromEnvironment` | home, not wired | Squire checks for the desktop relay before reading the key from the environment. |
| `ctx.keymaps.isBindableTriggerKey`, `bind` | `ui.keys.bind` | home, not wired | A `trigger-taken` refusal replaces the bindable check. The bound action still needs the command host (request 2). |
| `controller` plugin member, with `onDeath: "end"` | Core request | Core request | Request 1. The section after the requests describes what it does today. |
| `AgentCommand` builders (`act.move`, `act.cast`, `act.raw` and the rest) | `act.submit(token, intent)` | Core request | Every Squire command has a `command` intent, but submitting needs the install in request 1. |
| `ctx.controller.setStatus`, `markNondeterministic` | `act.controller.setStatus`, `markNondeterministic` | Core request | The members exist in `Api2Controller`, but a mod can only reach them once it holds the controller (request 1). |
| `ctx.controllerArmed` | Core request | Core request | Request 5. |
| `register`'s `host.commands` (`registry:command`) | Core request | Core request | Request 2. |
| `ctx.ui.openPanel` | Core request | Core request | The order prompt is a modal page with a text box. `ui.mount` has text, buttons, rows and columns only (request 8). |
| `ctx.ui.registerPanelKind` | Core request | Core request | The Squire panel is a tiled panel drawn on canvases, with a settings form and a file download (request 8). |
| `birth` plugin member (`ui:birth.replace`) | Core request | Core request | Request 3. |
| `ctx.title.registerRow`, `choose` (`ui:title`) | Core request | Core request | Request 4. |
| `ctx.profiles` (`profiles:manage`) | `manage.profiles` | Core request | `manage` is for the presentation mod only, and `switchTo` takes no options (request 5). |
| `ctx.saves.create` (`saves:manage`) | Core request | Core request | Request 6. |
| `ctx.character.key`, `onRunEnd` | Core request | Core request | Request 7. |
| `ctx.options.get` | Core request | Core request | Birth options. The `optionsChanged` hook only runs after a change (request 10). |
| `ctx.state.actor.player.noscore` | Core request | Core request | The autoplayer mark (request 9). |
| `AgentView.spellInfo`, `monsterRecall`, `inspectItem`, `simulateLoadout`, `projectionPath`, `travelPath`, `blastArea` | Core request | Core request | Request 14. |
| `AgentView.floorItems` away from the character, `knownFloorItems`, `inspectKnownFloorItem` | Core request | Core request | `view.world()` has only `floorHere` (request 13). |
| `CellView.glow` | Core request | Core request | Request 11. |
| `CellView.feat` from a terrain record | Core request | Core request | Squire reads the feature index as the record's place in the terrain file (request 12). |
| `MonsterView` exact `hp`, `speed`, `poisoned`, all `spellFlags` | Core request | Core request | Request 15. |
| IndexedDB store `neo-angband-squire` | Core request | Core request | Run reports, the apprentice and Squire's profile list (request 16). |
| `sessionStorage` roll-on and heir marks | Core request | Core request | Request 17. |
| `ctx.net.secrets` page storage in the browser | Core request | Core request | Request 18. |

Totals: 3 moved, 18 with an API 2 home but not wired, and 22 waiting on a Core request. Squire does not use `hud`, `menu`, `screen`, `frontend`, `regions`, `hooks` or any `truth` read.

`viewWorld` answers from the known world, so it says less than the API 1 view in five places. A monster's hit points are the middle of its look-command health band times the average hit points in its race record, kept inside the band. A monster's speed is its race speed, without the random spread or a temporary haste or slow, and `poisoned` is always false. Its race and spell flags are the ones the player's monster memory has learned. A square the character has never seen is unknown, impassable and has no trap, where API 1 read the real map. No square glows, and `floorItems` answers only for the character's own square. The tests in `src/host-adapter-api2.test.ts` build the known world from the same game facts as the API 1 tests and check that everything else answers the same.

## The manifest

`manifest.json` is a schema 2 document, converted with the SDK's `convertManifestV1`. It keeps `"api": ">=1.0.0 <2.0.0"` and `"runtime": "in-process"`, so the game still runs Squire on API 1. Every grant stays, because Squire still uses each one through API 1, and `src/manifest-capabilities.test.ts` checks that each grant matches a use in the code.

`tools/check-grants.mjs` reads `data.capabilities` from a schema 2 document or `capabilities` from a schema 1 manifest. It fails a grant for the real map, any wildcard or non-read `state:` grant, any `truth`, `core` or `registries` grant, and any `registry:` grant other than `registry:command`.

Schema 2 manifests and the API 2 types are on Core master but in no release yet: not in v1.22.0, not in v1.22.1-edge.165, and not in any published SDK. A released game cannot read this manifest, and a checkout on the published SDK cannot typecheck `src/host-adapter-api2.ts`. This branch builds against Core master through local links in `node_modules` (request 23).

## The four first-party grants

`registry:command` registers the `squire:order` command with a verb set through `setVerb`, in `src/ui/order-command.ts`. The command opens the order prompt through `ctx.ui.openPanel`, and the keymaps bind it to O, or N when O is taken. It needs the command host in request 2.

`saves:manage` makes the roll-on heir: when a Squire character dies, `src/runtime.ts` calls `saves.create({ like, resumeAutoplayer: true })` to roll a new character like the dead one, with Squire already holding the keyboard. It needs request 6.

`ui:title` adds the "New Squire character" row (key S) to the title screen through `title.registerRow`, and `title.choose` asks which profile the character lives in. It needs request 4.

`profiles:manage` lists and creates profiles, turns Squire on in a new profile with `setEnabledMods`, and calls `switchTo(id, { kind: "create-character", armController: true })` to start a new character there with the controller armed. `manage.profiles` covers the first three, and request 5 covers the rest.

## The removal list

Removed in this pass, with play unchanged: `ctx.core.turnEnergy` (now `src/energy.ts`), `ctx.registries.features` and `ctx.core.TF` (now the terrain records). The `core` read left in `HostReads` is `createAgentView`.

These wait on Core:

- `ctx.core.createAgentView` and `ctx.state` wait on requests 1 and 9: the API 2 adapter replaces them, but nothing can drive the character on API 2 yet.
- `ctx.snapshot()` raw state (inventory, equipment and the input token) waits on request 1.
- `ctx.state` for the autoplayer mark waits on request 9.
- `ctx.options` birth options wait on request 10.
- Actual-map data: the API 1 view reads each square's feature, passability, glow and trap from the real map, even for squares the character has never seen. The API 2 adapter reads remembered squares only, and the switch waits on request 1.
- Secrets in shared page storage wait on request 18. Squire never reads a key itself; requests carry a placeholder that the host fills in.

Label parsing is mod work with no Core change needed, kept for a later pass because each change alters Squire's item and spell model and its test harness. Squire learns facts from display text in these places:

- Item kinds by name: `readPack` in `src/gear/pack.ts` (its items carry a name and no kind), `src/brain/goals.ts` (around lines 1323 to 1352 and 2373 to 2388), `src/brain/combat-kit.ts` (charges at 153, potions at 203 to 207), `src/knight.ts:93`, `src/gear/readiness.ts`, `src/brain/aims.ts`, `src/town/plan.ts`, `src/orders/book.ts:284` and `src/runtime.ts:737`. `ItemView` has `tval` and `kindId` for most of these.
- Spell names: `src/brain/combat-kit.ts` (75, 108, 278), `src/brain/goals.ts` (1197, 1319) and `src/gear/pack.ts` (68, 116, 350).
- Monster recall text: `src/brain/goals.ts:473`, `src/brain/threat-model.ts` (56, 74, 205, 390, 404) and `src/brain/combat-kit.ts:317`. Request 15 replaces these.
- Item description text: the device fail rate ("chance of success") in `src/gear/pack.ts`, and "Provides resistance" in `src/gear/readiness.ts:155`. Request 14 replaces these.

## Core requests

Each request says what Squire needs, the smallest Core addition that gives it, and whether only a first-party mod should get it.

**1. A controller install in `act.controller`.** Squire plays the character, and API 2 has no way to take the keyboard. The smallest addition is a `controller` member on the API 2 definition, or an `act.controller.install(decide, { onDeath })` call, that gives the same contract as the API 1 controller described in the next section: the host's confirmation and noscore mark, a pump that calls `decide` once per tick with a fresh known world and input token, the host answering blocking prompts, `onDeath: "end"`, and hand-back through `release` and the player's stop keys. `decide` can stay synchronous over a view read just before the call, or become async with the token check `act.submit` already has. P-tier only.

**2. A command host for mod commands.** The order command is a `registry:command` entry with its own verb, bound to a key and opening Squire's order prompt. The smallest addition is a `ui.commands.register(id, verb)` member, or an `ui.keys` action that calls back into the mod, so a bound key runs mod code without a registry host. Not P-tier only; any mod with a command could use it.

**3. A birth presenter for API 2.** When a Squire character dies, Squire rolls an heir. Its birth presenter takes over only that one character creation and leaves every other to the game's own screens. The smallest addition is a `birth` member on the API 2 definition that gets the same `show(session)` call. P-tier only, because it replaces the game's own birth screens.

**4. A title-screen row for a first-party mod.** Squire adds "New Squire character" to the title screen. `ctx.title` has no API 2 form because title actions belong to the presentation mod. The smallest addition is a `ui.title.registerRow` member granted to P-tier mods through `ui:title`. P-tier only.

**5. `manage.profiles` for the autoplayer, with a character-start option.** Squire makes a profile, turns itself on there and starts a new character with the controller armed, and today's plugin also reads `ctx.controllerArmed` at boot. The smallest addition is to grant `manage.profiles` to P-tier mods holding `profiles:manage`, add an option argument to `switchTo(id, { kind: "create-character", armController: true })`, and tell the mod at start that the controller is armed (for example `meta.controllerArmed`). P-tier only.

**6. Character creation in `manage`.** The roll-on heir needs `saves.create({ like, resumeAutoplayer: true })`. The smallest addition is `manage.saves.create` with the same two options. P-tier only.

**7. Run end and a character key.** Squire writes its run report when a run ends, and names each run from a stable character key. The smallest addition is an `onRunEnd` event carrying the run report, and a stable `key` in `view.player()` or `meta`. The event could be open to every mod; the full run report is P-tier.

**8. Panels richer than `ui.mount`.** The Squire panel is a tiled panel kind drawn on canvases, with a settings form, a text box for the model key and a download button. The order prompt is a modal page with a text box. The smallest addition is a P-tier `ui.mountPage(kind, root)` that hands a first-party mod a shadow root, as `ctx.ui.openPanel` and `registerPanelKind` do now, plus `input` and `download` node types for `ui.mount`. P-tier only for the shadow root.

**9. The autoplayer mark in the known player.** Squire offers to play a character only when the save already carries the autoplayer mark (NOSCORE.BORG). The smallest addition is `autoplayed: boolean` in `KnownPlayer`. Not P-tier only; the mark is something the player can see.

**10. Birth options at start.** Squire tells its model which birth options are on, such as no up staircases or no selling. The `optionsChanged` hook only runs after the player changes an option. The smallest addition is `view.options()` or `meta.options()` with the `birth` record that `Api2Options` already has. Not P-tier only.

**11. Lit squares in the known level.** Before reading or casting, Squire checks that its own square is lit or that it carries a light, because the game refuses both in the dark. It also prefers a lit square when something unseen is hurting it. Without this, a character with no light in a lit room would never read a scroll. The smallest addition is `glow: boolean` on each remembered square in `KnownLevelCell`, set from the player's memory of the square. Not P-tier only.

**12. A feature index on terrain records.** A remembered square holds a feature index, and Squire finds that feature's record by its place in `content.records("terrain")`. That works because the game builds feature indexes from the file in the same order and mods can only patch existing codes. The smallest addition is a `featCode` on every remembered square, or an `index` field on each terrain record. Not P-tier only.

**13. Floor items beyond the character's square.** Squire plans pickups from items it remembers on other squares, and inspects them. `view.world()` has only `floorHere`. The smallest addition is the remembered objects of each known square as `KnownItem`s, where `KnownLevelCell` now gives only a count. Not P-tier only.

**14. An inspect domain.** Squire compares loadouts, reads spell details, a monster's recall, an item's description, projection paths, blast areas and travel paths. API 2 returns the data behind these but not the game's own calculations. The smallest addition is a `view.inspect` member with `simulateLoadout`, `item`, `monsterRecall`, `spell`, `projectionPath`, `blastArea` and `travelPath`, each answering from what the player knows. Not P-tier only.

**15. Structured monster memory.** Squire reads monster recall text for blows, spell frequency and danger, and approximates hit points from the health band. The smallest addition is the learned blows, spell frequency and average hit points as fields on `KnownMonster`, with the band limits documented. Not P-tier only.

**16. A larger mod store.** Squire keeps run reports, the apprentice and its list of profiles in IndexedDB, where every mod in the page can read them. The smallest addition is `store.kv` with `get`, `set` and `keys` for named JSON values, kept per mod and per install. Not P-tier only.

**17. A session store.** The roll-on and heir marks live in `sessionStorage` so they last through one reload and no longer. The smallest addition is `store.session`, a slot cleared when the tab closes. Not P-tier only.

**18. Browser credentials out of shared page storage.** In the browser, a stored model key sits in page storage that other mods in the page can read, and Squire warns the player. The smallest addition is a browser credential store that other mods cannot read, such as one kept by a worker. Not P-tier only.

**19. A credential reference with a prefix.** Squire sends `Authorization: Bearer <key>`, and `net.credential` fills in the whole header value. The smallest addition is `net.credential(name, { prefix: "Bearer " })`. Not P-tier only.

**20. The race of a killed monster in `combat-outcome`.** Squire counts kills by race. The API 1 listener reads the view during the event, while the dead monster still holds its index; an API 2 listener reads afterwards. The smallest addition is `targetRace` on the payload when the player saw the kill. Not P-tier only.

**21. Command arguments in `player-command`.** Knight's Lessons learns which item the player used and which spell they cast from `args.handle` and `args.spell`. The smallest addition is `args` for the player's own commands, which name only items and spells the player chose. Not P-tier only.

**22. The mod builder's banner.** `neo-angband-mod-build` calls `manifestFields` without importing it, so the banner names the folder rather than the mod id. The smallest fix is the missing import. Not P-tier only.

**23. A published SDK with API 2 and schema 2.** Until one ships, a released game cannot read Squire's schema 2 manifest, and CI on the published SDK cannot typecheck the API 2 adapter. The fix is a release of Core and the SDK with both. Not P-tier only.

**24. Messages in the known world (optional).** Squire hands its model the messages since the last decision, and the API 2 adapter collects them from the `message` event. The smallest addition is a `view.messages(since)` read. Not P-tier only.

## The controller today

At boot the game calls `controller(ctx)` once. Squire returns `undefined` unless the save already carries the autoplayer mark, `ctx.controllerArmed` is true (a character started from Squire's title row) or a one-time roll-on mark is in `sessionStorage`. Otherwise it returns `{ controller, onDeath: "end" }`; the game also takes a bare controller, plus optional `onKey` and `nondeterministic` fields.

The game holds one autoplayer at a time. It installs at once only after the player confirms Ctrl-Z, which reloads the game with a one-time key in reload storage, or on a roll-on boot. Any other boot leaves the controller pending and asks the player once the game screen is live. Installing marks the save with NOSCORE.BORG, which never clears, and shows a banner naming the mod.

A pump then runs on a timer every 10, 40, 120 or 400 ms, set by the Autoplayer speed row. Each tick it arms a latch and advances the game, and the game asks the controller for a command whenever the character has energy. The controller is called synchronously as `(view, act) => AgentCommand | null` and answers at most one command per tick, built with the `act` builders such as `act.move(dir)`, `act.cast(book, spell)` or `act.raw(code, args)`. Null means wait. While a prompt is open, the pump presses Escape for the controller.

While driving, Squire reads the API 1 view (player, monsters, cells, inventory, equipment, stores, spellbooks, messages, constants and the input token) and the inspect calls in request 14. It calls `ctx.controller.setStatus` to show what it is doing and `markNondeterministic` once a model starts making choices. It also uses `character.key` to name the run, `character.onRunEnd` for the run report, and `saves.create` for the heir. While a model request is out, the controller returns null, and it drops an answer whose input token has gone stale.

The player gets the keyboard back with Escape, Ctrl-Z, any key that `onKey` does not keep, or the touch or gamepad stop, and the mod gives it back through `release`. All of these call the same hand-back, which stops the pump and leaves the character where it stands. With `onDeath: "end"`, a death ends the run with the normal tombstone and run report; without it, the game reincarnates the character in place.
