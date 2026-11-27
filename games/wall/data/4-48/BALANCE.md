# The 4:48 build's balance

The best build so far: **4:48 average playtime** on Poki, the highest of the exports in `games/wall/data/` (2:55, 3:25, 3:45,
**4:48**, 4:01). Its analytics are in this folder. This page records the balance it played with, so it can be put back.

- **Build**: commit `2b44640e` ("wall: power-ups, swords and gloves, music, fights, events", 2026-11-25). Confirmed by the
  build cached at that commit (`cachedBuilds/wall/assets/index-8c536b92.js`): its punch prices and tool ladder are these.
- **Snapshot**: [balance/wall.json](balance/wall.json) and [balance/looks.json](balance/looks.json), that commit's
  `games/wall/ui/wall.json` and `looks.json` as they were.
- **Put it back**: [balance/apply.mjs](balance/apply.mjs) (see [Reverting](#reverting)).

## How it played (521 players who loaded)

| Reached | wall 5 | wall 10 | wall 15 | wall 20 | wall 30 | wall 50 | 5 min | 10 min |
|---|---|---|---|---|---|---|---|---|
| **4:48** | 82.7% | 58.7% | 48.4% | 40.5% | 26.9% | 14.4% | 28.6% | 12.1% |
| 4:01 (the next build) | 78.0% | 50.8% | 37.6% | 29.4% | 18.9% | 11.2% | 21.3% | 8.4% |

The next build lost 8-11 points over walls 9-22, where it had slowed the game down and given less (below). After wall 30 the
two lose players at the same rate, and 4:01 kept the long-time players a little better (wall 70+, returning sessions 3.7% vs 2.3%).

## The 4:48 balance

**Rhythm**: something new and something free nearly every wall up to 20. Free weapon levels every wall from 3 to 10, an animal
every two or three walls, both power-ups, boosts and the wardrobe by wall 7, all of the wardrobe by wall 26. The walls are easy
to wall 10, then get steep fast (×1.7 a wall from 17).

### Walls

| Wall | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | then |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| HP | 3 | 12 | 46 | 95 | 165 | 260 | 420 | 680 | 1.1K | 1.7K | 2.5K | 4.2K | 6.8K | 11K | 17K | 28K | ×1.7 a wall |

Cash: 1 per damage, plus 0.8× the wall's HP for breaking it. Bosses every 10 walls from 20 (0.7× HP, 30 s).

### PUNCH HARDER

- **Free levels** (for who hasn't bought them): level 2 at wall 3, then one more each wall: 3 at 4, 4 at 5, 5 at 6, 6 at 7,
  7 at 8, 8 at 9, 9 at 10, then 10 at 12, 11 at 14, 12 at 16.
- **Prices**: 20, 45, 90, 180, 340, 620, 1.1K, 1.9K, 3.6K, then ×2.15 a level. (The first level is free.)
- **Damage**: 1, ×2 for each of the first three levels, then ×1.5 a level.

### Tools

`levels [2,2,3,3,2,2]` from level 1, then **a new tool every level**: tools at levels 1, 3, 5, 8, 11, 13, 15, then 16, 17,
18, 19 ... (red gloves, blue gloves, stone hammer, stone axe, copper sword, copper pickaxe, copper mace, copper saber, iron
battleaxe ...). 4 per tier, 9 tiers (stone to cosmic). No grades, no rarity.

### The crew

| | Chick | Beaver | Hog | Monkey | Cow | Panda | Elephant | Giraffe |
|---|---|---|---|---|---|---|---|---|
| Wall | 3 | 5 | 7 | 9 | 11 | 14 | 17 | 20 |
| Price | 16 | 90 | 420 | 2.2K | 10K | 55K | 320K | 2M |
| Damage/s | 2 | 8 | 32 | 125 | 500 | 2.3K | 11K | 56K |

- Unlocked by the **best wall ever** (after a rewind they're all there from wall 1).
- Each one more costs ×1.16. Free first ones (for who hasn't hired any): beaver at 5, hog at 7, monkey at 9.
- Crew boosts at 1, 5, 15, 30, 50, 75, 100 owned (×2, ×2, ×2, ×1.5, ×1.5, ×1.25, ×1.25).

### When things first come

| Wall | |
|---|---|
| 2 | floating cash (every 16-26 s) |
| 4 | TWO HANDS power-up, boosts, the wardrobe |
| 5 | the weak spot, look offers |
| 6 | golden chests |
| 7 | AUTO HIT power-up |
| 10 | medals (every 3 walls) |
| 12 | frenzy, buying nudges |
| 15 | rewind (its popup at 20) |

AUTO buying for idle players till wall 40 (`auto.slow` 20).

### The wardrobe

38 looks with a wall (`wall`, `buy` or `video`): 31 of them by wall 20, the last at wall 26. Offers from wall 5.

### Rewind

Back to wall 1 with PUNCH HARDER at **level 1** (`rewind.punch: 1`), crew and cash gone, boosts and medals kept (+6% damage a
medal).

## What changed after it

What the 4:01 build changed (commit `2cd21048`), and what's in `games/wall/ui` now:

| | 4:48 | 4:01 | Now |
|---|---|---|---|
| Wall HP 4 / 8 / 12 / 16 | 95 / 680 / 4.2K / 28K | 180 / 1.1K / 5.4K / 15K | 110 / 800 / 4.2K / 15K |
| HP growth after the list | ×1.7 (from 17) | ×1.42 (from 18) | ×1.42 (from 18) |
| Free weapon levels by wall 16 | 11 (one a wall, 3-10) | 3 (5, 7, 13) | 8 (4, 5, 7, 8, 10, 13, 15) |
| Punch prices | 20, 45, 90 ... | 30, 90, 200 ... (×2) | 30, 90, 200 ... |
| New tool | every level from 13 | 14, 18, 22, then every 6 | 14, 18, 22, then every 6 |
| Crew walls | 3, 5, 7, 9, 11, 14, 17, 20 | 3, 6, 11, 15, 22, 26, 29, 33 | 3, 6, 11, 18, 27, 38, 51, 65 |
| Crew damage | 2 ... 56K | 2 ... 56K | 2, 12, 93 ... 12B (each ≈ its wall's HP / 30 s) |
| Crew unlock | best wall ever | best wall ever | this run's wall (`crewPerRun`) |
| Floating cash / chests / frenzy | 2 / 6 / 12 | 8 / 17 / 21 | 8 / 17 / 21 |
| TWO HANDS / AUTO HIT | 4 / 7 | 16 / 24 | 16 / 24 |
| Boosts / wardrobe / nudges | 4 / 4 / 12 | 9 / 14 / 19 | 9 / 14 / 19 |
| Wardrobe: looks by wall 20 / last | 31 / 26 | 19 / 700 | 19 / 700 |
| Rewind keeps | level 1 | half the level | half the level |
| New since | | relics, rarity, shop, hold to punch, CREW RUSH, gem ranks | + locked next-animal card |

Note the crew: 4:48 had an animal every two or three walls. Now they're spaced out on purpose (each a big step, the next one
shown locked), the other way. If the next build's numbers drop around the crew walls, that's the first thing to look at.

## Reverting

**The script** puts the 4:48 numbers back into the current files, section by section, and leaves what came later (shop,
relics, rarity, hold, ranks) alone. A plain copy of the snapshot over `ui/wall.json` would not work: today's code needs those
newer sections.

```
node games/wall/data/4-48/balance/apply.mjs              # the list of sections
node games/wall/data/4-48/balance/apply.mjs all          # everything below
node games/wall/data/4-48/balance/apply.mjs hp punch     # only some
git diff games/wall/ui                                   # what it did
git checkout games/wall/ui                               # undo (also drops other uncommitted ui changes)
```

| Section | Puts back |
|---|---|
| `hp` | `wallHp`, `hpGrowth` 1.7 |
| `punch` | `punch.given` (one a wall, 3 to 16), `punch.costs`, `costGrowth` |
| `crew` | each animal's `wall`, `cost`, `dps`; `auto.crew`; `crewPerRun: false` |
| `extras` | `floating` (cash, chest, frenzy walls), `nudge.wall`, `shows.boosts` / `wardrobe`, `weak.wall`, `auto.slow`, TWO HANDS / AUTO HIT walls |
| `tools` | `tools.levels`, `levelsAfter: 1` (a tool every level after the list) |
| `rewind` | `rewind.keep: 0` (back to level 1), `rewind.popup` 20 |
| `looks` | each look's wall (`wall` / `buy` / `video`), `offers.fromWall` 5 |

One at a time is the better test: put one section back per build and compare its export with this one, to learn which
change mattered. The largest by the numbers: `punch` and `hp` (walls 4-16), then `crew` and `extras`.

**What the script can't put back** (code, not numbers): hold to punch, relics and their medals, rarity grades on tools and
looks, the shop, CREW RUSH, gem ranks, the locked next-animal card. They can be left in with the 4:48 numbers, or turned off
where they have a switch (`hold.on`, the shop through the platform). For the code exactly as it was:
`git diff 2b44640e HEAD -- games/wall/game`.
