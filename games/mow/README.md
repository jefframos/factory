# Mow Town

A casual mowing / city-restoration game for web portals (Poki, CrazyGames, YouTube Playables): walk, and the grass
in front of you is cut. Fill your container, empty it for cash, buy better mowers and upgrades, restore each district
of an overgrown town and unlock the next. Design: the Mow Town GDD (MVP scope: the Starting Park and the
Residential Street).

Built on the factory's engine (`core/`) and the engine-level parts of `games/dig` (character, movement, physics,
UI kit, audio, localization, platforms). The town is built from the 3D library (KayKit City Builder Bits, KayKit
Forest trees, bushes and grass, KayKit Mixed Bag flowers, dig's ATM); the walked mowers are still placeholder cubes
(pushed by a U handle with a crossbar the hands hold), the ridden ones are dig's tractor.

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

---

## How it plays

1. **Mow** — move (WASD / arrows / joystick); everything in a circle the tool's width across, just in front of you,
   is cut when your tool's power is enough. Grass one step too tough **resists** (like dig's rock): the mower is held
   back and chews through, chips flying with each hit; tougher still is a wall until a better mower (with a hint).
   Grass you can cut still weighs on the mower: the more tough cells (resistance ≥ 1) under the blade, the slower it
   goes (`LOAD_DRAG` in `MowingSystem.ts`, down to 70% with a full blade). The outer rings mix in **brambles** and
   **thicket** (resistance 4 / 5), so even the big tractors have work at the edges.
2. **Collect** — each cut cell's clippings go into the container. When it fills (said once), mowing stops: the floor
   arrows lead to the nearest **ATM**; standing on its pad tosses the clippings in and pays out.
3. **Upgrade** — every ATM also opens the shop, laid out like dig's. **GEAR**: every mower on a timeline up to the
   goal (**Scissors** → Push Mower ($15) → Powered ($120) → Ride-on ($450) → Lawn Tractor → Industrial → Turbo →
   **Mega**; the first ride comes quickly), the next mower's offer, and
   the bag's capacity with its levels. **BOOSTS** (after the first mower; "!" when one is affordable): Speed, Money
   Gain, Cutting Width, Sharp Blades (chew through tough grass faster). Powered and bigger mowers run an engine.
4. **Dress up** — the first **wardrobe** appears with the second sale and the arrows lead to it; its first (cheapest)
   hat is a must (the wardrobe locks onto it, money topped up if short). Every wardrobe (Dig's closet, a pink pad with a
   heart) opens Dig's wardrobe: COLORS / FACES / HATS,
   the same catalogue, prices and assets (`wardrobe` in `ui/mow.json`; hats placed by `ui/hatfits.json`). Buying
   puts it on at once; it's saved, and the wardrobe shows a bouncing "!" while something new there is affordable.
5. **Restore** — each section shows its restored % at the top. At its goal (97%) the last stragglers are cleared,
   flowers bloom, a bonus is paid, and the next section opens: its fence sinks, its ATMs pop in, and the camera can
   glide over to show it.

### The town

The town is an **island** (like hole.io's cities): the ground stands out of the pizza game's cartoon sea
(`game/builders/WaterMaterial.ts`), any shape — `island.outline` in `levels/town.json`, a polygon (without one, the
ground's rect; `game/world/Shore.ts`). A **wooden deck** runs round the shore (`island.deck`: width, plank colour,
pilings into the sea and their spacing), with a white fence on it (`island.fence`, `inset` from the shore; a kerb under
it only with a `kerbColor`). Sea colour / level / reach and the sides are in `island` too. The next city can be another
island.

A city grid of roads, the **Starting Park** in the middle as the hub (`levels/town.json`; sections in unlock order):

| # | Section | Where | Grass |
|---|---|---|---|
| 1 | **Front Yard** | next to the start plaza, south | short grass only, `grassScale` 0.6, the camera closer (`zoom` 0.72): cleared in a couple of bags, enough for the Push Mower |
| 2 | **Starting Park** | the centre (the hub), fenced from the plaza | the noise's easy rings |
| 3 | **Residential Street** | north, across the main road | tougher rings |
| 4 | **East Gardens** | east block, off the east avenue | `grassScale` 1.1 |
| 5 | **West Lawns** | west block, off the west avenue | `grassScale` 1.2 |
| 6 | **Sports Field** | north-east corner, off the main road | the toughest ring, `grassScale` 1.35 |

The roads are one connected network of KayKit tiles (straight, crossing, curved corners, T-splits — each turned to
meet its neighbours, so no road just ends): an outer ring round the town and two avenues beside the park. The whole
island inside its fence is free to roam from the start (roads, verges, the plaza) — only the locked sections aren't:
each has a white fence all round it (its lock sign on the side facing the section before it), which sinks away when it
opens. Road tiles sit at `elevation` 0.06, above the road slabs under them (the slabs come first in `pavements`). Treasures and an area bonus wait in every section but the yard.

**Grass size** — a section's `grassScale` (default 1; "Grass size ×" in the editor) multiplies its tufts' height and
the contact needed to chew through grass one power too tough: under 1 an easier section, over 1 a harder one.
Clippings per cell stay the same.

**Camera zoom** — a section's `zoom` (default 1; "Camera zoom ×" in the editor) sets the camera distance while it's
the first section not restored yet; it eases over when that changes.

**Ridden mowers** — Ride-on, Lawn Tractor, Industrial, Turbo and Mega put the player in the seat of dig's tractor
(`tractor` in `ui/mow.json`), painted per tier: grey (dig's Digger), green, purple, blue, red (`greyscale` / `tint` on
the tool; `game/utils/Paint.ts`, which paints only the bodywork's mid-tone greys — tyres, glass and trim keep their
colours), bigger by `rideScale`. The shop shows that tractor as their icon.

**Walked mowers** — pushed by a U handle (two rails from the deck's back corners up to a crossbar) built in the tool's
own frame; the hands hold the crossbar. Each walked tool's `grip` (`forward`, `height`, `spread` of the hands) and
`gap` (how far ahead of the player the tool's middle is) are fitted in the editor's **Mowers** tab.

Cut grass never grows back on its own. Only when the player is stuck — nothing left in the open section their mower
can cut (or chew), and the next mower out of reach even with the bag sold — does just enough grass they can cut grow
back to earn the difference ("Fresh grass is growing back!").

The guide is just the floor arrows (purple): full bag → the nearest ATM; the first mower / first upgrade affordable → the
nearest ATM (with the hand on BUY); a newly opened section → its grass; wandered off (more than 7 units outside the
section being worked on, the first open one not restored) → back into it, the nearest way in, until you're inside. Routes
follow walkable ground — round the locked sections, never through them.

---

## Code

```
games/mow/
  index.ts              boot (platform, language, audio, fonts, atlas, then the scene)
  game/
    scenes/MowScene.ts  the game: town, grass, player, stations, restoration, guide, engine sound
    world/GrassField.ts the vegetation: a cell grid over the sections, instanced tufts per 16x16 chunk, the mowed-lawn
                        ground shader (pixel-noise grass + a cut map), cut states, resistance
    world/Town.ts       builds levels/town.json: ground, island (deck, sides, sea, fence), pavements, props, ATMs,
                        fences, flowers; walkability, "no grass here"
    world/Shore.ts      the island's outline and its polygon maths (insets, inside, edge distance)
    world/ArrowGuide.ts the floor arrows
    mowing/MowingSystem.ts  automatic cutting while moving
    player/MowPlayer.ts the character with the tool cube in front
    ui/MowHud.ts        money / bag / district bar / shop / language
    data/               MowConfig (typed ui/mow.json), MowProgress (the save, versioned)
    analytics/          GameAnalytics (every event; first-session funnel)
  levels/town.json      the town's layout (written by the editor)
  ui/mow.json           gameplay tuning (grass types, tools, upgrades, prices)
  ui/uikit.json         the UI kit (shared look with dig)
  web/                  the editor (server.mjs + public/town3d.js, mowers.js, …)
```

## The editor — `npm run editor`

A local web tool (`web/server.mjs`, port 4710) that reads and writes `levels/town.json`, the file the game loads;
reload the game to see saved changes. The **Town** tab, in 3D as the game draws it: click to select, W / E / R to
move / turn / scale, D duplicate, Del remove, Ctrl+Z undo, Ctrl+S save. The **Mowers** tab fits each walked mower's
handle grip and gap (and size) on the walking character, hands marked; it saves to `ui/mow.json`
(`PUT /api/mow/tools`).

| Thing | What it is |
|---|---|
| **Sections** | The districts to restore, in unlock order (▲ / ▼). Their rect is where grass grows (`Grass`: noise, a type, or none); "Grass size ×" (`grassScale`: easier under 1, harder over 1); "Camera zoom ×" (`zoom`); bonus, restore goal, ground colours; "camera glides over when it opens". |
| **Separator** | Where a locked section's lock sign stands; the section is fenced all round until the section before is restored. |
| **Grass patches** | Painted over the sections: noise, a grass type (a dense tall-grass patch takes longer at the start), or bare. Round or rectangle, turned, sized. The last one over a spot wins. |
| **Grass noise** | Which grass "auto" cells get: rings around the centre (pink marker), each with its shares per grass type — the further out, the tougher, so a new section further away is harder by itself. |
| **Props** | Game models, or 📚 imported from the 3D library. Fitted to a height; "blocks the player" makes a collider from the model's footprint (a tree's trunk, a building's base) on save — **no grass grows under a collider**. "Fades" = dithers out when it hides the player. |
| **ATMs** | Sell and shop. As many as you like; one can wait for a section to open. |
| **Wardrobes** | Open the wardrobe (Dig's closet behind the pad). Placed like ATMs, one can wait for a section too; their look is `wardrobe` in the level. |
| **Pavements** | Paved rects, no grass (plaza, road, park paths). |
| **Start** | Where the player starts. |
| **Island shore** | The island's outline: orange numbered posts, dragged to reshape it; D (or "Add a point after") inserts one half way to the next, Del removes one (3 at least). The deck band, fence line and sea follow; the inspector also edits the deck (width, colours, pilings) and the sides' colour. On save the ground's rect becomes the shore's bounds. Keep sections and roads a deck width in from the shore. |

The **grass preview** (toolbar) shows every cell as the game will generate it, with the count per type under the
Grass noise panel. Imported library models work right away in dev; run `GAME=mow npm run models` before a build.

## Tuning — `ui/mow.json`

| Section | Controls |
|---|---|
| `cell`, `seed` | grass grid resolution and layout seed |
| `grass` | vegetation types: height, colours, `resistance` (power needed), `value` (clippings per cell) |
| `tools` | equipment path: width, speed, power, capacity, price, placeholder `size` / `color`, `engine`; ridden ones `ride`, `rideScale`, `greyscale` / `tint` (the tractor's paint) |
| `tractor` | the ridden mowers' model (dig's tractor): height, seat, exhaust, smoke, cut reach |
| `treasures` | hidden finds per section (`area`) and each area's bonus |
| `upgrades` | the shop's repeatable tracks (`tab`: gear or boosts, `icon`): per-level effect, max level, base price, growth; `boostsUnlockToolLevel` |
| `clippingPrice` | money per clipping when sold |

The town itself (sections, grass, props, ATMs, start) is `levels/town.json`: edit it in the editor.

## Saving

`mow.save` in localStorage, written shortly after any change. `SAVE_VERSION` in `data/MowProgress.ts`: a save from
another version starts a new game — bump it when a change can't carry old saves over (the cut grass is saved over
the town's grid, so a new layout needs one: version 3 is the city grid with the Front Yard).

## Analytics

The first-session funnel (`analytics/GameAnalytics.ts` `TUTORIAL`) appends new steps so earlier numbers never
change: `10-yard-restored` is the Front Yard, `07-park-restored` is still the park (now the second section).
