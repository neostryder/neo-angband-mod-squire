# Squire on mod API 2

Squire runs as a first-party, in-process mod on mod API 2. Its manifest uses schema 2 and declares `"api": ">=2.0.0 <3.0.0"` with `"runtime": "in-process"`. `plugin.ts` exports an `Api2ModDefinition` with `prefs: { version: 1, migrate }`, `start`, `stop`, `armed`, `birth`, and `controller`. The "New Squire character" title row (key S) and the Squire panel mount through the presentation domain, and the title row's profile choice goes through `manage.profiles`. Squire reads only what the character knows, so it holds no `truth` grant and declares no hooks.

## The bridge

Squire's runtime, panel, and decision code were written against synchronous reads, and every API 2 call answers asynchronously with a result. `createBridge` in `src/api2/host.ts` closes that gap. It keeps a copy of each stored value (settings, preferences, the character record, the character key, the birth options, and the autoplayer mark), and `prime()` fills every copy before the mod does any work. A change to preferences or the character record updates the copy at once and writes through to `store.prefs` or `store.character`, and a failed write goes to the mod log.

The world is read fresh for each decision through `viewWorld`, which builds an `AgentView` over one reading of the known world. The bridge keeps the last reading for `viewNow`, so handlers that need the game as the player last saw it can answer without another call. Messages printed between decisions come from the `message` event.

`src/api2/act.ts` keeps the act verbs the decision code is written in (`move`, `quaff`, `cast`, `shopBuy`, `raw`, and the rest) and turns the one command chosen at a decision into a `command` intent. A target choice is recorded as it is made and submitted ahead of the command. `src/api2/net.ts` maps Squire's model-server requests onto `net.request`, turns the `Bearer {secret:jev}` header into `net.credential("jev", "Bearer ")`, and maps the key calls onto `net.credentials`.

`src/host-adapter-api2.ts` holds the known-world reads. `src/host-adapter.ts` now supplies only the shared view types the decision code imports, and the running mod uses none of its API 1 reads.

## The controller

`createTick` in `src/api2/controller.ts` is the controller. The game calls it at each input wait. If a prompt is open, the tick answers it (acknowledge, confirm, the default quantity or text, or cancel) and returns. At phase `play` or `store` it reads the world, asks the decision code for one command, submits any target choices, takes a fresh token if it submitted targets, and then submits the command. A null command submits nothing, and the game asks again at the next wait.

A refused command is logged on the first refusal and every tenth after that. After `REFUSALS_BEFORE_RELEASE` (25) refusals in a row, the tick releases the keyboard with "The game kept refusing Squire's commands." The player takes the keyboard back with Escape or Ctrl-Z.

`armed` offers to play when the context says the character was armed from Squire's title row, when the save already carries the autoplayer mark (NOSCORE_BORG, read through the engine domain), or when the birth presenter marked a roll-on heir. The game calls the controller only for a mod that declares `state:interaction.read`, `input:intent`, and `input:prompt.reply`, and Squire's manifest asks for all three.

## Known loss of exactness

The known world says less than the API 1 view did, and `viewWorld` fills the gaps from what the player can know:

- A monster's hit points come from its look-command health band and the average hit points in its race record.
- A square the character has never seen is impassable, with no feature and no trap.
- A trap the character has disabled still reads as a trap.
- No square glows.
- `floorItems` answers only for the character's own square.
- A timed effect reads as the lowest duration in the grade the status line names, so a check against a grade boundary answers as API 1 did and a check inside a grade does not.
- Recall and Deep Descent read 1 while active and 0 otherwise.
- A light's fuel is unknown, so every torch and lantern reads as out of fuel.

## Lab result

On build `8d450eedb`, with Squire enabled through the Mods screen and a character started from the title row, Squire takes the keyboard, plays, and walks the town on its own. After 16,000 game turns it is still in town. It cannot enter a store, because Core's mod pump presses Escape for any open modal and the store screen is one (SQ-1), so it keeps trying to restock. In earlier runs it reached dungeon level 2 only twice. Escape and Ctrl-Z giving the keyboard back are covered by unit tests and have not been played live.

## Open Core gaps

| Row | Gap | What it blocks | State |
| --- | --- | --- | --- |
| SQ-1 | The mod pump presses Escape whenever a modal is open, so the store closes before the controller's next wait and every `shop-buy`, `shop-sell`, and `shop-exit` is refused with "store is not open". | Shopping, and with it any run past dungeon level 2. The rest of the run degrades because Squire cannot buy potions or armor. | Open |
| SQ-2 | `Api2ModDefinition` has no `onKey`. | The order key (O) and the errand key (&) hand the keyboard back, so the errand menu and the orders panel cannot open during a run. | Open |
| SQ-3 | The controller install takes a plain function, with no `onDeath: "end"`. | A death reincarnates the character in place instead of ending the run with the tombstone and run report, and the roll-on heir cannot tell a real death. | Open |
| SQ-4 | `Api2ControllerContext` has no `autoplayed` field, and `armed` gets no roll-on information. | Nothing. Squire reads the mark through the engine domain and keeps its own session marks for the roll-on. | Served by the engine domain |
| SQ-5 | Without `state:interaction.read` (or `state:*.read`), `input:intent`, and `input:prompt.reply`, the controller silently does nothing, and the checker flags none of the three. | Nothing for Squire, which declares all three. Another controller mod can hold the keyboard and never move, with nothing in the log. | Open |
| SQ-6 | A title row id must match `^[a-z][a-z0-9-]{0,63}$`, and a bad id is refused with no log and no row. | Nothing now. The checker and the title row docs do not say so. | Open (note) |
| SQ-7 | The release build logs at warn, so `mod.meta.log` lines appear only with the localStorage key `neo-angband:log-level` set to `debug`. | Reading Squire's log in a lab run without that key. | Open (note) |
| SQ-8 | `player-command` arguments are reduced to `handle`, `floor`, `spell`, and `index`, with no `dir`, and the event's order against the command's effect is undocumented. | Nothing now. Squire works out its own command key. | Open (note) |
| SQ-9 | The API 2 definition docs still say a mod has no `controller` member. | Nothing. | Open (note) |

## Checking a build

The build runs against a local SDK pack for Core 1.22.0 with API 2, pinned through `file:` lines in `package.json`. Registry versions replace those lines when an SDK with API 2 is published.

Run `pnpm verify`. It runs the type check, the tests (113 test files and 1683 tests), the plugin builder's check, and the checker, `neo-angband-mod-check --first-party`, and all four must pass. `src/manifest-capabilities.test.ts` checks that every grant in the manifest matches a use in the code.

Then play it in a lab build. Set the localStorage key `neo-angband:log-level` to `debug` so Squire's log lines show (SQ-7), enable Squire on the Mods screen, and start a character from the "New Squire character" title row. Squire should take the keyboard and play. Take the keyboard back once with Escape and, in a second run, with Ctrl-Z. Until SQ-1 closes, a store door opens the store, the store closes at once, and the log shows the shop commands refused.
