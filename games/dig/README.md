# Dig & Discover

## Description

Dig through a block mine with a pickaxe, then with ever bigger tractors! Pile rock, ore and gems on your back, upgrade your tractor, blades and bag, dress your tractor up, and push out to the lava fields of the volcano.

## Controls

- **Move:** WASD or arrow keys; on touch screens, the on-screen joystick; on desktop you can also click and drag.
- **Dig:** walk into rock; the miner swings automatically.
- **Upgrade:** stand on a station's square to pour in what you've dug (and your money).
- **Sell:** walk onto the ATM's pad.
- **Menus:** tap or click the buttons and tabs.

---

A top-down mining idle/incremental game for web portals (Poki, CrazyGames, YouTube Playables…). The player digs
out from a hub through a block-voxel mine, fills a backpack with rock and ore, sells it at the ATM, and spends the
cash on better tools, bigger bags, boosts, cosmetics and hub pieces — then opens new mines for a lasting bonus.

Built on the factory's shared engine (`core/`): THREE.js for the 3D world, PIXI for the UI on top.

---

## Running it

From the repo root, with `GAME=dig` in `.env`:

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on `:8000`. Add `?dev=1` for the mine MAP button and the debug panels. |
| `npm run build` / `npm run build:cached` | Production build / build into `cachedBuilds/dig`. Local and cached builds use the **mock platform** (see Platforms). |
| `npm run editor` | The level / data editor (see Editor). |
| `npm run image` | Rebuild the UI atlas after adding images to `raw-assets/images/ui{tps}/`. |
| `npm run audio` | Repack sounds after adding files to `raw-assets/audio/`. |
| `npm run models` (= `models:compress`) / `npm run models:uncompress` | Publish the models — compressed by default, every build and editor import (raw assets untouched): textures capped at 256px, geometry gently quantised and **meshopt**-compressed (`meshopt` in `raw-assets/models-optimize.json`; ~2.5x smaller, decoded in the game by `core/three/GLTFLoaders.ts` and in the editor by `web/public/gltf.js`, so it works on any host), the character FBX published as a welded GLB. `:uncompress` publishes the raw files as they are. Loading: the loading screen only waits for the miner (and fonts / UI atlas); the mine's models load right after, in stages (topsoil blocks, the rest, then gems / pickups / relics), popping in nearest first; hub decor, sounds and the tractor load behind the game too. |
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
                        TabBar, ChestGift, CosmeticOffer, UpgradeList, ScreenFade
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
1. **Dig** — walk out of the hub and push into rock: the pickaxe swings by itself; on a tractor, everything its body and its
   blades touch is chewed at once (`MiningController.carve()`, `digging` in `dig.json`), so no rock it can dig ever holds it.
   Digging power = the tool's 2 plus the blades' level. A block takes `chewSec` at just enough power, x `falloff` a power
   over; one power short, it's chewed slowly (`shortSec`); more than that it's locked (a **padlock**).
2. **Fill the backpack** — what's dug flies onto a pile on the miner's back (`player/Backpack.ts`, Mow's rucksack): little
   blocks of what's in it, the ores on top, as high as the bag is full.
3. **Upgrade** — on the hub's **pads** (`world/UpgradePads.ts`, `levels/hub.json` `pads`), no shop: the next **tractor**, sharper
   **blades**, a **bigger bag** (the last two from the first tractor on). Standing on one pours in the bag, at what it sells
   for, then the money.
4. **Sell** — the ATM turns the bag into money (or the **SELL x2** pile, for a video; its first two are free) for **POWER-UPS**
   (the star bottom-left, from level 3: dig speed, sell price, ore luck, move speed, bag size, digging width), the hub's
   pieces and looks.

### Progression
- **Tools** (`tools`): the Pickaxe, then (from the first upgrade, $12) eight tractors: each wider (`width` 2.2 to 5), a little
  bigger (`rideScale`), faster, with a bigger bag. Ridden outside the hub (`player/TractorRide.ts`). One model
  (Kenney's tractor, its bucket off; its gold hood and roof and its blue-grey frame are split off its palette to take a colour each: `TractorDress.wrapBody`).
- **Blades** (`upgrades.blades`, `bladeLevels`): +1 power a level, seen at the tractor's front, a row of saws.
- **Bag** (`upgrades.capacity`): +20% of the tractor's own bag a level.
- **The tractor's looks** (`ui/tractor.json`): plain colours (yellow and dark grey to begin with), Mow's paints and parts, in its panel (the tractor sticker, bottom-left) or (the miner's looks too)
  offered for a video while driving.
- **Levels** (`levels`): XP from blocks, upgrades, zones, finds, chests and hub pieces; shared by every mine. A level pays cash;
  levels open POWER-UPS (3) and the portal (5).
- **Zones**: seven rings round the hub: Topsoil, Stone Layer, The Deep, Lost Ruins, Obsidian Depths, **Magma Fields**, **Volcano
  Heart**. The far ones stand higher (`height`, ramped over `terrain.zoneRamp`: the shaders lift everything bent,
  `BendService.setGround`; the game itself stays flat) and have pools of **lava** (`lava`, `world/LavaPools.ts`): slow to drive
  through. The mine is 144 blocks to its edge; only the chunks in view are drawn.

### Dungeons and the portal
At level 5 the **portal** appears at the back of the hub (`world/Portal.ts`, `levels/hub.json` `portal`; seen through while the miner's
behind it, as walls and the ATM are): paid for on its pad, it leads to the
next dungeon, **the gear and the money going along** (the bag is sold on the way). Every dungeon is the same mine in a new layout and
theme, and **exponential** (`dungeons` in `dig.json`): dungeon n's rock takes 6 n more power, its worth (and the finds', the chests'
and the levels' cash) is x 60^n, its XP x 2^n. Tractors past the last one come as MK 2, 3... (`toolMarks`), the blades never end.
The MAP button goes back and forth between the dungeons reached; each keeps its tunnels and finds (`MineSnapshot`).

### Animals
The **ANIMALS** pad (from the second tractor) calls the next one (`animals`): three of each of eight kinds, then on and on. They run
along round the miner and headbutt blocks (`player/Crew.ts`, the Wall game's models): real digging, at the power and speed the
tractor has (`MiningController.bite`). The newest ten are drawn and do the others' work too. Not in the hub, nor with the bag full.

### Rebirth
From the second dungeon on, the **MEDALS** sticker (`rebirth`): starting over in dungeon 1 with nothing pays medals by how deep the
run got, spent there on eleven perks kept for good (cash, digging, animals, what a run starts with...). The level and the looks
are kept. POWER-UPS and perks are both `ui/UpgradeList.ts`.

### Finds and the collection
18 buried artifacts per mine (`finds`). Buried ones near the miner give off sparkles in their rarity colour. Digging
one up pays at once, no popup: its name and cash float over the miner and the coins fly into the money. Nothing's ever claimed and nothing stops play:
what's picked up is money, paid at once. A cash **chest** also brings a cosmetic not owned yet, for the miner or their tractor, on the
HUD's card (`ui/CosmeticOffer`), free or for a video in turn (the first free): tapped, it's worn; left, it goes (at most one every 20 s:
`GIFT_GAP_MS` in DigScene, picked by `DigProgress.cosmeticToGive`). What an old save had waiting is paid as it loads.
Payouts grow with
rarity and depth (`findPayout`); the first find of a mine always pays at least the next upgrade.

### Chests, power surges and rich veins
`chests` configures buried cash chests and the optional tractor offer:
- **Rewarded tractor** — one fixed, seeded spot in The Deep per mine
  (`mining/PowerChestSpawner.ts`). It unlocks when the player reaches The Deep,
  with **no five-minute timer**. Within 16 blocks the spot shows the full-colour
  tractor (turning, bobbing, 1.8x chest size), a green ring, a tall green light
  beam (the video button's green, so it never reads as crystal cyan or treasure gold) and a floating green video button on a shine (`DigHud.setTractorBadge`,
  projected each frame). Dig a path to its cell and step within 1.4 blocks to open an offer:
  **WATCH VIDEO** (the standard video button: video icon, shine, pulse, glint) or **NOT YET**,
  under a green ribbon with the tractor on a double shine and a 30s badge. It never relocates to follow the miner.
  A completed rewarded video starts a **30-second power surge** and consumes
  that mine's offer, saved across reloads/travel. Skip, incomplete video, or
  failure grants nothing and leaves the spot available after stepping more than
  2.4 blocks away and returning. No-ads variants hide it. There are no automatic
  early or recurring power chests; stronger normal tools carry the opening.
  `mining/PowerSurge.ts` lends the Mega Drill (or
  one tier above their tool if higher), a bit faster, and every block is **cashed on the spot** instead of filling
  the backpack. It's the game's "star": the miner rides the tractor as a small rainbow-glowing truck (`TractorRide`;
  its model loads behind the game from the first input), the screen's edge throbs in rainbow colours (`DigHud`
  vignette) and a fast synthesised tune plays (`audio/StarMusic.ts`). A countdown
  shows at the top; expiry restores the owned tool and bag limits. The offer
  explains that return before the player watches. Gameplay and movement pause
  for the offer/ad; movement resumes after dismissal. A menu does not consume
  surge time. The debug POWER SURGE bypasses the ad and does not consume the spot; the debug
  **SPAWN TRACTOR AD SPOT** moves the spot 3 blocks ahead of the miner and makes it available again, to test the offer popup.
- **Cash chest** (gold): `perZone` buried per zone, drawn and revealed like finds; pays `reward[zone]` ± `spread`,
  x the sell bonus, at once.

Buried treasure within `beaconRange` blocks shows a pulsing **light beam** (`world/TreasureBeacons.ts`) — gold, green,
or the find's rarity colour — and sparkles up close. **Rich veins** (`richOre`): ore in seeded noise patches grows
bigger, more numerous nuggets/gems, twinkles, and drops `dropMultiplier` x the items. Swings that break several blocks
shake the camera, and every 10 blocks in a run pops "N BLOCKS!". The dev MAP shows chests as squares; the Dig debug
panel has **POWER SURGE**.

### Analytics time stamps
Build changes and the observed opening minutes of each playtest are recorded in
[the build timeline](data/BUILD_TIMELINE.md). Record every new test there with its
source/deployment identity, unchanged systems and export window before comparing
retention. The current local feedback revision adds a reusable 0.22-second ground
pulse when a swing breaks multiple blocks; it preserves the stronger first upgrade
and all progression tuning, and has not been measured by the latest export.

Every event (except frequent ones: playtime, sells, bag full, ads, settings, equips) is sent twice: as before, and
under category `time` with the total active play time (all sessions) as the minute its bucket starts at —
`time / upgrade-tool-03-drill-m08 / complete` = the Power Drill bought 8–12 minutes in. The funnel stays as it was;
the `time` events say when each step happens. See the table in `analytics/GameAnalytics.ts`. Panel tab taps
(`tab`, once per player per tab) and the wardrobe gifts (`gift`: badge seen, claimed with/without the badge) say
whether players find the wardrobe's other pages; `BUILD_TIMELINE.md` lists which events answer each question for
the current build.

PokiSDK.measure() **drops** an event with more than 2 runs of digits across its three values (and any character
outside `A-Z a-z 0-9 space - _ : . + |`). The old `m08-12` buckets used up both, so most `time` events with a number
in them never arrived. Now the bucket is one number, a time stamp drops its what's trailing numbers if needed
(`upgrade-bag-02-12` → `time / upgrade-bag-02-m05`), wardrobe colours are sent by their place in `wardrobe.colors`
(`color-01`, not the hex code), and `GameAnalytics` skips (and warns about) anything still over the limit.

### Achievements
Digger, Ore Hunter, Tycoon, Collector — 7 tiers each, shared across mines; tier 4 adds a trophy to the hub.
**Champion** (reach 15 levels) unlocks the Crown hat. They pay by themselves as they're reached (`DigHud.payAchievements`, from the end
of the tutorial on): the cash flies off the memo pad and a line says which. The panel's only to look at.

### The hub
Only stations: the pads, the ATM, the portal. The furniture to buy, the trophy room and the wardrobe's closet are out (they
confused players; the old layout is `levels/hub.backup.json`, and the code for buildables and areas is still there for a level that
has them). The wardrobe is a sticker on the HUD, like the tractor's. The language button is hidden (`DigHud.buildSettings`).

### The tutorial (first dungeon)
Driven by the progress alone, so a reload lands back in the right step: move -> dig -> bag full -> the first tractor on its pad ->
the bigger bag -> the blades -> the first animal (then it's over: `DigProgress.tutorialOver`). No menus, nothing forced. The guide's gold
floor arrows follow the real walking route (A* over the dug tunnels): to whatever pad can be paid, to the ATM with a full bag, and
later to the portal once it can be paid. Nothing during a power surge.

**Free looks:** one colour (red `#ff5252`) and one face (Cool) are `free: true` in `wardrobe` — claimed for nothing,
their card says FREE. Claimed on the hat visit, nothing more happens. Still unclaimed after the first hat, the wardrobe
gets its "!" and, from the next visit on (`freeLooksOffered` in the save), the COLORS / FACES tabs and the cards wear a
green bobbing FREE tag (`tagBadge` in TabBar.ts) until they're claimed.
Tutorial funnel steps (`GameAnalytics.TUTORIAL`): move, dig, bag-full, sell, tool-upgrade, bag-upgrade, wardrobe,
hat, find, claim, build — `collection` (opening the Trophy Room) was dropped, so `build` is now step 11.

The Oct 31 afternoon build made the tutorial wait for the first power chest, sent the arrows to that chest and ran
the relic hunt inside the tutorial. Tutorial completion fell from 49% to 35% and players reaching 2 minutes from 55%
to 46%, so those parts were rolled back to the morning build's tutorial. Keep the tutorial short: the treasure beams
do the guiding.

### The relic hunt (after the tutorial)
The playtests lost players in minutes 3–5, right after the tutorial, when the next relic was down to luck. So for
`relicHunt.guided` relics after the tutorial's (`world/RelicHunt.ts`): the moment the Trophy Room has nothing waiting,
the next relic (lowest zone first) is named on screen ("NEXT RELIC: …"), and the guide's arrows and a beam that shows
at any range lead to it. Once the miner is out of the hub it's placed: left where it is if it's within
`maxDistance` blocks in rock they can dig, otherwise moved into a diggable block `place` blocks from them. Dug up, the
reward is claimed on its banner, and the claim names the next one. `relicHunt.enabled: false` is the
baseline build (the guide ends with the tutorial) and is the current setting: in the Oct 31 afternoon build the hunt
went with a big tutorial drop-off, so the treasure beams alone lead to relics for now. It never runs before the first
hub piece is built.

### Saving
One entry in the platform's storage (`dig.save`, core/platforms/SaveStorage), written shortly after any change. It carries a **version**
(`SAVE_VERSION` in `data/DigProgress.ts`): a save from another version starts a new game. **Bump it when a change
can't carry old saves over** (it's at 5: dungeons, animals and rebirth). The language and mute choices are stored separately and survive.

---

## Data — `ui/dig.json`

Every tuning value lives here, not in code. Main sections:

| Section | What it controls |
|---|---|
| `terrain` | map radius, block height, seed, bedrock look (`bedrockTint`), the round edge (`edge`), zone wobble |
| `materials` | each rock / ore: durability, minPower, value, drops, model, `tint`, gem `decorTint` |
| `zones` | the rings: start distance, fill rock, patches, ores, tunnel `floor` colour, far-view `fog` colour |
| `tools` | the pickaxe and the tractors: width, size, speed, bag, price, colour |
| `digging`, `upgrades`, `bladeLevels` | how fast blades chew, the pads' blades and bag, how the blades look |
| `levels` | XP, what a level pays |
| `lava` | how slow it is |
| `dungeons`, `toolMarks`, `animals`, `rebirth` | see above |
| `boosts` | POWER-UPS |
| `prestige`, `mineThemes` | each dungeon's layout seed and colours (rock tints, floors, hub floor and walls) |
| `finds`, `findPayout`, `collectionReward`, `firstFindAfterBlocks` | artifacts and what they pay |
| `relicHunt` | the guided relics after the tutorial: on/off, how many, how far one may be before it's moved closer |
| `chests`, `richOre` | power / cash chests (count per zone, surge tool and length, rewards, beacon range) and rich veins |
| `wardrobe` | colours, faces, hats and prices (the Crown is `unlock: "achievement"`; `free: true` = a gift look) |
| `achievements` | tiers, rewards, the hub decoration (`decor`, `decorAt`) or hat (`hat`) |
| `tractor` | the tractor's model, seat, smoke, `body` (all of it digs), `collide`, where blades and parts go |

The hub layout is `levels/hub.json` (edit it in the editor's Hub tabs; its `pads` and `portal` are kept, but edited by hand). Reveal-area rules (`reveal`) say when each
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
