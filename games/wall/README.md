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
- **PUNCH HARDER.** The first level's given after wall 1; levels 2 to 5 are given at walls 4, 6, 8 and 10 to
  who hasn't bought them by then; from level 2 each one brings another tool: six types in turn, in the
  next of nine colours every three levels (stone, copper, iron, gold, emerald ...).
- **The wardrobe** (top right). Skin, shirt, gloves, rings, wrist and the tool held; things come with the walls, are bought,
  or are for a video (`ui/looks.json`). While playing, cards come up with something new (a gift, a sale, a video): taken, it's worn.
- **The crew** (cash). Eight animals that headbutt or throw on their own, each there from a wall on; a card shows the next one
  as a silhouette.
- **Boosts** (bricks, which walls bring). Each of the crew's at 1, 5, 15, 30... copies, and others: hits that add some of the
  crew's damage, cash, the weak spot, a longer combo.
- **The weak spot** (from wall 5). x5, and hit again within 2.2 s each time, a combo on every hit up to x4.
- **Enemies and bosses** (`ui/wall.json` `enemies`; `on`: false and there are none at all, `?enemies=0` or 1 and the debug panel try
  it either way). Minions behind every third wall (3, 6, 9, 12 ...) and a boss behind every tenth, whose gate says so: dark red with a
  skull on it, spikes, a skull and a red light over it. Punch them, the crew does too; a boss has the weak spot on it and 30 seconds.
  Its time up it's gone, and minions come, wave after wave (they pay), until FIGHT BOSS! calls it back. Each boss is bigger than the one before, and the
  colours (the skeletons' bones, the others' hue) change every two bosses and with each rewind; some are a pair (the debug Bosses panel shows them all). A wall's only done once
  what's behind it is. Models: Mob's (`tools/build-enemies.mjs`), got one at a time as their walls come near.
- **Medals** (from wall 6): a golden one turns behind each wall; the wall down, it flies to the Rewind button (a wall's number
  of them). **REWIND** (from wall 10) cashes them in: back to wall 1 with all damage up for good (+20% each); PUNCH HARDER,
  boosts and looks are kept. Its popup says so, opens by itself the first time ever, and its show spins the clock back.
- **The save** (SaveStorage) and **the events** (`game/analytics/WallAnalytics.ts`: the table of them all).
- **Gameplay and ads** (`game/ads/Gameplay.ts`): gameplayStart on the first click, stop while the wardrobe, the rewind popup or an
  ad is open; a commercial break as either opens, as the wardrobe closes and after a rewind; rewarded videos.

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
| `game/data/ModelQueue` | The models after the first screen, one at a time, the soonest needed first (`wantedModels` in the scene: the next enemies, tools, boxing glove, crew). The loading screen waits only for the hands and what is on or in them |
| `game/enemies/` | `Enemies` (how they look and move), `Fight` (the waves, the boss's time, calling it back) |
| `game/player/` | The hands over everything: punches, tools, There Is Rope's tool swing; `HandDress`: what they wear |
| `game/ui/` | `WallHud` (bar, numbers, words), `Tray` (what's bought: the Layer Lab pack's item cards), `Wardrobe`, `HitPill` (what a hit does now, and where it comes from) |
| `tools/build-tools.mjs`, `tools/build-crew.mjs` | Make the tools' and the crew's models, and the tray's icons, from the library |

## Pacing

From the first playtest (2026-11-25, 491 new players, `data/`): walls 3 and 4 lost half of them (190 and 480 HP then), a fifth
never took the free PUNCH HARDER, 5% got to Rewind at wall 16 and nearly all who did kept rewinding. So the first upgrade and the
first chick are given, the early walls are lighter and Rewind is at wall 10. Simulated casual player (2.5 taps a second, a look at
the cards every 6 s, any of what's affordable, sometimes nothing): walls 1-5 take 6-11 s each, 6-9 18-45 s, Rewind's reached in about 2:40.

## Where it parts from the design

- A wall comes down at 50% of its cells gone (`wall.breakShare`), not all of them; the rest bursting is the payoff.
- A hit isn't capped at 24 cells: the damage is the bite.
- The helpers are animals, not the design's fighters and machines (ours to own), and their prices are our own.
- Bricks buy boosts, not new kinds of helper (those come with the walls).
- Nothing moves or flashes on a hit but the wall and the hands (it made people sick); a wall's fall shakes and flashes
  (`ui/effects.json`).
- Rewinding is at wall 10 (12 there). The tease behind the wall is the medal it cashes in, from wall 6.
- Not built: offline earnings.
