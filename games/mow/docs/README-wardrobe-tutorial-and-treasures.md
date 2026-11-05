# Mow Town — Wardrobe tutorial step & hidden treasures

The plan for two features, and the record of how they're built. Built on what Mow already has: the wardrobe (Dig's,
see `game/ui/WardrobePanel.ts`), the floor-arrow guide (`MowScene.updateGuide`), the grass grid (`GrassField`) and the
town's stations (`Town`).

Status: **Part 1 and Part 2 built** (to be tested in game).

---

## Part 1 — The wardrobe tutorial step

### What the player sees

1. Mow → the bag fills → the arrows lead to the ATM → **first sale**; the guide points at the first upgrades
   (mower, bag) as it does today.
2. Back to mowing → the bag fills again → **second sale**.
3. Right after the second sale the **first wardrobe pops in** (smoke, the pop-in the section stations use) and the
   **arrows lead to it**.
4. On its pad the wardrobe opens **locked onto the cheapest hat**: the hand points at it, every other card is dimmed,
   the tabs don't switch, there's no close button, and the player can't walk off. Any money short of its price is
   quietly added (as in Dig), so this never blocks.
5. Hat bought → it's on the player's head, the panel unlocks (the rest of the wardrobe can be browsed), and the game
   simply carries on: the guide goes back to its normal steps.

### How

| Piece | Change |
|---|---|
| `levels/town.json` | A station spot can wait for sales: `"appearsAfterSales": 2` (the first wardrobe). A station tied to a section keeps `section`. |
| `Town` | `shown()` also checks `appearsAfterSales` against `MowProgress.timesSold`; `revealStations()` is called after a sale too, so the wardrobe pops in. `wardrobeSpot(i)` for the guide. |
| `MowScene.updateGuide` | New step, after the full-bag / first-upgrade steps: sales ≥ 2 and no hat bought yet → the arrows lead to the nearest wardrobe that's there. |
| `MowScene` / `MowHud` | On a wardrobe's pad with no hat bought yet: the forced hat. `MowHud.setWardrobeForced(hatId)` locks the panel (`WardrobePanel.setForcedItem`, Dig's), hides the close button, dims the screen like the shop's hint; the scene stops movement and tops up the money. |
| `WardrobePanel` | Gets Dig's forced-item mode back (`setForcedItem`: its tab and page, the hand, the rest dimmed). |
| `MowProgress` | `boughtFirstHat`, `starterHat` (the cheapest hat for sale), as in Dig. |
| Analytics | Tutorial steps `08-wardrobe` (reached the wardrobe, hat forced) and `09-hat` (first hat bought), appended after `07-park-restored` so the earlier steps keep their numbers. |
| Editor | The station inspector's "Appears": from the start, after the 1st / 2nd / 3rd sale, or with a section; the 3D label and the lists say which. |

Old saves: a player already past two sales sees the wardrobe at once; one who already owns a hat is never forced.

---

## Part 2 — Hidden treasures

### What the player sees

- Treasures are **hidden in the grass** of each area (section): a handful per area, at seeded spots, so every player
  finds them in the same places.
- Walking **close** to one (within a few units), a soft **beam of light** rises from its spot (Dig's treasure beams),
  with sparkles right next to it — something to mow towards.
- **Cutting its cell** pops the treasure out: it jumps up, spins and flies into the **Trophies button** on the HUD; a
  banner says what was found ("NEW TROPHY: Rusty Lantern").
- The **Trophies button** (a trophy icon under the money/bag pills) gets a bouncing "!" while there's a reward to
  claim. Tapping it opens the **Trophies panel**:
  - one **tab per area** (Starting Park, Residential Street, …; an area not open yet shows its tab locked);
  - a grid of that area's treasures: a found one shows its model (turning icon), name and either **CLAIM $X** or a ✓;
    one not found yet shows a dark silhouette and "?" — so the player knows how many are left and where to look;
  - the area's count ("3 / 5 found") and, when all are found, an **area bonus** to claim.
  - Claiming flies coins from the button to the money counter (Dig's claim animation).

That's the difference from Dig: Dig keeps its finds in a Trophy Room in the hub (you walk there to claim); Mow shows
them in a UI panel you open any time, organised by area.

### Decisions (change any of them)

- **Rewards are claimed in the panel**, not paid on the spot: the "!" brings the player into the panel, where they
  see the area's collection and what's still missing.
- **Restoring an area never loses a treasure**: when an area hits its goal and its stragglers are cleared, any
  treasure still hidden there pops out and is collected too.
- **The relief regrowth** (grass growing back only when stuck) never covers a treasure that's still hidden; collected
  treasures don't come back.
- **Models**: Dig's relic models (bone, comic, lantern, skull, map, chest, journal, dynamite, gold bars, …), copied
  into Mow's models — same assets, like the wardrobe.

### Data

`ui/mow.json`:

```json
"treasures": {
  "beamRange": 7,
  "items": [
    { "id": "bone", "name": "Old Bone", "model": "treasures/bone-a.glb", "size": 0.7, "area": "park", "reward": 25, "rarity": "common" }
  ],
  "areaBonus": { "park": 150, "street": 500 }
}
```

- `area` is a section id (`levels/town.json` sections); placement is seeded inside that section's grass cells, away
  from pads and props, and spread out (a minimum distance between two).
- Save (`MowProgress`): `treasures.found` (ids), `treasures.claimed` (ids, plus `area:<id>` for an area bonus). Old
  saves get empty lists.

### How

| Piece | What |
|---|---|
| `GrassField` | `treasureAt(cell)` / `placeTreasures()` (seeded per area, only on grass cells), and cutting a treasure cell reports it (`cutCapsule` result `found`). Relief regrowth skips treasure cells. |
| `world/TreasureBeacons.ts` | Dig's beam + ring, fed by the hidden treasures within `beamRange` of the player. |
| `MowScene` | On `found`: the pop-out and flight to the Trophies button, the banner, `MowProgress.findTreasure()`. On restoration: collects what's left in that area. |
| `ui/TrophiesPanel.ts` | The panel: area tabs, the grid (found / claim / silhouette), the area count and bonus. |
| `MowHud` | The Trophies button and its "!", the banner, the claim coin flight. |
| Analytics | `treasure / <id> / complete` (found), `treasure / <id> / interact` (claimed), `treasure / area-<id> / complete`. |
| README | "How it plays" gets the treasures; Data gets `treasures`. |

### Testing (by the developer, in game)

- New game: two sales → the wardrobe appears and the arrows lead there → forced hat → the game carries on.
- Old save past two sales with a hat → no forced hat; the wardrobe is just there.
- Walk near a treasure → the beam; cut it → pop-out, banner, "!" on the button; claim in the panel → coins.
- Restore an area with treasures still hidden → they're collected; the panel shows them found.
