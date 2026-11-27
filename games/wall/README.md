# WALLBREAK

## Description

Smash through wall after wall with your bare fists, then boxing gloves, hammers, axes and swords! Hire a crew of animals that punch for you, upgrade your weapon, beat the enemies and bosses hiding behind the walls, and rewind to start again stronger.

## Controls

- **Punch:** tap or click the wall; hit the glowing weak spot for extra damage and combos. Two fingers punch with both hands. Space also punches.
- **Upgrade:** tap the cards at the bottom to buy a stronger weapon, more crew and boosts (keys 1-4 buy the first four).
- **Power-ups:** tap the buttons on the right, and catch what floats by for cash and chests.
- **Menus:** tap or click the buttons (wardrobe, rewind); Esc closes them.

---

Punch a voxel wall to pieces, walk through, punch the next. The design: [wallbreak-design-readme.md](wallbreak-design-readme.md)
(its build order, section 8). Run it: `GAME=wall` in `.env`, `npm run dev`. `?debug=1` adds three panels: **Wall** (cash, bricks,
skip walls, new game), **Camera** (its settings, in play and in fights; COPY gives them as `camera` in `ui/wall.json`) and **Effects** (a switch and a strength for every effect, kept in the browser; COPY gives them as
`ui/effects.json` wants them).

**Android app**: `npm run android` opens a panel that checks the setup, lists the phones plugged in and runs it on one or builds an APK (mock ads till AdMob is set): [native/README.md](../../native/README.md).
The plan for the stores (accounts, costs, in-app purchases, every step): [WALLBREAK on Android](https://claude.ai/artifact/TdaLhThEY7Q3vesak4RkDu).

## What's built (steps 1-8)

- **The punch.** Tap anywhere: the hand goes to that spot (or the nearest of the wall) and the cells there break off. Two fingers
  are two punches; Space punches, 1-4 buy.
- **The wall.** A portrait block, the same on every screen and all of it in sight; what's round it doesn't break. Cells go by how
  near they are to the tap, steered by weak lines; what's left hanging falls. The bar is the share of cells still to go.
- **The way on.** The next wall stands in its own gate in the dark behind; a wall down, the player walks through to it and the
  crew runs along.
- **27 walls, 15 materials** (cardboard, wood, plaster, concrete ... moon rock), then round again from concrete in other
  colours, for as long as it goes.
- **PUNCH HARDER.** The first level's given after wall 1; the next at nearly every wall up to 16 (`punch.given`; helpers and boosts
  too: `auto`), so nobody ever gets stuck and the first ten walls take 5-8 s each, whoever plays, to
  who hasn't bought them by then; boxing gloves come first, kept to level 4 (worn on both
  hands; red, blue from level 3, then emerald, golden, shadow each time they come round), then ten to swing (four of them swords; the first ones kept 2-3 levels, then one a level: `tools.levels`), in turn, in the next of nine
  colours every four levels (stone, copper, iron, gold, emerald ...).
- **The wardrobe** (top right). Skin, shirt, gloves, rings, wrist and the tool held; things come with the walls, are bought,
  or are for a video (`ui/looks.json`). While playing, cards come up with something new (a gift, a sale, a video): taken, it's worn.
- **The crew** (cash). Eight animals that headbutt or throw on their own, each there from a wall on.
- **Boosts** (bricks, which walls bring). Each of the crew's at 1, 5, 15, 30... copies, and others: hits that add some of the
  crew's damage, cash, the weak spot, a longer combo.
- **Rarity** (`rarity` in `ui/wall.json`): common, uncommon, rare, epic, legendary, mythic, prismatic, as the pack's collection
  cards (`Preview/5_Collection_List`): the card in its tier's colour (`ItemFrame02_Single_*`: grey, green, blue, purple, gold,
  red, rainbow) and 1 to 7 stars (rainbow for prismatic) in a dark band ([ui/Rarity.ts](game/ui/Rarity.ts)). Every look has one
  (`ui/looks.json`), the rarer from later walls (legendary 110-260, mythic 220-450, prismatic 400-700; numbers past Dc go aa, ab ... zz), so later runs still bring new ones. A tool's is its
  grade: as it came, then each level it's kept (`tools.levelsAfter` 6, so each later tool goes green to red); the weapon's card
  and its glow show it.
- **Relics** ([ui/Relics.ts](game/ui/Relics.ts), `relics`): bought with medals, for good, from the first rewind (a button under
  the rewind's): STRONG ARM (all damage x1.5 a level), WILD HERD (crew damage x2), STAMPEDE (crew x1.25 faster), IRON GRIP
  (+1 hold punch a second), GOLD DUST (cash x1.5), QUICK CHARGE (power-ups charge 20% sooner), HEAD START (a rewind starts 3
  walls further, up to wall 13). A medal spent gives no damage any more; each is the pack's grade badge.
- **Shop** ([ui/Shop.ts](game/ui/Shop.ts), `shop`): only where the platform has purchases (`canBuy()`: the phone app,
  CrazyGames once it's let in; none on Poki, YouTube, GameDistribution, GamePix), from wall 5, a button under the wardrobe's.
  The starter pack, then NO ADS, DOUBLE CASH, AUTO HOLD (had for good, restored from the store at the start) and medal packs.
  **Try it locally with `?shop=1`**: the mock platform sells everything through a BUY / CANCEL screen and keeps what's had for
  good in the browser (`mock.purchases` in localStorage; clear it to buy again).
- **Crew ranks** ([ui/CrewRanks.ts](game/ui/CrewRanks.ts), `ranks`): for good, through rewinds, bought with **gems** (bosses
  drop them: `boss.gems`, one more every `gemsEvery` walls). Each kind's next rank: x2, x4, x8 damage, and a hat on all of
  that kind (hard hat, viking hat, crown, out of library3d's stylized hats pack: `tools/build-hats.mjs`, sat on each head by
  Crew's `headOf`). The CREW button sits under the shop's on the right (in the top row on a wide screen) from the first gems
  on. Debug: `?debug=1` > Wall > +20 GEMS.
- **Hold to punch** (`hold`; the button from the first rewind): a big HOLD button low on the right; held, the hands punch on their own (3 a second
  and IRON GRIP's), where AUTO would; a finger held on the wall does it too, where it is, from the very first wall.
- **What comes when**, the first time through: one new thing a wall, a gift or something new on screen, never two, and no words to
  read about it. 2 the red gloves, 3 the chick, 4 the weak spot (a TAP ring on it till it's hit), 5 a free weapon level, 6 the beaver,
  7 a free weapon level, 8 floating cash, 9 boosts (bought for who leaves them three walls), 10 medals, 11 the hog, 12 enemies,
  13 a free weapon level, 14 the wardrobe and its offers, 15 the monkey, 16 TWO HANDS, 17 golden chests, 18 a free weapon level,
  19 buying nudges, 20 the first boss, 21 frenzy, 22 the cow, 23 a free weapon level, 24 AUTO HIT, then the panda at 26 (a finger held on the wall punches on its own from the start; the HOLD button comes with the first rewind), a weapon level
  at 27, the elephant at 29, a weapon level at 31, the giraffe at 33 (each helper's card shows up with it). Free weapon levels only to
  who hasn't bought them, free helpers (beaver, hog, monkey) only to who hasn't hired one. A rewind keeps half the weapon's level
  (its popup shows which weapon). Walls 4-30 take about 10-20 s each for a casual player (simulated; a boss up to half a minute).
- **What floats by** (`ui/Floater`, `floating`, from wall 8): every 16-26 s bills (the wall's HP in cash), a frenzy (from wall 21: all damage
  x2 for 30 s) or a golden chest (from wall 17, for a video: five walls' worth). Their switch is in the Effects panel.
- **Away** (`away`): back after 3 minutes or more, the crew's earned some cash (paid at the first click; no popup), the same again
  floats by for a video.
- **The nudge** (`nudge`, from wall 19): something affordable left for 15 s, a hand points at the best of it.
- **The weak spot** (from wall 5). x5, and hit again within 2.2 s each time, a combo on every hit up to x4.
- **Enemies and bosses** (`ui/wall.json` `enemies`; `on`: false and there are none at all, `?enemies=0` or 1 and the debug panel try
  it either way). Minions behind every third wall from 12 on and a boss behind every tenth from 20 on, whose gate says so: dark red with a
  skull on it, spikes, a skull and a red light over it. Punch them, the crew does too; a boss has the weak spot on it and 30 seconds.
  In a fight the camera eases in on them (`fightCamera` in the Effects panel). In the first 5 won (`circles`), each minion has a circle on it
  (`enemies/TapMarks`): tapped, x2 damage, and it pops up somewhere else on it.
  Its time up it's gone, and minions come, wave after wave (they pay), until FIGHT BOSS! calls it back. Each boss is bigger than the one before, and the
  colours (the skeletons' bones, the others' hue) change every two bosses and with each rewind; some are a pair (the debug Bosses panel shows them all). A wall's only done once
  what's behind it is. Models: Mob's (`tools/build-enemies.mjs`), got one at a time as their walls come near.
- **Power-ups** (`data/Powers`, `ui/PowerButton`, `powers`): down the right side, TWO HANDS (from wall 16: each hit's followed by the other
  hand's, the same tool in it) and AUTO HIT (from wall 24: 4 hits a second on its own), 30 s each, together too; then they charge (or a
  video has them on at once). Their icons are drawn (`art/power_*.png`, full size; `Wall_power_*` in the atlas); the floating orbs: `tools/build-powers.mjs`.
- **Medals** (from wall 10, every third wall: 10, 13, 16 ...; minions are at 12, 15, 18 ... and bosses at 20, 30 ..., so a wall has one thing,
  and none right before a boss): a golden one turns behind the wall; the wall down, it flies to the Rewind button (the wall's number of them). **REWIND** (from wall 15) cashes them in: back to wall 1 with the first gloves and all damage up for good (+6% each); boosts and
  looks are kept, and nothing's given to help the next time up. Its popup says so, opens by itself once ever (at wall 21, after the first boss: `rewind.popup`; sooner if that boss gets away), and its show spins the clock back.
- **The music**: a lo-fi loop, written and played by `tools/build-music.py` (76 bpm, 24 bars, seamless); it comes in on the first click.
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
first chick are given, and the early walls are lighter. Simulated (a casual player: 2.5 taps a second, a look at the cards every 7 s, a few
things bought each time): walls 1-11 take 4-6 s each, 12-19 5-13 s, 20-35 5-30 s, from 38 on 30 s and more (time to rewind). Who never
buys is carried along too (`auto`): 10-30 s a wall, up to a minute or so past 30.

## Where it parts from the design

- A wall comes down at 50% of its cells gone (`wall.breakShare`), not all of them; the rest bursting is the payoff.
- A hit isn't capped at 24 cells: the damage is the bite.
- The helpers are animals, not the design's fighters and machines (ours to own), and their prices are our own.
- Bricks buy boosts, not new kinds of helper (those come with the walls).
- Nothing moves or flashes on a hit but the wall and the hands (it made people sick); a wall's fall shakes and flashes
  (`ui/effects.json`).
- Rewinding is at wall 15 (12 there). The tease behind the wall is the medal it cashes in, from wall 10.
