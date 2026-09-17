# `games/bandit/legacy` feature reference

Working notes for porting features from the full game (`games/bandit/legacy`)
into this tech demo (`games/bandit-controller`), one system at a time. This
doc is the map; it doesn't try to be exhaustive about every file, just
accurate about where things live and how they connect, so a future session
doesn't have to re-survey the whole codebase before making a change.

**Naming note**: `games/bandit/legacy` was built under the internal codename
"Pizza" — its own scene class, storage keys, and several doc comments still
literally say `PizzaScene`/`PIZZA_ECONOMY`/etc. Don't be thrown by that.
`games/pizza` is a sibling game built on (basically) the same engine slice;
for the UI/economy/flying-icon files this doc covers, `games/pizza` and
`games/bandit/legacy` are **byte-for-byte identical** (confirmed via diff on
`FlyingResourceIcon.ts`, `FlyingResourceEffect.ts`, `EconomyUI.ts`,
`UIService.ts`, `EconomyStorage.ts`, `EconomyTypes.ts`) — either is a valid
reference for those.

There's also `games/bandit/README.md` — a hand-written architecture doc for
the legacy game. It's useful background but **partially stale** (e.g. it
doesn't mention Farms, Marts, Animals, the Tutorial system, i18n, or
Notifications, all of which exist in code). Cross-check its claims against
actual source before trusting them.

---

## 1. Top-level structure

- `games/bandit/legacy/index.ts` — `MyGame extends Game`. Boots the
  platform, awaits `.load()` on ~20 static `*Storage` classes (order
  matters), loads three PIXI asset bundles (json → fonts → images), then
  switches to `PizzaScene`.
- `games/bandit/legacy/game/scenes/PizzaScene.ts` (2073 lines) — **the
  entire game is one scene.** Extends `core/scene/ThreeScene`. Implements
  `CameraFocusHost`/`WorldProgressionHost` (see `game/camera/`) so entities
  can call back into the scene without importing it. Builds every
  manager/system as a field initializer in its constructor;
  `build()`/`setupX()` calls (`:1042-1720`) wire up gates, farms, marts,
  crafting tables, queue-spawn gates, etc. `fixedUpdate()` (`:1837`) runs
  physics + camera math; `update()` (`:2041`) runs `world.update()` then
  `world.lateUpdate()`.
- `games/bandit/legacy/game/ClogConstants.ts` — **dead code.** Leftover
  agar.io-style "cube eats cube" constants from `games/clog`, the game this
  codebase was originally forked from. Nothing in the current game imports
  it. Don't port from it, don't be confused by it.
- `games/bandit/legacy/game/plan.txt` — a milestone plan describing what
  looks like `bandit-controller`'s own build-up (ActionType,
  PlayerActionController, ResourceNode, AutoGatherController...). A stray
  planning doc sitting in the wrong game's folder, not legacy documentation.
- `games/bandit/legacy/game/config/PerformanceConfig.ts` — render-distance/
  pop-in tuning (`cameraFar`, `resourceLoadRadius/UnloadRadius`,
  `resourcePopInSec/OutSec`), read live every frame.

## 2. ECS — `game/ecs/`

Same shape as `bandit-controller`'s own `game/ecs/` (Entity = THREE.Group +
Component[]; World owns PhysicsWorld + entity list), with two differences
worth knowing before porting anything that depends on them:

- **`lateUpdate()`** — a second per-entity pass after `update()`, only for
  entities that override it (e.g. `NpcEntity`). `bandit-controller`'s ECS
  doesn't have this hook at all.
- **No archetype/query system.** `entity.getComponent(Class)` is a linear
  `find()` over that one entity's own components, same as
  `bandit-controller`. Entities are hand-built dedicated subclasses
  (`MainPlayer`, `ResourceNode`, `BuildingZone`, `QueueZone`, `Gate`,
  `FarmZone`, `NpcEntity`, `AnimalNode`, ...) — pooling
  (`World.spawn()`/`despawn()`) is only used for a minority of simple cases.
  This is a lightweight Unity-style GameObject/Component pattern, not a
  "real" ECS — matches `bandit-controller`'s own `World.spawn()`/`add()`
  split exactly (pooled generic entity vs. adopted dedicated subclass).

## 3. Physics — `game/physics/`

Same kinematic AABB collide-and-slide as `bandit-controller`'s own
`PhysicsWorld`/`RigidBody` (no mass/impulses/rotation, per-axis push-out,
`onCollisionEnter/Stay/Exit` vs `onTriggerEnter/Stay/Exit`). Notable
additions over `bandit-controller`'s copy:

- `Layers` includes `Trigger`/`Resource` on top of
  `Default`/`Player`/`Environment`.
- `RigidBody.blocksVertical` is used so horizontal-only obstacles (trees,
  rocks) don't let the player stand on top of them.
- `game/physics/SolidArea.ts` — a shared `buildSolidArea()` helper every
  zone entity (`ShopZone`, `CraftZone`, `QueueZone`, ...) uses to build its
  static solid `RigidBody` box. `bandit-controller`'s
  `GateBuilder.buildTriggerGate()`/`WorldEnvironment.buildGroundCollider()` do this
  inline instead — worth factoring out if bandit-controller grows more zone
  types.

## 4. Player + controllers — `game/player/`, `game/components/`, `game/entities/`

- `player/MainPlayer.ts` — same two-step pattern as bandit-controller's own
  `MainPlayer` (`awake()` adds RigidBody + controllers synchronously,
  `loadCharacter()` is a separate async step), but with more components:
  `PlayerActionController` (repeated-hit chop/mine/gather loop against an
  `ActionTarget` interface), `AutoGatherController` (radius+facing-cone auto
  gather — the actual `BackpackStorage.add()` call site, see Economy
  below), `AnimalCatchController`, `FacingComponent` (generic
  slerp-toward-direction, reusable), plus UI-avoidance/notification
  components if a `screenHost` is given.
- `entities/CharacterBody.ts` (784 lines) + `entities/animation/` — a
  **layered** animator (base idle/run/jump layer + an upper-body-only
  "action" layer for chop/mine, see `BoneMask.ts`), tool-in-hand attachment,
  head/backpack cube mounting. `bandit-controller`'s own `CharacterBody.ts`
  is a trimmed single-layer version of this same state-graph idea.
- Tools/upgrades are deliberately split in two: `actions/ToolRegistry.ts`
  (purely cosmetic mesh/hand placement) vs. `shop/ShopTypes.ts`
  (`SHOP_CONFIG_BY_ID`, the gameplay upgrade ladder that mutates
  `ACTION_CONFIG` live). Same "visual asset vs. gameplay config" split shows
  up again in the Economy section below — it's a recurring convention in
  this codebase, not a one-off.

## 5. Camera

**Not a dedicated class/folder** — `game/camera/` only holds two structural
interfaces (`CameraFocusHost.ts`, `WorldProgressionHost.ts`) that let
entities call back into the scene. The actual spherical yaw/pitch/distance
orbit camera is implemented **inline in `PizzaScene.ts`**: `CAMERA_SETTINGS`
(seeded from `data/CameraTemplateTypes.ts`'s `default` template),
`cameraOffset()`/`cameraUpVector()` free functions, `positionCamera()`
(initial snap), an exponential-lerp follow in `fixedUpdate()`, and gsap
tweens for `toggleCameraMode()` (follow ↔ top-down) and
`applyCameraTemplateForZone()` (per-zone camera templates,
`data/ZoneTypes.ts`'s `cameraTemplateId`).

`bandit-controller`'s own `VirtualCameraSystem` (`game/camera/`) is actually
a **more reusable** version of this same idea (named presets + `blendTo()`)
— porting camera behavior FROM legacy mostly means porting the *data*
(templates/settings), not the mechanism.

## 6. World / streaming / spawners — `game/world/`

Not relevant to `bandit-controller` today (no Tiled map, no streaming world)
but documented here since it's the biggest single system in legacy, in case
a future "give bandit-controller a real world" pass needs it:

- `WorldManager.ts` — ground + Tiled-painted `ResourceNode` streaming
  (materialize/dematerialize by `PERFORMANCE_CONFIG.resourceLoadRadius/
  UnloadRadius`), plus `ZoneVisibilityManager`/`FogOfWarManager`.
- `WorldSpawner.ts` + `DynamicResourceSpawner.ts` — flood-fills Tiled
  "spawner layers" into tile clusters, scatters loose instant-pickup loot
  (`player/LooseResourceNode.ts`) persisted as `(col,row)` cell records.
- `ShapeResourceSpawner.ts` — sibling system: scatters resources/animals
  inside hand-drawn Tiled shapes instead of tile clusters.
- `WorldObjectRegistry.ts` — reads Tiled's `"mapSettings"` object layer,
  buckets by `"type"` — the bridge between hand-authored map data and code.
- `Gate.ts`/`RequirementRegistry.ts` — solid obstacles that unlock on a
  milestone (building level / item / resource amount), serialized so
  simultaneous unlocks never race the camera.
- `FarmZone.ts` + `data/FarmTypes.ts`/`FarmPlotStorage.ts`/`CropTypes.ts` — a
  full farming subsystem (buy plot → grid → plant → grow → harvest). Not in
  the legacy README — confirms that doc is stale.
- `NpcEntity.ts`/`NpcBodyLoader.ts` — ambient/quest NPCs.

## 7. Economy / resources — the full pickup → currency pipeline

This is the most load-bearing section for UI/economy porting work. Three
deliberately separate data layers (each file's own header explains the
split):

- **`actions/ResourceTypes.ts`** — `ResourceType` enum + `RESOURCE_CONFIG`:
  the bankable item (`amountPerGather`, `label`, `color`, optional
  `price`/`sellable`, `category: 'main'|'farm'|'animal'`). This is what
  lives in `BackpackStorage`. ~25 types today.
- **`actions/ProviderTypes.ts`** — `ProviderType` enum + `PROVIDER_CONFIG`:
  the world dispenser (tree/deposit/bush) — `action`, `maxLife`, a weighted
  `ResourceDropEntry[]` drop table, `rollProviderDrop()`. One provider can
  drop several resource types; one resource type can come from several
  providers.
- **`actions/ActionTypes.ts`** — `ActionType` enum + `ACTION_CONFIG` /
  `BASE_ACTION_CONFIG`: the live, **mutable** per-tool numbers
  (`hitIntervalSec`, `hitScale`, `resourcePerHit`, `hitAngleDeg`,
  `hitRangeMeters`, `animationTrigger`) — mutated in place by
  `shop/ShopTypes.applyShopLevel()` on tool upgrade.

**Currencies** are a separate, smaller concept from resources —
`data/EconomyTypes.ts`:

```ts
export enum CurrencyType { Money = 'money', Gem = 'gem', Energy = 'energy' }

export interface CurrencyConfig {
    label: string;
    assetKey: AssetLibraryKey;   // which AssetLibraryRegistry entry's icon to use
}

export const CURRENCY_CONFIG: Record<CurrencyType, CurrencyConfig> = {
    [CurrencyType.Money]:  { label: 'Money',  assetKey: 'money'  },
    [CurrencyType.Gem]:    { label: 'Gems',   assetKey: 'gem'    },
    [CurrencyType.Energy]: { label: 'Energy', assetKey: 'energy' },
};
```

The icon is never stored inline — `assetKey` points into
`game/world/AssetLibraryRegistry.ts`'s `ASSET_LIBRARY` map, where each entry
optionally carries an `icon?: string` alongside its 3D `models`/`scale`/
`rotationDeg`. `getAssetIcon(key)` resolves that to a `PIXI.Texture` (via
`PIXI.Texture.from(entry.icon)`, i.e. a preloaded PIXI bundle alias —
**doesn't apply directly to bandit-controller**, which loads no PIXI
bundles; see the "What's already ported" section below for how this project
adapted it), falling back to `PIXI.Texture.WHITE` if missing. **One icon
asset is shared by both the world visual and the UI icon** — e.g.
`ASSET_LIBRARY.tree` carries both the 3D tree models and `icon:
"wood-log"`.

**Balances** — `data/EconomyStorage.ts`: static class, `Map<CurrencyType,
number>` + a `signals.Signal onChange` (dispatched with just the changed
`CurrencyType` — readers call `getBalance()` themselves). `add()`/`spend()`
mutate, dispatch, then fire-and-forget `persist()` via `PlatformHandler`.
This is the single source of truth; the HUD and the flying icon are both
just reactions to it.

### End-to-end flow (QueueZone / money — the closest analog to
`bandit-controller`'s `Collectible` → `GameUI`)

1. Player gathers → `AutoGatherController.onHitLanded()` credits
   `BackpackStorage.add()` directly and synchronously (no flight/landing
   gate on this step).
2. Player stands in a `QueueZone` with an active task — it drains
   `BackpackStorage` one unit per `FLY_IN_STAGGER_SEC = 0.12s`, each unit
   spawning `spawnFlyingResourceIcon()` (world → world) whose `onArrive`
   credits `QueueStorage.addProgress()`.
3. Once the task's full amount is delivered, `QueueZone.flyRewardToWallet()`
   runs — `spawnFlyingIconToOverlayPoint(screenHost, fromWorld,
   getWalletOverlayPosition, moneyIcon, onArrive)`, where
   `getWalletOverlayPosition` is `EconomyUI.getIconAnchorPosition(Money)`,
   re-read live every frame.
4. On arrival, `onArrive` calls `EconomyStorage.add(CurrencyType.Money,
   rewardAmount)` — **the only place the balance actually changes.**
   Departure is purely cosmetic; landing is the state mutation. This
   "mutate on landing, not on departure" convention is shared by every
   deposit flow in the game (QueueZone/DropZone/BuildingZone), not just
   money.
5. `EconomyUI.onEconomyChanged('money')` fires: snaps the digits instantly
   to the new balance (no count-up tween), computes `gained = balance -
   lastBalance`, and if `gained > 0` plays the icon punch-scale + rising
   `"+N"` feedback (see below).

For a plain world pickup with no queue/task involved (closer to
`Collectible`), the credit can also happen immediately on pickup with a
purely decorative, no-`onArrive` flying chip — legacy has both patterns
(`AutoGatherController`'s commented-out `spawnFlyingResourceChip()` is the
"immediate credit" version). **`bandit-controller`'s port uses the
landing-driven version** (step 4 above) since it reads better for a single
big pickup rather than a stream of small ones — see below.

## 8. UI system

Base/shared conventions, all under `game/ui/`, built on
`core/ui/BaseButton`:

- **`ui/UIService.ts`** — one plain manager (not ECS), owns every HUD panel,
  constructed once in `PizzaScene.build()`, `update()`d every frame from
  `Game.overlayScreenData`. **Keeps both an old and new implementation of
  several panels side by side** (`backpackUi` vs `backpackListUi`,
  `animalFollowUi` vs `animalDockUi`, `toolLevelUi` vs `toolListUi`) — only
  the second of each pair is actually mounted
  (`game.uiLayer.addChild(...)`). Don't port the dead half without checking
  which one is actually live.
- **`ui/popups/Popup.ts`** — abstract base for modal popups (chrome: nine-
  slice `AutoFitFrame` + title/close-button header row; subclasses only
  implement `buildContent()`).
- **`ui/popups/PopupManager.ts`** — singleton, one popup open at a time,
  backdrop darken + tap-to-close. **Separate from** the framework-level
  `core/popup/PopupManager` (used for boot-level popups like game-over) —
  two popup systems coexist, one per layer tier.
- **`ui/ButtonLibrary.ts`** — `createLibraryButton()`, the one `BaseButton`
  factory every button should go through (7 named nine-slice colors).
- **`ui/FrameRegistry.ts`/`PanelBackground.ts`/`AutoFitFrame.ts`** —
  nine-slice panel chrome + auto-sizing wrapper, shared by every popup/HUD
  panel.
- **`ui/TextStyleRegistry.ts`/`LayoutRegistry.ts`/`IconSlotRegistry.ts`/
  `BarRegistry.ts`** — shared style/layout preset registries so every panel
  pulls from one place instead of hand-tuning each.
- **HUD screens**: `BackpackListUI`, `GlobalResourcesUI`, `EconomyUI`
  (currency topbar — see below), `ToolListUI`, `AnimalDockUI`,
  `InGameButtonList`, `BackpackButton`, `SettingsUIService`.
- **Notifications** — `ui/notifications/UpgradeNotificationManager.ts`
  (singleton queue, non-blocking, self-timed) + `UpgradeNotificationView.ts`
  (ribbon+badge+caption).
- **In-world zone panels** — every zone (`BuildingZone`/`QueueZone`/
  `ShopZone`/`CraftZone`/`FarmZone`/`MartZone`) carries a persistent
  floating requirement/progress panel anchored via
  `components/ScreenAnchorComponent.ts` (a `ScreenAnchorHost`), built from
  the same `AutoFitFrame`+`LayoutRegistry` primitives.
- **i18n** — `game/i18n/Localization.ts` + `locales/*.json` (25 languages).
- **DOM UI** — `game/dom-ui/` — non-PIXI HTML overlay (loading spinner
  shown before the PIXI/THREE scene exists).

### The currency HUD in detail — `ui/EconomyUI.ts` (identical in
`games/pizza`)

`EconomyUI extends PIXI.Container`. Builds one "pill" per currency in
`TopBarStyle.ts`'s `currencies: [Money, Gem, Energy]`. Each pill
(`buildPill()`):

- a `PIXI.Container`
- a `FrameComponent` nine-slice background (`pillFrame: 'Info'`)
- a `PIXI.Sprite` icon, anchor `(0, 0.5)`, scaled to fit the pill height
- a `PIXI.Text` amount label, anchor `(1, 0.5)` (right-aligned)

Laid out left-to-right with a gap; a pill hides entirely if its currency has
never been held (Money always shows). Positioned via
`UIService.positionEconomyUi()`:

```ts
this.economyUi.position.set(
    screen.topRight.x - this.economyUi.panelWidth - ECONOMY_UI_MARGIN,
    screen.topRight.y + ECONOMY_UI_MARGIN,
);
```

`ECONOMY_UI_MARGIN = 16`, run every frame against
`Game.overlayScreenData.topRight` — **exactly** the "screen-corner-minus-
margin" convention `bandit-controller`'s own `GameUI.ts` already uses for
its reset button.

`EconomyUI` also exposes `getIconAnchorPosition(currency)` — the pill's icon
position in the row's parent's (`uiLayer`'s) local space. This is the exact
callback other systems pass into the flying-icon function so a flight always
lands on the icon regardless of layout/resize.

**Gain feedback** (`onEconomyChanged` → `playGainFeedback()`), verbatim:

```ts
const balance = EconomyStorage.getBalance(type);
const gained = balance - pill.lastBalance;
pill.lastBalance = balance;
pill.amountLabel.text = balance.toString();   // snaps instantly, no count-up tween
if (gained > 0) this.playGainFeedback(pill, gained);

private playGainFeedback(pill: Pill, gained: number): void {
    gsap.killTweensOf(pill.icon.scale);
    pill.icon.scale.set(pill.iconBaseScale);
    gsap.timeline()
        .to(pill.icon.scale, { x: iconBaseScale * 1.3, y: iconBaseScale * 1.3, duration: 0.12, ease: 'back.out(2)' })
        .to(pill.icon.scale, { x: iconBaseScale, y: iconBaseScale, duration: 0.15, ease: 'power1.out' });

    const popup = new PIXI.Text(`+${gained}`, { fill: '#33cc66', ... });
    // rises 16px and fades over 0.6s (power2.out), then popup.destroy()
}
```

So: **the digits snap instantly** (no tween on the number itself) — all the
"juice" is the icon punch-scale + a rising, fading `"+N"`.

### The flying-icon mechanism — `game/components/FlyingResourceIcon.ts`

Three exported spawn functions, all thin wrappers around one shared driver:

- `spawnFlyingResourceIcon(host, fromWorld, toWorld, texture, onArrive?)` —
  world → world.
- `spawnFlyingIconToOverlayPoint(host, fromWorld, getToOverlayPoint,
  texture, onArrive?)` — world → a **live HUD point**. This is the one
  `bandit-controller` ported.
- `spawnFlyingIconFromOverlayPoint(...)` — the mirror (HUD → world, e.g.
  spending).

`host: ScreenAnchorHost` = `{ worldToScreen(pos): {x,y}|null;
overlayContainer: PIXI.Container }`.

World→screen projection (`projectWorldToOverlay()`): bends the point via
`BendService.applyToPosition()`, projects through `host.worldToScreen()`,
converts stage space → `overlayContainer` local space via `.toLocal()`.
Re-projected **every frame** (not once at spawn), with **separate scratch
buffers per endpoint** — the file's own comment flags a real bug history
where sharing one buffer between the `from` and `to` endpoints collapsed
both onto the same point.

Flight math (`flyIcon()`):

```ts
const ICON_SIZE = 40;
const FLIGHT_DURATION_SEC = 0.45;
const ARC_HEIGHT_PX = 90;

// quadratic Bezier (De Casteljau, two lerped legs):
const apexX = (from.x + to.x) / 2;
const apexY = (from.y + to.y) / 2 - ARC_HEIGHT_PX;
// ...lerp from->apex and apex->to, then lerp those two legs by progress.t
```

`power1.in` easing (starts slow, accelerates into the target). No pooling —
every flight allocates a fresh `PIXI.Sprite` + `gsap.to()`, destroyed on
`onComplete`. Bursts are throttled by staggering *departures*
(`FLY_IN_STAGGER_SEC = 0.12s` in `QueueZone.step()`), not by pooling icons.

## 9. Shop / crafting / building

- **Shop** — `shop/ShopTypes.ts` (`SHOP_CONFIG_BY_ID`, 10-level ladder
  mutating `ACTION_CONFIG`), `shop/ShopUpgradeStorage.ts`,
  `shop/ShopZone.ts` (drains `EconomyStorage` money one coin at a time).
- **Crafting** — `crafting/ItemTypes.ts`/`ItemStorage.ts`/`CraftTypes.ts`/
  `CraftStorage.ts`/`CraftZone.ts`. Also `shop/CraftingTableZone.ts` +
  `ui/popups/CraftingTablePopup.ts` — a **second**, poppable-menu crafting
  UI, separate from the walk-in-and-auto-drain `CraftZone` flow. Check which
  is which before porting either.
- **Buildings** — `data/BuildingTypes.ts` (upgrade ladder + mesh per
  level), `player/BuildingZone.ts` (drains `BackpackStorage`,
  `playLevelUpSequence()`: camera travel → mesh swap → progression
  callback).
- **Marts** — `shop/MartZone.ts` (buy/sell at a fixed multiplier off
  `RESOURCE_CONFIG.price`, sell = 80% of buy).
- **Queues** — `player/QueueZone.ts` (task delivery, see Economy section).

## 10. Save / settings / platform

Every `*Storage.ts` (~25 of them) follows one pattern: static class,
in-memory `Map`, `static onChange: Signal`, `static async load()` (awaited
once at boot via `PlatformHandler.instance.platform.getItem/setItem` — never
raw `localStorage`), fire-and-forget `persist()` on every mutation.
`PlatformHandler`/`PlatformFactory`/`Game` are framework-level (`core/`), not
bandit-specific — same platform abstraction `bandit-controller` already has
access to via `PlatformFactory.getPlatformInstance()`.

## 11. Asset pipeline specifics (legacy-only, for context)

- `registry/assetsRegistry/modelsRegistry.ts` — auto-generated, same shape
  as `bandit-controller`'s own copy.
- A standalone **design-data web editor** (`games/bandit/web/`) edits
  `web/data/*.json`, which a sync script (`ts-morph`-based) patches back
  into the real `*.ts` config files — the JSON is an editor convenience
  mirror, never read by the running game.
- `games/bandit/tiled/` — Tiled map editor source assets.

## 12. Other notable systems

- **Tutorial** — `game/tutorial/ZoneTutorialController.ts` (gather → deliver
  phase sequencing) + a screen-space arrow + optional 3D orbiting arrow.
- **VFX** — `game/vfx/ParticleSystem.ts` — registry-driven, one draw-call
  batch per (texture, blendMode) pair.
- **Rendering helpers ported from `games/clog`** (independent,
  manually-resynced copies, not shared code): `ClusterMeshBuilder.ts`,
  `WaterMaterial.ts`, `ScreenAnchorComponent.ts`, `AnimationBoard.ts`. Worth
  a diff against `games/clog` before assuming these are bandit-original.
- **`game/services/BendService.ts`** — same idea as
  `bandit-controller`'s own `BendService`, plus `applyToPosition()` (a
  CPU-side replica of the vertex shader's y-drop, used to correct a raw
  world position before projecting it to screen space — see the flying-icon
  section above) and `applyBottomFade`/`applyDistanceFade`.
  `bandit-controller`'s own `BendService` doesn't have `applyToPosition()`
  yet — see the porting note below.

---

## What's already been ported into `bandit-controller`

- **`game/data/CollectibleSettings.ts`** — `CollectibleDefinition` (model +
  resourceAmount + modelScale + `icon`), analogous to legacy's
  `RESOURCE_CONFIG`/`CURRENCY_CONFIG` combined into one small record (only
  one resource exists so far, so they haven't been split apart yet — see
  "Next steps" below for when that split becomes worth doing).
- **`game/entities/Collectible.ts`** — attract-radius trigger + snap-to-
  player pickup, roughly analogous to legacy's `LooseResourceNode`
  (instant, no-tool-required pickup) crossed with a `QueueZone`'s "mutate on
  landing" convention for the payout itself.
- **`game/ui/FlyingResourceIcon.ts`** — a trimmed port of
  `spawnFlyingIconToOverlayPoint()`: same quadratic-Bezier arc/timing/
  easing constants, same "re-project every frame" reasoning. Adapted to
  this project's actual API instead of legacy's `ScreenAnchorHost`
  interface — `ThreeScene.worldToScreen()` (`core/scene/ThreeScene.ts`) +
  `Game.uiLayer`/`Game.app.stage` already cover the same need with no new
  plumbing. **Simplification**: does not replicate
  `BendService.applyToPosition()` (bandit-controller's own `BendService`
  doesn't have this method) — negligible in practice since a `Collectible`
  is only ever a few units from the player (inside its own attract radius)
  when it fires `onCollected`, so the bend's y-drop at that range is
  imperceptible. Would need adding if this effect is ever reused for a
  much-longer-range flight.
- **`game/ui/GameUI.ts`** — money "pill" (icon + amount), fed by
  `HubScene.onCollectResource()`. Ported `EconomyUI`'s
  `playGainFeedback()` (icon punch-scale + rising `"+N"`) verbatim,
  including its constants. Digits snap instantly on change, same as legacy.
- **Icon asset** — `games/bandit/legacy/game/world/AssetLibraryRegistry.ts`'s
  `money` entry points at icon `"ItemIcon_Money_Bill-2"`
  (`raw-assets/images/ui{tps}/icons/ItemIcon_Money_Bill-2.png` in legacy).
  Copied into `games/bandit-controller/raw-assets/non-preload/icons/
  money.png`, built via `GAME=bandit-controller node
  tools/image/build-image.mjs` → `public/bandit-controller/images/
  non-preload/icons/money.webp`. Loaded with `PIXI.Assets.load(url)`
  (bandit-controller has no PIXI bundle/manifest system — legacy's
  `getAssetIcon()` resolves a preloaded bundle alias via
  `PIXI.Texture.from(key)`, which doesn't apply here; `PIXI.Assets.load()`
  on a direct URL is the closest equivalent, and it caches by URL the same
  way).

## Suggested next steps, in order

1. **Split `CollectibleDefinition` into a resource/currency shape** once a
   second resource type exists — right now one record does the job of both
   `RESOURCE_CONFIG` and `CURRENCY_CONFIG`; premature to split with only
   "money."
2. **`ui/ButtonLibrary.ts`-style button factory** — `bandit-controller`'s
   `GameUI.ts` builds its reset button inline; legacy's
   `createLibraryButton()` convention would matter once there's more than
   one button.
3. **A real popup** (`ui/popups/Popup.ts` + `PopupManager.ts`) — worth
   porting once bandit-controller needs any modal UI (a settings panel, an
   inventory view) — nothing today needs one yet.
4. **`AutoGatherController`-style radius+facing-cone auto-gather** if
   bandit-controller ever grows resource NODES (as opposed to snap-to-player
   pickups) that need a tool/hit-cycle rather than instant collection.
