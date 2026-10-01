# Settings reference

Squire has settings in three places: the switches on the game's Mods screen, the Setup tab of the Squire panel, and the Persona tab. A Mods switch takes effect after the page reloads. A panel setting is saved the moment you change it, but some apply only at the next handover or reload, as the tables below say. Persona edits apply to new characters.

## Mods screen

Open the Escape menu, then **Mods**, then Squire. The errand switches matter when a handover runs the errands: with no model set up, or with "Let a model choose what to do" off. "Take the stairs down" also applies while a model is playing.

| Switch | Flag | Default | What it does |
| --- | --- | --- | --- |
| Errand: clear what is in front of me | `squire.errandAutofight` | on | Runs the fighting errand when Squire can pick a creature to fight. A sleeping creature counts only with "Attack sleeping creatures" on. When there is no such creature, Squire tries the exploring errand. |
| Errand: explore this floor | `squire.errandAutoexplore` | on | Runs the exploring errand when the fighting errand is off or has no creature to fight. |
| Errand: play on until I take the keyboard back | `squire.errandCampaign` | off | Runs the long errand in place of both short errands. |
| Let a model choose what to do | `squire.useModel` | on | With a model set up in the Squire panel, Squire asks it what to do and keeps playing. With this off, a handover runs the errands. Knight's Lessons still asks the model while you play; turn that off on the Setup tab. |
| Stop when I am hurt | `squire.stopOnLowHealth` | on | Ends a short errand when hit points fall to half or less. The long errand reacts to low health whatever this says. |
| Stop when something new appears | `squire.stopOnNewCreature` | on | Ends a short errand when a creature that was not already in sight comes into view. The long errand keeps playing. |
| Attack sleeping creatures | `squire.wakeSleepers` | off | Lets the fighting errand and the long errand pick a sleeping creature to fight. |
| Pick things up on the way | `squire.collect` | on | Lets the long errand pick up what lies under the character. |
| Take the stairs down | `squire.descend` | on | Lets the long errand take a known down staircase, and lets a model choose ordinary descent. Fleeing down the stairs in an emergency and reading Word of Recall do not depend on it. |

## Setup tab

The Setup tab is the first tab of the Squire panel. Its sections appear in this order.

### Pick a brain

| Setting | Default | What it does |
| --- | --- | --- |
| Brain | Jev | Which model Squire asks: Jev, Laya, another server, or no model. Pick no model, or pick Jev without saving a key, and a handover runs the errands instead. A new pick takes over at the next handover. |
| Jev API key | none | Shown when Jev is picked. Squire comes with no key. Paste yours and press "Save key". Save an empty field to remove it. In the desktop app, "Use key from environment" reads `TYPESAFE_API_KEY` or `JEV_API_KEY` once you agree. |
| Per session ($) | 0 | Shown when Jev is picked. Squire pauses when this session's spend reaches the limit. 0 means no limit. A change takes effect after a reload. |
| Per day ($) | 0 | Shown when Jev is picked. Squire pauses when today's spend reaches the limit. 0 means no limit. A change takes effect after a reload. |
| Server address | `http://localhost:8010/v1/systemone` | Shown for Laya or another server. The server Squire asks. Use localhost or an IP address on your home network. Squire can't reach a name such as `laya.lan`. |
| Backup server addresses | empty | Shown for Laya or another server. Up to eight more addresses, separated by commas, tried in order when the first server is busy or not answering. |
| Model name | empty | Shown for Laya or another server. The model name sent with each request. Empty uses the server's default. |
| Context size (tokens) | 4,096 | Shown for Laya or another server. How much text the server accepts in one request. Squire gives a backstory at most 15 percent of it. The smallest value is 512. |

**Test connection** sends one small request to the picked server and shows what came back.

### Train Laya while Jev plays

| Setting | Default | What it does |
| --- | --- | --- |
| Send decisions to Laya | off | While Jev is the brain, sends each of Jev's questions to Laya as a training request. Squire never acts on Laya's answers. |
| Laya address | `http://localhost:8010/v1/systemone` | Where training requests go. An empty field goes back to the default. |
| Backup server addresses | empty | Up to eight more Laya addresses, separated by commas, tried in order when the first is busy or not answering. |

**Save Laya training rows** writes the Jev answers Squire has kept on your computer to a file, one answer per line, for training Laya.

### When a character dies

| Setting | Default | What it does |
| --- | --- | --- |
| When a character dies | Stop and wait for you to make the next character | The other choices start a new character like the last one, or one of a random race and class, and hand it to Squire. This applies only when a character dies while a model is playing it. Your own characters are never replaced. |

### Knight's Lessons

| Setting | Default | What it does |
| --- | --- | --- |
| Learn from how I play while I have the keyboard | on | When you fight, flee, drink a potion or make another choice Squire would have weighed, it works out what it would have done and writes the difference in the Lessons tab. If a model is set up, Squire asks it about those moments, one question at a time, so this costs requests on Jev. Switch it off and Squire asks nothing while you play. |

### Orders

| Setting | Default | What it does |
| --- | --- | --- |
| Instructions kept | 8 | How many orders and standing instructions Squire holds before it drops the one it follows least readily. From 1 to 50. |
| Viewer orders address | empty | An address to collect viewers' orders from, such as Squire Link's `http://127.0.0.1:8765/v1/orders`. Squire checks it every 5 seconds while it plays. Empty collects no orders from chat. |

### Share runs with the Squire project

| Setting | Default | What it does |
| --- | --- | --- |
| What to send | Off | Off sends nothing. Summary sends how each run ended, its deepest level, top kills and token counts, with the character's name, race and class. Decisions adds each decision's turn, kind, question, choice, confidence, probabilities and outcome. Full adds the run's Chronicle. |
| Also send my persona's backstory, at the Full level | off | Sends the persona's backstory with runs sent at the Full level. |
| Endpoint (empty sends nothing) | `https://squire.rpgm.tools` | Where finished runs are sent. With the field empty, Squire sends nothing. |

## Persona tab

The top of the Persona tab holds the persona library. Pick a persona from the list to edit it, or start a new one from "Start a new persona from...", which offers Default, Random and the archetypes coward, berserker, miser, scholar, zealot and tourist. **Export**, **Import** and **Delete** work on the persona shown. The library holds up to 50 personas.

| Setting | Default | What it does |
| --- | --- | --- |
| New characters play as this persona | on for Squire, the first persona | Makes the persona shown the one new characters start with. Clear it to start new characters with no persona. |
| Name | Squire | The persona's name. |
| Backstory | empty | Who the character is, in your words. Squire sends as much of it with each decision as the backstory weight, the backstory cap and the server allow. |

The rest of the sheet is grouped as on screen. Sliders run from 0 to 100, and the range column names the ends. A list takes words separated by commas. A quirk has a checkbox and a strength slider.

### Temperament

| Setting | Default | Range | What it changes |
| --- | --- | --- | --- |
| Boldness | 50 | timid to fearless | A timid character backs off from danger a fearless one would stay and face. |
| Impulsiveness | 50 | deliberate to rash | A rash character acts on its first instinct more often. |
| Patience | 50 | restless to patient | A patient character rests to full, waits in corridors and reads a level before taking the stairs. |
| Composure | 50 | panics to ice-cold | How the character's choices change when its hit points run low. |
| Stubbornness | 50 | flexible to never backs down | The higher it is, the harder the character finds it to give up a fight or goal it has chosen. |
| Curiosity | 50 | incurious to must know | Trying unknown items and looking into every corner. |
| Paranoia | 50 | trusting to sees danger everywhere | A wary character detects more, keeps away from monsters it does not know and holds on to its escapes. |
| Optimism | 50 | expects the worst to expects the best | At 70 or more, creatures seem one danger step safer than they are. At 30 or less, they seem one step deadlier. |
| Volatility | 50 | steady to mood swings | How far persona strength wanders from one decision to the next. |
| Pride | 50 | humble to glory-seeking | A proud character hunts uniques and chases depth records. |

### Values

| Setting | Default | Range | What it changes |
| --- | --- | --- | --- |
| Self-preservation | 70 | reckless to survival first | Squire drops any choice riskier than this allows, unless Death wish is on. |
| Greed | 50 | indifferent to gold-hungry | A greedy character goes out of its way for gold and loot it knows about. |
| Ambition | 50 | content to driven to win | How fast the character heads deeper. |
| Honour | 50 | fights dirty to fights fair | Attacking sleeping creatures and using corridor tactics. |
| Mercy | 50 | kills everything to spares the harmless | Whether to attack harmless or fleeing creatures. |
| Renown | 50 | private to showboat | Favours moves worth a Chronicle line over equally good, safer ones. |

### Likes and dislikes

| Setting | Default | Example | What it changes |
| --- | --- | --- | --- |
| Hated monster families | empty | orcs, dragons, undead | Fights these on sight and takes more risk against them. |
| Feared monster families | empty | spiders, ghosts | Avoids these and leaves levels early when they appear. |
| Favoured weapons | empty | blades, hafted, polearms, bows | Keeps a favoured type when another is slightly better. |
| Distrusted things | empty | magic devices, unknown scrolls | Uses these only when necessary. |
| Favoured spells or elements | empty | fire, lightning, healing | Prefers these spells when several work. |
| Superstitions | empty | never reads scrolls at 1300 ft | Harmless rules the character keeps. |

### Habits

| Setting | Default | Range | What it changes |
| --- | --- | --- | --- |
| Pack weight | 50 | travels light to carries everything | A light traveller leaves things behind that a hoarder would carry. |
| Tidiness | 50 | ignores junk rules to ignores aggressively | How readily the character tells the game to ignore kinds of junk. |
| Home use | 50 | never uses the home to stashes treasures | Whether spare gear is left in the home in town. |
| Town trips | 50 | rarely returns to returns often | How low supplies get before the character goes back to town. |
| Detection habit | 50 | never detects to detects on arrival | Whether the character detects and maps as soon as it reaches a new level. |
| Level thoroughness | 50 | takes the first stairs to clears every level | How much of a level the character explores before it goes down. |

### Tactics

| Setting | Default | Range | What it changes |
| --- | --- | --- | --- |
| Engagement range | 50 | melee to ranged and kiting | Whether the character closes in to fight or shoots from a distance. |
| Escape readiness | 50 | keeps none to keeps many | How many escapes the character wants in the pack before it goes down. |
| Heal threshold | 50 | heals late to heals early | The hit points at which healing becomes an option. |
| Retreat threshold | 50 | holds to the end to leaves early | The hit points at which fleeing becomes an option. |
| Target priority | 50 | weakest first to most dangerous first | Which creature in a group is attacked first. |
| Consumable use | 50 | saves for emergencies to uses freely | How readily potions, scrolls and charges are spent. |
| Corridor discipline | 50 | fights in the open to always backs into a corridor | Whether the character draws a group into a corridor before it fights. |

### Money

| Setting | Default | Range | What it changes |
| --- | --- | --- | --- |
| Price sense | 50 | pays anything to buys only bargains | How much a high price puts the character off something it wants in a shop. |
| Savings goal | 50 | spends it all to saves for the big item | Whether the character keeps gold back for one expensive item. |
| Selling | 50 | keeps everything to sells everything | At 60 or more, the character sells plain spare weapons and armour, where the birth options allow selling. |

### Quirks

Each quirk starts off, with its strength slider at 50.

| Setting | Default | What it changes |
| --- | --- | --- |
| Forgetful | off | Now and then leaves a learned lesson out of what Squire tells the model, and lets what it saw in the shops fade. |
| Delusional | off | Now and then misjudges how dangerous a creature is. |
| Compulsive collector | off | Must pick up everything it walks over. |
| Pyromaniac | off | Reaches for fire in every form. |
| Death wish | off | Lets choices past the Self-preservation risk limit through. |
| Craven | off | Flees from anything new, then circles back. |

### Lineage

| Setting | Default | What it changes |
| --- | --- | --- |
| Inheritance | 50 | How much ancestral lore an heir starts with, from nothing passes (0) to everything passes (100). |
| Blood grudges | on | An heir hates or fears whatever killed its ancestors, more strongly with each ancestor it killed. |
| Epitaphs | on | Squire writes an epitaph naming the killer and the character's last choice. |
| Family milestones | on | The family remembers depth records, unique kills and its first artifact. |
| Namesakes | on | An heir can take an ancestor's name with a number. |
| Inherited superstitions | on | An heir avoids the scroll, potion or wand its ancestor used just before dying, until that kind is identified. |
| Lessons of the dark | on | An heir carries extra fuel after an ancestor died without light. |
| Trophies | on | A proud character keeps one item from each unique it kills while the pack has room. |
| Favoured grounds | on | An heir prefers hunting where the family made its best find, once it is ready for that depth. |
| Family resemblance | 50 | How much personality an heir takes from its parent, from each heir is new (0) to heirs take after parents (100). |

The [README](README.md#personas) explains what each lineage feature does in play.

### Patron

| Setting | Default | Range | What it changes |
| --- | --- | --- | --- |
| Devotion | 50 | ignores you to obeys you | How closely the character follows your orders. |
| Gratitude | 50 | takes gifts for granted to deeply grateful | How much a blessing from you raises Devotion. |
| Resentment | 50 | forgives trials to holds a grudge | How far Devotion falls after you put the character through a trial. |

### How Squire plays it

| Setting | Default | Range | What it changes |
| --- | --- | --- | --- |
| Persona strength | 35 | plays by advice to plays in character | How much the in-character answer counts against the best-move answer. |
| Backstory weight | 50 | ignored to rules everything | How much of the backstory goes into each decision. |
| Backstory cap (tokens) | 600 | 0 to 4,000 | The most backstory tokens sent with one decision. |
| Learning rate | 50 | slow to quick | How fast lessons form and fade. |
| Trait drift | 30 | fixed to shaped by experience | How far experience moves the character's traits. |
| Confidence gate | 50 | acts on anything to asks again when unsure | When Squire asks the model a second question. |
| Thinking depth | 50 | fast to thorough | How many questions a decision asks. |
| Chronicle voice | 50 | terse to chatty | How many events reach the Chronicle. |

## Other panel controls

| Setting | Default | What it does |
| --- | --- | --- |
| Show Squire's choice when it differs (Lessons tab) | off | Shows what Squire would have done when your choice differs from its own. |
| A- and A+ (panel tab bar) | 100% | Make the panel text smaller or larger, in steps of 80, 90, 100, 115, 130 and 150 percent. The size is kept for this browser or app. |
