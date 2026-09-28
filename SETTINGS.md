# Settings reference

Squire reads these settings when its controller is created, so a change takes effect after a reload. The errand settings apply only when no model is choosing. The brain, key, personas, telemetry, roll-on and Knight's Lessons are set in the Squire panel instead.

| Flag | Default | What it does | Reload required |
| --- | --- | --- | --- |
| `squire.errandAutofight` | on | Offers the fighting errand when a creature is in sight. | Yes, controller side. |
| `squire.errandAutoexplore` | on | Offers the exploring errand when no creature is in sight. | Yes, controller side. |
| `squire.errandCampaign` | off | Lets Squire continue playing until the keyboard is taken back. | Yes, controller side. |
| `squire.useModel` | on | Asks the model set up in the Squire panel what to do at each decision; runs the errands otherwise. | Yes, controller side. |
| `squire.stopOnLowHealth` | on | Ends an errand after hit points fall below half. | Yes, controller side. |
| `squire.stopOnNewCreature` | on | Ends an errand when a new creature appears. | Yes, controller side. |
| `squire.wakeSleepers` | off | Lets the fighting errand target sleeping creatures. | Yes, controller side. |
| `squire.collect` | on | Picks up items underfoot during the long errand. | Yes, controller side. |
| `squire.descend` | on | Lets the long errand use a known down staircase. | Yes, controller side. |
