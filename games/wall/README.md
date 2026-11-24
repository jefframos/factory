# WALLBREAK

Punch a voxel wall to pieces, walk through, punch the next. The design: [wallbreak-design-readme.md](wallbreak-design-readme.md)
(its build order, section 8). Run it: `GAME=wall` in `.env`, `npm run dev`. `?debug=1` adds two panels: **Wall** (cash, bricks,
skip walls, new game) and **Effects** (a switch and a strength for every effect, kept in the browser; COPY gives them as
`ui/effects.json` wants them).

## What's built (steps 1-8)

- **The punch.** Tap anywhere: the hand goes to that spot (or the nearest of the wall) and the cells there break off. Two fingers
  are two punches; Space punches, 1-4 buy.
- **The wall.** A portrait block, the same on every screen and all of it in sight; what's round it doesn't break. Cells go by how
  near they are to the tap, steered by weak lines; what's left hanging falls. The bar is the share of cells still to go.
- **The way on.** The next wall stands in its own gate in the dark behind; a wall down, the player walks through to it and the
  crew runs along.
- **27 walls, 15 materials** (cardboard, wood, plaster, concrete ... moon rock), then round again from concrete in other
  colours, for as long as it goes.
- **PUNCH HARDER.** The first level's free after wall 1; from level 2 each one brings another tool: six types in turn, in the
  next of nine colours every three levels (stone, copper, iron, gold, emerald ...).
- **The wardrobe** (top right). Skin, shirt, gloves, rings, wrist and the tool held; things come with the walls, are bought,
  or are for a video (`ui/looks.json`). While playing, cards come up with something new (a gift, a sale, a video): taken, it's worn.
- **The crew** (cash). Eight animals that headbutt or throw on their own, each there from a wall on; a card shows the next one
  as a silhouette.
- **Boosts** (bricks, which walls bring). Each of the crew's at 1, 5, 15, 30... copies, and others: hits that add some of the
  crew's damage, cash, the weak spot, a longer combo.
- **The weak spot** (from wall 5). x5, and hit again within 2.2 s each time, a combo on every hit up to x4.
- **Medals** (from wall 6): a golden one turns behind each wall; the wall down, it flies to the Rewind button (a wall's number
  of them). **REWIND** (from wall 16) cashes them in: back to wall 1 with all damage up for good (+10% each); PUNCH HARDER,
  boosts and looks are kept. Its popup says so, opens by itself the first times, and its show spins the clock back.
- **The save** (SaveStorage) and **the events** (`game/analytics/WallAnalytics.ts`: the table of them all).
- **Gameplay and ads** (`game/ads/Gameplay.ts`): gameplayStart on the first click, stop while the wardrobe, the rewind popup or an
  ad is open; a commercial break as either opens; rewarded videos.

## Where

| | |
|---|---|
| `ui/wall.json` | Every number: walls, materials, the crew, boosts, the weak spot, rewinding, tools, the camera |
| `ui/effects.json` | How strong each effect is (camera, screen, pieces) |
| `ui/looks.json` | What the hands can wear, and the wall each thing comes with |
| `ui/hands.json` | The hands' finger poses (from There Is Rope's editor; `fist` is ours) |
| `game/data/` | `WallConfig` (the numbers, typed), `WallProgress` (the save, and what follows from it) |
| `game/wall/` | `VoxelWall` (the grid, hits, what's drawn), `Tunnel` (the gates, the medal), `WeakSpot`, `Debris` |
| `game/crew/Crew.ts` | The helpers: one InstancedMesh a kind |
| `game/player/` | The hands over everything: punches, tools, There Is Rope's tool swing; `HandDress`: what they wear |
| `game/ui/` | `WallHud` (bar, numbers, words), `Tray` (what's bought: the Layer Lab pack's item cards), `Wardrobe` |
| `tools/build-tools.mjs`, `tools/build-crew.mjs` | Make the tools' and the crew's models, and the tray's icons, from the library |

## Pacing

Simulated, 4 taps a second with some weak spots hit and buying well: wall 5 at 1:00, 8 at 1:50, 12 at 3:50, 16 at 6:15. At
2.5 taps a second without them: 1:35, 3:00, 5:55, 9:20. Real players are slower than both.

## Where it parts from the design

- A wall comes down at 50% of its cells gone (`wall.breakShare`), not all of them; the rest bursting is the payoff.
- A hit isn't capped at 24 cells: the damage is the bite.
- The helpers are animals, not the design's fighters and machines (ours to own), and their prices are our own.
- Bricks buy boosts, not new kinds of helper (those come with the walls).
- Nothing moves or flashes on a hit but the wall and the hands (it made people sick); a wall's fall shakes and flashes
  (`ui/effects.json`).
- Rewinding is at wall 16 (12 there): the walls go faster. The tease behind the wall is the medal it cashes in, from wall 6.
- Not built: offline earnings.
