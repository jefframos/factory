# Pizza

A mobile-first hybrid casual game with **only one input: movement**. The player walks
near resources to auto-gather them, walks into zones to auto-deposit/auto-upgrade, and
walks toward gates that unlock as buildings level up. No buttons beyond movement + one
camera toggle.

```
Explore → auto-gather resources → carry in backpack → walk into a zone →
auto-deposit → building levels up → gate unlocks → explore further
```

This file is the **architecture** reference — what's built, where it lives, how the
pieces fit. For the original pitch/design framing (tower progression, biomes, etc. —
aspirational, not all implemented yet) see git history; this doc reflects what
actually exists in code today so a new session can extend it without re-deriving it.

## Entry point & bootstrap

`index.ts` (`MyGame`) — `initialize()` resolves the platform (`VITE_PLATFORM` env var →
`platforms.config.json` → `PlatformFactory.getPlatformInstance()` → `PlatformHandler`,
the one seam between game code and any specific platform SDK's ads/save-storage calls),
then sequentially loads every persisted-data store (`ShopStorage`, `HighScoreStorage`,
`GlobalResourceStorage`, `BackpackStorage`, `BuildingStorage`, `GateStorage`,
`Localization`) *before* any asset loads. `loadAssets()` then loads three PIXI bundles
in order — `json` (also triggers `loadShopItems()`/`loadIslands()`), `fonts`, `images`
— each patched to `pizza/<kind>/` via `ManifestHelper.patchPaths()`. `startGame()`
initializes `DevGuiManager` (gated on `?dev` — see `Game.debugParams`), registers and
switches to `PizzaScene`.

## Scene: `game/scenes/PizzaScene.ts`

The whole game currently runs in one scene. It extends `ThreeScene` (owns
`threeScene`/`threeCamera`, THREE render loop) and implements `CameraFocusHost` +
`WorldProgressionHost` (see below) so child entities can redirect the camera / chain
progression events without importing the scene class itself.

**Camera** — a spherical yaw/pitch/distance orbit around the player (`CAMERA_SETTINGS`),
recomputed every `fixedUpdate()` via `cameraOffset()` and eased with an exponential lerp
(`smoothedFollowTarget`). `cameraUpVector()` derives `camera.up` from yaw every frame
instead of trusting THREE's default `(0,1,0)` — necessary because `lookAt()` degenerates
when the view direction is parallel to `up` (exactly what happens at `pitchDeg=90`,
straight-down). A bottom-left `BaseButton` (`setupCameraToggleButton()`) tweens
`CAMERA_SETTINGS.pitchDeg`/`distance` between the normal follow angle and a top-down
view via gsap — **note:** `BaseButton`'s click callback must go on the `click` state, not
`standard` (see `core/ui/BaseButton.ts`'s `setState()`) — putting it on `standard` fires
on every mouse-out, not just clicks.

**HUD** — `BackpackUI` (bottom-center), `GlobalResourcesUI` (top-right), camera toggle
(bottom-left) — all direct children of `Game.overlayContainer`, repositioned every
`update()` frame from `Game.overlayScreenData` (already expressed in the overlay's local
space, no conversion needed).

**Dev GUI** (`setupDebugGui()`, no-ops without `?dev`) — resource-clearing buttons,
live camera sliders, a live render-stats readout (`triangles`/`drawCalls`/`meshCount`
from `SetupThree.renderer.info` vs. a full scene traversal — useful for spotting
frustum-culling mismatches caused by `BendService`'s vertex bend happening *after* THREE
already decided visibility from the un-bent bounding sphere), and every
`PerformanceConfig` knob (see below).

## World / terrain — `game/world/`

The ground truth for the map is a **Tiled** (mapeditor.org) export:
`raw-assets/json/map/testMap1.json` + its tile lookup `map/tiles.json`. Both are
preloaded PIXI assets, read synchronously via `loadTiledMap()`/`loadTileDefs()`.

- **`TileMapConfig.ts`** — all the Tiled-parsing primitives: `iterateLayerCells()`
  (handles both bounded and Tiled's "infinite" chunked export uniformly, always
  yielding absolute col/row), `tileCellToWorldPosition()` (col/row → world XZ,
  deliberately uncentered — tile (0,0) is world origin), and the `objectgroup`-layer
  equivalents `TiledObject`/`getObjectProperty()`/`objectToWorldRect()` for the
  `"mapSettings"` layer (see World Objects below).
- **`TileMap.ts`** — paints `groundLayer` as one `InstancedMesh` (one draw call
  regardless of map size) tinted from `tiles.json`'s per-tile color. Also keeps a
  `col/row → TileDef` lookup (`getGroundCells()`/`getGroundDefAt()`) that survives
  even when the mesh itself is hidden (`build(paintVisible=false)`) — this is what
  lets `IslandMeshBuilder` and `TileWalkability` both work off the same parsed data
  without re-parsing Tiled.
- **`TileWalkability.ts`** — a bare optional module-level slot (`setWalkabilityQuery`/
  `isWalkable`), fail-open (`true`) when nothing has published a query. `TileMap.build()`
  publishes; `PlayerMovementController.fixedUpdate()` checks it per-axis before applying
  velocity (so diagonal movement slides along a shoreline instead of stopping dead), so a
  game with no tile map at all still moves normally — nothing hard-depends on this.
  Non-walkable tile names live in `NON_WALKABLE_GROUND_TILES` (currently `water`, `lava`).
- **`IslandMeshBuilder.ts`** — the current default visual (`WorldManager.buildGround()`'s
  `USE_ISLAND_MESH` flag): flood-fills `TileMap.getGroundCells()` into per-tile-name
  connected blobs, builds each via `ClusterMeshBuilder` (ported from `games/clog` —
  voxel-blob geometry with optional rounded outer corners), merges same-name blobs into
  one mesh, and builds a single animated water plane (`WaterMaterial.ts`, also ported
  from clog) sized to the painted area, deriving its 4-tone palette from the map's own
  `water` tile color (`IslandStorage.deriveWaterTones()`). Per-tile-name
  height/depth/radius/fade live in `MeshConfig.ts`'s `ISLAND_TILE_DEFS`/
  `ISLAND_DEFAULT_TILE` — island tops currently sit at `height: 0` (flush with the rest
  of the world), water surface at `elevation: -0.5`.
- **`WorldObjectRegistry.ts`** — reads the Tiled map's `"mapSettings"` **object** layer
  (rects drawn anywhere in Tiled, independent of the tile grid) and buckets them by a
  `"type"` custom property (e.g. `"building"`, `"gate"`), keyed within that bucket by an
  `"id"` custom property (e.g. `"camp"`, `"gate1"`) — **not** the object's own
  name/type fields, which Tiled leaves blank in this project's exports. Converts each
  rect's pixel position *and* width/height to world units/footprint
  (`objectToWorldRect()` — Tiled has no 3rd dimension, so only X/Z come from this; mesh
  height still comes from game config). `require(type, id, fallback)` warns and falls
  back if a spawner asks for an id that isn't on the map; the constructor logs every
  object it finds unconditionally (not just `?dev`) — check the console first if a
  building/gate isn't showing up where expected.
- **`WorldManager.ts`** — owns the ground + every resource node's streaming
  materialize/dematerialize state (see Resources below). `buildGround()` builds the
  physics floor slab, `TileMap`, and (if `USE_ISLAND_MESH`) `IslandMeshBuilder`.
- **`Gate.ts` / `GateManager.ts`** — a solid obstacle that physically blocks progress
  until a building reaches a required level (`GateTypes.ts`'s `GateRequirement`).
  `GateManager` is the sole authority on *when* to check/unlock a gate (serialized after
  the triggering building's own camera sequence, never concurrently) — see
  `WorldProgressionHost` below for why.
- **`AssetLibraryRegistry.ts`** — catalog of spawnable visual assets (models + scale/
  rotation ranges) keyed by a plain string id, separate from `ResourceType` (that
  mapping is `ResourceRegistry.ts`'s `RESOURCE_ASSET_KEYS`). An empty `models` list means
  "no glb yet" — callers fall back to a colored box primitive.

## Performance — `game/config/PerformanceConfig.ts`

One mutable object collecting every "how far/how much renders" knob, live-editable via
the dev GUI's "Performance" folder (`?dev`):

| Field | Effect |
|---|---|
| `cameraFar` | THREE camera far clip plane |
| `resourceLoadRadius` / `resourceUnloadRadius` | distance a resource node materializes/stays materialized at (hysteresis gap between the two prevents load/unload flapping at the boundary) |
| `resourcePopInSec` / `resourcePopOutSec` | scale-in/out tween duration on materialize/dematerialize (0 = old instant snap) |

Everything reads this object fresh every frame/call (no cached squared constants) so a
slider drag takes effect immediately.

## Resources — `game/player/ResourceNode.ts`, `game/world/WorldManager.ts`

`WorldManager.update(playerPosition, delta)` streams `ResourceNode` entities in/out by
distance (`PERFORMANCE_CONFIG.resourceLoadRadius/UnloadRadius`) — an out-of-range
resource still ticks its respawn timer via a lightweight `ResourceRecord`, so walking
away mid-respawn and coming back finds it grown back on schedule, not frozen.
`materialize()`/`dematerialize()` call `ResourceNode.playSpawnIn()`/`playDespawnOut()`
(gsap scale tween) instead of an instant pop. Resource spawn positions normally come
from the Tiled map's `resourcesLayer` (`TileMapConfig.buildResourceSpawnsFromTileMap()`)
— procedural spawning (`WorldConfig.generateProceduralResourceSpawns()`) exists as an
alternative but isn't the default path.

## Player & actions — `game/player/MainPlayer.ts`, `game/components/`

`MainPlayer` self-configures in `awake()` (`RigidBody`, `PlayerMovementController`,
`FacingComponent`, `PlayerActionController`, `AutoGatherController`) — movement/physics
work from the first frame, independent of the FBX character load
(`loadCharacter()`, separate/async/purely cosmetic).

- **`PlayerMovementController`** — reads keyboard/analog/pointer input, writes
  `RigidBody.velocity` in `fixedUpdate()`, checking `TileWalkability.isWalkable()` per
  axis first.
- **`PlayerActionController`** — the repeated-hit action loop against an `ActionTarget`
  (`ResourceNode` implements this: `position`, `applyHit(damage): boolean`,
  `onHit?()`). `onPlayActionAnimation(action, target, onHit?)` is the entry point;
  throws synchronously if already busy. Does not freeze movement — walking away is the
  cancel gesture.
- **`AutoGatherController`** — the actual "no interaction required" layer: tracks every
  `ResourceNode` currently overlapped (`Layers.Resource` trigger), auto-starts
  `PlayerActionController` on the first one, credits `BackpackStorage` + spawns a flying
  chip visual per landed hit, picks the next target on completion/cancellation/new
  overlap.

## Buildings & progression — `game/player/BuildingZone.ts`, `game/data/`

`BuildingTypes.ts`/`GateTypes.ts` are pure data (no engine imports) — an upgrade ladder
per building id (`BUILDING_CONFIG`), a requirement + placeholder mesh per gate id
(`GATE_CONFIG`). `BuildingZone` is a trigger that drains `BackpackStorage` into
`BuildingStorage.addProgress()` per-unit (staggered flying-chip visual), triggers
`playLevelUpSequence()` on level clear — camera travel via `CameraFocusHost`, mesh
swap+drop-in, THEN `WorldProgressionHost.notifyBuildingLevelUp()` (deliberately
sequential, not concurrent, so a chained gate-unlock camera trip never races the
building's own). Both `BuildingZone`'s visible mesh AND its trigger hitbox can take an
optional `footprint: {width, depth}` override (from `WorldObjectRegistry`) so a
Tiled-authored rect actually matches what you see/can walk into — height (Y) always
still comes from the level's own `BuildingMeshConfig`, since Tiled has no 3rd dimension.

**Persisted state** — `BackpackStorage` (carried, not yet deposited) and
`GlobalResourceStorage` (permanently banked), both static classes backed by
`PlatformHandler`'s `getItem`/`setItem` (not raw `localStorage`), each firing an
`onChange: Signal<ResourceType>` the matching HUD panel subscribes to.
`BuildingStorage`/`GateStorage` persist upgrade/unlock state the same way.

## ECS — `game/ecs/`

`Entity` = a `THREE.Group` transform + a `Component[]`. `World.spawn()` hands out a
pooled generic entity; `World.add(entity)` adopts an already-constructed subclass
instance (`MainPlayer`, `ResourceNode`, ...) — either way `awake()` fires immediately.
Component order: `awake()` (siblings may not exist yet) → `start()` (once, right before
first tick, siblings guaranteed) → `fixedUpdate(delta)` (physics-rate, only while
`enabled`) → `update(delta)` (render-rate, only while `enabled`) → `destroy()`.
`World.fixedUpdate()` runs every entity's `fixedUpdate()` *then* steps physics, so
whatever velocity gets set this tick is exactly what integrates this tick.

## Physics — `game/physics/`

Deliberately not a real simulation: kinematic-only AABB collide-and-slide (no mass, no
impulses, no rotation), documented explicitly as such in `PhysicsConstants.ts`. `Layers`
is a bitmask (`Default`/`Player`/`Environment`/`Trigger`/`Resource`); a pair only
interacts if each side's `mask` includes the other's `layer`. `isTrigger=true` bodies
are never physically resolved — they only fire `onTriggerEnter/Stay/Exit`; solid pairs
get both physical push-out AND `onCollisionEnter/Stay/Exit`.

## Rendering helpers

- **`BendService.ts`** — the shared vertex-shader "world curves away from the player"
  effect. `applyBend(material)` is idempotent (safe to call repeatedly on a shared
  material). `applyBottomFade`/`applyDistanceFade` fade a material's alpha by world-Y or
  by XZ distance from the bend origin.
- **`builders/ClusterMeshBuilder.ts`, `builders/WaterMaterial.ts`** — ported from
  `games/clog`, used by `IslandMeshBuilder`. If clog's terrain/water system changes,
  these are independent copies, not shared — resync manually if needed.

## Where to look first when extending

- **New ground tile type** → add to `map/tiles.json`'s `grounds[]`, paint it in Tiled.
  Walkability: add to `NON_WALKABLE_GROUND_TILES` (`TileMapConfig.ts`) if it should block
  movement. Island look: add an entry to `ISLAND_TILE_DEFS` (`MeshConfig.ts`) if it
  should look different from `ISLAND_DEFAULT_TILE`.
- **New building/gate placement** → draw a rect on Tiled's `"mapSettings"` layer with
  `type`/`id` custom properties, matching a `BuildingId`/`GateId` enum value. Check the
  console log from `WorldObjectRegistry`'s constructor to confirm it was found.
- **New resource type** → `ResourceTypes.ts` (`RESOURCE_CONFIG`) + `ResourceRegistry.ts`
  (`RESOURCE_ASSET_KEYS`) + an `AssetLibraryRegistry.ts` entry (or leave `models: []` for
  a placeholder box).
- **Tuning render distance/pop-in** → `PerformanceConfig.ts`, live via the dev GUI.
- **New camera behavior** → `CAMERA_SETTINGS`/`cameraOffset()`/`cameraUpVector()` in
  `PizzaScene.ts`. Remember `cameraUpVector()` exists specifically because `lookAt()`
  breaks down at `pitch=90` — don't reintroduce a raw `lookAt()` without it if pitch can
  reach vertical.
