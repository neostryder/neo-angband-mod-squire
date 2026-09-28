# Gear and detection report

## Files and exports

- `src/gear/compare.ts` exports `GearCandidate`, `GEAR_WEIGHTS`, `fullyKnown`, and `gearCandidates`.
- `src/gear/REPORT.md` is this delivery report.

## Changes outside `src/gear/`

- `src/brain/goals.ts` offers and plans the `wear` and `detect` goals, tracks the first decision after a depth change, and adds two handbook lines.
- `src/brain/pack.ts` exports `Detection`, `detectionSources`, and `detectionSource` for known mapping and detection sources.
- `src/brain/goals.test.ts` covers gear selection, fair play, cursed gear, launcher preservation, detection timing and actions, and command mapping.
- `src/harness.ts` gives named test items the tval that matches their shown kind.
- `src/knight.ts` labels the goals and maps player wear, read, zap, and cast commands.

## Judgment calls

- A loadout simulation is used only when the shown name includes the required plus pair and has no unexplained brace mark. Other gear stays unknown, even if its visible base armour or damage is better.
- A curious persona can try unknown gear when no awake creature is within three steps. Visible base values reject an obviously worse item.
- Detection is offered on the first decision at a dungeon depth, including the first decision in a new planner. If a creature is awake in sight on that decision, the opportunity passes until the depth changes again.
- Gear scoring uses the named weights in `compare.ts` and requires a score above 2. The description lists derived changes, including losses.

## Limits

- The shown name and tval do not describe every slot rule of a modded body. The loadout simulation supplies exact placements for fully known gear. Unknown gear uses the standard Angband 4.2 slot families.
- No requested work was left undone.
