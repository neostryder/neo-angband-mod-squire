# Squire

**A Learning Angband Autoplayer.**

Press Ctrl-Z and Squire plays your character. It fights, casts spells, drinks potions, reads scrolls, throws oil, learns new spells, wears better gear, shops in town and takes the stairs down. When something changes, such as a new creature, a hit or an empty floor, it asks a model what to do. Routine upkeep and choices with only one way out it settles itself. Press any key and the keyboard is yours again.

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

On a game new enough to offer it, the title screen has a **New Squire character** row (key S). It starts a character with Squire already playing, in this profile or in a separate one that keeps Squire's options, mods and characters apart from yours. A separate profile can start fresh or copy another profile's options, mods and mod settings, but never its characters. Next time, Squire offers the profiles it made before.

A character handed to any autoplayer is marked for good, and the game keeps it off the score table. That is the game's own rule, and Squire follows it.

## How Squire decides

Squire works out what options make sense right now: fight the nearest creature, shoot or throw oil at it, aim a wand, cast an attack or healing spell, drink a healing potion, read Phase Door or Teleportation, back away, rest, eat, pick something up, study a new spell, wear better gear, light a fresh torch, map a new level, explore, take the stairs, read Word of Recall, or visit the shops. It describes the situation to the model in plain words, with each creature rated from an easy kill to deadly, and asks which option gives the character the best chance. The chosen option then runs until something changes: the plan finishes, a new creature appears, one hard hit or several smaller ones land, or hit points cross a line.

Squire only knows what the character knows:

- Items are used by the names your inventory shows, so an unidentified potion stays a mystery to Squire too.
- It learns a shop's stock only by walking in, and plans from what it remembers, which may be out of date by its next visit.
- It plans routes only over ground the character remembers. It can walk to a worthwhile item on that ground and pick it up there. On a game that keeps the player's floor memory, Squire knows an item as the look command shows it: by name while in sight, as remembered once out of sight, and not at all if it fell where nobody saw. It looks again on arrival, and drops the plan if the item has gone. Squire can't value an unknown flavour or an object it has only sensed, so it walks over to look at one close by, as a player picks up unknown potions to learn them. A curious, greedy or bold persona goes further for it, and a cautious one stays closer. The long errand picks up only what lies underfoot.
- It compares gear by what the game would show once an item's runes are known. An item whose runes are still unknown can only be tried on, which a curious persona does.

Squire judges gear by what it lets the character do: the damage it can deal each action, how well it can cast, and its speed, ahead of price or a favourite name. It never trades away the last source of Free Action, See Invisible or telepathy, or a resistance the next depth calls for. A swap that gives something up for something else stays a choice; only a straight upgrade is automatic.

In town, Squire first makes sure the character has a small reserve: two healing potions, two Phase Doors, some food, and a working light with spare fuel. These come before anything optional, and they can use money the savings setting would otherwise hold back. It won't head back down while one of them is missing and affordable. When there isn't the gold for them, a healthy character can go and earn some on the first dungeon level, staying close to the stairs.

Before going deeper on purpose, Squire checks that the character is ready for that depth: enough levels and hit points for its class, and the supplies and protections the depth calls for, such as Word of Recall from 250 ft, Phase Door from 300 ft and Free Action by 1000 ft. Whatever is missing becomes an aim: supplies go on the next shopping list, while experience, hit points and protections the shops don't sell are things to earn or find first. The deepest levels ask for more, such as speed, telepathy and a stock of Healing potions. Fleeing down the stairs in an emergency doesn't wait for this check.

It heads home while it still has enough to get there, not when the last potion is gone, and walks back up if it has no Recall. It reads Recall only somewhere quiet, and while waiting for it to work it won't rest near anything dangerous.

While the character is young, it explores and picks up loot only within a leash of the up stairs that grows with its level. When a level stops paying off in experience, gold or new ground, Squire reconsiders: a fresh level, a deeper one if it is ready, or a trip to town.

When a floor has nothing reachable left to explore and the character is not ready to go deeper, Squire takes the up stairs to keep earning on a fresh floor. From the first dungeon level it returns to town, where it prepares for the next trip. A plan to leave a level never takes down stairs into a depth the character is not ready for.

In a fight, Squire works out how much damage the character could take over its next action or two, from each creature's speed, the blows it has been seen to use, its ranged attacks and the character's resistances. When it doesn't know a creature's attacks, it assumes some danger rather than none. An escape has to leave the character safer: stepping away from an adjacent creature that is as fast as it is doesn't count, and each step of a walk to the stairs is checked again before it is taken. When one blow could finish an enemy, attacking can beat stepping away.

In a fight it weighs melee, arrows and bolts, thrown oil, spells and wands by the damage each does per action, and by whether one blow could finish the target. It keeps back what the next escape needs: the mana for an escape spell when there is no scroll, the last flask to refill a lantern, the last charge of an escape device. It checks that reserve before every shot in a volley. It spends the reserve only on a finishing attack, when even its weakest hit would kill, the attack has at least a three-in-four chance to work, and the other creatures in sight can't kill the character before its next action.

A young character, up to level 5, treats three awake breeders as the sign to leave the level. It stops chasing, exploring and resting there, clears whatever is next to it, and may shut a door on them on the way out.

It heals with the smallest potion that outpaces the damage coming in. A weaker potion is still offered when the next blows could kill the character, or when it is poisoned, cut, blinded or confused. When only one cure or escape keeps the character alive, Squire takes it straight away without asking the model. Out of combat it rests instead of drinking, but not while poisoned or cut, near breeders, or soon after a hit from something it can't see, and it waits for Recall only where nothing can reach it.

Near death, Squire offers whatever healing and teleports the character carries, and Word of Recall even with no gold to restock, though Recall's delay can't stop the next blow. Deep Descent is offered only when there is time to wait, since it drops the character several levels deeper. If the model turns every option down in danger, Squire picks the best escape or attack itself. A fast unique is treated as deadly to a character of level 1 to 3: Squire looks for a safe way off the level and never walks up to fight it.

If the model can't be reached, Squire finishes the step it is on, stops, and tries again a few times, showing how long it will wait. After that it gives you the keyboard and says how to resume.

When the game supports releasing the keyboard, a final stop gives it back straight away and hides Squire's banner. Ctrl-Z starts Squire again. On older games, press any key to take the keyboard back first. Death stays with the game's death and next-character flow.

## Personas

A persona is a character sheet for how Squire plays: sliders for boldness, patience, greed, how early it heals and when it retreats, lists of favourite weapons and hated creatures, quirks, and a backstory. With a persona, Squire usually asks the model two questions at once, the best move and the move this character would make, and blends the answers by how strong the persona is. A safety floor then removes any choice riskier than the persona's Self-preservation allows. If every choice is that risky, the safest one stays. Death wish lifts the limit for every choice, and an order the character follows closely lifts it for that order.

The Persona tab starts from Default or a random persona, or from an archetype: coward, berserker, miser, scholar, zealot or tourist. Personas can be exported to a file and imported again. Edits on the Persona tab apply to new characters. A character already in play keeps its own copy, which shifts with experience.

When a character dies, Setup can have Squire start the next one for you, either like the last one or with a random race and class. The new character inherits a little of what its ancestors learned.

The family also remembers what killed its characters. A bold or proud heir hates that creature and a cautious or craven one fears it, more strongly with each ancestor it killed. Hatred adds weight to fighting it, and a hated unique can become an aim to avenge the family. Fear makes the heir believe the creature more dangerous and offers to leave the level when it appears. Neither overrides the safety floor. Killing a hated unique settles the grudge for the whole family. A feeling toward an ordinary monster that has killed one or two ancestors fades over later generations unless it kills again, and one that has killed three never fades. The Squire panel lists these under Family memory. With Inheritance at nothing, or Blood grudges off, an heir starts with no grudges.

Epitaphs gives each death a short line in the character's voice, naming the killer, depth, character level and last choice. The log records it, and Family memory shows the last few an heir inherits. Turn Epitaphs off to stop writing them. Inheritance sets how many pass to heirs.

Family milestones remembers the first time the family slays each unique, its deepest level and its first known artifact. An heir recalls a milestone in the log when it reaches that depth or sees that unique. Family memory lists recent milestones. Turn Family milestones off to stop recording and recalling them; Inheritance sets how many an heir remembers.

Namesakes lets an heir take an ancestor's name with a number, such as "Mira the Second". Ancestors who reached deeper or lived longer are more likely to lend their names. The log names the ancestor. Turn Namesakes off to keep the usual birth names. Inheritance lowers the chance, down to none when nothing passes, and a pinned name stays yours.
Inherited superstitions makes an heir distrust an unknown scroll, potion or wand that an ancestor used just before dying. The heir avoids using that kind until the family sees it identified. Known healing and escape items remain available. Inheritance controls how many superstitions pass on, and Family memory lists them. The setting starts on; turning it off or setting Inheritance to nothing gives the heir none.

Lessons of the dark makes an heir carry one extra torch or flask of lantern fuel after an ancestor died without light. Inheritance sets the chance of passing on the lesson. The extra fuel waits until the town survival reserve is filled, and lights that need no fuel keep their usual targets. Family memory and the log mention the lesson. The setting starts on and can be turned off.

Trophies lets a character with Pride at 70 or above keep one carried item dropped by each unique it kills. The item's inspection must name the unique. Squire keeps useful gear available to wear and sells the rest of a trophy stack. A full pack ends the sale protection. Family memory lists the trophies, and the log records each one. The setting starts on; trophies belong to the character that earned them, so heirs start a fresh collection.

Favoured grounds gives an heir a small preference for hunting at the depth of the family's most valuable dungeon find. Squire reads the item's value and inspection, or remembers where it was picked up. The heir favours descent toward that depth only once it meets the readiness requirements, then favours exploration there. Survival guards and the death-risk ceiling still decide what is safe. Inheritance sets the chance of passing on the preference. Family memory lists the depth, and the setting starts on and can be turned off.

## Knight's Lessons

When you have the keyboard, you are the knight and Squire is your apprentice. It issues no commands, so your character stays yours. At each moment that matters it forms its own choice, compares it with yours, and writes a line in its notebook on the Lessons tab.

- **Why, sir?** When your choice surprises it, the notebook offers a few one-click reasons. Answering is optional.
- **Watch this** makes your next five choices count double.
- **Ranks.** As it agrees with you more often, the apprentice rises from Page to Squire to Knight-Errant.
- **Play like me** shows the persona Squire infers from your play beside its own, as two radar charts. **Save as a persona** adds your style to the persona library, and **Use it** also makes new characters play that way.
- **Exams.** After 40 noted moments, take an exam. After your next Ctrl-Z, the next 20 choices Squire asks the model about are compared with what you chose in similar moments in the notebook. A choice with no similar moment in the notebook is not scored.
- **The hint**, off by default, shows what Squire would do when it disagrees with you, for players learning the game.

Knight's Lessons is on by default. With a model set up, Squire asks it for its own choice while you play, one question at a time. With no model, it forms its choices from its own rules. To stop these requests, clear "Learn from how I play while I have the keyboard" on the Setup tab. The Mods switch "Let a model choose what to do" does not stop them.

## Reports

When a character Squire played dies, wins or retires, the Report tab shows how the run went: the outcome and depth, the most killed creatures and uniques, how often Squire went against the model's advice, what it learned, the apprenticeship, and the tokens it used. You can save the report as Markdown or JSON, save a share card image, and post the run on X or Reddit from its links. The decision log can be saved at any time, even before a report exists, and holds the latest 20,000 decisions. The Dashboard tab shows the same run while it is happening, with a depth chart and the latest decisions.

## What Squire sends and stores

- **To the model you chose**, everything Squire weighs in a decision. That means the character's level, race, class, health, mana, gold and status, the creatures in sight and how dangerous they are, the ground around it and how the last plan ended. It also means the persona and its backstory, the lessons Squire has learned, its aims, your orders and the names of viewers who gave orders. Squire asks the model whether an event belongs in the Chronicle, too. When a character dies, Squire sends the cause, the depth and the last few plans, and asks which plan got the character killed. With Knight's Lessons on, these requests go out while you play as well.
- **To Laya, if you turn on "Send decisions to Laya"** under "Train Laya while Jev plays". Each of Jev's questions goes to Laya as a separate request. If Laya is still answering the last question of that kind, Squire skips the new one. Squire never acts on what Laya answers here. This is off by default. Squire still saves Jev's answers on your computer as training rows when it is off.
- **To squire.rpgm.tools, only if you turn it on.** Telemetry is off by default. The Setup tab lists what each level sends, from a run summary up to every decision, and a backstory is sent only with its own consent. The Endpoint field on the Setup tab sets where runs go, and with it empty Squire sends nothing. A run that could not be sent waits on your computer and goes out with the next one. "Delete what I have sent" asks the telemetry service to delete this install's records and drops any runs still waiting to be sent. Your own logs and reports stay on your computer.
- **On your computer**, Squire keeps its settings, personas, family records, the decision log, reports, Laya training rows, runs waiting to be sent and the apprentice's notebook in the game's own storage. In the desktop app, an API key is kept encrypted by the app, and the game page never sees it. In a browser, Squire keeps the key in page storage, where other mods in the same page could read it.

## Playing in a browser

The desktop app is the easiest way to use Squire, because the app sends Squire's requests itself. A game page in a browser can reach Laya on the same computer, but Jev doesn't yet accept requests from web pages, and a page can't reach a server on another computer. [Squire Link](https://github.com/neostryder/squire-link) is a small program that runs on your computer and passes those requests on.

## Orders

The Orders tab takes orders and standing instructions in plain words, such as `suit up at the armour shop`. Each one shows whether Squire is following it, following it grudgingly or ignoring it, which depends on the persona, most of all its Devotion, Stubbornness and Resentment. A standing instruction can be marked as a family creed, which heirs inherit, and creeds can be saved to a file and loaded again. During play, press O to open the order prompt. If O is already taken, Squire uses N, and if both are taken the order key is left unbound. While the Squire panel has the keyboard, Ctrl-Shift-O opens the Orders tab. "Instructions kept" on the Setup tab sets how many orders and instructions Squire holds before it drops the one it follows least readily.

## Orders from viewers

If you stream your game, Squire Link can also read your Twitch chat or a Discord channel and keep the orders viewers give there, such as `!squire run from uniques`. Enter its orders address, `http://127.0.0.1:8765/v1/orders`, as the "Viewer orders address" under Orders on the Setup tab. While Squire plays, it checks that address every 5 seconds and adds each order to the Orders tab. The Orders tab and the journal name the viewer, as in "New order from viewer Grip: run from uniques". A viewer's order pulls on Squire less than one of yours, unless the persona's Devotion is 90 or higher. If the address can't be reached, Squire notes it once in the log and tries again 30 seconds later. With the field empty, Squire asks nothing. Squire Link's own README explains how to turn chat on and how to keep a busy chat from flooding the squire.

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

Two files: `manifest.json` and `plugin.js`. Squire needs Neo Angband engine 1.8.0 or newer. Either:

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

[Open an issue here](../../issues/new/choose) for a bug in **this mod**. Two kinds of bug belong against the game instead, and the forms will point you there: the mod **system** (an install that fails, a load order that won't stick, a conflict report that looks wrong), and the game **not matching Angband's own gameplay** once this mod is switched off.

For anything that should not be public, including a security report: **strider-angband (at) rpgm.tools**. See [SECURITY.md](SECURITY.md).

Asking about AI use in this project? [AI_USAGE_POLICY.md](AI_USAGE_POLICY.md) is the complete answer.

[TERMS.md](TERMS.md) covers use of this mod. The core repository's [PRIVACY.md](https://github.com/neostryder/neo-angband/blob/master/PRIVACY.md) covers what the game stores and what network requests it makes. Project participation is subject to the shared [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Licence

Squire is licensed under the GNU General Public License, version 3. See [LICENSE](LICENSE).

## Credits

Built by neostryder / RPGM Tools as part of Neo Angband. The bounded-automation direction, and the separate requests for a single autofight command and an autoexplore that keeps going to the next unexplored area, were raised on r/angband by `angbandfourk`. Jev is made by TypeSafe. Angband is the work of Ben Harrison, James E. Wilson, Robert A. Koeneke and the Angband contributors.
