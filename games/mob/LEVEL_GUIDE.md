# Mob level guide

Every element you can put in a Mob level: what it does, its settings, and how pieces combine. Build levels in the
editor's **Levels** tab. Levels are saved to `levels/<id>.json`; their order and look come from **Zones**
(`ui/zones.json`).

The element settings are the level format in `game/data/MobConfig.ts` (`BattleConfig` and its parts). The battle rules
are documented at the top of `game/battle/Battle.ts`. If this guide and the code disagree, the code wins: update this.

## The basics

| Element | What it does | Settings |
|---|---|---|
| **Field** | The play area. It grows from the bottom centre and defaults to 10 × 24. | `width`, `length` |
| **Cannon** | Slides to where the player aims and fires blue mobs while they hold. It runs on energy; empty, it locks until it has fully recharged. | Upgrades only |
| **Enemy base** | One building at the far end. Blues hit it to win. | `baseHp` |
| **Forts** | Several targets instead of the base, and all must fall. Editor tool: **Fort**. | `targets`: `x`, `hp`, `width`, `z` |
| **Red waves** | Reds march down from the targets, each picking its own lane, getting faster over the level. | `redRate` (start), `redRateEnd`, `redRamp` (seconds) |
| **Red giants** | A big red sent at intervals. | `redGiantEvery` (seconds; 0 = never) |
| **Danger line** | A red getting past it loses the level. | — |
| **Giant King** | On boss levels: once the enemy's HP left is down to `kingAt`, one red giant in viking horns comes out, once a match. Double damage, and `TUNING.kingHp` (1.6) times a red giant's hits. The last level of each area has one at 100. | `kingAt` |
| **Reward** | Coins for a win. | `reward` |

## Your units

Units come from **cards**, which charge during a battle, or from **houses** on the field.

| Unit | What it does |
|---|---|
| **Blue mob** | The basic shot. A blue and a red that touch both die. |
| **Giant** | Big and tough. Crushes what it touches, does big damage to targets, ignores gates. |
| **Truck** | Heavier and tougher than a giant. |
| **Rammer** (car) | Can't be destroyed: it wears down the reds it touches while the crowd pushes it back. |
| **Gold UFO** | Not a mob: flies over everything to the main building, sucking up reds on the way, and crashes into it. |

A unit's hits, damage and charge are set in the editor's **Units** tab (`ui/units.json`).

## Pieces that help the player

| Element | Editor tool | What it does | Settings |
|---|---|---|---|
| **Gate** | Gate | A blue crossing it becomes `value` mobs. Each crowd uses a gate only once, and giants don't use gates. | `x`, `z`, `width`, `value`; optional `swing` (`range`, `seconds`) to slide side to side |
| **Locked gate** | Gate | A barred gate both sides must break before it works as a gate. | `lock`: hits to break |
| **Helmet barrier** | Barrier | Blues crossing get a helmet, doubling their hits, once. | `x`, `z`, `width`, `kind: "hp"` |
| **Viking barrier** | Barrier | Blues crossing get a viking hat, doubling their damage, once. Stacks with the helmet. | `x`, `z`, `width`, `kind: "attack"` |
| **House** | House | Takes in plain blues; every `need` of them makes a giant, truck, UFO or car out of its far side. Reds and giants go round it. | `kind`, `x`, `z`, `width`, `depth`, `need` (defaults: giant 16, truck 24, car 30, UFO 40) |
| **Pipe** | Pipe | A tube over the field: a mob walking into one opening comes out the other. Its ends are solid to everything else. | both ends (`x`, `z`, `toX`, `toZ`); `team`: `blue`, `red` or `both` |

## Pieces that block or shape the path

Each is one entry in `obstacles`, drawn with the **Polygon** tool (pick the kind first), or given as a box (`width`,
`depth`) or a circle (`radius`).

| Element | `kind` | What it does |
|---|---|---|
| **Wall** | `wall` | A raised block of any shape. Everyone slides round it. |
| **Water hole** | `water` | Blocks like a wall, drawn as water. |
| **Breakable block** | `breakable` | Mobs walking into it are spent, each taking a hit off it; giants chip at it. Gone at zero. Set `hp`. |
| **Enemy wall** | `enemyWall` | Invisible; blocks reds only, so you can fence the enemy in. |

| Element | Editor tool | What it does | Settings |
|---|---|---|---|
| **PUSH block** | PUSH | Fills a lane. Each side pushes it from its face, and the side with more mobs on it wins. Shoved out at either end, the lane opens. | `x`, `z`, `width`, `depth`, `far` and `near` stops |

## Pieces that move and hurt

| Element | Editor tool | What it does | Settings |
|---|---|---|---|
| **Spinner** | Spinner | Rotating arms that shove mobs aside, without killing them. | `x`, `z`, `length` (arm), `arms`, `speed` |
| **Pusher** | Pusher | A sliding bar that shoves mobs as it moves. | `x`, `z`, `width`, `depth`, `range`, `seconds`, `phase` (0–1, to put two out of step) |
| **Grinder** | Grinder | A spiked roller: plain mobs of either side die at once, giants and trucks wear down, cars roll over. | `x`, `z`, `length`, `thickness`, `axis` (`x` or `z`); optional `move` (`range`, `seconds`) to roll back and forth |

## Between battles

- **Cannon upgrades:** fire rate, energy capacity and recharge speed, bought with coins.
- **Unit cards:** giant, truck, UFO and car, each levelled up for more hits and damage.
- **Looping:** after the last level, the game loops a little harder each time.

## Looks

There are 3 themes: beach, castle and desert. Each zone of levels uses one, and any level can be played in any theme.
Themes are edited in the editor's **Themes** tab.

## Difficulty without long levels

**Levels that take too long are bad. Raising the enemy's HP is not the way to make a level harder:** it only makes the
level longer and turns the enemy into a sponge. Keep `baseHp`, the forts' `hp` and breakables' `hp` modest.

To make a level harder, or give it more to it, add things that kill the player's units or pressure them:

- **Killers:** grinders, and breakables in the way (they spend the blues that hit them).
- **Enemy pressure:** red giants (`redGiantEvery`), more and faster reds (`redRate`, `redRateEnd`).
- **Path shaping:** walls, water, enemy walls, spinners, pushers and PUSH blocks, for longer or narrower routes and
  moments of timing.

To make a level easier, take those away, or give more help: gates, barriers and houses.

## Level length

Aim for 25 to 50 seconds to win (the robots' average); the level list shows each level's time and flags over 55s as
**LONG**. Fewer gates make a level slower as well as harder, so when removing gates, take a little HP off too, and keep
the pressure up with reds, red giants and killers.

## Building tips

- **Order on the path matters.** Gates, barriers and houses all work on blue crowds. A helmet barrier before a ×3 gate
  gives three helmeted blues; after it, only the blues that reach the barrier get one.
- **Reds ignore gates, houses and barriers.** To shape their routes, use enemy walls, spinners, pushers and grinders.
- **Don't put a killer right after a gate.** A grinder just behind a ×3 gate grinds up the crowd it has just made: it
  turns the level into a wall. Give the multiplied crowd room first.
- **Leave room for big units.** Giants, trucks and cars need wider gaps than plain mobs. Watch for narrow gaps between a
  wall and the field's edge, and between a pipe's end and a wall: both make dead ends.
- **Walls at the field's edge are fine**, even reaching slightly past it. Units are always pushed back out on the field side.

## Checking a level

- **Check gaps** (Levels tab) walks giants, trucks, cars and red giants through the level and marks where they stall:
  ✓ passes, ! units stall, ✗ one stuck for good.
- **Grade all** has robot players grade each level's difficulty where it sits in the game. It only grades levels whose
  grade is missing or out of date; Shift+click grades every level. The level list tags a level **EASY** or **HARD**
  when it's off the difficulty curve, and the **Curve** tab suggests what to change.
