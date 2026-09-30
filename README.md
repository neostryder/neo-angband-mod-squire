# Squire

**A Learning Angband Autoplayer.**

Press Ctrl-Z and Squire plays your character. It fights, casts spells, drinks potions, reads scrolls, throws oil, learns new spells, wears better gear, shops in town and takes the stairs down. At each moment that matters, a new creature, a hit, an empty floor, it asks a model what to do. Press any key and the keyboard is yours again.

While you play, Squire rides along as your apprentice. It makes its own choice at each of those moments, notes where yours differed, and learns your style. Give it a persona and it plays in character: a coward who flees too early, a berserker who never backs down, a miser who won't spend a coin.

Squire is a mod. It installs and uninstalls in the game's mod manager and reaches the game only through the same agent seam any other autoplayer uses. It sees what you could see and nothing more, and every action it takes is a command you could have typed.

## Getting started

1. **Install and enable Squire.** Escape menu, then **Mods**. Installing it changes nothing about your character.
2. **Open the Squire panel** and pick a brain on the Setup tab:
   - **Jev**, a hosted model from TypeSafe. It needs an API key from typesafe.ai and costs about three cents per thousand decisions. In the desktop app you can paste the key once, or let Squire read it from the `TYPESAFE_API_KEY` or `JEV_API_KEY` environment variable after you agree.
   - **Laya**, an open model you run on your own computer or home network. It is free, but it plays worse than Jev until it has been trained on Squire's decisions.
   - **Another server** that answers the same System One requests.
   - **No model**, and Squire runs short errands instead (see below).
3. **Press Test connection.** Squire sends one small request and tells you what came back, or what went wrong and what to try.
4. **Pick a persona** on the Persona tab, or keep the default.
5. **Press Ctrl-Z in play.** The game warns you, asks you to confirm, and Squire takes over from the next turn.

Press any key to take the keyboard back. The character stays where it is, and the key you pressed is not acted on. Ctrl-Z hands it over again.

A character handed to any autoplayer is marked for good, and the game keeps it off the score table. That is the game's own rule, and Squire follows it.

## How Squire decides

Squire works out what options make sense right now: fight the nearest creature, shoot or throw oil at it, aim a wand, cast an attack or healing spell, drink a healing potion, read Phase Door or Teleportation, back away, rest, eat, pick something up, study a new spell, wear better gear, light a fresh torch, map a new level, explore, take the stairs, read Word of Recall, or visit the shops. It describes the situation to the model in plain words, with each creature rated from an easy kill to deadly, and asks which option gives the character the best chance. The chosen option then runs until something changes: the plan finishes, a new creature appears, one hard hit or several smaller ones land, or hit points cross a line.

Squire only knows what the character knows:

- Items are used by the names your inventory shows, so an unidentified potion stays a mystery to Squire too.
- It reads a shop's stock only while standing in that shop.
- It plans routes only over ground the character remembers, and picks up only what lies underfoot.
- It compares gear by what the game would show once an item's runes are known. An item whose runes are still unknown can only be tried on, which a curious persona does.

In town, Squire first makes sure the character has a small reserve: two healing potions, two Phase Doors, some food, and a working light with spare fuel. These come before anything optional, and they can use money the savings setting would otherwise hold back. It won't head back down while one of them is missing and affordable. When there isn't the gold for them, a healthy character can go and earn some on the first dungeon level, staying close to the stairs.

Before going deeper on purpose, Squire checks that the character is ready for that depth: enough levels and hit points for its class, and the supplies and protections the depth calls for, such as Word of Recall from 250 ft, Phase Door from 300 ft and Free Action by 1000 ft. Whatever is missing becomes an aim, so the next trip to town shops for it. Fleeing down the stairs in an emergency doesn't wait for this check.

It heads home while it still has enough to get there, not when the last potion is gone, and walks back up if it has no Recall. It reads Recall only somewhere quiet, and while waiting for it to work it won't rest near anything dangerous.

While the character is young, it explores and picks up loot only within a leash of the up stairs that grows with its level. When a level stops paying off in experience, gold or new ground, Squire reconsiders: a fresh level, a deeper one if it is ready, or a trip to town.

Squire does not offer to back away from an adjacent creature that moves at least as fast as the character, unless a staircase is already underfoot. It offers usable healing and teleportation near death. Word of Recall remains an option even without restocking gold, but its delay cannot save the character from the next blow. Deep Descent is an option only with time to wait and leads several levels deeper. If every option is declined in danger, Squire chooses an escape or heal itself, or fights when none can help. A faster unique is deadly to a level 1 to 3 character on first sight; Squire offers to leave the level and does not walk up to fight it.

If the model can't be reached, Squire finishes the step it is on, stops, and tries again a few times, showing how long it will wait. After that it gives you the keyboard and says how to resume.

## Personas

A persona is a character sheet for how Squire plays: sliders for boldness, patience, greed, how early it heals and when it retreats, lists of favourite weapons and hated creatures, quirks, and a backstory. Squire asks the model two questions at each decision, the best move and the move this character would make, and blends the two by how strong the persona is. A safety floor still keeps a sensible persona out of a fight it would certainly lose, unless you give it a death wish.

The Persona tab starts from Default or a random persona, or from an archetype: coward, berserker, miser, scholar, zealot or tourist. Personas can be exported to a file and imported again.

When a character dies, Setup can have Squire start the next one for you, either like the last one or with a random race and class. The new character inherits a little of what its ancestors learned.

## Knight's Lessons

When you have the keyboard, you are the knight and Squire is your apprentice. It issues no commands, so your character stays yours. At each moment that matters it forms its own choice, compares it with yours, and writes a line in its notebook on the Lessons tab.

- **Why, sir?** When your choice surprises it, the notebook offers a few one-click reasons. Answering is optional.
- **Watch this** makes your next five choices count double.
- **Ranks.** As it agrees with you more often, the apprentice rises from Page to Squire to Knight-Errant.
- **Play like me** shows the persona Squire infers from your play beside its own, as two radar charts. Save it, and a handover plays the way you would.
- **Exams.** After 40 noted moments, take an exam: after your next Ctrl-Z, Squire's first 20 choices are scored against yours.
- **The hint**, off by default, shows what Squire would do when it disagrees with you, for players learning the game.

Knight's Lessons works with no model set up, using Squire's own rules to form its choices.

## Reports

When a character Squire played dies, wins or retires, the Report tab shows how the run went: the outcome and depth, the most killed creatures and uniques, how often Squire went against the model's advice, what it learned, the apprenticeship, and the tokens it used. You can save the report as Markdown or JSON, save a share card image, and save the full decision log. The Dashboard tab shows the same run while it is happening, with a depth chart and the latest decisions.

## What Squire sends and stores

- **To the model you chose**, the situation at each decision: the character's level, class, health and mana, the creatures in sight and how dangerous they are, the ground, and the persona. Nothing else from your computer.
- **To Laya, if you turn on "Train Laya while Jev plays"**, the same requests again. Squire never acts on Laya's answers there. Off by default.
- **To squire.rpgm.tools, only if you turn it on.** Telemetry is off by default. The Setup tab lists what each level sends, from a run summary up to every decision, and a backstory is sent only with its own consent. "Delete what I have sent" removes everything this install has sent.
- **On your computer**, Squire keeps its settings, personas, the decision log, reports, Laya training rows and the apprentice's notebook in the game's own storage. In the desktop app, an API key is kept encrypted by the app, and the game page never sees it. In a browser, Squire keeps the key in page storage, where other mods in the same page could read it.

## Playing in a browser

The desktop app is the easiest way to use Squire, because the app sends Squire's requests itself. A game page in a browser can reach Laya on the same computer, but Jev doesn't yet accept requests from web pages, and a page can't reach a server on another computer. [Squire Link](https://github.com/neostryder/squire-link) is a small program that runs on your computer and passes those requests on.

## Orders from viewers

If you stream your game, Squire Link can also read your Twitch chat or a Discord channel and keep the orders viewers give there, such as `!squire run from uniques`. Enter its orders address, `http://127.0.0.1:8765/v1/orders`, as the "Viewer orders address" under Orders on the Setup tab. While Squire plays, it checks that address every 5 seconds and takes each order as if you had typed it in the Orders tab. The Orders tab and the journal name the viewer, as in "New order from viewer Grip: run from uniques". If the address can't be reached, Squire notes it once in the log and tries again 30 seconds later. With the field empty, Squire asks nothing. Squire Link's own README explains how to turn chat on and how to keep a busy chat from flooding the squire.

## Without a model: errands

With no model set up, or with "Let a model choose what to do" switched off, a handover runs one short errand and then waits for you. Which errand runs depends on what the character sees.

| Errand | What it does | What ends it |
| --- | --- | --- |
| **Clear what is in front of me** | Picks one creature, walks to it, and fights until it is down. | The target falls or leaves, something new arrives, hit points cross the retreat line, a status effect lands, or the way is blocked. |
| **Explore this floor** | Walks toward the nearest unmapped ground until the floor is walked out. | The floor is finished, anything comes into view, any hit lands, a status effect lands, or the character stops making progress. |
| **Play on until I take the keyboard back** | Carries the character: survive, fight, collect, explore, descend. | Death, or nothing left to do on the floor. |

When an errand ends, Squire waits, and the next key takes the keyboard back. Each errand can be switched off under Mods, then Squire. [SETTINGS.md](SETTINGS.md) lists every setting.

The fighting errand leaves sleeping creatures alone unless you switch that on or target one first with the game's own targeting command. The exploring errand stops at the first point of damage, because damage while walking about means something caught the character off guard.

## Installing

Two files: `manifest.json` and `plugin.js`. Either:

- **In the game.** Mods, then **Install a mod...**, which fetches this repository at a release tag, never a branch, so what arrives can't change afterwards. The install records a SHA-256 of every byte that arrived, which lets the manager tell later whether the copy on your machine has changed.
- **A folder.** Clone this repository into your mods directory, or point the browser build at it with **Load mod folder**.

`plugin.js` is generated from `plugin.ts` and the sources under `src/`. It is committed because that is what an install fetches, and it ships unminified so you can read what you are trusting. Edit the source, not that file.

## Building and testing the mod

```bash
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` typechecks, runs the tests, and checks that the committed `plugin.js` is a current build of the source. An install runs the committed `plugin.js` from a pinned tag as it is, so a stale build would reach players even with every other check passing.

```bash
pnpm build     # rebuild plugin.js after editing the source
```

No checkout of the game is needed. The engine types and the plugin builder are published packages.

### How the tests work

The tests drive Squire through a world drawn in a string rather than a booted game:

```
"########",
"#.@....#",
"#.#### #",
"########",
```

Most of what matters to an autoplayer is a shape of world: a corridor with one unexplored end, a sleeping creature to walk past, a hit while walking, a shop entrance with the right stock. A generated level can't be asked for one of those, and a drawn map can, so each rule has a test that fails when it stops working. Model answers are supplied by the test, so no test calls a real server.

Everything the harness builds is typed as the engine's own `AgentView` and `AgentActions`, so a field Squire reads that changes shape in the engine fails the typecheck here.

## Releasing

A tag matching `vX.Y.Z` is the release: there is no separate publish step. The releases site at releases.rpgm.tools posts each new release to the Neo Angband announcements forum.

## Support and bug reports

[**The RPGM Tools Discord**](https://discord.gg/YegtwbHTBQ) is the fastest way to ask anything: whether a behaviour is intended, how to get Squire set up, or what to try next. No GitHub account needed.

[Open an issue here](../../issues/new/choose) for a bug in **this mod**. Two kinds of bug belong against the game instead, and the forms will point you there: the mod **system** (an install that fails, a load order that won't stick, a conflict report that looks wrong), and the game **not matching Angband 4.2.6** once this mod is switched off.

For anything that should not be public, including a security report: **strider-angband (at) rpgm.tools**. See [SECURITY.md](SECURITY.md).

Asking about AI use in this project? [AI_USAGE_POLICY.md](AI_USAGE_POLICY.md) is the complete answer.

[TERMS.md](TERMS.md) covers use of this mod. The core repository's [PRIVACY.md](https://github.com/neostryder/neo-angband/blob/master/PRIVACY.md) covers what the game stores and what network requests it makes. Project participation is subject to the shared [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Licence

Squire is licensed under the GNU General Public License, version 3. See [LICENSE](LICENSE).

## Credits

Built by neostryder / RPGM Tools as part of Neo Angband. The bounded-automation direction, and the separate requests for a single autofight command and an autoexplore that keeps going to the next unexplored area, were raised on r/angband by `angbandfourk`. Jev is made by TypeSafe. Angband is the work of Ben Harrison, James E. Wilson, Robert A. Koeneke and the Angband contributors.
