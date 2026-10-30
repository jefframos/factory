# Mow Town

A casual mowing / city-restoration game for web portals (Poki, CrazyGames, YouTube Playables): walk, and the grass
in front of you is cut. Fill your container, empty it for cash, buy better mowers and upgrades, restore each district
of an overgrown town and unlock the next. Design: the Mow Town GDD (MVP scope: the Starting Park and the
Residential Street).

Built on the factory's engine (`core/`) and the engine-level parts of `games/dig` (character, movement, physics,
UI kit, audio, localization, platforms). The town is built from the 3D library (KayKit City Builder Bits, KayKit
Forest trees and grass, KayKit Mixed Bag flowers, dig's ATM); **the mowers are still placeholder cubes**.

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
2. **Collect** — each cut cell's clippings go into the container. When it fills (said once), mowing stops: the floor
   arrows lead to the nearest **ATM**; standing on its pad tosses the clippings in and pays out.
3. **Upgrade** — every ATM also opens the shop, laid out like dig's. **GEAR**: every mower on a timeline up to the
   goal (**Scissors** → Push Mower ($15) → Powered → Ride-on → Industrial → **Mega**), the next mower's offer, and
   the bag's capacity with its levels. **BOOSTS** (after the first mower; "!" when one is affordable): Speed, Money
   Gain, Cutting Width, Sharp Blades (chew through tough grass faster). Powered and bigger mowers run an engine.
4. **Restore** — each section shows its restored % at the top. At its goal (97%) the last stragglers are cleared,
   flowers bloom, a bonus is paid, and the next section opens: its fence sinks, its ATMs pop in, and the camera can
   glide over to show it.

The guide is just the floor arrows: full bag → the nearest ATM; the first mower / first upgrade affordable → the
nearest ATM (with the hand on BUY); a newly opened section → its grass.

---

## Code

```
games/mow/
  index.ts              boot (platform, language, audio, fonts, atlas, then the scene)
  game/
    scenes/MowScene.ts  the game: town, grass, player, stations, restoration, guide, engine sound
    world/GrassField.ts the vegetation: a cell grid over the sections, instanced tufts per 16x16 chunk, the mowed-lawn
                        ground shader (pixel-noise grass + a cut map), cut states, resistance
    world/Town.ts       builds levels/town.json: ground, pavements, props, ATMs, fences, flowers; walkability, "no grass here"
    world/ArrowGuide.ts the floor arrows
    mowing/MowingSystem.ts  automatic cutting while moving
    player/MowPlayer.ts the character with the tool cube in front
    ui/MowHud.ts        money / bag / district bar / shop / language
    data/               MowConfig (typed ui/mow.json), MowProgress (the save, versioned)
    analytics/          GameAnalytics (every event; first-session funnel)
  levels/town.json      the town's layout (written by the editor)
  ui/mow.json           gameplay tuning (grass types, tools, upgrades, prices)
  ui/uikit.json         the UI kit (shared look with dig)
  web/                  the editor (server.mjs + public/town3d.js)
```

## The editor — `npm run editor`

A local web tool (`web/server.mjs`, port 4710) that reads and writes `levels/town.json`, the file the game loads;
reload the game to see saved changes. One **Town** tab, in 3D as the game draws it: click to select, W / E / R to
move / turn / scale, D duplicate, Del remove, Ctrl+Z undo, Ctrl+S save.

| Thing | What it is |
|---|---|
| **Sections** | The districts to restore, in unlock order (▲ / ▼). Their rect is where grass grows (`Grass`: noise, a type, or none); bonus, restore goal, ground colours; "camera glides over when it opens". |
| **Separator** | A section's fence (with its lock sign), closing it until the section before is restored. |
| **Grass patches** | Painted over the sections: noise, a grass type (a dense tall-grass patch takes longer at the start), or bare. Round or rectangle, turned, sized. The last one over a spot wins. |
| **Grass noise** | Which grass "auto" cells get: rings around the centre (pink marker), each with its shares per grass type — the further out, the tougher, so a new section further away is harder by itself. |
| **Props** | Game models, or 📚 imported from the 3D library. Fitted to a height; "blocks the player" makes a collider from the model's footprint (a tree's trunk, a building's base) on save — **no grass grows under a collider**. "Fades" = dithers out when it hides the player. |
| **ATMs** | Sell and shop. As many as you like; one can wait for a section to open. |
| **Pavements** | Walkable rects, no grass (plaza, road, park paths). |
| **Start** | Where the player starts. |

The **grass preview** (toolbar) shows every cell as the game will generate it, with the count per type under the
Grass noise panel. Imported library models work right away in dev; run `GAME=mow npm run models` before a build.

## Tuning — `ui/mow.json`

| Section | Controls |
|---|---|
| `cell`, `seed` | grass grid resolution and layout seed |
| `grass` | vegetation types: height, colours, `resistance` (power needed), `value` (clippings per cell) |
| `tools` | equipment path: width, speed, power, capacity, price, placeholder `size` / `color`, `engine` |
| `upgrades` | the shop's repeatable tracks (`tab`: gear or boosts, `icon`): per-level effect, max level, base price, growth; `boostsUnlockToolLevel` |
| `clippingPrice` | money per clipping when sold |

The town itself (sections, grass, props, ATMs, start) is `levels/town.json`: edit it in the editor.

## Saving

`mow.save` in localStorage, written shortly after any change. `SAVE_VERSION` in `data/MowProgress.ts`: a save from
another version starts a new game — bump it when a change can't carry old saves over.
