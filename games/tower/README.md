# Clog

A 2048-style merge-snake game in a 3D linear corridor. The player collects numbered cubes, merges equal values to double them, and passes through value-gated doors to advance through increasingly large rooms.

## How to play

- Move with WASD / arrow keys or touch drag
- Walk over food cubes to collect them — they attach to your tail
- Equal adjacent values merge automatically, doubling the closer one
- When your player value meets the gate requirement, the gate turns green and you can pass through
- Reach Room 12 (gate: 8192) to become King

## Architecture

Entry point: `BaseDemoScene` (Pixi `GameScene`) owns two layers:

- **3D world** — `LinearWorld3dScene` (Three.js): player, rooms, food, camera
- **2D HUD** — `PlayerHud`, `LinearMinimap`, `ScoreLeaderboard` (Pixi)

### Key systems

| System | File | Responsibility |
|---|---|---|
| `LinearAreaManager` | `world/LinearAreaManager.ts` | Keeps 2 rooms live at all times; handles transitions |
| `LinearArea` | `world/LinearArea.ts` | Single room geometry, gate mesh, collision |
| `PlayerEntity` | `entities/PlayerEntity.ts` | Movement, tail snake-follow, merge pipeline |
| `CollectibleManager` | `systems/CollectibleManager.ts` | Pool of food cubes in the scene |
| `LevelManager` | `systems/LevelManager.ts` | Tops up food every 3.5 s |
| `MergeQueue` | `systems/MergeQueue.ts` | Serializes merge animations |
| `BendService` | `services/BendService.ts` | Vertex shader that curves the world around the player |

### Room progression

Rooms are defined in `world/LinearConfig.ts`. There are 12 named rooms (gates 8 → 8192), then procedurally generated rooms beyond that.

```
Room  Size  Gate    Food pool
  1    60    —      [2]
  2    68    8      [2]
  3    76    16     [2, 4]
  4    86    32     [2, 4]
  5    96    64     [4]
  6   106   128     [4]
  7   116   256     [4, 8]
  8   126   512     [8]
  9   136   1024    [8, 16]
 10   148   2048    [16]
 11   160   4096    [16]
 12♚  172   8192    [16, 32]  ← King Room
```

### Merge flow

1. Player walks over a food cube → `collect()` inserts it into the tail in descending value order
2. After a 0.7 s settle delay, `scheduleMerges()` finds the first adjacent equal pair
3. The back cube slides into the front cube; their value doubles
4. Repeat until no equal pairs remain
5. If `tail[0].value === player.value`, the player absorbs it first (priority over tail merges)

### Size formula

All spatial quantities scale with cube value:

```
size = 1 + (log₂(value) − 1) × 0.15
```

So value 2 → size 1.0, value 1024 → size 2.35.

## Dev tools

- **Double Value** button in the dev GUI (Player section) — instantly doubles the player's value for testing gate progression
- **Camera Zoom** slider in the dev GUI (Camera section)
- `MergeDebugger` — enable `dbg` / `dbgTail` calls in `debug/MergeDebugger.ts` for verbose merge logging
