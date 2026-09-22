# Pizza

A mobile-first hybrid casual game with **almost only one input: movement**. The player
walks near resources to auto-gather them, walks into zones to auto-deposit/auto-upgrade,
and walks toward gates that unlock as buildings level up. Movement + one camera toggle
covers most of the game; farming (see Farming below) is the one system that now asks for
deliberate taps (pick a seed, tap Collect) — a real exception to the original
movement-only pitch, not yet reconciled in this framing.

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
then sequentially loads every persisted-data store *before* any asset loads —
`ShopStorage`, `HighScoreStorage`, `GlobalResourceStorage`, `BackpackStorage`,
`BuildingStorage`, `GateStorage`, `EconomyStorage`, `QueueStorage`, `ShopUpgradeStorage`,
`ItemStorage`, `CraftStorage`, `DynamicResourceStorage`, `ShapeResourceStorage`,
`FarmPlotStorage`, `FarmCropStorage`, `SeedStorage`, `BackpackUnlockStorage`,
`CurrencyUnlockStorage`, `AnimalFollowStorage`, `PlayerPositionStorage`,
`TutorialProgressStorage`, `TriggerStorage`, `Localization`. `loadAssets()` then loads
three PIXI bundles in order — `json` (also triggers `loadShopItems()`/`loadIslands()`),
`fonts`, `images` — each patched to `pizza/<kind>/` via `ManifestHelper.patchPaths()`.
`startGame()` calls `applyDebugPhysicsCookie()` (dev-mode-only, see Debug cookies below —
must run before any entity's `RigidBody.awake()`, which reads the debug flags once at
construction), initializes `DevGuiManager` (gated on `?dev` — see `Game.debugParams`),
registers and switches to `PizzaScene`.

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

**VFX driver** — `ParticleSystem.init(scene)` is called once from `build()`,
`ParticleSystem.update(delta)` every frame from `update()` (see Particle VFX below).
`PizzaScene` itself never spawns an effect directly — entities do, via
`ParticleEmitterComponent`/`ParticleBurstOnDestroyComponent` or a direct
`ParticleSystem.burst()` call.

**Dev GUI** (`setupDebugGui()`, no-ops without `?dev`) — resource-clearing buttons,
live camera sliders, a live render-stats readout (`triangles`/`drawCalls`/`meshCount`
from `SetupThree.renderer.info` vs. a full scene traversal — useful for spotting
frustum-culling mismatches caused by `BendService`'s vertex bend happening *after* THREE
already decided visibility from the un-bent bounding sphere), every `PerformanceConfig`
knob (see below), an `Upgrades` folder — one force-upgrade button per shop (fully
funds + completes the next level in one click, firing the same notification the real
coin-drain flow does — see Tools & shop upgrades / Notifications below) plus a live
per-tool readout of `hitIntervalSec`/`hitScale`/`yieldPerHit` — and debug buttons to add
seeds (`SeedStorage.add`, currently the ONLY way to acquire seeds — see Farming below)
and to reveal zones ahead of schedule (`WorldManager.revealNextZone()`/
`revealUpToZone()`, persisted via `DebugZoneRevealCookie` — see Zone locking below).

## World / terrain — `game/world/`

The ground truth for the map is a **Tiled** (mapeditor.org) export:
`raw-assets/json/map/testMap1.json` + its tile lookup `map/tiles.json`. Both are
preloaded PIXI assets, read synchronously via `loadTiledMap()`/`loadTileDefs()`.

- **`TileMapConfig.ts`** — all the Tiled-parsing primitives: `iterateLayerCells()`
  (handles both bounded and Tiled's "infinite" chunked export uniformly, always
  yielding absolute col/row), `tileCellToWorldPosition()` (col/row → world XZ,
  deliberately uncentered — tile (0,0) is world origin), and the `objectgroup`-layer
  equivalents `TiledObject`/`getObjectProperty()`/`objectToWorldRect()` for the
  `"mapSettings"` layer (see World Objects below). `objectToWorldRect()` now handles
  rotation-around-origin for BOTH a plain rect (top-left anchor) and a Tiled tile-object
  placement (bottom-left anchor, identified by `TiledObject.gid`) — rotating an object in
  Tiled swings its footprint around that corner, not its center, so the true center has
  to be re-derived before it's rotated. A `TileDef` can now carry `providerType`
  (resources layer — which `ProviderType` a painted cell spawns, settable from the pizza
  web editor's Map tab, overriding the old hardcoded name→type lookup — see World /
  Resources below for why resources are dispensed by *providers* now, not raw
  `ResourceType`s), `walkable` (grounds — overrides `NON_WALKABLE_GROUND_TILES`), and
  `transparent` (grounds — paints nothing at all, a real hole revealing whatever's
  beneath, while still counting for walkability). `findTilesetOwningGid()` /
  `getTiledTileBooleanProperty()`/`getTiledTileNumberProperty()` read custom properties
  off the TILE DEFINITION itself (e.g. `solid`, `offsetY`) rather than one placement of
  it. `ZONE_LAYER_NAME` (`"zones"`) + `buildZoneTileCells()` reads a dedicated painted
  layer where a cell's local tile id IS the zone number (0-based) — feeds the zone-lock
  system (see Zone locking below). `resolveTiledTileImageName()` resolves any gid to its
  image-collection tileset entry's basename, feeding `MeshLayerSpawner`'s snapshot-decode
  pipeline (see below).
- **`TileMap.ts`** — paints every layer whose name CONTAINS `"groundLayer"` (see
  `findLayers()`/`GROUND_LAYER_NAME`, not just an exact match — lets a map stack
  decorative variants like `groundLayer2`) as its own `InstancedMesh` (one draw call per
  matched layer regardless of map size), tinted from `tiles.json`'s per-tile color. A
  layer beyond the first sits `GROUND_LAYER_Y_STEP` (0.05) higher than the one before it.
  Keeps two separate lookups: `cellDefs` (`getGroundDefAt()`/`isWalkableAt()`) is ALWAYS
  merged across every matched layer, topmost wins per cell, so an overlay tile's
  walkability always takes priority; `layerCellLists` (`getGroundCellLayers()`) keeps
  each layer's cells SEPARATE, feeding `IslandMeshBuilder` one layer at a time so an
  overlay never reshapes the base layer's blob. Both survive even when the meshes
  themselves are hidden (`build(paintVisible=false)`) — this is what lets
  `IslandMeshBuilder` and `TileWalkability` both work off the same parsed data without
  re-parsing Tiled.
- **`TileWalkability.ts`** — a bare optional module-level slot (`setWalkabilityQuery`/
  `isWalkable`), fail-open (`true`) when nothing has published a query. `TileMap.build()`
  publishes; `PlayerMovementController.fixedUpdate()` checks it per-axis before applying
  velocity (so diagonal movement slides along a shoreline instead of stopping dead), so a
  game with no tile map at all still moves normally — nothing hard-depends on this.
  Non-walkable tile names live in `NON_WALKABLE_GROUND_TILES` (currently `water`, `lava`).
  `isWalkableAt()` ALSO calls `ZoneVisibilityManager.isPositionUnlocked()` — a locked or
  zoneless cell is never walkable regardless of its own tile def (see Zone locking below).
- **`IslandMeshBuilder.ts`** — the current default visual (`WorldManager.buildGround()`'s
  `USE_ISLAND_MESH` flag): reads `TileMap.getGroundCellLayers()` and, for EACH matched
  ground layer independently, flood-fills its cells into per-tile-name connected blobs,
  builds each via `ClusterMeshBuilder` (ported from `games/clog` — voxel-blob geometry
  with optional rounded outer corners), merges same-name blobs into one mesh per layer
  (lifted `layerIndex * GROUND_LAYER_Y_STEP` above the base, same offset `TileMap`'s own
  flat paint uses), and builds a single animated water plane (`WaterMaterial.ts`, also
  ported from clog) sized off the BASE layer only, deriving its 4-tone palette from the
  map's own `water` tile color (`IslandStorage.deriveWaterTones()`). Per-tile-name
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
  building/gate isn't showing up where expected. Several more object kinds now read off
  the same layer, each with its own bucket:
  - **`dropper`** — a second rect naming a `"target"` (not `"id"`) that stands in for
    another entity's deposit-trigger footprint; `getDropperFor(targetId)` — used by
    `GateDropZone` (see Buildings & progression below).
  - **`playerStart`** — a bare point with only `id: "playerStart"`, no `type`;
    special-cased before the type/id bucketing; `getPlayerStart()`.
  - **`spawner`** — an AREA (rect/ellipse/polygon, whichever Tiled tool drew it) captured
    as a `SpawnerShape` (`kind: 'polygon'|'circle'|'rect'`), collected *plural* per id in
    `shapesById` (unlike every other bucketed type, which keeps only the last — an id can
    label several drawn areas at once). Exposes `isPointInShape()`, `shapeArea()`
    (shoelace formula for polygons), and `sampleRandomPointInShape()` (rejection
    sampling) as free functions — consumed by `ShapeResourceSpawner.ts`/`AnimalNode.ts`
    (see Resources below).
  - **`waypoint`** — a point keyed by `"target"`+`"order"` (not `"id"`), collected into
    `waypointsByTarget`, sorted ascending once at construction; `getWaypoints(target)` —
    the one reader is `QuestGiverEntity` walking a queue's giver in/out (see Queues
    below).
  - **`useOwnMesh`** (bool custom property on any bucketed object, e.g. `building`) opts
    that object into resolving its own dragged-on Tiled image as a real model via
    `MeshLayerSpawner.decodeObjectModel()` — collected plural in `ownMeshesByKey`
    (`"type:id"` → `OwnMeshPlacement[]`, each carrying its own `x`/`z`/`width`/`depth`/
    `solid`), so a composite building made of several `mapSettings` pieces sharing one id
    can each resolve/place their own mesh. `OWN_MESH_SOLID_PROPERTY` (`"solid"`, 0-1
    fraction) lets individual pieces opt into colliders.
  - `getAllOfType(type)` — returns every id→placement for a type with no fixed enum
    (queues, shops, triggers) — "whatever's drawn on the map is the source of truth."
- **`MeshLayerSpawner.ts`** — reads the Tiled `"meshes"` objectgroup layer
  (`MESH_LAYER_NAME`), where a level designer drags a `ModelSnapshotTool`-rendered PNG
  placeholder into place. `decodeObjectModel()` decodes the placed image's filename back
  to a `MODELS` registry ref via `ModelSnapshotTool.decodeModelRef()`, handling Tiled's
  bottom-left tile-object rotation-around-origin math (same routine `WorldObjectRegistry`'s
  `useOwnMesh` handling reuses, just off a different source layer). `getMeshPlacements()`
  returns every placement's world x/z, `rotationY` (sign-flipped from Tiled's clockwise
  degrees to THREE's), `worldWidth`/`worldDepth` (the placeholder's CURRENT resized
  footprint, not native scale, so stretching the placeholder in Tiled actually reaches the
  real model), `solid` (from `SOLID_PROPERTY`, checked on the placed object OR the tile
  definition), and `offsetX/Y/Z` nudges. `PizzaScene.setupMeshLayer()` iterates these,
  spawns a real `GlbVisualComponent` per placement, applies rotation AFTER measuring the
  un-rotated bounding box (so width/depth scaling matches Tiled's axes), and adds a static
  solid `RigidBody` when `placement.solid` is set.
- **`EntityViewRegistry.ts`** — id-keyed real-mesh overrides for buildings/shops/gates/
  queues (`ENTITY_VIEW_CONFIG`, set from the pizza web editor's "Entity Views" tab), same
  shape as `AssetLibraryRegistry` (`models`/`scale`/`rotationDeg`, plus a local
  `offset: [x,y,z]`). `BuildingTypes.ts`/`ShopTypes.ts`/`GateTypes.ts`/`QueueTypes.ts`
  each still own a placeholder-box default; a config entry that also sets a `view` id
  swaps the box for a real glb. `resolveEntityView(id)` returns `undefined` (caller falls
  back to its own placeholder) if the id is missing or has an empty `models` list.
  Consumed by `Gate.awake()` (see Buildings & progression below) and
  `BuildingZone.createBuildingMesh()`.
- **`WorldManager.ts`** — owns the ground + every resource node's streaming
  materialize/dematerialize state (see Resources below), and constructs the zone-lock/
  fog-of-war system (see Zone locking below). `buildGround()` builds the physics floor
  slab, `TileMap`, and (if `USE_ISLAND_MESH`) `IslandMeshBuilder`. `materialize()` now
  no-ops entirely if the target position's zone is still locked — checked BEFORE creating
  the node, not after, so a hidden-but-locked node never has a live gather trigger.
- **`Gate.ts` / `RequirementRegistry.ts`** — a solid obstacle that physically blocks
  progress until some milestone happens (a building level, an owned item, a held resource
  amount, or a walked-through trigger — see `MilestoneRequirement.ts`, extended below).
  `RequirementRegistry` is the sole authority on *when* to check/unlock a gate (serialized
  after the triggering milestone's own camera sequence, never concurrently) — see
  `WorldProgressionHost` below for why. The same registry also spawns queues/shops/
  buildings/farms once their own `appearRequirement` is met. See Buildings & progression
  below for how much this file has grown (real mesh, icon HUD, resource-drop-zone
  requirement, choreographed unlock sequence).
- **`AssetLibraryRegistry.ts`** — catalog of spawnable visual assets (models + scale/
  rotation ranges) keyed by a plain string id. Shared by two different readers:
  `ResourceRegistry.ts`'s `resolveResourceAssetKey()` (banked item → asset, for icons)
  and `ProviderRegistry.ts`'s `resolveProviderAssetKey()` (world dispenser → asset, for
  the actual placed node) — plus any bare decorative-prop scatterer that reads
  `ASSET_LIBRARY` directly. An empty `models` list means "no glb yet" — callers fall back
  to a colored box primitive; `getAssetIcon(key)` warns-and-falls-back-to-
  `PIXI.Texture.WHITE` for an unrecognized key, defensive against a stale saved key
  outliving a rename. Now ~45+ entries, including full farm-crop coverage (`beet`,
  `carrot`, `pumpkin`, ...) plus matching `*Seed` icon-only entries (seeds never get
  `models` — inventory-only); mining/ore doubled up as bare resource (`iron`, `gold`, ...
  — icon-only, banked-item look) vs. `*Deposit` (`ironDeposit`, `goldDeposit`, ... — real
  world-node glbs); and a deliberate `berries` (item icon) vs `berryBush` (the provider's
  own world appearance) split, replacing an earlier conflated entry.
- **`WorldSpawner.ts`** — finds every tilelayer whose name CONTAINS `"spawnerLayer"` (same
  substring-match convention as `TileMap`'s `"groundLayer"`, so multiple spawner layers
  can coexist and are never merged) and flood-fills each one's painted cells into
  per-tile-name connected clusters (4-directional adjacency only — a diagonal touch
  doesn't count as connected). A cluster's `type` is the resolved tile name (e.g.
  `"grass"`, `"sand"`), not the raw gid — resolved via the same
  `getTilesetFirstGids()`/`resolveGroundDef()`/`resolveResourceDef()` lookup
  `buildResourceSpawnsFromTileMap()` uses. `getLayers()` feeds `DynamicResourceSpawner.ts`
  (see Resources below).
- **`Trigger.ts`** — the runtime entity for a `"trigger"`-type `mapSettings` object: a
  trigger-only `RigidBody` (`DottedZoneVisualComponent` outline, no deposit/drain
  behavior) that fires `onActivated()` once `MainPlayer` enters, and either self-destroys
  (`destroyOnTrigger`) or re-arms for repeat entry. `PizzaScene.setupTriggers()` (from
  `worldObjects.getAllOfType('trigger')`) wires `onActivated` to
  `TriggerStorage.activate(id)` then `requirementRegistry.recheckAll()` — this is what
  backs the new `'trigger'` arm of `MilestoneRequirement` (a zone or gate can now be gated
  on "player walked through trigger X," not just building/item/resource), consumed
  identically by `WorldManager.checkZoneRequirements()`. A `Trigger` also registers its
  own transform with `ZoneVisibilityManager` like any other placed entity, so its
  visibility is zone-gated the same way — but it is not itself a zone-*reveal* trigger,
  just another zone-gated placed object that happens to fire a callback.

## Zone locking, fog of war & reveal — `game/world/`

Separate from Gate (a single obstacle blocking one path) is a coarser, always-on system
that locks out entire regions of the map until progression reaches them:

- **`ZoneVisibilityManager.ts`** — the zone-lock AUTHORITY, constructed once by
  `WorldManager` regardless of which fog visual is in use, exposed via
  `WorldManager.getZoneVisibilityManager()`. Callers register any placed object via
  `register(object, worldX, worldZ, width?, depth?, categoryDelaySec?)` or
  `registerWithZones(...)` (for a caller that already knows its own zone set, e.g.
  `IslandMeshBuilder`) — `PizzaScene.registerZoneVisibility()` wraps this and is called
  for every building/shop/queue/gate/mart/farm-tile/trigger it places. It enforces two
  invariants no visual style may violate: (1) a locked or zoneless cell is never walkable
  — `TileMap.isWalkableAt()` calls `isPositionUnlocked()`; (2) a locked resource/animal is
  never materialized — `DynamicResourceSpawner`/`ShapeResourceSpawner`/`WorldManager` all
  gate `materialize()` on it rather than spawning-then-hiding. `revealZone(zoneNumber,
  origin?)` is idempotent, flips visibility for every registrant touching that zone (per
  `resolveVisible()`'s `'any'`/`'all'` overlap mode), and — given an `origin` (the
  player's position at unlock time) — plays a shockwave: each newly-visible registrant
  rises from `baseY - ZONE_REVEAL_CONFIG.riseDistance` via a gsap tween delayed by
  `distance(origin)/waveSpeed + categoryDelaySec` (terrain=0, props=0.35,
  creatures=0.7, so ground settles before objects before NPCs/animals). A *late*
  registration (e.g. a resource that only materializes frames after its zone unlocks)
  still echoes the same wave within `ZONE_REVEAL_CONFIG.revealEchoWindowMs` (20s) via
  `findEchoOrigin()`/`revealRecords`, instead of popping in instantly.
- **`FogOfWarConfig.ts` / `FogOfWarManager.ts`** — a purely COSMETIC choice of how a
  locked zone LOOKS, switched by `FOG_OF_WAR_CONFIG.style`: `HideEntities` (nothing
  renders at all — current default) or `BoxCloud` (opaque `InstancedMesh` box volumes
  over every unfogged land cell, with real geometry still rendering underneath —
  `FogOfWarManager.build(tileMap)` only runs for this style, classifying each ground cell
  land/water and indexing zone-tagged cells from `TileMapConfig.buildZoneTileCells()` so
  `revealZone()` can collapse that zone's box instances to zero scale; a land cell with no
  zone painted is built once and can never be revealed). Neither style gates walkability
  or spawning — that's always `ZoneVisibilityManager`'s job.
- **`ZoneRevealEffect.ts`** — the decorative twin of the shockwave:
  `playZoneRevealShockwave(scene, origin)` spawns a self-disposing expanding ring mesh at
  the same `waveSpeed` `ZoneVisibilityManager` uses for its rise-delay math; nothing
  functional depends on it.
- **`WorldManager.checkZoneRequirements()`** — polled every `update()` tick, checks every
  `ZONE_CONFIG` entry with a `requirement` (a `MilestoneRequirement`, including the
  `'trigger'` kind above) and reveals it via `revealZoneWithEffect()` (drives
  `ZoneRevealEffect` + fires `onZoneRevealed: Signal`, which `PizzaScene` uses to briefly
  freeze player movement so the reveal animation actually reads). `buildGround()` reveals
  zone 0 unconditionally at boot, then replays `DebugZoneRevealCookie`'s persisted
  `nextZoneToReveal` to catch a reloaded session back up to wherever debug testing had it.
  `revealNextZone()`/`revealUpToZone()` are debug/test-only zone unlocks that bypass
  `ZONE_CONFIG` entirely, gated behind `?dev` in the dev GUI.

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

## Resources — `game/player/ResourceNode.ts`, `game/actions/ProviderTypes.ts`, `game/world/WorldManager.ts`

`WorldManager.update(playerPosition, delta)` streams `ResourceNode` entities in/out by
distance (`PERFORMANCE_CONFIG.resourceLoadRadius/UnloadRadius`, and now also gated on
`ZoneVisibilityManager.isPositionUnlocked()` — see Zone locking above) — an out-of-range
resource still ticks its respawn timer via a lightweight `ResourceRecord`, so walking
away mid-respawn and coming back finds it grown back on schedule, not frozen.
`materialize()`/`dematerialize()` call `ResourceNode.playSpawnIn()`/`playDespawnOut()`
(gsap scale tween) instead of an instant pop. Resource spawn positions normally come
from the Tiled map's `resourcesLayer` (`TileMapConfig.buildResourceSpawnsFromTileMap()`)
— procedural spawning (`WorldConfig.generateProceduralResourceSpawns()`) exists as an
alternative but isn't the default path.

**Providers vs. resource types.** `ProviderTypes.ts` splits what used to be one conflated
`ResourceType` enum into two: a **provider** (`ProviderType` — `Tree`, `BerryBush`,
`StoneDeposit`, `IronDeposit`, ...) is the world dispenser the player actually swings/
mines/forages at, with its own `action`/`maxLife`/`respawnSec`/`label`/`color`/
`solidRadius` in `PROVIDER_CONFIG`; a **resource type** (`ResourceType` — `Wood`, `Stone`,
`Berries`, `Iron`, and the farm crops, see Farming below) is the actual bankable
`BackpackStorage` item. A provider yields resources via a weighted `ResourceDropEntry[]`
drop table (`rollProviderDrop()`), so the same provider can drop more than one resource
type (a stone deposit mostly dropping `Stone`, sometimes `Pebble`) and a resource type
can come from more than one provider — decoupling that a flat "hit tree, bank tree" enum
couldn't express. `ResourceNode` is now constructed as
`new ResourceNode(ProviderType.Tree, position)`, keyed and configured by `ProviderType`/
`PROVIDER_CONFIG` throughout (`this.providerType`, `PROVIDER_CONFIG[this.providerType]`
for `maxLife`/`respawnSec`/particle config), harvested via `PlayerActionController`'s
multi-swing action loop (see Player & actions below). A provider's world appearance still
resolves through `AssetLibraryRegistry.ts` via `ProviderRegistry.ts`'s
`resolveProviderAssetKey()`, the provider-side parallel to `ResourceRegistry.ts`'s
`resolveResourceAssetKey()` for banked items.

**Three ways a resource-yielding thing ends up in the world**, each independent and
composable on the same map:

1. **Map-painted providers** — hand-placed on the Tiled `resourcesLayer`, one `ResourceNode`
   per painted cell, full action/life/respawn cycle (above).
2. **`DynamicResourceSpawner.ts` / `DynamicResourceTypes.ts` / `DynamicResourceStorage.ts`
   / `game/player/LooseResourceNode.ts`** — loose ground loot (`Bark`, `Pebble`,
   `GrassFiber`) that comes and goes dynamically instead of sitting at fixed positions. A
   `DynamicResourcePlacement` is one `(resourceType, spawnerTileType)` pair with its own
   `density` (target instances per eligible `WorldSpawner` cell WITHIN
   `PERFORMANCE_CONFIG.resourceLoadRadius` of the player — a rate, not a flat world
   count), `minDistance`, and `checkIntervalSec` — the same resource type can have a
   different density on different terrain via two separate placements.
   `DynamicResourceSpawner.update(playerPosition, delta)` streams materialize/dematerialize
   by the SAME load/unload radius `WorldManager` uses, and periodically tops up each
   placement's nearby instance count toward its density target (skipping any candidate
   inside a locked zone or a farm plot footprint — see Zone locking / Farming). Only
   `(col, row)` cells are persisted (`DynamicResourceStorage`), keyed by `placementKey()`
   (`"resourceType:spawnerTileType"`) — not live entities — so a walked-away area's loot
   survives a reload without precomputing anything for parts of the map nobody's near.
   `LooseResourceNode` is a plain `Entity` (NOT a `ResourceNode` subclass, no
   `PlayerActionController` channel at all) picked up instantly on player contact — no
   gather animation, no tool requirement.
3. **`ShapeResourceSpawner.ts` / `ShapeResourceStorage.ts` / `ShapeResourceTypes.ts`** — a
   THIRD placement mechanism, not a third pickup mechanism: it scatters things inside a
   hand-drawn freehand AREA (a `"spawner"`-type object on `mapSettings`,
   `WorldObjectRegistry.getShapes(shapeId)`, sampled via `sampleRandomPointInShape()`)
   instead of a tile cluster or a hand-painted map layer, and reuses the SAME node types
   rather than inventing a new one. Each `ShapeResourcePlacement`'s `spawnType` picks
   which: `'resource'` (default) → plain `LooseResourceNode` pickup; `'provider'` → a real
   `ResourceNode` (tree/deposit/bush — same action/life/respawn mechanics as one
   hand-painted on `resourcesLayer`) scattered across the shape instead of hard-placed at
   a fixed spot; `'animal'` → a wandering `AnimalNode` that must be *caught* (a continuous
   on-presence timer, `AnimalCatchController`, optionally gated on owning an item) rather
   than walked over — genuinely new gameplay the other two systems don't have. Budget is
   `count` (a flat target for the WHOLE shape) or, if `density > 0`, an area-derived target
   (`shapeArea / WORLD_UNITS_PER_TILE² * density`) checked against the placement's TOTAL
   record count — unlike `DynamicResourceSpawner`'s proximity-scoped density, because a
   drawn shape is small and fixed-size. One `shapeId` can match multiple drawn shape
   instances (e.g. "treeSpawner" drawn in five clearings); `ShapeResourceSpawner`'s
   constructor gives each its own independent `ShapeResourceState` (own record list, own
   countdown) so clearings don't share a spawn budget. `ShapeResourceStorage` persists raw
   world-space `(x, z)` points per placement key (not tile col/row), same static-class +
   `PlatformHandler` pattern as `DynamicResourceStorage`. An animal's `position` is frozen
   at spawn time — a dematerialized, wandered-off `AnimalNode` snaps back to its ORIGINAL
   spot on re-approach, an accepted limitation documented in `dematerialize()`.

## Farming — `game/world/Farm*.ts`, `game/data/Farm*.ts`, `CropTypes.ts`, `SeedTypes.ts`, `SeedStorage.ts`

A second, independent progression loop layered onto the base gather/deposit game — the
one place the game currently asks for deliberate taps rather than pure movement (see the
intro caveat above).

A farm PLOT is a `"farm"`-typed object on the Tiled `mapSettings` layer, configured via
`FarmTypes.ts`'s `FarmPlotConfig` (`price`, optional `appearRequirement`, optional
`allowedCrops`, optional `solid`) — `getFarmPlotConfig(id)` falls back to
`DEFAULT_FARM_PLOT_CONFIG` for any plot not explicitly listed, so every discovered plot
is always valid. `PizzaScene.setupFarms()` registers one `RequirementRegistry` spawn gate
per plot; on trigger it branches on `FarmPlotStorage.isOwned(id)` — an already-owned plot
(from a previous session) skips straight to `spawnFarmGrid()`, an unowned one spawns
`FarmZone`. `FarmGrid.computeFarmGrid(width, depth)` is the shared geometry step both the
pre-purchase preview and the post-purchase grid build off, turning a plot's Tiled
footprint into row-major `FarmGridCell[]` sized to `WORLD_UNITS_PER_TILE`, so the two
states always agree on layout.

**Buying** — `FarmZone` (one whole-area trigger + `DottedZoneVisualComponent` + price/
progress popup) is the "for sale" state. Purchase is a gradual deposit, not a lump sum:
coins fly from `EconomyUI`'s wallet icon into the zone while the player stands inside
(`tryDeposit`/`flyInCoins`), crediting `FarmPlotStorage.addProgress()` per landed coin.
`FarmPlotStorage.tryCompletePurchase()` flips the plot to owned, fires `onPurchase`, and
`FarmZone` destroys itself and calls `onPurchased` → `PizzaScene.spawnFarmGrid(id,
placement, config)`, replacing the single big trigger with one `FarmPlotTile` per
`FarmGrid` cell (staggered pop-in via `FARM_GRID_APPEAR_STAGGER_SEC`).

**Planting & growing** — each `FarmPlotTile` owns one croppable cell, keyed by
`FarmCropStorage.tileKey(farmId, col, row)` — the stable identity per-cell planted state
hangs off. Empty cells register with the single shared `FarmSeedPicker` (constructed once
in `PizzaScene`, held by every tile) on trigger-enter; planted cells register with the
single shared `FarmCropHud` instead — both are true singletons passed into every
`FarmPlotTile` constructor, never instantiated per-tile. Both pickers resolve "which tile
is active" by proximity to the player's position every frame (`resolveActive()`), not
registration order or trigger-enter/exit state — this specifically fixes a bug where two
overlapping/adjacent triggers could each believe they own the popup; `FarmPlotTile`'s
outline visibility is likewise driven off `FarmSeedPicker.getActiveTileKey() ===
this.tileKey`, not its own trigger state. Planting flow: seed-picker tap →
`SeedStorage.removeOne(seedId)` → `FarmCropStorage.plant(tileKey,
SEED_CONFIG[seedId].cropId, Date.now()/1000)`; `CropVisualComponent` grows purely off
that stored state. Growth/readiness (`CropTypes.isCropReady`) is computed from real
elapsed wall-clock time against `plantedAtSec`, so it survives reloads with no
offline-catchup step — same pattern as `GateStorage`/`QueueStorage`. Harvest is always a
deliberate "Collect" tap in `FarmCropHud`, never automatic on collision (auto-collect is
a planned unlockable, not implemented); `FarmPlotTile.harvest()` banks
`CROP_CONFIG[cropId].yield` into `BackpackStorage`, calls `FarmCropStorage.harvest(tileKey)`,
then immediately re-registers the tile with the seed picker so it can be replanted without
stepping off and back on.

**Persistence** — `FarmPlotStorage` (owned ids + deposit progress), `FarmCropStorage`
(per-tile `PlantedCrop`), `SeedStorage` (seed counts) are all static-class/Signal/
`PlatformHandler` stores, `load()`-awaited at boot in `index.ts` before `PizzaScene`
spawns anything (see Entry point above).

**`FarmFootprints.ts`** (`collectFarmFootprints`/`isInsideAnyFarmFootprint`) is a separate
AABB exclusion check consumed by the loose-resource spawners
(`DynamicResourceSpawner`/`ShapeResourceSpawner`) so trees/animals/pickups never spawn on
top of a plot; rotation is ignored (axis-aligned only), consistent with `FarmZone`/
`FarmPlotTile` themselves also ignoring rotation.

**Gotchas:** `FARM_TILE_CONFIG` (empty/prepared views, notification icon, ground tints) is
game-WIDE, not per-plot — only price/`appearRequirement`/`allowedCrops` vary per plot id.
Ground tint (`applyGroundTint`) only applies on the `GlbVisualComponent` path; the
`BoxVisualComponent` dev placeholder keeps a fixed color regardless. **There is currently
no in-game seed acquisition path** — `SeedStorage.add` is only ever called from dev-GUI
buttons ("Add 5 Seeds") — a real shop/reward source for seeds doesn't exist yet.

## Player & actions — `game/player/MainPlayer.ts`, `game/components/`

`MainPlayer` self-configures in `awake()` (`RigidBody`, `PlayerMovementController`,
`FacingComponent`, `PlayerActionController`, `AutoGatherController`) — movement/physics
work from the first frame, independent of the FBX character load
(`loadCharacter()`, separate/async/purely cosmetic).

- **`PlayerMovementController`** — reads keyboard/analog/pointer input, writes
  `RigidBody.velocity` in `fixedUpdate()`, checking `TileWalkability.isWalkable()` per
  axis first.
- **`PlayerActionController`** — the repeated-hit action loop against an `ActionTarget`
  (`ResourceNode` implements this: `position`, `remainingLife?`, `applyHit(hits): boolean`,
  `onHit?({ hits })`). `onPlayActionAnimation(action, target, onHit?)` is the entry point;
  throws synchronously if already busy. Does not freeze movement — walking away is the
  cancel gesture. Every `hitIntervalSec` it removes `hitScale` hits' worth of life from the
  target, CAPPED at `target.remainingLife` so a killing blow never removes more than the
  target actually had left (no overkill) — see Tools & shop upgrades below for how that hit
  count and the separate, uncapped yield-per-hit multiplier interact.
- **`AutoGatherController`** — the actual "no interaction required" layer: tracks every
  `ResourceNode` currently overlapped (`Layers.Resource` trigger), auto-starts
  `PlayerActionController` on the first AVAILABLE one the player also has the tool for
  (`hasRequiredTool()` checks `ACTION_CONFIG[action].tool` against `ItemStorage` —
  `undefined` tool, e.g. `Gather`, is always allowed bare-handed; a `StoneDeposit` node just
  sits un-harvestable until the player owns a pickaxe), credits `BackpackStorage` via
  `rollProviderDrop()` at `resourcePerHit * hits` weight (see Resources above) + spawns a
  flying chip visual per landed swing, picks the next target on completion/cancellation/
  new overlap. Loose resources (`LooseResourceNode`) never enter this controller at all —
  see Resources above.

## Tools & shop upgrades — `game/actions/ActionTypes.ts`, `game/actions/ToolRegistry.ts`, `game/shop/`

`ActionConfig` (`ACTION_CONFIG`, keyed by `ActionType` — `Chop`/`Mine`/`Gather`) is the
live, mutable gameplay data every hit reads: **three independent upgrade knobs**, not one:

| Field | Effect | Capped by remaining life? |
|---|---|---|
| `hitIntervalSec` | seconds per swing (speed) | n/a |
| `hitScale` | how many hits one swing counts as — shrinks the hit COUNT needed to clear a target | **yes** — `PlayerActionController.update()` clamps it to `target.remainingLife` |
| `resourcePerHit` | yield banked per hit (`amountPerGather * resourcePerHit * hits`, see `AutoGatherController.onHitLanded()`) | **no** — deliberately uncapped, so it's what lets total yield exceed a target's own `maxLife` |

Example: a Tree provider (`maxLife` 5, `amountPerGather` 1) hit by a swing with
`hitScale: 3, resourcePerHit: 3` removes 3 life and banks `1*3*3 = 9` (as `Wood`, via the
drop table); the next swing removes the remaining 2 (hit count capped, yield multiplier
isn't) and banks `1*3*2 = 6` — 15 total, not the 5 a `hitScale`-only reading would suggest.

`ToolRegistry.ts` (`TOOL_LIBRARY`) is purely cosmetic — which glb/placeholder a tool shows
in the right hand, no gameplay numbers. `ShopTypes.ts` (`SHOP_CONFIG_BY_ID`) defines a
per-tool upgrade LADDER: each `ShopUpgradeLevel` sets whichever of `hitIntervalSec`/
`hitScale`/`resourcePerHit` it upgrades (omitted fields stay whatever the previous level
left them at — see `applyShopLevel()`). The default axe ladder (`shop1`) is 10 levels,
rotating all three knobs. `ShopZone.ts` is the in-world trigger that drains
`EconomyStorage`'s money into `ShopUpgradeStorage.addProgress()`/`tryCompleteUpgrade()`;
the dev GUI's `Upgrades` folder (`?dev`) has a force-upgrade button per shop (bypasses the
coin-walk-up/cooldown) plus a live per-tool readout of all three knobs, for testing without
grinding money.

`ShopUpgradeStorage` persists only the purchased `level` per shop id — `ACTION_CONFIG`
itself is a plain in-memory object, replayed back to the correct live values at boot via
`reapplyAllShopUpgrades()`. `resetAllActionConfigs()` (called by the dev GUI's "Reset
Upgrades"/"Reset Everything") restores `ACTION_CONFIG` to `BASE_ACTION_CONFIG`'s
hand-authored defaults.

## Particle VFX — `game/vfx/`

Three-file driver/catalog/instance split:

- **`ParticleRegistry.ts`** — pure data catalog. `PARTICLE_REGISTRY: Record<string,
  ParticleEffectDescriptor>` holds one entry per named effect id (`craftingMyst`,
  `destroyBurst`, `treeLeafBurst`, `gateMyst`, ...), each specifying texture path, tint
  color, fade in/out, lifetime, size range, rise-speed range, spread radius, offset,
  `blendMode: 'normal'|'additive'`, and optional burst-only fields (`burstSpeedMin/Max`,
  `gravity`). `getParticleEffect(id)` throws if the id is unregistered. Edited via the web
  editor's "Particle Effects" tab (ts-morph patches this file directly, same convention as
  `CraftTypes.ts`/`ShopTypes.ts` — no separate JSON at runtime).
- **`ParticleSystem.ts`** — static driver/facade (same convention as `TextureBuilder`/
  `BendService`). Owns one `ParticleBatch` per unique `(texture, blendMode)` pair, lazily
  created on first `spawn`/`burst` call for an effect (async texture load, deduped via a
  `pendingLoads` map so concurrent requests don't double-fetch). `init(scene)` — call once
  from `PizzaScene.build()`; `update(delta)` — call every frame from `PizzaScene.update()`.
  `spawn(effectId, worldPos)` — one particle drifting straight up per call (continuous
  "ambient" mode); `burst(effectId, worldPos, count)` — launches `count` particles at once
  in random upper-hemisphere directions with gravity pulling them back down. Both are
  no-ops before `init()` or before the batch's texture finishes loading — safe to call
  speculatively.
- **`ParticleBatch.ts`** — the pooled GPU instance: one `THREE.Points` draw call per
  texture+blendMode, a fixed-size (`BATCH_CAPACITY = 256`) ring buffer of float attribute
  arrays. `spawn()` just writes floats at the next ring index (dead slots aren't tracked/
  freed — acceptable churn for ambient VFX). Aging/fade/drift/gravity/billboard-size math
  all happens in a raw `ShaderMaterial` vertex shader driven by `uTime` minus each
  particle's `aSpawnTime`; it manually reproduces `BendService`'s world-bend math (shares
  `uBendOrigin`/`uBendStrength` uniforms by reference) since it's a raw shader with no
  `#include <project_vertex>` chunk to patch.

**Call sites** — two reusable ECS components wrap the two entry points rather than every
caller calling `ParticleSystem` directly: `ParticleEmitterComponent` (continuous, ticks
`spawn()` on a timer at the entity's world position, skips spawning while the entity is
zone-hidden) and `ParticleBurstOnDestroyComponent` (fires `burst()` once from `destroy()`).
Both driven by a `particleEffectId` config field. `CraftZone.ts` (ambient myst on crafting
tables) and `Gate.ts` (ambient emitter via `particleEffectId` + a direct `burst()` call in
`collapseMesh()` via `destroyParticleEffectId`/`destroyParticleCount`) both wire it up;
`ResourceNode.ts` uses the same `destroyParticleEffectId` pattern per `ProviderConfig`.
`PizzaScene.ts` only calls `ParticleSystem.init()`/`update()` — it never spawns an effect
itself.

## Notifications — `game/ui/notifications/`

A large, non-blocking, center-upper callout for big events (tool upgrades today;
building-upgrade/gate-unlock call sites aren't wired up yet) — deliberately NOT a `Popup`
(no backdrop, doesn't steal input, self-timed).

- **`UpgradeNotificationView.ts`** — the visual + animation: a ribbon (9-sliced,
  `NotificationType`-colored via `UpgradeStyle.ribbonTextureFor()`) reading "UPGRADE!", a
  badge hanging off its bottom edge (`NotificationRarity`-colored via
  `UpgradeStyle.badgeTextureFor()`) holding the target's icon with a spinning shine effect
  behind it, and a caption below naming what got upgraded (e.g. "AXE LEVEL 2"). Owns its
  own show → hold → hide → self-destroy lifecycle (`play(restPosition): Promise<void>`).
- **`UpgradeNotificationManager.ts`** — a singleton queue (multiple `show()` calls queue
  rather than interrupt each other) that only knows WHERE a notification sits and THAT they
  queue — never what one looks like. `init(game)` once (see `UIService`'s constructor,
  same convention as `PopupManager`); `show(options)` to queue one.
- **`NotificationTypes.ts`** / **`UpgradeStyle.ts`** — `NotificationType` (`Upgrade`/
  `Unlockable`/`BuildingUpgrade`/`NewTool`) picks the ribbon color, `NotificationRarity`
  (`Common`/`Rare`/`Epic`/`Legendary`) picks the badge color (all four badge textures are
  real; `Unlockable`/`BuildingUpgrade` ribbon textures are placeholders pending final
  ids; `NewTool` uses the real `Title_Ribbon01_Red`).

Call sites: `ShopZone.ts`'s coin-drain completion and the dev GUI's per-shop force-upgrade
button both fire `UpgradeNotificationManager.instance.show({ type, rarity, icon, title,
subtitle })` right after `ShopUpgradeStorage.tryCompleteUpgrade()` succeeds.
`CraftZone.ts` fires a `NotificationType.NewTool` (always `NotificationRarity.Common`,
i.e. the green badge) callout the instant a recipe hands out its item — distinct from
`Upgrade`, which is an EXISTING tool getting better, not a new one being obtained.

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
`createBuildingMesh()` now also checks `EntityViewRegistry.resolveEntityView()` first,
falling back to the placeholder box only when no real view resolves (see World / terrain
above).

**Gate, in full** — `Gate.ts` resolves its visible mesh the same way: a resolved
`EntityViewRegistry` view spawns a real `GlbVisualComponent` (scale/rotation composed from
`viewRotationOffsetDeg`/`viewScaleMultiplier` on top of the view's own values, so several
gates can share one view while facing/sizing differently), falling back to a plain
`BoxGeometry` placeholder otherwise. It also owns a persistent icon-only HUD panel — a
padlock icon (`Icon_Lock03`→`Icon_Lock02` on unlock) beside the requirement's own icon
(item/resource/building), an exclamation badge overlapping it while unmet, a "LvN" badge
for `building` requirements, and a live "have/need" deposit counter for `resource`
requirements kept current via `GateStorage.onDepositChanged`. `isRequirementMet()`
special-cases a `resource` requirement: NOT `isMilestoneRequirementMet()` (passively
holding enough in the backpack) but `GateStorage.getDepositProgress(id) >= amount` — a
resource gate must be actively FED, via `GateDropZone` below, not just satisfied by
inventory. `playUnlockSequence()` runs a choreographed sequence concurrently via
`Promise.all`: `GateStorage.unlock()`, camera travel/hold (`CameraFocusHost.focusCameraOn`),
`collapseMesh()` (gsap scale-to-zero + an optional `destroyParticleEffectId` burst — see
Particle VFX above), and a lock-icon pop/swap/settle/fade sequence.

- **`GateDropZone.ts`** — the deposit trigger for a `'resource'`-type gate requirement,
  since Gate itself deliberately doesn't unlock passively (above). A static trigger
  `RigidBody` + `DottedZoneVisualComponent` outline; on trigger enter/stay from
  `MainPlayer`, drains `BackpackStorage` one unit at a time on a staggered timer (same
  shape as `BuildingZone.flyInResource()`), flying icons from the player's backpack to the
  gate's icon panel, crediting `GateStorage.addDepositProgress()` only on landing. Fires
  `onComplete()` exactly once when the target amount is reached. `PizzaScene.setupGates()`
  positions it at `worldObjects.getDropperFor(id) ?? placement` (a dedicated dropper rect,
  falling back to the gate's own footprint if none was drawn); `onComplete` calls
  `gate.playUnlockSequence(this)` then removes both the gate and the drop zone.

**Persisted state** — `BackpackStorage` (carried, not yet deposited) and
`GlobalResourceStorage` (permanently banked), both static classes backed by
`PlatformHandler`'s `getItem`/`setItem` (not raw `localStorage`), each firing an
`onChange: Signal<ResourceType>` the matching HUD panel subscribes to.
`BuildingStorage`/`GateStorage` persist upgrade/unlock state the same way.

### Shared requirement system — `game/data/MilestoneRequirement.ts`, `game/world/RequirementRegistry.ts`

Queue/Shop/Building/Farm "should this even appear yet" checks, Gate's "should this unlock
and vanish yet" check, and now zone reveal's "should this whole region unlock yet" check
are the SAME underlying question — some other game milestone happened — so they share one
requirement vocabulary and one dispatcher instead of bespoke implementations per system:

- **`MilestoneRequirement.ts`** — the DATA half: a discriminated union —
  `{type:'building', buildingId, level}`, `{type:'item', item}` (owning a crafted
  tool/good — `ItemStorage.hasCount()`), `{type:'resource', resourceType, amount}`
  (currently HELD in `BackpackStorage`, so — unlike the others — it can become un-met
  again if the player spends the resource), or `{type:'trigger', triggerId}` (whether
  `Trigger.ts`'s entity with that id has fired — see World / terrain above).
  `isMilestoneRequirementMet()` is the one function that actually reads any of those four
  storages.
- **`RequirementRegistry.ts`** — the BEHAVIOR half, two roles over the same requirement
  data: **spawn gate** (`registerSpawnGate(id, requirement, spawn)`— entity doesn't exist
  yet; `spawn()` fires exactly once, immediately if `requirement` is undefined) and
  **unlock gate** (`registerUnlockGate(id, requirement, unlock)` — entity already exists,
  blocking; `unlock()` fires exactly once, and every pending unlock gate is processed ONE
  AT A TIME in registration order so two unlocking off the same milestone never fight
  over the camera). `recheckAll()` is the one entry point `PizzaScene`'s
  `WorldProgressionHost` implementation (`notifyBuildingLevelUp()`/`notifyItemCrafted()`)
  calls after a triggering zone's own camera sequence (if any) has fully resolved, and is
  also what `Trigger.ts`'s `onActivated` calls directly. `QueueConfig`/`ShopConfig`/
  `BuildingConfig`/`FarmPlotConfig` all carry an optional `appearRequirement?:
  MilestoneRequirement` field wired through `registerSpawnGate()` in `PizzaScene`'s
  respective setup methods. Zone reveal (`WorldManager.checkZoneRequirements()`) reads the
  same `MilestoneRequirement` data directly rather than going through
  `RequirementRegistry` — see Zone locking above.

**One deliberate exception:** `CraftTableConfig.appearRequirement` is checked INLINE in
`PizzaScene.setupCraftTables()` (calling `isMilestoneRequirementMet()` directly) rather
than through a registered spawn gate — a craft table can be destroyed and later REBUILT
(Clear Data resets a spent `destroyOnComplete` table back to not-yet-crafted, and
`setupCraftTables()` is expected to respawn it), which conflicts with a spawn gate's
"fires once, forever" contract. Same requirement data/check function either way, just a
different lifecycle wrapper — see that method's own doc for the full reasoning.

**Adding a brand new gated entity type**: give its config an optional
`appearRequirement?: MilestoneRequirement`, and in its setup code call
`requirementRegistry.registerSpawnGate(id, config.appearRequirement, () => { /* build it */ })`
— that's the entire integration, whatever the requirement kind. Something that needs
Gate's "already exists, unlocks and vanishes" behavior instead uses
`registerUnlockGate()`.

## NPCs — `game/world/NpcEntity.ts`, `NpcBodyLoader.ts`, `NpcLookAtSensor.ts`

`NpcEntity` (extends `Entity`) is a stationary, animated NPC that reuses `CharacterBody` —
the same rig/animation machinery `MainPlayer` uses — rather than a bespoke mesh.
`awake()` parents `body.container` under `this.transform` and calls `loadNpcBody(body,
config)` (`NpcBodyLoader.ts`), which hides the container, loads `CharacterMedium` plus
idle/walk/run/happy clips from the SAME `PlayerConfig.animations` source the player uses,
applies the `CharacterViewTypes` look, scales the container, forces one synchronous
`body.update(0)` to snap the skeleton into 'idle' pose (avoiding a T-pose flash), then
reveals it. `NpcEntity.update()` calls `body.update(delta, 0, 0, { grounded: true })`
every frame — zero move input keeps it idle forever, but `grounded: true` is still passed
so the idle/walk/run transition graph isn't left broken if move input is ever added.
`NpcEntity.lateUpdate()` drives `NpcLookAtSensor` (built once the rig loads, via
`tryBuild()`, which requires both `NpcConfig.viewRadius`/`viewAngleDeg` AND "Neck"/"Head"
bones — otherwise returns `undefined` with a `console.warn`): `update(bodyPosition,
bodyForwardQuaternion, playerPosition, delta)` computes flat (Y-ignored) distance and a
facing-cone half-angle check, then feeds `EntityBoneLookAt` the player position (or
`undefined` if out of cone/range) so the neck eases toward/away from looking at the
player. This runs in `lateUpdate()` specifically because it needs the player's THIS-frame
position and must run after the animation mixer has reset bones for the frame.
`getHeadWorldPosition()` exposes the live Head bone in world space for anchoring UI (e.g.
requirement popups), `undefined` until load finishes. `NpcBodyLoader`/`NpcLookAtSensor`
are factored out specifically so `QuestGiverEntity`'s walking-NPC variant (see Queues
below) shares identical rig-build and look-at behavior instead of a drifting duplicate.
Wiring: building setup looks up `getNpcConfig(buildingConfig.npcId)` and constructs
`new NpcEntity(npcPosition, npcConfig, () => this.mainPlayer.transform.position)`, with
`npcPosition` derived from the building's own placement + `npcOffset` — not from
`WorldObjectRegistry`.

## Queues — `game/player/QueueZone.ts`, `game/data/QueueTypes.ts`, `game/data/QueueStorage.ts`

A queue is a repeating task-delivery trigger, id'd from whatever's drawn on the Tiled
map's `"queue"` objects (open-ended, unlike `BuildingId`/`GateId`'s fixed enums — a level
designer can add `"queue7"` with zero code changes). `QueueConfig` (`QUEUE_CONFIG_BY_ID`,
falling back to `DEFAULT_QUEUE_CONFIG` for any id not listed) picks a random
`QueueTaskDef` (`resourceType`, `amount`, `rewardAmount`) on a cooldown
(`QueueStorage.tryRollNextTask()`); `QueueZone` drains `BackpackStorage` into it the same
staggered-flying-icon way `BuildingZone` does, then flies a money icon to `EconomyUI`'s
wallet on completion (`EconomyStorage` is only credited once that icon actually LANDS,
not on departure — the same convention every deposit flow here follows). A queue can
instead be paced by a `QuestGiverEntity` walking a Tiled waypoint path in/out
(`QueueConfig`'s giver fields + `WorldObjectRegistry.getWaypoints()`, reusing
`NpcBodyLoader`/`NpcLookAtSensor` — see NPCs above) — when both a `QuestGiverConfig` AND
≥2 waypoints exist for an id, `QueueZone`'s own timer-based `autoRollTasks` is turned off,
and the giver's arrival is what starts the next task instead.

`QueueConfig.appearRequirement?: MilestoneRequirement` (see Buildings & progression's
shared requirement system above) gates whether a queue exists at all —
`PizzaScene.registerQueueSpawnGates()` registers one `RequirementRegistry` spawn gate per
queue found on the map. `queue1` requires owning a pickaxe (`{type:'item',
item:ItemType.Pickaxe}`) as a worked example — anything without an `appearRequirement`
just spawns immediately, unchanged from before that field existed.

## Crafting — `game/crafting/`

A second progression track, independent of Queue/Shop/Building: crafting TABLES turn
raw resources into ITEMS (tools/goods), which the rest of the game reads off
`ItemStorage` — `AutoGatherController.hasRequiredTool()` (Player & actions above) and
`GateTypes.ts`'s `{type:'item', ...}` requirement both key off it.

- **`ItemTypes.ts`** — `ItemType` (`Axe`/`Pickaxe` today) + `ITEM_CONFIG` (display label,
  and the `ToolRegistry` id it shares its hand-held/icon art with — a crafted item and an
  equippable tool are the same concept from two different files' perspectives).
- **`ItemStorage.ts`** — persisted item counts, same static-class-+-`Signal`-+-
  `PlatformHandler` shape as `BackpackStorage`. `DEFAULT_STARTING_ITEMS` is EMPTY — a
  brand new player starts with no tools at all; crafting the very first axe (see below)
  is the actual first thing there is to do.
- **`CraftTypes.ts`** — `CraftTableConfig` per craft id (`CRAFT_CONFIG_BY_ID`, no
  fallback default — same "has to know what it can actually make" reasoning as
  `ShopTypes.ts`): a list of INDEPENDENT `CraftRecipeDef`s (own resource `cost`, own
  `result` item+amount — no forced build order), `destroyOnComplete` (a one-shot starter
  table removes itself once every recipe's crafted; a permanent table — e.g. one meant to
  keep producing rarer items — never does), and an optional `appearRequirement` (checked
  inline, not via a spawn gate — see the shared-requirement-system section above for why).
- **`CraftStorage.ts`** — which recipes are already crafted per table id
  (`completedRecipeIds`) + progress toward the currently-active one; `tryCompleteRecipe()`
  credits `ItemStorage` and fires the table's `NewTool` notification (see Notifications
  above).
- **`CraftZone.ts`** — the trigger, same staggered-flying-icon deposit shape as
  `BuildingZone`/`QueueZone`, with an ambient `craftingMyst` particle emitter (see
  Particle VFX above). A `destroyOnComplete` table NEVER visibly renders a
  "fully crafted" state, not even for one frame — `refreshLabel()` just hides everything
  the instant `CraftStorage` reports it's done, and the entity leaves the world in that
  same tick (see the flying-icon landing callback) — there's no fade-out/delay to watch.
  `PizzaScene.setupCraftTables()` also refuses to even BUILD a `destroyOnComplete` table
  whose `CraftStorage` state already says it's fully spent (e.g. after a scene rebuild,
  not just a reload) — otherwise it'd reappear, inert, doing nothing. Notifies
  `WorldProgressionHost.notifyItemCrafted(item)` (fire-and-forget — a gate's own unlock
  sequence has nothing to do with whether the table's entity still exists) right after
  crediting the item.

Worked example already in `CRAFT_CONFIG_BY_ID`: `craftAxe` (5 `Bark` → 1 `Axe`,
`destroyOnComplete: true`) is the very first thing a fresh player can do (`Bark` needs no
tool to gather — see Resources above); crafting the axe satisfies `GateId.GateAxe`'s
`{type:'item', item:ItemType.Axe}` requirement, unlocking that gate live, mid-session.

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
  by XZ distance from the bend origin. `ParticleBatch.ts`'s raw shader (see Particle VFX
  above) manually reproduces this bend math rather than patching it in, since it has no
  `#include <project_vertex>` chunk to hook.
- **`builders/ClusterMeshBuilder.ts`, `builders/WaterMaterial.ts`** — ported from
  `games/clog`, used by `IslandMeshBuilder`. If clog's terrain/water system changes,
  these are independent copies, not shared — resync manually if needed.

## Debug / dev-cookie utilities

Three small `document.cookie`-backed utilities — NOT `PlatformHandler`/`*Storage`,
deliberately local dev/testing state, read synchronously at module load with no async
boot step:

- **`DebugMenuVisibilityCookie.ts`** — persists whether `InGameButtonList`'s testing-button
  stack (Top-Down View, Clear Data, Open Next Zone, Add 100 Money, etc.) is expanded/
  collapsed; collapsed by default on first load.
- **`DebugPhysicsCookie.ts`** — lets the separate pizza web editor's header toggles
  ("Debug Colliders"/"Debug Triggers") drive the game's own
  `PhysicsConstants.PHYSICS_DEBUG`/`PHYSICS_TRIGGER_DEBUG` flags cross-process via a
  shared cookie (cookies are host-scoped, not port-scoped, so this works despite editor
  and game running on different localhost ports). `applyDebugPhysicsCookie()` is called
  once at boot from `index.ts`'s `startGame()`, gated to dev mode by the CALLER (not
  internally), and must run before any entity's `RigidBody.awake()` since those flags are
  read once at construction (see Entry point above).
- **`DebugZoneRevealCookie.ts`** — persists `nextZoneToReveal` for
  `WorldManager.revealNextZone()`/`revealUpToZone()` debug testing, separate from real
  zone progression (see Zone locking above, which always goes through
  `checkZoneRequirements()` → `revealZoneWithEffect()` and never touches this cookie).

## Where to look first when extending

- **New ground tile type** → add to `map/tiles.json`'s `grounds[]`, paint it in Tiled.
  Walkability: add to `NON_WALKABLE_GROUND_TILES` (`TileMapConfig.ts`) or set the tile's
  `walkable` property if it should block movement. Island look: add an entry to
  `ISLAND_TILE_DEFS` (`MeshConfig.ts`) if it should look different from
  `ISLAND_DEFAULT_TILE`.
- **New building/gate placement** → draw a rect on Tiled's `"mapSettings"` layer with
  `type`/`id` custom properties, matching a `BuildingId`/`GateId` enum value. Check the
  console log from `WorldObjectRegistry`'s constructor to confirm it was found. Give it a
  real mesh instead of the placeholder box via an `EntityViewRegistry.ts` entry + `view`
  id on its config.
- **New provider (world resource dispenser)** → `ProviderTypes.ts` (`ProviderType` +
  `PROVIDER_CONFIG`, including its `ResourceDropEntry[]` drop table) + a
  `ProviderRegistry.ts`/`AssetLibraryRegistry.ts` entry (or leave `models: []` for a
  placeholder box).
- **New bankable resource type** → `ResourceTypes.ts` (`ResourceType` + `RESOURCE_CONFIG`)
  + `ResourceRegistry.ts` (`resolveResourceAssetKey()`) + an `AssetLibraryRegistry.ts`
  entry for its icon — then reference it from a provider's drop table, a
  `DynamicResourcePlacement`, or a `ShapeResourcePlacement` to actually put it in the
  world.
- **Tuning render distance/pop-in** → `PerformanceConfig.ts`, live via the dev GUI.
- **New camera behavior** → `CAMERA_SETTINGS`/`cameraOffset()`/`cameraUpVector()` in
  `PizzaScene.ts`. Remember `cameraUpVector()` exists specifically because `lookAt()`
  breaks down at `pitch=90` — don't reintroduce a raw `lookAt()` without it if pitch can
  reach vertical.
- **New tool upgrade level/ladder** → `ShopTypes.ts`'s `SHOP_CONFIG_BY_ID[id].levels` —
  set only the `hitIntervalSec`/`hitScale`/`resourcePerHit` field(s) that level changes.
- **New notification call site** (building level-up, gate unlock) → call
  `UpgradeNotificationManager.instance.show({ type, rarity, icon, title, subtitle })`
  right after the event actually completes — see `ShopZone.ts` for the existing pattern.
  `NotificationType.BuildingUpgrade`/`Unlockable` ribbon textures are still placeholders
  (see `UpgradeStyle.ts`).
- **New queue** → draw a `"queue"` object on Tiled's `"mapSettings"` layer with an `id`
  (no fixed enum needed). Custom cooldown/tasks → add an entry to
  `QueueTypes.ts`'s `QUEUE_CONFIG_BY_ID`; leave it out to just get the default ladder. Give
  it a walking `QuestGiverEntity` instead of a static timer via the config's giver fields +
  ≥2 `"waypoint"` objects on Tiled sharing its id.
- **New craft table / craftable item** → `ItemTypes.ts` (`ItemType` + `ITEM_CONFIG`,
  reusing a `ToolRegistry` id for the hand-held/icon art if it's a tool) + an entry in
  `CraftTypes.ts`'s `CRAFT_CONFIG_BY_ID` (recipes, `destroyOnComplete`), then draw a
  `"craft"` object on Tiled matching that id.
- **New dynamically-spawned (loose, instant-pickup) resource on tile clusters** → a
  `ResourceType` + `RESOURCE_CONFIG`/`ResourceRegistry.ts`/`AssetLibraryRegistry.ts` entry
  + one entry in `DynamicResourceTypes.ts`'s `DYNAMIC_RESOURCE_PLACEMENTS` naming which
  `WorldSpawner` tile type (e.g. `"grass"`) it scatters across and at what density — no
  `PizzaScene.ts` changes needed. Give the SAME resource a second placement entry
  (different `spawnerTileType`) for a different density on different terrain.
- **New freehand-area spawn (resource, provider, or catchable animal)** → draw a
  `"spawner"` rect/ellipse/polygon on Tiled's `"mapSettings"` layer with an `id`, then add
  a `ShapeResourcePlacement` to `ShapeResourceTypes.ts` referencing that `shapeId` with the
  right `spawnType` (`'resource'`/`'provider'`/`'animal'`) — no `PizzaScene.ts` changes
  needed.
- **New NPC** → `NpcTypes.ts`'s `getNpcConfig()` entry (view/animation/viewRadius/
  viewAngleDeg for the look-at sensor), then construct a `NpcEntity` from wherever it
  should live (a building's `setup*()` method is the existing pattern) — `NpcBodyLoader`/
  `NpcLookAtSensor` need no changes for a new NPC that just stands and looks at the player.
- **New particle effect** → add an entry to `ParticleRegistry.ts`'s `PARTICLE_REGISTRY`
  (texture/tint/lifetime/etc.), then either attach a `ParticleEmitterComponent`/
  `ParticleBurstOnDestroyComponent` to the emitting entity or call
  `ParticleSystem.spawn()`/`burst()` directly — no `PizzaScene.ts` changes needed either
  way (it only drives `init()`/`update()`).
- **New crop/seed** → `CropTypes.ts` (`CROP_CONFIG` — growth time, yield) +
  `SeedTypes.ts` (`SEED_CONFIG` — which crop it plants) + `AssetLibraryRegistry.ts`
  entries for the crop and its seed icon. Remember there's still no in-game seed source
  (see Farming above) — a new seed is only reachable via the dev GUI until one exists.
- **New "appears once X happens" or "unlocks once X happens" entity, or a zone that
  should unlock on a milestone** → add an optional `appearRequirement?:
  MilestoneRequirement` to its config type, then register it via
  `requirementRegistry.registerSpawnGate(id, config.appearRequirement, () => {...})` (or
  `registerUnlockGate()` for Gate-style "already exists, vanishes once met", or a
  `ZONE_CONFIG` entry's own `requirement` field for a zone) in its `PizzaScene.ts` setup
  method — see the shared requirement system under Buildings & progression above.
  `MilestoneRequirement` covers building level, owned item, held resource amount, and now
  a fired `Trigger` id; add a new arm there (+ a branch in `isMilestoneRequirementMet()`)
  for a milestone kind that doesn't fit those four.
- **New "walk here to flip a flag" trigger** (not tied to gathering/depositing) → draw a
  `"trigger"` object on Tiled's `"mapSettings"` layer with an `id` and optional
  `destroyOnTrigger`; `PizzaScene.setupTriggers()` wires it up automatically — combine with
  a `{type:'trigger', triggerId}` `MilestoneRequirement` elsewhere to gate on it.
