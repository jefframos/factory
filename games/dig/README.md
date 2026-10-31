# Dig & Discover

A top-down mining idle/incremental game for web portals (Poki, CrazyGames, YouTube Playables…). The player digs
out from a hub through a block-voxel mine, fills a backpack with rock and ore, sells it at the ATM, and spends the
cash on better tools, bigger bags, boosts, cosmetics and hub pieces — then opens new mines for a lasting bonus.

Built on the factory's shared engine (`core/`): THREE.js for the 3D world, PIXI for the UI on top.

---

## Running it

From the repo root, with `GAME=dig` in `.env`:

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on `:9001`. Add `?dev=1` for the mine MAP button and the debug panels. |
| `npm run build` / `npm run build:cached` | Production build / build into `cachedBuilds/dig`. Local and cached builds use the **mock platform** (see Platforms). |
| `npm run editor` | The level / data editor (see Editor). |
| `npm run image` | Rebuild the UI atlas after adding images to `raw-assets/images/ui{tps}/`. |
| `npm run audio` | Repack sounds after adding files to `raw-assets/audio/`. |
| `npm run models` (= `models:compress`) / `npm run models:uncompress` | Publish the models — compressed by default, every build and editor import (raw assets untouched); `:uncompress` publishes the raw files as they are: textures capped at 256px, the character FBX published as a welded GLB (`raw-assets/models-optimize.json`). Loading: only the mine, the miner and the stations block the loading screen; hub decor, sounds and the tractor load behind the game. |
| `npm run i18n:update` | Translate new or changed strings with Claude (see Localization). |
| `npm run i18n:validate` | Check every language file against English. |

The debug panel (**Dig**, top of the screen in dev) has: free camera, mine map, ADD $100 / $5000, SELL BACKPACK
HERE, RESET SAVE, platform pause, CLEAN ALL DATA.

---

## Folder layout

```
games/dig/
  index.ts              boot: platform, language, audio, fonts, atlas, then the scene (loading screen waits for it)
  game/
    scenes/DigScene.ts  the game: world, player, HUD, stations, selling, forced purchases, mines, ads
    world/              VoxelTerrain (the mine), HubRoom, Guide + GuidePath (tutorial arrows), HardBlockMarkers,
                        TreasureSparkles, TileWalkability
    mining/             MiningController (pushing into rock digs it)
    player/             DigPlayer (the miner), TractorRide (the Digger / Tractor vehicles)
    ui/                 DigHud and every panel (upgrades, wardrobe, collection, achievements, mines, language),
                        TabBar, FindBanner, RewardPopup, ScreenFade
    data/               DigConfig (typed ui/dig.json), DigProgress (the save), HubData, Gameplay
    analytics/          GameAnalytics (every event the game sends)
    audio/              DigAudio (sound cues), EngineSound (synthesised tractor engine)
    i18n/               config.ts (the 15 languages), Localization.ts, locales/*.json
  ui/
    dig.json            ALL gameplay tuning (see Data)
    uikit.json          UI kit: images, texts, colours of every panel
    hatfits.json        how each hat sits on the head
    worldstyles.json    3D world styles
  levels/hub.json       the hub: walls, stations, props, buildables, trophy tables, reveal areas
  raw-assets/           source images / audio / models / fonts (packed into public/dig by the asset tools)
  web/                  the editor (server.mjs + public/)
```

---

## How the game works

### The core loop
1. **Dig** — walk out of the hub and push into rock; the miner swings automatically. Each rock has a durability
   and a minimum tool power (`materials` in `dig.json`). Rock the current tool can't dig shows a **padlock**.
2. **Fill the backpack** — each broken block drops items that fly into the bag. A full bag is called out on screen,
   pulses in the HUD, and after a couple of tries at digging the guide's arrows lead back to the ATM.
3. **Sell** — stand on the ATM pad (or tap the **SELL x2** cash pile for a rewarded video, once it unlocks).
4. **Upgrade** — at the ATM: **GEAR** (the next tool, the next bag) and **BOOSTS** (repeatable levels).

### Progression
- **Tools** (`tools`): Shovel → Pickaxe → Steel Pickaxe (digs 2 deep) → Power Drill → Mega Drill (3 wide, 2 deep)
  → **Digger** (a grey tractor you ride) → **Tractor**. Vehicles are ridden outside the hub, faster, with an engine.
- **Backpack** (`backpack`): 10 → 500 slots in 17 tiers, sized so a trip is mostly digging, not walking.
- **Boosts** (`boosts`, unlock with the Steel Pickaxe): Dig Speed, Sell Price, Ore Luck, Move Speed — 20 levels
  each, cost ×1.3 per level. The BOOSTS tab shows "!" when one is affordable.
- **Zones**: rings around the hub — Topsoil, Stone Layer, The Deep, Lost Ruins, Obsidian Depths — each with its own
  rock (tinted so they read apart), ores and floor colour. The mine ends in a noisy round wall of black bedrock.
  Amethyst is a rare purple gem in the obsidian.

### Mines (prestige)
Once the newest mine has its Tractor, the HUD shows a bouncing **NEW MINE!** button (and the MAP gets a "!").
Opening a mine gives a **fresh run** there (shovel, small bag, no cash or boosts) in a new layout and colour theme
(`mineThemes`), and every mine gets the bonus (`prestige`: +25% cash, +10% dig speed per mine). The **MAP** button
lists every mine with GO to travel back and forth — each keeps its own cash, tools, bags, boosts, tunnels and
collection; looks, hub, achievements and the bonus are shared. Switching plays a screen fade with the mine's name.

### Finds and the collection
18 buried artifacts per mine (`finds`). Buried ones near the miner give off sparkles in their rarity colour. Digging
one up shows a banner — its reward then **waits in the Trophy Room**: the totem gets a "!", and the collection panel
has a CLAIM button on each card with a reward (and on the footer for a completed collection). Payouts grow with
rarity and depth (`findPayout`); the first find of a mine always pays at least the next upgrade.

### Chests, power surges and rich veins
Two kinds of **chests** (`chests`):
- **Power chest** (cyan) — the Mega Drill moment, **once per player**. It's never buried: after `spawn.afterBlocks`
  blocks dug, it pops and fades into the rock `spawn.ahead` blocks in front of where the miner is digging
  (`mining/PowerChestSpawner.ts`), in rock their tool can dig. It waits however long it takes; only
  if the miner goes more than `spawn.maxDistance` blocks away does it fade out, and the next dig after
  `spawn.respawnDelay` s brings another. Only one at a time, and it counts as taken the moment its block breaks.
  Digging it starts a **power surge** (`mining/PowerSurge.ts`): for `seconds` the miner digs with the Mega Drill (or
  one tier above their tool if higher), a bit faster, and every block is **cashed on the spot** instead of filling
  the backpack. A countdown shows at the top; when it ends the HUD names the tool to buy. Never offered once the
  Mega Drill is owned. Forced tutorial purchases wait until a surge is over. (The data showed only ~8% reached the
  Power Drill.)
- **Cash chest** (gold): `perZone` buried per zone, drawn and revealed like finds; pays `reward[zone]` ± `spread`,
  x the sell bonus, at once.

Buried treasure within `beaconRange` blocks shows a pulsing **light beam** (`world/TreasureBeacons.ts`) — gold, cyan,
or the find's rarity colour — and sparkles up close. **Rich veins** (`richOre`): ore in seeded noise patches grows
bigger, more numerous nuggets/gems, twinkles, and drops `dropMultiplier` x the items. Swings that break several blocks
shake the camera, and every 10 blocks in a run pops "N BLOCKS!". The dev MAP shows chests as squares; the Dig debug
panel has **POWER SURGE**.

### Analytics time stamps
Every event (except frequent ones: playtime, sells, bag full, ads, settings, equips) is sent twice: as before, and
under category `time` with the total active play time (all sessions) as a minute bucket —
`time / upgrade-tool-03-drill-m08-12 / complete` = the Power Drill bought 8–12 minutes in. The funnel stays as it was;
the `time` events say when each step happens. See the table in `analytics/GameAnalytics.ts`.

### Achievements
Digger, Ore Hunter, Tycoon, Collector — 7 tiers each, shared across mines; tier 4 adds a trophy to the hub.
**Champion** (claim 15 levels) unlocks the Crown hat. Claiming dims the screen until the coins land.

### The tutorial (first mine only)
Driven by the progress alone, so a reload lands back in the right step:
move → dig → bag full → sell → **forced Pickaxe** → **forced first bag** → wardrobe appears → **forced first hat**
(the Mining Helmet; money topped up if short) → first relic (claim it in the Trophy Room) → first hub piece (the
last sale is topped up to its price). Forced purchases dim the screen, stop the miner and point at BUY. The guide's
floor arrows follow the real walking route (A* over the dug tunnels) and draw over the rock.

### Saving
One localStorage entry (`dig.save`), written shortly after any change. It carries a **version**
(`SAVE_VERSION` in `data/DigProgress.ts`): a save from another version starts a new game. **Bump it when a change
can't carry old saves over** (it's at 3). The language and mute choices are stored separately and survive.

---

## Data — `ui/dig.json`

Every tuning value lives here, not in code. Main sections:

| Section | What it controls |
|---|---|
| `terrain` | map radius, block height, seed, bedrock look (`bedrockTint`), the round edge (`edge`), zone wobble |
| `materials` | each rock / ore: durability, minPower, value, drops, model, `tint`, gem `decorTint` |
| `zones` | the rings: start distance, fill rock, patches, ores, tunnel `floor` colour |
| `tools` | the tool path: power, hit interval, `area` / `depth`, price, `vehicle` / `greyscale` / `rideSpeed` |
| `backpack` | bag tiers: capacity and price |
| `boosts`, `boostsUnlockToolLevel` | the boost tracks |
| `prestige`, `mineThemes` | new-mine bonus and each mine's colours (rock tints, floors, hub floor and walls) |
| `finds`, `findPayout`, `collectionReward`, `firstFindAfterBlocks` | artifacts and what they pay |
| `chests`, `richOre` | power / cash chests (count per zone, surge tool and length, rewards, beacon range) and rich veins |
| `wardrobe` | colours, faces, hats and prices (the Crown is `unlock: "achievement"`) |
| `achievements` | tiers, rewards, the hub decoration (`decor`, `decorAt`) or hat (`hat`) |
| `tractor` | the ridden vehicle's model, seat, speed, smoke, `bodyRadius` (its footprint against rock) |

The hub layout is `levels/hub.json` (edit it in the editor's Hub tabs). Reveal-area rules (`reveal`) say when each
part of the hub appears: `start`, `upgrades:<n>`, `firstFind`, `upgradeAfter:<area>`, `built:<area>`…

---

## The editor — `npm run editor`

A local web tool (`web/server.mjs`) that reads and writes the same files the game loads; reload the game to see
saved changes.

| Tab | Edits | File |
|---|---|---|
| 🏗 **Hub 3D** | The hub in 3D as the game draws it: walls, stations, props, buildables (with prices), trophy tables, achievement trophies, reveal areas. Click to select, W / E / R to move / turn / scale. Import models from the 3D asset library. | `levels/hub.json` |
| ⛏ **Hub 2D (walls)** | The hub's walls and doorways on a top-down grid. | `levels/hub.json` |
| 🚜 **Tractor** | The ridden vehicle: model, height, turn, seat (previewed with the sitting miner), exhaust, smoke ("Puff"). | `ui/dig.json` → `tractor` |
| 🎨 **UI Kit** | Images, texts, fonts and colours of every panel, with a live preview; can add images to the atlas. | `ui/uikit.json` |
| 🎩 **Hats** | Position, scale and turn of each hat on a preview head. | `ui/hatfits.json` |

---

## Localization

15 languages (`game/i18n/config.ts`): English plus Poki's recommended set — French, Italian, German, Spanish,
Turkish, Simplified Chinese, Japanese, Korean, Brazilian Portuguese, Russian — and Dutch, Polish, Indonesian,
Vietnamese. The game picks the platform's language (YouTube), else the player's saved choice, else the browser's
preferred languages, else English. The flag button (top-left) opens the language list.

`en.json` is the source of truth. After adding or changing English strings:

```
npm run i18n:update            # translate what's new / changed (Claude, ANTHROPIC_API_KEY in .env)
npm run i18n:update -- --all   # re-translate everything
npm run i18n:validate          # check every file ({placeholders}, nothing empty or missing)
```

Translations follow `tools/i18n/translation-guide.md` (tone, glossary). Hand fixes in a locale file are kept: a
plain update never overwrites a string that's already translated. Names in `dig.json` (tools, finds, achievements…)
are translated through keys like `tool_<id>` — **add the key to `en.json` when you add one**, or it shows in English.

---

## Platforms, ads and analytics

- **Platforms** come from `VITE_PLATFORM` (`platforms.config.json`). Local runs and cached builds use the **mock
  platform**: every SDK call is logged to the console as `[Mock]`, commercial breaks resolve at once, and rewarded
  videos show a 1-second placeholder before paying out.
- **Ads**: a rewarded video behind **SELL x2**; a commercial break only after a BUY tap (never in the tutorial, at
  most every 3 minutes).
- **Analytics** (`game/analytics/GameAnalytics.ts`, sent to Poki): the numbered tutorial funnel, play-time
  milestones, purchases, boosts, mines, finds, achievements, bag full / blocked rock, ads. The file's header table
  lists every event — add new ones there.
