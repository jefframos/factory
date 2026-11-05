# UFO

Fly a saucer over a town and eat it. Everything under the saucer gets pulled up if it fits, and each bite grows the saucer, which also lifts it higher.

- **To eat something:** its middle has to be under the saucer, its footprint has to fit within the saucer's radius, and the saucer has to fly above it.
- **Too tall to fly over:** the thing blocks the saucer (the prop's `collider`, or a solid collider cube), and the saucer has to go round it.
- **Cars:** they can be eaten but never block.
- **Standard mode:** areas in `ui/areas.json` (the editor's Levels tab), each with a `miniature` (the town the home screen shows as its island) and its levels. A level is a town, a time, a number of rivals and a job: `points` (reach `points`, or a `share` of the town's), `all` (eat everything) or `object` (swallow the town's `goal`), so a town can be reused. `all` levels are gentle: rivals never eat the player or outgrow it, and eating one gets you all it ate. `tutorial` in the same file is what a new player plays first; seconds 0 means no clock. Progress is saved. Other saucers show as small arrows in their colour.
- **Competition:** a level with `round` (`seconds`, `rivals`) is timed, and the biggest saucer at the end wins. Rival saucers play the same rules (`game/player/Rival.ts`, tuned in the UFO tab), and a higher saucer eats a lower one when it gets its middle under its beam. The goal is then a big bonus.
- **End of a calm level (no `round`):** when its goal is eaten (`goal` in the level file: a prop's model, and the size the saucer needs for it), or without a goal, when everything is. Then on to the level named in `next`, from a small saucer again.

## Running it

Set `GAME=ufo` in `.env`, then use `npm run dev` for the game and `npm run editor` for the editor. After a fresh clone, or when `raw-assets` changes, run `npm run models`, `npm run font`, `npm run audio` and `npm run image`.

`?dev=1` shows the debug panel (live tuning, GROW, EAT EVERYTHING). `?city=<level>` plays another file from `levels/`.

## Where things are

- `levels/*.json`: the levels, edited in the Town tab. Every file in the folder is a level.
- `ui/ufo.json`: the game's numbers, edited in the UFO tab: size, height, growth, camera, plus the road kit and traffic.
- `web/`: the game's editor. It's a small server over the shared `tools/world-editor/server.mjs`, with its own tabs in `web/public/`. The Town tab's browser code comes from `games/mow/web/public`.
- `game/player/Saucer.ts`: the saucer and its skins. `tools/build-saucer.mjs` builds its model and textures from `mixamo/ufo/` (then run `npm run models` and `npm run image`). For a new skin, add a `BaseColor*.png` to `mixamo/ufo/Textures/`, run those, and add its name to `saucer.skins` in `ui/ufo.json`.
- `ui/saucers.json`: the UFO styles and the aliens, edited in the editor's Hangar tab. Their pieces are built by `core/pieces/Pieces.ts`.
- `game/world/People.ts`: the people. Wander areas and street paths are placed in the Town tab's People card (the level's `people`); their speed, height and how long they stop are in the UFO tab.
- `tools/build-people.mjs`: builds the people's models and animations from the library's characters Fun kit and the Mixamo clips in `mixamo/`. To change an outfit, edit its list, run `node games/ufo/tools/build-people.mjs`, then `npm run models`. Their skin and clothes colours are `people.palette` in `ui/ufo.json`.
