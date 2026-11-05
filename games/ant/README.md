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
| `npm run ant:pixelate` | Turns every picture in `raw-assets/pictures` into a level (see below). `npm run ant:pixelate -- mushroom` does one. |

---

## How it plays

- **Exposed**: a block on the picture's outline (any side: the ants walk round the tray's rim), or next to (left,
  right, above, below) a block already taken. The picture is eaten from its outline inwards.
- **Ants walk in straight lines**, turning at right angles: up from their slot to the rim, along the rim (round its
  corners) to the side nearest their block, then in through the eaten cells. Home: straight down when the way below is
  clear, else the shortest straight line (or path) to the nearest border; along the rim to its bottom; straight down to
  the anthill's row; across into it.
- **Tiles**: 4 columns under the 5 slots; only the front row (on white plates) can be tapped; the second row waits as
  it is; rows further back sit lower with faded numbers. Taking a tile moves its column up.
- **Slots**: 5. A tile in a slot sends one ant every 0.09 s while there's an exposed block of its colour no other ant
  is already going for; its number counts down as they leave, and the tile goes once its last ant is home.
- **Won**: the picture is gone. **Lost**: all 5 slots hold a tile still waiting, none of their colours has anything
  exposed, and no ant is out. The card offers NEXT or TRY AGAIN; the ↻ button restarts any time.
- **2x**: the top-left button doubles the game speed (`Game.timeScale`).

**Every level can be cleared.** The tiles are dealt by playing the picture out with the same rules
(`Board.dealDeck`): each tile takes blocks of a colour that are reachable by then, so taking the tiles in the order they
were dealt always works. They're dealt round-robin into the columns, so the front row is always the next four. Tile
sizes run from about 1/60 to 1/22 of the picture, all that's left of a small run in one tile.

Progress (the level reached) is saved in `localStorage` (`ant.save`).

---

## Making levels — `tools/pixelate.mjs`

Drop a picture (`.png`, `.jpg`, `.webp` or `.svg`) into `raw-assets/pictures/` and run `npm run ant:pixelate`:

1. The picture is sampled 8×8 times per cell of a small grid (transparent parts become the `background` colour).
2. Its colours are reduced to a handful with k-means (deterministic: the same picture always makes the same level).
3. Each cell takes the colour most of its samples are nearest to: crisp edges, no blended in-between colours.

Out come `levels/<name>.json` (size, palette ordered by use, one string per row of colour indices) and a big preview,
`levels/previews/<name>.png`, to check by eye. New pictures are added at the end of `levels/index.json`, the play
order; reorder that list by hand.

Per-picture settings, in `raw-assets/pictures/pictures.json` (defaults: 24 × 24, 6 colours, the file name, white):

```json
{ "mushroom": { "name": "Mushroom", "width": 24, "height": 24, "colors": 6, "background": "#ffffff" } }
```

Bigger grids keep more detail (a strawberry's seeds need more than 22 × 22). Pictures with flat colours and clear
shapes pixelate best; few colours (4–8) suit the game.

The three starting pictures (`strawberry`, `mushroom`, `sunset`) are simple SVGs drawn for the game.

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
  raw-assets/pictures/   source pictures + pictures.json
  tools/pixelate.mjs     picture -> level
```

## Next steps (not in this first version)

Sounds; the reference's booster bar (add a slot, shuffle, magnet…); a hint for the next good tile; star ratings that
mean something; more pictures.
