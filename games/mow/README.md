# Mow Town

A casual mowing / city-restoration game for web portals (Poki, CrazyGames, YouTube Playables): walk, and the grass
in front of you is cut. Fill your container, empty it for cash, buy better mowers and upgrades, restore each district
of an overgrown town and unlock the next. Design: the Mow Town GDD (MVP scope: the Starting Park and the
Residential Street).

Built on the factory's engine (`core/`) and the engine-level parts of `games/dig` (character, movement, physics,
UI kit, audio, localization, platforms). The town is built from the 3D library (KayKit City Builder Bits, KayKit
Forest trees, bushes and grass, dig's ATM; a restored section's flowers are low-poly daisy and tulip clumps built
in code, `Town.bloom()`, springing up in a wave; sparse and low — `FLOWER_DENSITY` in `MowScene.ts`, `FLOWER_SIZE` in
`Town.ts`); the walked mowers are placeholders built in code
(`player/MowerModel.ts`: the two reel mowers a spinning bladed barrel between two wheels, the three push mowers a long
deck on four wheels with the engine — a capped cylinder — in its middle), each pushed by a U handle with a crossbar
the hands hold; the ridden ones are dig's tractor. The shop's mower icons are rendered from these same models.
Holding the mower (`MowPlayer.holdPose()`): the legs walk with the clip, but each arm (shoulder, upper arm, forearm)
is frozen in the idle pose and solved as a two-bone IK chain pinned at its grip on the bar, the elbow bending toward
`ELBOW_POLE` (back, out, a little down); the fingers stay closed round the bar (the idle clip's first frame). The
mower rolls on top of pavements and road tiles (`Town.surfaceAt()`), its handle and the hands lifting with it.

---

## Running it

Set `GAME=mow` in `.env`, then from the repo root:

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on `:9001` (`?dev=1` for the debug panels). |
| `npm run editor` | The town editor (see below), on `:4710`. |
| `npm run build` | Production build. Local runs and unnamed builds use the mock platform. |
| `npm run image` / `font` / `audio` / `models` | Rebuild asset bundles from `raw-assets/` (the `manifests/` folder must exist). |
| `npm run i18n:update` | Translate new English strings with Claude (only `en.json` exists so far). |

The debug panel (**Mow**) has ADD $100 / $1000, RESTORE CURRENT DISTRICT and RESET SAVE.

**Modes** (`game/data/GameMode.ts`): the same town and loop as two games to test — `?mode=calm` (the ASMR one: just
mowing) or `?mode=rush` (arcade layers on top); without the parameter, `mode` in `ui/mow.json` (calm). Both share the
save.

---

## How it plays

1. **Mow** — move (WASD / arrows / joystick); everything in a circle the tool's width across, just in front of you,
   is cut when your tool's power is enough. Grass up to 3 powers too tough **resists** (like dig's rock): the mower is
   held back and chews through, chips flying with each hit — 0.7 / 1.6 / 3 s of contact per cell when 1 / 2 / 3 short
   (`chewSec` in `ui/mow.json`; its length is how far short still cuts), so a player who spent on the bag instead of a
   mower is slowed, never stuck. Only tougher still (Thicket for the two reel mowers) is a wall until a better mower: like dig's
   padlocks, a badge floats over that grass's edge near you showing the mower it takes, with a lock
   (`world/GrassLocks.ts`); pushing into it makes the badge hop and says "NEEDS <mower>".
   Grass you can cut still weighs on the mower: the more tough cells (resistance ≥ 1) under the blade, the slower it
   goes (`LOAD_DRAG` in `MowingSystem.ts`, down to 70% with a full blade). The outer rings mix in **brambles** and
   **thicket** (resistance 4 / 5), so even the big tractors have work at the edges.
2. **Collect** — each cut cell's clippings go into the container. When it fills (said once), mowing stops: the floor
   arrows lead to the nearest **ATM**; standing on its pad tosses the clippings in and pays out.
3. **Upgrade** — every ATM also opens the shop, laid out like dig's. **GEAR**: every mower on a timeline up to the
   goal — two reel mowers, three push mowers, three tractors: **Reel Mower** (bag 120) → Wide Reel ($15, bag 280) → Push Mower ($120) →
   Powered ($450) → Pro ($1800) → Lawn Tractor ($5000, the first ride) → Turbo → **Mega** — the next mower's offer, and
   the bag's capacity with its levels. **BOOSTS** (after the first mower; "!" when one is affordable): Speed, Money
   Gain, Cutting Width, Sharp Blades (chew through tough grass faster), each with the bag's segmented level bar under
   its name. The tabs are dig's (`ui/TabBar.ts`: gold when inactive, the active one joined to the block). Each kind of mower sounds different
   (`audio/EngineSound.ts`, synthesised, kept low under the music): the reel mowers click as the blades pass (faster
   as you walk, silent standing still), the push / powered / pro mowers hum like an electric motor, the ridden ones
   chug like a petrol engine (all under one `MOWER_VOLUME`, 0.6; a mower left standing fades slowly to silence). Footsteps follow what's underfoot: stone on pavements and roads, wood on the island's
   deck, a soft pad on grass (`MowScene.updateFootsteps()`). **Ambient sound is placed in the world**
   (`audio/SpatialAudio.ts`, Web Audio panners through Howler's master, heard from the player facing up the screen):
   the sea comes from the editor's sound zones round the island (silent inland, rising on the deck), and each car
   nearby runs its own engine, panned to where it is (`soundSettings.cars` in the level).
4. **Dress up** — the first **wardrobe** appears with the second sale and the arrows lead to it; its first (cheapest)
   hat is a must (the wardrobe locks onto it, money topped up if short). Every wardrobe (Dig's closet, a pink pad with a
   heart) opens Dig's wardrobe: COLORS / FACES / HATS,
   the same catalogue, prices and assets (`wardrobe` in `ui/mow.json`; hats placed by `ui/hatfits.json`). Buying
   puts it on at once; it's saved, and the wardrobe shows a bouncing "!" while something new there is affordable.
   **Gifts** (dig's): one colour (red) and one face (Cool) are `free` in the catalogue. Claimed on the first visit, nothing
   more; still unclaimed when the player comes back after the first hat (`freeLooksOffered` in the save), their tabs
   and cards get a green FREE badge (and the wardrobe its "!") until taken.
5. **Restore** — each section shows its restored % at the top, with a pop and a chime at 25 / 50 / 75%. At its goal
   (97%) the last stragglers are cleared, flowers spring up, a banner celebrates it (rays, its name, RESTORED!, the
   bonus counting up, confetti), and the next section opens: its fence sinks, its ATMs pop in, and the camera can
   glide over to show it.

**The town miniature** (`ui/TownMiniature.ts`) is the "fill the whole town" meter, top-right under the trophy: a
picture of the whole island baked from the 3D world, under a dusky violet veil that drains from the bottom up to the
town's % (a rippling edge with a glow), and a badge with the %.
- **Town %:** the mean of the sections' shares (a restored section counts as 100%), so every section weighs the same.
- **Completing a section** (`MowHud.celebrate()` → `TownMiniature.celebrate()`, about 2.6 s, `MAP_FLIGHT_SEC`): the
  miniature flies to the middle, big, with rays; the veil drains to the new % (sparks off its edge, the % counting
  up); a flash, a spark burst and confetti; it flies home. Then the RESTORED! banner (rays, ribbon, bonus), and only
  once that's gone (`BANNER_SEC`) the scene's "NEW AREA" message.
- **Baking the pictures:** the editor's **📸 Map shots** tab (`web/public/mapshots.js`), one zone at a time: `town`
  (the island) or a section (not shown in the game yet). Each zone is shot as the **Original** (the saved town as it
  is: a section cut out of it — only the props that fit inside it, the ground clipped to it — onto a slab of earth) or
  as its **Custom** diorama: a little level shaped like `town.json`, started from the town (↺ Copy from the town: a
  section on its own island, the deck round it) and edited right there with the Town tab's editor (a second copy of
  `town3d.js`). Each zone has a camera (yaw round, pitch above; 0° / 40° unless set; **Isometric** on, an
  orthographic camera, or off, a perspective one with its FOV; 🎯 Use this view takes the diorama view's) and a
  **HUD outline** toggle (a black stroke round the small picture's silhouette, like the rest of the HUD). Settings and dioramas: `levels/mapshots.json`. **📸 Take snapshot** opens the game with
  `?mapshots=<editor url>&zone=<zone>` (`debug/TownSnapshotScene.ts`): it builds the level (a custom diorama swapped in
  for the town) fully restored (every section open, mowed, in bloom, every station out; no player, traffic, sea, labels
  or bend), in the game's light, and renders it with an orthographic camera on a transparent background, cropped to
  what was drawn, 2048 across. Two pictures come of it, each shrunk in halving steps (a big shrink on the fly turned
  jagged): `<zone>` (512 across: the reveal, the corner miniature blown up) and `<zone>-small` (192: the HUD corner,
  about its size on screen). Each goes to the editor server (`POST /api/map-snapshot`), saved as
  `raw-assets/non-preload/map/<name>.png` and published as `public/mow/images/non-preload/map/<name>.webp` straight
  away. Re-shoot after changing the town. Not baked: the drawn map below stands in, in the corner.

**The map** (`ui/TownMap.ts`, the MAP button bottom-left, or a tap on the miniature): the island drawn from the level
(sea, `outline`, `pavements`, `sections`, so it follows the editor with nothing to author), big over a dim.
- Locked sections: grey with a lock. Open: the overgrown colour, with bright green rising from the bottom to the
  section's restored share. The one being worked on: a pulsing gold outline. Restored: full green with a check. A white
  dot is the player.
- **Wiring:** `MowScene.updateDistrictBar()` sends every section's share to the HUD each frame
  (`hud.setTownMap(shares, open, restored, current)`), and the player's position (`hud.setMapPlayer(x, z)`).

Cut lawn is striped like a real one: each cell is lighter or darker by the way the mower was heading when it cut it
(`PATH_SHADES` in `GrassField.ts`), so mowing up and down leaves stripes the mower's width. Cells cut without a
heading (a section's last stragglers, and everything after a reload: headings aren't saved) get fixed bands.

**Rush mode only — the combo** (`mowing/Combo.ts`, `combo` in `ui/mow.json`): any cut starts it, and mowing on without
a break (`window`, 1.4 s) keeps it alive; every `stepSec` (2.5 s) its multiplier climbs by `step` (0.5) up to `max`
(x5). While it runs, each cut's money x (multiplier - 1) piles up in a pot (shown under the bar with a draining
timer); when it ends — a break, or the bag filling — the pot is paid straight into your money.

### The town

The town is an **island** (like hole.io's cities): the ground stands out of the pizza game's cartoon sea
(`game/builders/WaterMaterial.ts`), any shape — `island.outline` in `levels/town.json`, a polygon (without one, the
ground's rect; `game/world/Shore.ts`). A **wooden deck** runs round the shore (`island.deck`: width, plank colour,
pilings into the sea and their spacing), with a white fence on it (`island.fence`, `inset` from the shore; a kerb under
it only with a `kerbColor`). Sea colour / level / reach and the sides (stone blocks tinted `sideColor`) are in `island`
too. Pavements get a faint procedural texture (paving slabs; tarmac grain on the `road-*` ones), tinted by their colour;
the open ground gets faint cobbles (tinted by `ground.color`).
The next city can be another island.

A city grid of roads, the **Starting Park** in the middle as the hub (`levels/town.json`; sections in unlock order):

| # | Section | Where | Grass |
|---|---|---|---|
| 1 | **Front Yard** | next to the start plaza, south | short grass only, `grassScale` 0.6, the camera closer (`zoom` 0.72), $65 bonus: cleared in a couple of bags, enough for the Wide Reel and most of the Push Mower |
| 2 | **Starting Park** | the centre (the hub), fenced from the plaza | the noise's easy rings, $160 bonus |
| 3 | **Residential Street** | north, across the main road | tougher rings |
| 4 | **East Gardens** | east block, off the east avenue | `grassScale` 1.1 |
| 5 | **West Lawns** | west block, off the west avenue | `grassScale` 1.2 |
| 6 | **Sports Field** | north-east corner, off the main road | the toughest ring, `grassScale` 1.35 |

The roads are one connected network of KayKit tiles (straight, crossing, curved corners, T-splits — each turned to
meet its neighbours, so no road just ends): an outer ring round the town and two avenues beside the park. The whole
island inside its fence is free to roam from the start (roads, verges, the plaza) — only the locked sections aren't:
each has a white fence all round it (its lock sign on the side facing the section before it), which sinks away when it
opens. Road tiles sit at `elevation` 0.06, above the road slabs under them (the slabs come first in `pavements`).

**Traffic** (`world/Traffic.ts`) — a few cars (the city kit's sedan, taxi, hatchback, station wagon) drive the roads
to make the town feel alive. How they drive is `traffic` in `ui/mow.json`; where is the level's `traffic`
(`levels/town.json`, edited in the editor): **waypoints** on the roads' middles, **links** between them (two-way roads)
and the **cars**, each starting at a waypoint. A car drives waypoint to waypoint in the right-hand lane (`lane` off the
middle), curving through each one (half way along the road in to half way along the road out, bent where the lanes
meet), picking a link at random (the straightest likelier, back only at a dead end). It only roams what its waypoint
links to, so a network of its own keeps a car to an area.
A car brakes for the player (or the car ahead) within `gap` of its front and drives on once the way is clear; two
blocking each other at a junction: the older goes first. Cars are solid to walk into (not to the guide's route); one
the player is already in isn't, so they can always step out.

**Finds** — a treasure mowed out of the grass (every section, the yard's Toy Chest the first) or a secret patch's chest
pops out, then its **claim card** (`ui/FindCard.ts`, dig's FindBanner): rays in its rarity's colour, its model, "TREASURE
FOUND!" / "SECRET FOUND!", its name, what it's worth and a CLAIM button that pays on the spot, the coins flying into the
money (it claims itself after 6 s). Cards queue and never stop play. A treasure's card also marks it claimed in the
Trophies panel; an area's bonus (all its treasures found) is still claimed there.

**Grass size** — a section's `grassScale` (default 1; "Grass size ×" in the editor) multiplies its tufts' height and
the contact needed to chew through grass too tough: under 1 an easier section, over 1 a harder one.
Clippings per cell stay the same.

**Max growth** — a section's `maxGrass` (a grass id; "Max growth" in the editor, which names the first mower that cuts
each type) caps its grass: anything tougher (from the noise or a patch) grows as that type instead, so the section can
be finished with that mower (e.g. Brambles: even the reel mowers get through it, slowly; only Thicket needs the Push
Mower).

**Camera zoom** — a section's `zoom` (default 1; "Camera zoom ×" in the editor) sets the camera distance while it's
the first section not restored yet; it eases over when that changes.

**Ridden mowers** — Lawn Tractor, Turbo and Mega put the player in the seat of dig's tractor
(`tractor` in `ui/mow.json`), painted per tier: green, blue, red (`tint` on the tool, or
`greyscale` for dig's grey; `game/utils/Paint.ts`, which paints only the bodywork's mid-tone greys — tyres, glass and trim keep their
colours), bigger by `rideScale`. The shop shows that tractor as their icon.

**Walked mowers** — all pushed the same way, by a U handle (two rails from the deck's back corners — the reel
mower's axle — up to a crossbar) built in the tool's own frame; the hands hold the crossbar. The first tool (id
`scissors`, kept for old saves) is a manual reel mower (`reel` on the tool) whose barrel spins with the ground
covered. Each walked tool's `grip` (`forward`, `height`, `spread` of the hands; `hand` — the hands' turn on the bar in
degrees, the right hand mirroring the left's unless `mirror` is false) and `gap` (between the feet and the mower) are
fitted in the editor's **Mowers** tab.

Cut grass never grows back on its own. Only when the player is stuck — nothing left in the open section their mower
can cut (or chew), and the next mower out of reach even with the bag sold — does just enough grass they can cut grow
back to earn the difference ("Fresh grass is growing back!").

The guide is just the floor arrows (purple, dig's rounded arrowheads with a dark outline): full bag → the nearest ATM; the first mower / first upgrade affordable → the
nearest ATM (with the hand on BUY); a newly opened section → its grass; wandered off (more than 7 units outside the
section being worked on, the first open one not restored) → back into it, the nearest way in, until you're inside. Routes
follow walkable ground — round the locked sections, never through them.

---

## Code

```
games/mow/
  index.ts              boot (platform, language, audio, fonts, atlas, then the scene)
  game/
    scenes/MowScene.ts  the game: town, grass, player, stations, restoration, guide, mower sound, footsteps
    audio/              MowAudio (sound cues), EngineSound (the synthesised reel / electric / petrol mower voices and the cars), SpatialAudio (sound zones and cars placed in 3D)
    world/GrassField.ts the vegetation: a cell grid over the sections, instanced tufts per 16x16 chunk, the mowed-lawn
                        ground shader (pixel-noise grass + a cut map), cut states, resistance
    world/Town.ts       builds levels/town.json: ground, island (deck, sides, sea, fence), pavements, props, ATMs,
                        fences, flowers; walkability, "no grass here", surfaceAt (ground height / kind)
    world/Shore.ts      the island's outline and its polygon maths (insets, inside, edge distance)
    world/ArrowGuide.ts the floor arrows
    world/GrassLocks.ts padlocks (with the mower it takes) over grass the mower can't cut
    world/Traffic.ts    a few cars driving the road tiles, stopping for the player
    mowing/MowingSystem.ts  automatic cutting while moving
    mowing/Combo.ts     rush mode's combo meter
    player/MowPlayer.ts the character pushing the mower (arm IK, finger grip, the mower lifted onto pavements)
    ui/MowHud.ts        money / bag / district bar and milestones / restored banner / combo / shop / language
    data/               MowConfig (typed ui/mow.json), MowProgress (the save, versioned), GameMode (calm / rush)
    analytics/          GameAnalytics (every event; first-session funnel)
  levels/town.json      the town's layout (written by the editor)
  ui/mow.json           gameplay tuning (grass types, tools, upgrades, prices)
  ui/uikit.json         the UI kit (shared look with dig)
  web/                  the editor (server.mjs + public/town3d.js, mowers.js, …)
```

## The editor — `npm run editor`

A local web tool (`web/server.mjs`, port 4710) that reads and writes `levels/town.json`, the file the game loads;
reload the game to see saved changes. The **Town** tab, in 3D as the game draws it: click to select, W / E / R to
move / turn / scale, D duplicate, Del remove, Ctrl+Z undo, Ctrl+S save. **Shift+click** (or Ctrl+click), in the view or
the lists, adds to the selection (or takes back out; outlined in yellow), **Ctrl+A** selects everything of the
selected kind: moving the gizmo moves them all together, Del removes them all, Esc lets go. The **Mowers** tab fits each walked mower's
handle grip, the hands' turn on the bar and offset from it (`grip.offset`: x outward for each hand, y up, z forward — the bar stays put), gap and size on the walking character, hands marked; it saves to `ui/mow.json`
(`PUT /api/mow/tools`).

| Thing | What it is |
|---|---|
| **Sections** | The districts to restore, in unlock order (▲ / ▼). Their rect is where grass grows (`Grass`: noise, a type, or none); "Grass size ×" (`grassScale`: easier under 1, harder over 1); "Max growth" (`maxGrass`: the toughest grass it grows); "Camera zoom ×" (`zoom`); bonus, restore goal, ground colours; "camera glides over when it opens". |
| **Separator** | Where a locked section's lock sign stands; the section is fenced all round until the section before is restored. |
| **Grass patches** | Painted over the sections: noise, a grass type (a dense tall-grass patch takes longer at the start), or bare. Round or rectangle, turned, sized. The last one over a spot wins. |
| **Grass noise** | Which grass "auto" cells get: rings around the centre (pink marker), each with its shares per grass type — the further out, the tougher, so a new section further away is harder by itself. |
| **Props** | Game models, or 📚 imported from the 3D library. Fitted to a height; "blocks the player" makes a collider from the model's footprint (a tree's trunk, a building's base) on save — **no grass grows under a collider**. "Fades" = dithers out when it hides the player. |
| **ATMs** | Sell and shop. As many as you like; one can wait for a section to open. |
| **Wardrobes** | Open the wardrobe (Dig's closet behind the pad). Placed like ATMs, one can wait for a section too; their look is `wardrobe` in the level. |
| **Pavements** | Paved rects, no grass (plaza, road, park paths). |
| **Sound zones** | 🔊 Violet boxes (`sounds`): a looping sound (any file in `raw-assets/audio`; a new one needs `npm run audio`) at full `volume` (0-1) inside, fading to nothing at the dashed line `fade` units out, heard from the box's nearest side. Zones with the same sound share one loop (the loudest wins). Four seed the sea round the island. The **Sounds** panel also sets the cars' volume, "full within" and "silent from" distances (`soundSettings.cars`). |
| **Traffic** | 🚦 Orange waypoints and cyan roads (`traffic`). Selecting a waypoint lights its links yellow and the rest of its network pale (where a car there can drive); **Alt+click** another (or 🔗 Link) links / unlinks the two; a new waypoint (🚦 Traffic waypoint) is linked to the selected one. Its inspector lists its links (✕ unlinks) and its cars (model, ✕; 🚗 Add a car here). **🛣 Waypoints from road tiles** rebuilds them from the road props (one per tile, linked to its neighbours `tile` apart). The toolbar's Traffic box hides them. |
| **Secret patches** | 🤫 Gold boxes (`secrets`): a clump of lush, bright grass anywhere in town (`world/SecretPatches.ts`), apart from the sections' grass. Any mower cuts it, even with the bag full (no clippings); mowed through (85%), its chest pops out with a claim card worth its `reward`, once per save (by id: `secretsFound`). A twinkle shows over a hidden one when the player is near. |
| **Pen** | 🚧 A section's `pen` (its inspector: "Add a pen"): a white fence all round the rect keeping the player inside until the section is restored, then sinking away (`Town.releasePen()`). The Front Yard's holds the yard and the plaza with its ATM and wardrobe. No signs on it (nothing to read at the very start); the park's separator, on the pen's side, has none either. |
| **Start** | Where the player starts. |
| **Island shore** | The island's outline: orange numbered posts, dragged to reshape it (its corners are drawn round: `island.cornerRadius`, default 3.5, `Shore.roundCorners()`; the points stay where they are); D (or "Add a point after") inserts one half way to the next, Del removes one (3 at least). The deck band, fence line and sea follow; the inspector also edits the deck (width, colours, pilings) and the sides' colour. On save the ground's rect becomes the shore's bounds. Keep sections and roads a deck width in from the shore. |

The **grass preview** (toolbar) shows every cell as the game will generate it, with the count per type under the
Grass noise panel. Imported library models work right away in dev; run `GAME=mow npm run models` before a build.

## Tuning — `ui/mow.json`

| Section | Controls |
|---|---|
| `cell`, `seed` | grass grid resolution and layout seed |
| `grass` | vegetation types: height, colours, `resistance` (power needed), `value` (clippings per cell) |
| `tools` | equipment path: width, speed, power, capacity, price, placeholder `size` / `color`, `engine`, `reel`, `grip` / `gap` (Mowers tab); ridden ones `ride`, `rideScale`, `greyscale` / `tint` (the tractor's paint) |
| `tractor` | the ridden mowers' model (dig's tractor): height, seat, exhaust, smoke, cut reach |
| `treasures` | hidden finds per section (`area`) and each area's bonus |
| `upgrades` | the shop's repeatable tracks (`tab`: gear or boosts, `icon`): per-level effect, max level, base price, growth; `boostsUnlockToolLevel` |
| `clippingPrice` | money per clipping when sold |
| `mode` | calm or rush when the URL has no `?mode=` |
| `combo` | rush mode's combo: `window` (s without a cut before it ends), `stepSec`, `step`, `max` (the multiplier) |

The town itself (sections, grass, props, ATMs, start) is `levels/town.json`: edit it in the editor.

## Saving

`mow.save` in localStorage, written shortly after any change. `SAVE_VERSION` in `data/MowProgress.ts`: a save from
another version starts a new game — bump it when a change can't carry old saves over (the cut grass is saved over
the town's grid, so a new layout needs one: version 3 is the city grid with the Front Yard).

## Analytics

The first-session funnel (`analytics/GameAnalytics.ts` `TUTORIAL`) appends new steps so earlier numbers never
change: `10-yard-restored` is the Front Yard, `07-park-restored` is still the park (now the second section).
Every session also sends `mode/<calm|rush>/start`, and each playtime minute a `mode/<mode>-min-<n>/reached`, so the two
modes' play time can be compared. The first open of each tab sends `tab/<atm|wardrobe>-<tab>/interact`; wardrobe gifts send
`gift/<kind>/visible` when the FREE badge is first shown and `gift/<kind>-<badge|unbadged>/complete` when claimed.
