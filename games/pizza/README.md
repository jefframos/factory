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
already decided visibility from the un-bent bounding sphere), every `PerformanceConfig`
knob (see below), and an `Upgrades` folder — one force-upgrade button per shop (fully
funds + completes the next level in one click, firing the same notification the real
coin-drain flow does — see Tools & shop upgrades / Notifications below) plus a live
per-tool readout of `hitIntervalSec`/`hitScale`/`yieldPerHit`.

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
  (`ResourceNode` implements this: `position`, `remainingLife?`, `applyHit(hits): boolean`,
  `onHit?({ hits })`). `onPlayActionAnimation(action, target, onHit?)` is the entry point;
  throws synchronously if already busy. Does not freeze movement — walking away is the
  cancel gesture. Every `hitIntervalSec` it removes `hitScale` hits' worth of life from the
  target, CAPPED at `target.remainingLife` so a killing blow never removes more than the
  target actually had left (no overkill) — see Tools & shop upgrades below for how that hit
  count and the separate, uncapped yield-per-hit multiplier interact.
- **`AutoGatherController`** — the actual "no interaction required" layer: tracks every
  `ResourceNode` currently overlapped (`Layers.Resource` trigger), auto-starts
  `PlayerActionController` on the first one, credits `BackpackStorage` with
  `amountPerGather * resourcePerHit * hits` (see below) + spawns a flying chip visual per
  landed swing, picks the next target on completion/cancellation/new overlap.

## Tools & shop upgrades — `game/actions/ActionTypes.ts`, `game/actions/ToolRegistry.ts`, `game/shop/`

`ActionConfig` (`ACTION_CONFIG`, keyed by `ActionType` — `Chop`/`Mine`/`Gather`) is the
live, mutable gameplay data every hit reads: **three independent upgrade knobs**, not one:

| Field | Effect | Capped by remaining life? |
|---|---|---|
| `hitIntervalSec` | seconds per swing (speed) | n/a |
| `hitScale` | how many hits one swing counts as — shrinks the hit COUNT needed to clear a target | **yes** — `PlayerActionController.update()` clamps it to `target.remainingLife` |
| `resourcePerHit` | yield banked per hit (`amountPerGather * resourcePerHit * hits`, see `AutoGatherController.onHitLanded()`) | **no** — deliberately uncapped, so it's what lets total yield exceed a target's own `maxLife` |

Example: a Tree (`maxLife` 5, `amountPerGather` 1) hit by a swing with `hitScale: 3,
resourcePerHit: 3` removes 3 life and banks `1*3*3 = 9`; the next swing removes the
remaining 2 (hit count capped, yield multiplier isn't) and banks `1*3*2 = 6` — 15 total,
not the 5 a `hitScale`-only reading would suggest.

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
  `Unlockable`/`BuildingUpgrade`) picks the ribbon color, `NotificationRarity` (`Common`/
  `Rare`/`Epic`/`Legendary`) picks the badge color (all four badge textures are real;
  `Unlockable`/`BuildingUpgrade` ribbon textures are placeholders pending final ids).

Call sites: `ShopZone.ts`'s coin-drain completion and the dev GUI's per-shop force-upgrade
button both fire `UpgradeNotificationManager.instance.show({ type, rarity, icon, title,
subtitle })` right after `ShopUpgradeStorage.tryCompleteUpgrade()` succeeds.

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
- **New tool upgrade level/ladder** → `ShopTypes.ts`'s `SHOP_CONFIG_BY_ID[id].levels` —
  set only the `hitIntervalSec`/`hitScale`/`resourcePerHit` field(s) that level changes.
- **New notification call site** (building level-up, gate unlock) → call
  `UpgradeNotificationManager.instance.show({ type, rarity, icon, title, subtitle })`
  right after the event actually completes — see `ShopZone.ts` for the existing pattern.
  `NotificationType.BuildingUpgrade`/`Unlockable` ribbon textures are still placeholders
  (see `UpgradeStyle.ts`).
