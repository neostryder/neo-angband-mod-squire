# Town trip report

## Files and exports

- `needs.ts`: `SupplyKind`, `SupplyNeed`, `shownName`, `matchesSupplyName`, `supplyName`, `supplyNeeds`, `lowOnSupplies`, and `recallItem`.
- `shop.ts`: `Purchase`, `Sale`, `storesFor`, `shoppingList`, `sellList`, and `saleFits`.
- `plan.ts`: `ShopEntrance`, `shopEntrances`, `neededEntrances`, `townTripPlan`, and `recallPlan`.
- `needs.test.ts`, `shop.test.ts`, and `plan.test.ts`: supply, budget, purchase order, and store visibility checks.
- `../terrain.ts`: identifies mapped shop entrances by the 4.2 feature codes.
- `../harness.ts`: adds town shop grids, mutable test inventory and stores, and shop quantities.
- `../knight.ts`: labels and recognizes the new goals.
- `../../manifest.json`: grants the store read capability used while inside a shop.

## Goal planner changes

`../brain/goals.ts` offers `recall_town` when dungeon supplies are critically low and a visible Word of Recall scroll is carried. In town it offers `shop` for mapped, unvisited supply shops, then `recall_dungeon` when shopping is done and the character has reached below level 1. A character with no recall scroll can take known town stairs once shopping is exhausted or no gold remains. The handbook mentions town trips. `../brain/goals.test.ts` covers these offers.

## Judgment calls

- Store stock is read only on the shop entrance under the character, and only the matching store is used. Routes to shops come from remembered map cells and registered terrain codes.
- Missing shown names or prices are skipped. The plan uses explicit quantities and re-reads stock after each command.
- A high savings slider holds up to one quarter of starting gold in reserve. Recall can spend that reserve.
- Selling is limited to clearly duplicate, named, unworn ordinary gear at a selling slider of at least 60. Favoured weapons are retained.
- A lantern's oil supply serves both fuel and throwing needs, so a single purchase covers the larger deficit.
- A town shop is tried once per visit. This lets Squire recall back down when the desired stock is unavailable or unaffordable.
