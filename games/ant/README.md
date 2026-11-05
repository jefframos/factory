# Ant

A chill pixel-picture puzzle for web portals. A picture made of coloured blocks sits on a tray; under it, an anthill,
five slots, and columns of coloured tiles, each with a number. Tap a column's front tile: it moves into a free slot and
that many ants of its colour stream out, each fetching one block of that colour back down the anthill. Clear the whole
picture to win. The puzzle is the order: ants can only reach blocks that are **exposed**, so a tile whose colour isn't
reachable yet just waits in its slot — fill all five slots with waiting colours and the level is lost.

Built on the factory's engine (`core/`): one THREE scene for the board, a small PIXI layer for the HUD. The layout
follows the reference screens (a 1080 × 1920 portrait, measured in `game/world/Layout.ts`): the picture's tray across
the top, the anthill and its lid under it, the slots, the tile columns; the picture's pixels are glossy jelly cubes,
the floor a peach checker. A finished picture gets a celebration (rays, confetti, the picture, three stars, NEXT).

---

## Running it

Set `GAME=ant` in `.env`, then from the repo root:

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on `:9001`. |
| `npm run build` | Production build. |
| `npm run editor` | The **level editor** on `:4720` (see below). |
| `npm run ant:pixelate` | Turns every picture in `raw-assets/pictures` into a level (see below). `npm run ant:pixelate -- mushroom` does one. |

On the dev server (or with `?dev=1`) the **Ant** debug panel has: a level dropdown, ant speed and the time between
ants (live), RESTART / WIN LEVEL / NEXT / +1 SLOT, the level's baked check, and pixels left, ants out, each slot's
count. The feel's defaults are in
`game/data/Tuning.ts` (slow and steady: cozy).

---

## How it plays

- **Empty cells** (a transparent part of the picture) have no block and count as open ground from the start.
- **Exposed**: a block on the picture's outline (any side: the ants walk round the tray's rim), or next to (left,
  right, above, below) a block already taken. The picture is eaten from its outline inwards.
- **Ants walk in straight lines**, turning at right angles: up from their slot to the rim, along the rim (round its
  corners) to the side nearest their block, then in through the eaten cells. Home: straight down when the way below is
  clear, else the shortest straight line (or path) to the nearest border; along the rim to its bottom; straight down to
  the anthill's row; across into it.
- **Tiles**: 3 to 5 columns (the level's own: fewer for small pictures) under the 5 slots; only the front row (on white plates) can be tapped; the second row waits as
  it is; rows further back sit lower with faded numbers. Taking a tile moves its column up.
- **Slots**: 5. A tile in a slot sends one ant every 0.2 s while there's an exposed block of its colour no other ant
  is already going for — the one nearest its slot (no dice) —; its number counts down as they leave, and the tile goes
  once its last ant is home.
- **Extra slot** (power-up, once a level): the orange ＋1 SLOT button under x2 adds a sixth slot. A lost level offers it
  too (+1 SLOT on the card), and play goes on.
- **Won**: the picture is gone. **Lost**: all 5 slots hold a tile still waiting, none of their colours has anything
  exposed, and no ant is out. The card offers NEXT or TRY AGAIN; the ↻ button restarts any time.
- **2x**: the top-left button doubles the game speed (`Game.timeScale`).

**Every level is baked and checked.** The tiles — which, in what order, how many columns — are worked out when the level
is made (`tools/solver.mjs`) and saved in the level file, so a level always plays the same:

1. **Dealt** by playing the picture out with the game's rules: each tile takes blocks of a colour that are reachable by
   then, so taking the tiles in the order they were dealt always works. The `seed` picks another deal. Tile sizes run
   from about 1/90 to 1/25 of the grid.
2. **Mixed** (`mix` 0–5): some later tiles are pulled a few rows forward — a colour that can't be reached yet turning
   up early, to sit in a slot waiting: the traps that fill the slots and lose the level. Of several mixes, the hardest
   one that can still be cleared is kept.
3. **Checked** by a solver that plays it: is there an order of taps that clears it with 5 slots (or only with the
   extra slot)? Does that still work whichever blocks the ants happen to pick? And how often does a player tapping at
   random win — the level's difficulty (100% = can't go wrong; the editor calls it easy / gentle / tricky / hard).

The solver plays patiently (the ants finish all they can before the next tap) — a player can always wait. Its rules are
a copy of `Board.ts` / `AntScene.ts`'s: change one, change the other. Traps need colours the ants can't reach yet:
a picture whose colours all touch its edge is always easy; an **outline** (it wraps everything) or colours inside
others make room for them.

The tiles go round-robin into the columns, so the front row is always the next tiles in the deck's order.

Progress (the level reached) is saved in `localStorage` (`ant.save`).

---

## The level editor — `npm run editor`

With `GAME=ant` in `.env`, `npm run editor` opens a local page (`web/server.mjs` + `web/public/index.html`):

- **Master palette** (top left): the game's tones (`raw-assets/pictures/palette.json`). Click a swatch to change it,
  × to remove one, ＋ to add one; Saturation / Brightness −/＋ shift them all. The level being tuned previews the change
  at once; **Apply to all levels** saves it and rebuilds every level on the Master palette in the new tones.
- **Play order**: every level as a card (its picture in the game, size, pixels, colours); drag to reorder (saved at
  once to `levels/index.json`).
- **Add a picture…**: a `.png` / `.jpg` / `.webp` / `.svg` from disk becomes a new level at the end (Master palette,
  background removed when it's solid), ready to tune. **New drawing…**: an empty grid (any size up to 64 × 64) to
  draw by hand with the master palette, no picture needed.
- **Tiles & difficulty** (under the tuning): **Outline** (a stroke round the picture in a colour, snapped to the
  palette — e.g. a dark one round the strawberry; it needs a free cell round the picture), **Columns** (auto: 3 under
  150 blocks, 4 under 450, else 5), **Seed** (🎲: another deal), **Mix** (0 = easy, up to 5). The check updates live
  — ✓ can be cleared / ⚠ only with the extra slot / ✗ can't — with how often random taps win, and the tile columns
  as the game will lay them out (the front row outlined). The list shows each level's check.
- **Tuning a level**: the source picture next to the level as the game will show it, **live**, which you can draw on:
  **Paint** (a palette colour, or any colour from the picker, snapped to the palette), **Erase** (no block there),
  **Restore** (drops your edit and shading on a cell); the **shading brushes** — ☀️＋ / 🌑− brightness, 🎨＋ / 🩶−
  saturation (keys 1–4) — move a pixel one step per pass (−5 to +5), for depth: a highlight, a shadow; **🪣 Select**
  (F) picks the pixels of a colour joined to the one clicked (or, *whole picture*, all of that colour) and the bar
  under the tools swaps them to a palette colour, or to **a custom colour** kept exactly (not snapped: saved as
  `"!#hex"` edits); Esc drops the selection. Undo
  (Ctrl/Cmd+Z), Clear edits (edits and shading). Edited cells show a dot. A shaded pixel is a colour of its own (not
  snapped to the palette), so it gets its own tiles in the game: shade sparingly. Then: name;
  width × height (proportions locked or not); the most colours; the **palette** its colours snap to (**Master**,
  a preset — cozy / candy / garden / sea / night — or none: its own); **saturation** and **brightness** steps,
  −5 to +5 (applied to the level's final colours, after the palette: a Master level keeps the master's tones, just
  more or less vivid; +1 saturation is 15% more, +1 brightness 6% lighter);
  the **background** (auto: removed when the picture has no transparency of its own; remove; keep); the **padding**
  (empty cells all round: the picture is drawn that much smaller — room for an outline on a picture that fills its
  whole canvas); the **offset** (arrows move the whole picture a cell, ◎ centres it). Pixels and colours used are counted as you go. **Save**
  writes the level, its preview and its settings; **Delete** takes it out of the game (its picture moves to
  `raw-assets/pictures/removed`).

Hand edits are kept apart from the picture (`edits` in its settings), so they survive re-pixelating and palette
changes, and move with the offset. They're stored by cell, so changing a picture's size can misplace them.

Calm levels are small with few colours: a first level works well at about 18 × 18 with 4 colours and no background.

## Making levels — `tools/pixelate.mjs`

Drop a picture (`.png`, `.jpg`, `.webp` or `.svg`) into `raw-assets/pictures/` and run `npm run ant:pixelate` (it
rebuilds every level, drawn ones too):

1. The picture is sampled 8×8 times per cell of a small grid. Transparent parts are **empty** (no block, a `.` in the
   level's rows); a solid background can be removed (the colour round the border, flood-filled in from the edges).
2. Its colours are reduced to a handful with k-means (deterministic: the
   same picture always makes the same level) and snapped to the chosen palette — the master palette by default — by
   the tone that *looks* closest (measured in OKLab), so in an all-red palette a green becomes the nearest red.
3. Each cell takes the colour most of its samples are nearest to: crisp edges, no blended in-between colours.
4. The picture sits inside its padding (and one more cell with an outline); the hand edits go on top (snapped to the
   same palette); the whole grid is shifted by the offset; the outline goes round it; the level's colours get its
   saturation / brightness steps, then the brushes' shading per pixel.
5. The tiles are baked and checked (above).

A level drawn in the editor has no picture: just its settings, its size and its edits.

The work is in `tools/pixelate-lib.mjs`, shared by the command line and the editor.

Out come `levels/<name>.json` (size, palette ordered by use, one string per row of colour indices) and a big preview,
`levels/previews/<name>.png`, to check by eye. New pictures are added at the end of `levels/index.json`, the play
order; reorder that list by hand.

Per-picture settings, in `raw-assets/pictures/pictures.json` (the editor writes them):

```json
{ "mushroom": { "name": "Mushroom", "width": 22, "height": 22, "colors": 5, "palette": "master", "background": "auto",
                "saturation": 1, "brightness": 0, "offsetX": 0, "offsetY": 1, "edits": { "10,3": ".", "11,3": "#f28b8b" },
                "stroke": "#4a4a5a", "padding": 1, "shades": { "9,6": [0, 2] }, "columns": 0, "seed": 0, "mix": 2 } }
```

Bigger grids keep more detail (a strawberry's seeds need more than 22 × 22). Pictures with flat colours and clear
shapes pixelate best; few colours (4–8) suit the game.

The 28 test levels: `strawberry`, `mushroom`, `teacup`, `sunset` and five patterns (`rings`, `frames`, `checker`,
`zigzag`, `polka`) are SVGs drawn for the game; the other 19 are Twemoji (CC BY 4.0 — credit needed if they ship:
`raw-assets/pictures/CREDITS.md`). They're ordered by the solver's difficulty: plain pictures first, the outlined
ones with traps (cloud, frames, blossom, ice cream, cat, frog) last.

---

## Code

```
games/ant/
  index.ts               boot: platform, then the scene
  game/
    scenes/AntScene.ts   the board, input, slots, releasing ants, win / lose, the camera framing it all
    data/Board.ts        the rules (exposed, claim, take) and the deck dealer — no drawing
    data/Levels.ts       levels/index.json + the level files
    data/AntSave.ts      the level reached
    world/PictureView.ts the picture: one InstancedMesh of rounded blocks on a tray
    world/AntSwarm.ts    the ants (one InstancedMesh) and the blocks they carry (another): out, pick up, home
    world/TileRack.ts    the slots (white plates) and the tile columns: two-tone cushions, numbers on canvas textures
    world/Layout.ts      where everything goes, measured off the reference screen
    ui/AntHud.ts         restart (blue), "Level N", x2 (green), the celebration and the lost card (PIXI shapes and text)
  levels/                the levels (index.json = order) and their previews
  raw-assets/pictures/   source pictures + pictures.json (settings) + palette.json (the master palette)
  tools/pixelate-lib.mjs picture (or drawing) + settings + palette -> level
  tools/solver.mjs       deals, mixes and checks a level's tiles (the game's rules, played by a solver)
  tools/pixelate.mjs     the command line over it
  web/                   the level editor (server.mjs + public/index.html)
```

## Next steps (not in this first version)

Sounds; more power-ups (shuffle, magnet…); a hint for the next good tile; star ratings that
mean something; more pictures.
