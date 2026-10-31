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
  → **Digger** (a grey tractor you ride) → **Tractor** → **Red Tractor** ($100,000, 5 wide: the long goal the hub's
  income helps pay for). Vehicles are ridden outside the hub, faster, with an engine; a vehicle's `tint` repaints the
  tractor model (`utils/Paint.ts`, like the Digger's `greyscale`).
- **Backpack** (`backpack`): 10 → 500 slots in 17 tiers, sized so a trip is mostly digging, not walking.
- **Boosts** (`boosts`, unlock with the Steel Pickaxe): Dig Speed, Sell Price, Ore Luck, Move Speed — 20 levels
  each, cost ×1.3 per level. The BOOSTS tab shows "!" when one is affordable.
- **Zones**: rings around the hub — Topsoil, Stone Layer, The Deep, Lost Ruins, Obsidian Depths — each with its own
  rock (tinted so they read apart), ores and floor colour. The mine ends in a noisy round wall of black bedrock.
  Amethyst is a rare purple gem in the obsidian.

### Mines (prestige)
Once the newest mine has its Tractor ($15,000, painted purple, `prestige.tool`; marked "NEW MINE" on the ATM's tool timeline — the
Red Tractor after it stays the goal), the HUD shows a bouncing **NEW MINE!** button (and the MAP gets a "!").
Opening a mine gives a **fresh run** there (shovel, small bag, no cash or boosts) in a new layout and colour theme
(`mineThemes`), and every mine gets the bonus (`prestige`: +25% cash, +10% dig speed per mine). The **MAP** button
lists every mine with GO to travel back and forth — each keeps its own cash, tools, bags, boosts, tunnels and
collection; looks, hub, achievements and the bonus are shared. Switching plays a screen fade with the mine's name.
Each mine after the first prices its tools, backpacks and boosts `prestige.priceStep` higher (mine #2 x1.15, #3
x1.30…: `DigProgress.priceOf`), since the hub's perks and income come along; the first mine pays the listed prices.

### Finds and the collection
18 buried artifacts per mine (`finds`). Buried ones near the miner give off sparkles in their rarity colour. Digging
one up shows a banner — its reward then **waits in the Trophy Room**: the totem gets a "!", and the collection panel
has a CLAIM button on each card with a reward (and on the footer for a completed collection). Payouts grow with
rarity and depth (`findPayout`); the first find of a mine always pays at least the next upgrade.

### Chests, power surges and rich veins
Two kinds of **chests** (`chests`):
- **Power chest** (cyan beam) — drawn as the tractor it lets you ride, glowing round the rainbow (its model loads
  behind the game, not on the loading screen). The first is the Mega Drill moment, **once per player**, and it's
  never buried: after `spawn.afterBlocks` blocks dug, it pops and fades onto the rock `spawn.ahead` blocks in front
  of where the miner is digging (`mining/PowerChestSpawner.ts`), in rock their tool can dig. It waits however long it
  takes; only if the miner goes more than `spawn.maxDistance` blocks away does it fade out, and the next dig after
  `spawn.respawnDelay` s brings another. Only one at a time, and it counts as taken the moment its block breaks.
  Digging it opens the hub's first room of furniture (reveal rule `powerChest`). From then on there's always one more
  out there, one at a time: `power.roam.delay` s (a minute) after each surge ends, the next sits on a block `roam.distance` blocks
  from the miner (never right by them), with its beam — each a surge one tier above the tool.
  Digging it starts a **power surge** (`mining/PowerSurge.ts`): for `seconds` the miner digs with the Mega Drill (or
  one tier above their tool if higher), a bit faster, and every block is **cashed on the spot** instead of filling
  the backpack. It's the game's "star": the miner rides the tractor as a small rainbow-glowing truck (`TractorRide`;
  its model loads behind the game from the first input), the screen's edge throbs in rainbow colours (`DigHud`
  vignette) and a fast synthesised tune plays (`audio/StarMusic.ts`). A countdown shows at the top; when it ends the HUD names the tool to buy. Never offered once the
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

### Hub rooms and perks
The hub is shared by every mine, so what's built there is kept for good — a small second prestige layer. Each
buildable has an **income** (`income`, $ a second) and a **perk** (`perk` in `levels/hub.json`: `sell` / `dig` /
`move` as a fraction, `beam` in blocks of treasure-beam range). Its price tag has no words: a short vertical list — the
price, then a row for each ("+$0.3/s" by a bill, "+3%" by the stat's icon). The income piles up while playing (x the new mines' sell bonus,
up to `hubIncome.capMinutes`) and waits over the ATM ("$252 / +$0.4/s"); stepping onto the ATM's pad collects it.
Every few seconds each earning piece pops "+$N" over itself while the miner is near, and from the first one the HUD
shows the base's $/s by the money. Each piece earns about its price / 600 a second (the whole hub ~$34/s). Each reveal area's buildables are a **set**: buying them all adds the area's
`bonus` ("SET COMPLETE!", analytics `hub / set-<area>`). The rooms aren't named to the player (a new room just says
"NEW FURNITURE TO BUILD!") and open one at a time with the tools, so new things to buy keep coming: the first room
(it appears with the first power chest — or the Power Drill at the latest — $50–250; until it's there the tutorial's
build step waits and the relic hunt starts on its own), then with the Power Drill ($500–900), the Mega Drill ($1,500–2,500) and the Digger
($4,000–5,000) — each piece about 20–40% of the next tool then. The whole hub's perks are worth about one new mine (+28% cash,
+17% dig, +13% move, +4 beam range); the BOOSTS tab's footer adds up everything kept forever (hub + mines). The
perks apply in `DigProgress` (`sellMultiplier`, `hitInterval`, `moveMultiplier`, `beaconRange`), so a new perk stat
goes there too. A room for later mines: an area with the reveal rule `mines:<n>`.

### The tutorial (first mine only)
Driven by the progress alone, so a reload lands back in the right step:
move → dig → bag full → sell → **forced Pickaxe** → **forced first bag** → wardrobe appears → **forced first hat**
(the Mining Helmet; money topped up if short) → first relic (claim it in the Trophy Room) → first hub piece (the
last sale is topped up to its price). Forced purchases dim the screen, stop the miner and point at BUY. The guide's
green floor arrows follow the real walking route (A* over the dug tunnels) and draw over the rock. Its priorities:
nothing during a power surge (it resumes after); the first power chest while it's showing; a full backpack back to the
ATM; then the tutorial step (or the relic hunt).

### The relic hunt (after the tutorial)
The playtests lost players in minutes 3–5, right after the tutorial, when the next relic was down to luck. So for
`relicHunt.guided` relics after the tutorial's (`world/RelicHunt.ts`): the moment the Trophy Room has nothing waiting,
the next relic (lowest zone first) is named on screen ("NEXT RELIC: …"), and the guide's arrows and a beam that shows
at any range lead to it. Once the miner is out of the hub it's placed: left where it is if it's within
`maxDistance` blocks in rock they can dig, otherwise moved into a diggable block `place` blocks from them. Dug up, the
arrows lead to the Trophy Room to claim it, and the claim names the next one. `relicHunt.enabled: false` is the
baseline build (the guide ends with the tutorial), for A/B playtests.

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
| `relicHunt` | the guided relics after the tutorial: on/off, how many, how far one may be before it's moved closer |
| `chests`, `richOre` | power / cash chests (count per zone, surge tool and length, rewards, beacon range) and rich veins |
| `wardrobe` | colours, faces, hats and prices (the Crown is `unlock: "achievement"`) |
| `achievements` | tiers, rewards, the hub decoration (`decor`, `decorAt`) or hat (`hat`) |
| `tractor` | the ridden vehicle's model, seat, speed, smoke, `bodyRadius` (its footprint against rock) |

The hub layout is `levels/hub.json` (edit it in the editor's Hub tabs). Reveal-area rules (`reveal`) say when each
part of the hub appears: `start`, `upgrades:<n>`, `upgrade:<n>` (tool level), `mines:<n>`, `firstFind`,
`upgradeAfter:<area>`, `built:<area>`… Pieces' perks and rooms' set bonuses are edited in the Hub 3D inspector.

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
