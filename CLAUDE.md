# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server on :9001 (reads GAME from .env)
npm run build        # Build current game to /dist
npm run build-all    # Build all platform variants
npm run assets       # Process all asset bundles (images, fonts, audio, JSON)
```

Game selection is controlled by `GAME=<name>` in `.env` (e.g. `GAME=clog`). The Vite config roots itself at `games/${GAME}`, so only one game builds at a time.

Asset sub-commands (`npm run image`, `npm run font`, `npm run audio`, `npm run models`) each have a `watch:` variant.

## Architecture

### Multi-game factory

```
core/          # Shared engine (PIXI-based game loop, input, audio, platforms, UI)
games/<name>/  # One folder per game, each with index.ts entry point
public/<name>/ # Built asset bundles per game
tools/         # Asset pipeline (AssetPack → manifests)
```

Each game's `index.ts` creates a class extending `core/Game.ts`, loads its asset manifests, registers scenes via `SceneManager`, then transitions to the first scene. `Game` owns the PIXI `Application` and drives the fixed/variable update loop.

### Dual-renderer pattern (clog)

3D world and 2D UI are **separate renderers stacked in the DOM**. The THREE.js canvas sits behind a PIXI overlay:

- `LinearWorld3dScene` (extends `ThreeScene`) — all 3D geometry, player, collectibles, camera
- `BaseDemoScene` (extends `GameScene`, owns the above) — owns the PIXI UI (`PlayerHud`, `ScoreLeaderboard`) and syncs them each frame from the 3D scene's accessors

`BaseDemoScene` never touches THREE directly — it reads `world3d.playerValue` and `world3d.playerScore` and passes them to Pixi components.

### Scene lifecycle

`build()` → `show()` → `update(delta)` / `fixedUpdate(delta)` → `hide()` → `destroy()`

### World management (linear mode)

`LinearAreaManager` keeps exactly three `LinearArea` instances live at all times: `prevArea` (locked, still rendered), `currentArea` (active), `nextArea` (pre-built, visible through the gate). A fourth `pendingNextArea` is buffered 20 units before the south edge to avoid frame spikes. On transition, the oldest is destroyed, everything shifts forward, and food in the vacated Z-range is cleared via `onTransition`.

There is also a dungeon-style `AreaManager` / `ClogWorld3dScene` pair — an independent alternative mode that is **not** used by default.

### Food lifecycle

`LevelManager` owns the spawn timer (3.5 s). It asks `CollectibleManager` to place cubes in the current room's spawn zone (`spawnCenter` + `spawnHalfSize` from `LinearAreaManager`). Food values come from the current room's `foodValues` pool. `CollectibleManager.clearInZRange()` is called by the `onTransition` handler to clean up abandoned food.

### Merge system

`PlayerEntity` holds `tail: TailCube[]` sorted descending by value. After a 0.7 s settle delay, `MergeQueue` (a sequential task animator) slides the back cube of an equal-value pair into the front one; the receiver doubles. Player-absorb (front tail matches player value) has priority. Merges cascade: each `onDone` re-scans for the next pair.

### BendService

All materials receive an injected vertex shader that curves the world around the player. Call `BendService.applyBend(material)` when creating geometry and `BendService.updateOrigin(playerPos)` each frame.

### Room / world config

`LinearConfig.ts` is the single source of truth: 12 hand-crafted `ROOM_CONFIGS` entries (size, gateValue, foodValues, optional obstacles), `FOOD_CONFIG` spawn constants, and `CAMERA_CONFIG`. `getLinearRoomConfig(idx)` handles out-of-bounds indices by generating procedural rooms beyond the King room.

### Platform layer

`PlatformFactory.getPlatformInstance(name)` returns the right SDK wrapper (Poki, CrazyGames, GameDistribution, Facebook, or `MockPlatform` for local). Platform name comes from `VITE_PLATFORM` env var. Each game has `platforms.config.json` mapping platform names to class names and asset folder paths. Always use `this.folderPath` (set from platform config) when constructing asset paths.

## Key conventions

- Path aliases: `core/` and `@core/` both resolve to the repo's `core/` directory.
- Asset manifests must be patched with the game's folder path before loading: `ManifestHelper.patchPaths(manifest, 'clog/images/')`.
- `LinearAreaManager` is **not** behind an interface — it is a concrete class used directly by `LinearWorld3dScene`.
- Obstacle generation uses seeded value noise: `noise(cell * scale, seed) >= threshold`. Same seed always produces the same layout.
- `ClogConstants.sizeForValue(v)` and `followDist(a, b)` are the canonical size/spacing formulas — use them instead of inlining math.
