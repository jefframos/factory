# Bandit Controller

A minimal, self-contained third-person character-controller tech demo — a
bent wireframe-grid floor, one player character with walk/run/jump/dodge/
slide, a data-driven virtual-camera system, and a hub-and-minigames scene
structure for testing subway-surfers-style controls. It was extracted from
the much larger `games/bandit` game (see `games/bandit/legacy/` for that
game's full original source) by pulling out just the character-controller
plumbing — ECS, physics, animation state graph, character rig loading — and
rebuilding a tiny scene around it from scratch. It does **not** import
anything from `games/bandit`; it has its own copies of every file it needs,
plus its own `raw-assets/` and generated `registry/`.

Run it with `GAME=bandit-controller` in `.env`, then `npm run dev`. Add
`?dev` to the URL for a live-tuning dat.GUI panel (Camera / Player / World
folders — see "Data-driven settings" below).

Porting a feature over from the full game? Read
[`docs/bandit-legacy-reference.md`](docs/bandit-legacy-reference.md) first —
a map of every system in `games/bandit/legacy`, what's already been ported
here, and what's next.

## Big picture: a hub scene + one scene per minigame

`index.ts` boots a plain `core/Game` subclass — no PIXI.Assets bundles, no
platform-specific storages, nothing this project's asset pipeline doesn't
need. It owns a `core/scene/SceneManager` and registers THREE scenes:

- **`HubScene`** (`game/scenes/HubScene.ts`) — free-roam: the player wanders,
  collects `Money_Pile_Small` pickups, and walks into one of two minigame
  entry gates.
- **`RunnerMinigameScene`** (`game/scenes/RunnerMinigameScene.ts`) — the
  continuous pointer-follow runner mode, ends at a finish gate.
- **`SwipeMinigameScene`** (`game/scenes/SwipeMinigameScene.ts`) — the
  discrete-lane swipe runner mode, ends on a countdown timer.

**No scene ever calls `SceneManager.changeScene()` itself** — `GameScene`
gives scenes no reference to it at all (see `core/scene/GameScene.ts`). Every
multi-scene game in this repo follows the same shape instead: a scene
exposes a plain `signals` `Signal` for whatever navigation event it needs
(`HubScene.onEnterMinigame`, `RunnerMinigameScene.onComplete`,
`SwipeMinigameScene.onComplete`), and `index.ts`'s `startGame()` is the only
thing that listens and calls `changeScene()`:

```ts
const hub = this.sceneManager.register<HubScene>('hub', HubScene, this);
hub.onEnterMinigame.add((sceneKey: string) => this.sceneManager.changeScene(sceneKey));

const runnerMinigame = this.sceneManager.register<RunnerMinigameScene>('runner-minigame', RunnerMinigameScene, this);
runnerMinigame.onComplete.add(() => this.sceneManager.changeScene('hub'));
```

**`SceneManager.changeScene()` fully `destroy()`s the outgoing scene and
rebuilds the incoming one from scratch** (`core/scene/SceneManager.ts`) — so
walking hub → minigame → hub doesn't pause/resume the hub, it throws the old
one away and builds a brand new one. The one thing that has to survive that
is the collected money total — see `GameState.ts` below.

### Shared 3D scaffolding — `game/scenes/shared/WorldEnvironment.ts`

All three scenes need the same floor/collider/lighting/player-spawn/
follow-camera boilerplate, factored into one non-scene helper class each
scene composes in its own `build()`:

- **`World`** (`game/ecs/World.ts`) — the ECS: ticks every `Entity`'s
  `fixedUpdate()`/`update()`, then steps `PhysicsWorld`.
- **`VirtualCameraSystem`** (`game/camera/VirtualCameraSystem.ts`) — blends
  the actual THREE.PerspectiveCamera between named presets.

A scene's own `fixedUpdate()` calls `env.fixedUpdate(delta)` (physics +
camera blend) then `env.updateCamera(threeCamera, delta)` (repositions the
real camera from whichever `CameraSettings` is currently "current"); its own
`update()` calls `env.update(delta)` (drives animation/visual sync) then
`super.update()` — `ThreeScene`'s own — for the actual THREE render call.
Gameplay-specific stuff (gates, collectibles, minigame UI, dev-gui wiring)
stays in each scene itself, not in `WorldEnvironment`.

## ECS — `game/ecs/`

A tiny Unity-flavored Entity/Component system, ported unmodified from
`bandit`'s own (see that game's README for more detail — this one didn't
change any of it):

- `Entity` — a `THREE.Group` transform + a bag of `Component`s.
  `awake()`/`update()`/`fixedUpdate()`/`destroy()` lifecycle.
- `Component` — `awake()`/`start()`/`onEnable()`/`onDisable()`/`update()`/
  `fixedUpdate()`/`destroy()`, all optional. `component.enabled = false`
  freezes a component in place without removing it — this is how
  `SwipeMinigameScene` disables `PlayerMovementController` before activating
  `SwipeRunnerController` (see below) without them fighting over the same
  `RigidBody.velocity` in the same tick.
- `World` — owns `PhysicsWorld`, ticks every registered `Entity`.

## Physics — `game/physics/`

Kinematic AABB collide-and-slide, no mass/impulses/rotation:

- `RigidBody` (a `Component`) — a box collider + velocity. `isStatic` /
  `isTrigger` / `layer` / `mask` — see the file's own doc for the full
  event list (`onCollisionEnter/Stay/Exit`, `onTriggerEnter/Stay/Exit`).
- `PhysicsWorld` — steps every dynamic body: gravity, move X, move Z, move
  Y (grounded is only ever set true here), then one broad-phase contact
  pass for events. Reads `WorldSettings.gravity`/`.maxPhysicsDelta` **live**
  every step (not a value copied at import time) — see "Data-driven
  settings."
- `PhysicsConstants.ts` — layers (`Default`/`Player`/`Environment`), debug
  colors. Gravity/max-delta live in `../data/WorldSettings.ts` instead,
  since those are meant to be tunable.

## The character — `game/entities/`, `game/components/CharacterVisualComponent.ts`

- **`CharacterBody`** — the purely visual/animated half: FBX loading, the
  flat-color material fix (this rig's FBX export has no texture at all), a
  rounded (`RoundedBoxGeometry`) head with a face-decal plane in front of
  it (see `game/builders/TextureBuilder.ts`), and `setUp()` — the entire
  idle/walk/run/jump/roll/slide animation state graph (see "Animation state
  graph" below).
- **`ThirdPersonCharacter`** — a thin player-driven wrapper around
  `CharacterBody`. Owns nothing itself except a handful of animator-trigger
  pass-throughs (`jump()`/`dodge()`/`slide()`); `getMoveSpeed()` reads
  `PlayerSettings.ts` live.
- **`CharacterVisualComponent`** (a `Component`) — bridges `RigidBody` to
  `ThirdPersonCharacter.update()` every frame: reads the collider's center/
  velocity/grounded state, forwards `moveInput` (set by whichever movement
  controller is active), and owns the two "how long is this trigger-fired
  action still playing" timers (`rollingRemaining`/`slidingRemaining`, both
  read from `PlayerSettings.ts`).

### Animation state graph — `CharacterBody.setUp()`

States: `idle`, `walk`, `run`, `jumpUp`, `falling`, `landing`, `roll`,
`slide`, `hit`. Driven by `AnimatorBoard` (`game/entities/animation/AnimationBoard.ts`)
— a minimal Unity-Animator-style state machine: each state IS a clip id,
transitions crossfade in when a condition or fired trigger matches (see
`registerTransition()`'s own doc for the exact `(from, to, duration,
condition?, trigger?, loop?)` signature).

`hit` (`ThirdPersonCharacter.hit()`, fired by `ObstacleBuilder.ts`'s
`onCollisionEnter` callback in both minigame scenes — see "Two minigame
scenes" below) is a one-shot pose like `jumpUp`/`roll`/`slide`, but with
**no exit transition at all** — the whole minigame scene freezes movement
the instant it fires, so there's nothing to transition back to until the
player leaves for the hub (which destroys this entity anyway). Reuses the
`FallingIdle` clip, which was already in `modelsRegistry.ts` but had never
actually been wired to anything until now.

**Two easy-to-reintroduce bugs already fixed here, worth knowing about
before touching this graph again:**

1. **One-shot poses must pass `loop: false`.** `jumpUp`, `falling`,
   `landing`, `roll`, and `slide` are all one-shot poses — they should play
   through once and hold their last frame (`clampWhenFinished`), not loop.
   `registerTransition()`'s `loop` parameter defaults to `true` (correct
   for `idle`/`walk`/`run`), so every ONE of those five transitions needs
   the trailing `false` explicitly. Missing it on even one (this happened
   to `falling` once already) means that state keeps **restarting from
   frame 0** for as long as it outlasts its own clip's natural
   duration — looks exactly like a stutter/glitch, not a smooth arc.
2. **`jumpUp → falling`'s condition is `verticalSpeed <= 0`, not `> 0`.**
   Real physics gives `verticalSpeed` a big *positive* value the instant a
   jump launches, so a naive `> 0` check fires on the very next tick — this
   was copy-pasted from `bandit`'s original cosmetic (fake, ±1) jump timer,
   where it was correct for a completely different reason. `<= 0` waits
   for the actual apex/descent, so `jumpUp` gets to play through the whole
   ascent.
3. **Two states sharing the same underlying clip must not "restart" each
   other.** `MainPlayer.loadCharacter()` currently registers `'falling'`
   and `'landing'` against the identical clip file (no distinct "falling"
   art exists yet). `THREE.AnimationMixer.clipAction()` caches one
   `AnimationAction` per clip, so transitioning between two ids that
   resolve to the same clip means `mix()` would otherwise `.reset()` (snap
   to frame 0) the exact action that's already mid-play. `AnimatorController.mix()`
   guards against this: if the resolved action is already `currentAction`,
   it just updates the bookkeeping id and leaves playback alone. **If you
   ever give `falling` its own real clip, this guard becomes a no-op
   automatically — nothing to undo.**

## Player input — two DIFFERENT, mutually-exclusive controllers

`MainPlayer` (`game/player/MainPlayer.ts`) adds a `RigidBody` plus **both**
of the below as sibling components in `awake()`. Only one drives
`RigidBody.velocity` at a time; whichever minigame scene is active toggles
between them via `component.enabled`.

### 1. `PlayerMovementController` — free movement + continuous pointer-follow runner mode

Default state: reads `core/io/KeyboardInputMovement` (WASD/arrows) and
`core/io/AnalogInput` (mobile joystick) into a `moveInput` vector, applies
it to `RigidBody.velocity` scaled by `PlayerSettings.walkSpeed` (× `
runSpeedMultiplier` while Shift is held). Space jumps (grounded-gated,
`PlayerSettings.jumpSpeed`), Ctrl dodges (`CharacterVisualComponent.dodge()`).

`enterRunnerMode(worldDirection)` switches it into **continuous
pointer-follow mode**: forward movement becomes automatic and constant
along `worldDirection`; sideways steering switches entirely from
WASD/joystick to tracking the raw pointer/touch X position on screen (a
plain `window.addEventListener('pointermove', ...)` — deliberately NOT
`core/io/PointerFollowInput`, which withholds any position until the first
click/tap; this needs to respond immediately). Left edge of the window
maps to one lane edge, right edge to the other, eased toward with an
exponential-approach (not snapped) so it reads as "the character tries to
match the finger," not jump-to-cursor. `exitRunnerMode()` reverts.

Both jump (Space) and dodge (Ctrl) check `e.repeat` and bail — holding the
key must not machine-gun-retrigger a one-shot action.

### 2. `SwipeRunnerController` — discrete-lane swipe runner mode

Starts fully `enabled = false`. `activate(worldDirection, laneCount,
laneWidth, laneOrigin)` turns it on: snaps forward movement to constant
automatic pace, and steering becomes **swipe left/right = move exactly one
lane over** (a plain `pointerdown`/`pointerup` drag-distance detector, plus
a WASD/arrow keydown fallback for desktop testing — see the file's own doc
for why this does NOT use the shared `core/io/SwipeInputManager`: that
class reads `.clientX` directly off a native `TouchEvent`, which has no
such property, so real touch swipes never registered there). Swipe up
jumps, swipe down calls `CharacterVisualComponent.slide()`.

**`laneOrigin` matters.** `activate()` doesn't assume the player is
standing exactly in the middle lane's center — it measures the player's
CURRENT actual world position against `laneOrigin` (the corridor's fixed
world-space center, the same point the visible lane rectangles are drawn
from — see `LaneMath.laneOffset()`) and snaps to whichever lane is
*nearest*. Skipping this (assuming "wherever you are right now = lane
center") was an earlier bug: the trigger gate is several units wide, so a
player entering off-center would run down the edge of a lane instead of
its middle.

`deactivate()` turns it back off — not actually called today (see this
file's own doc comment on why: SwipeMinigameScene just ends the whole scene
instead of reverting in-place).

## Camera — `game/camera/VirtualCameraSystem.ts` + `game/data/GameSettings.ts` + `game/scenes/shared/WorldEnvironment.ts`

A small Cinemachine-style system, entirely separate from the ECS:

- `GameSettings.ts` defines named `CameraSettings` presets — `yawDeg`/
  `pitchDeg`/`distance` (spherical orbit around a look-at point) +
  `followSpeed` (how fast the look-at point itself chases the player) +
  `offset` (world-space shift of the look-at point, e.g. up to chest
  height). Currently: `standard`, `closeup`, `topdown`, `runner`.
- `VirtualCameraSystem` holds a `Map<id, CameraSettings>` (via `register()`)
  and a live `current` object. `cutTo(id)` snaps instantly; `blendTo(id,
  durationSec)` eases every field from wherever `current` is right now
  (yaw uses shortest-path angle interpolation) toward the target —
  retargeting mid-blend blends from the current partial state, never pops.
- `WorldEnvironment` (composed by every scene) registers every mode from
  `CAMERA_SETTINGS_BY_MODE`, and each scene's own `fixedUpdate()` calls
  `env.updateCamera(threeCamera, delta, options?)` to actually position the
  real camera from whichever `CameraSettings` is currently "current." HubScene
  additionally wires **1/2/3/4** to demo-blend between the registered modes
  directly (`awakeCameraHotkeys()` — unrelated to actual gameplay, just a
  way to preview presets).
- **`CameraFollowOptions`** (`updateCamera()`'s third argument) lets a scene
  override individual axes of the base follow target (the player's own
  `transform.position`, feet level, plus `settings.offset`) without
  touching the shared follow/blend math itself:
  - `lockX` — pins the look-at point's X to a fixed world value instead of
    tracking the player's own X. `RunnerMinigameScene` passes its lane's own
    centerline here, so the camera holds a stable "center of the gameplay"
    framing instead of swaying with the player's lateral pointer-follow
    steering.
  - `freezeHeightWhileAirborne` — the look-at point's Y only updates while
    `mainPlayer.rigidBody.grounded` is true, frozen at the last grounded
    height for the whole jump so a hop doesn't bob the camera, then resyncs
    the instant the player lands. Also used by `RunnerMinigameScene`.
  - `HubScene`/`SwipeMinigameScene` call `updateCamera()` with no options —
    full player-tracking on every axis, same as before this existed.
- Entering a minigame scene cuts (not blends — there's no "walking up to a
  gate while already in free-roam" moment to blend from, the scene just
  starts already in runner mode) to `'runner'`. The hub's "Reset" button
  **cuts** back to `'standard'` — a hard correction, not a cinematic beat.

## Two minigame scenes — `RunnerMinigameScene.ts`, `SwipeMinigameScene.ts`

Both run along the same fixed world direction
(`MinigameSettings.RUNNER_LANE_DIRECTION = (0,0,-1)`, matching every runner
camera preset's own `yawDeg: 0` convention — the camera and the lane's
forward have to agree, or the camera looks the wrong way down the lane).
Entering either from `HubScene`'s own gates (or its quick-launch buttons —
see "UI" below) loads a dedicated scene (see "Big picture" above) rather
than switching modes in-place — each one:

- **`RunnerMinigameScene`**: the free-mode / continuous pointer-follow
  runner. `build()` spawns the player already in `enterRunnerMode(...)` (no
  walk-up — see this file's own doc), and a single finish `RigidBody(isTrigger:
  true)` gate `MinigameSettings.RUNNER_MINIGAME_SETTINGS.laneLength` (400)
  away fires `onComplete` once crossed.
- **`SwipeMinigameScene`**: the discrete-lane swipe runner. `build()`
  disables `movementController`, calls `swipeRunnerController.activate(...)`,
  and draws one full-width, differently-colored rectangle per lane
  (`MinigameSettings.SWIPE_MINIGAME_SETTINGS.laneColors`), computed from the
  exact same `laneOffset()` call `SwipeRunnerController` itself snaps to, so
  the visible lanes and the ones the player actually lands on can never
  drift apart. **Each rectangle is subdivided along its length**
  (`PlaneGeometry`'s 4th arg) — `RunnerBendService`'s bend is a per-vertex
  displacement, so a plain 1×1 plane only bends at its 4 corners and would
  warp/sink out of view over a long strip instead of following the same
  curve the floor's own mesh does (see `FloorBuilder`'s own doc — same fix,
  same reasoning). Ends on a plain countdown
  (`SWIPE_MINIGAME_SETTINGS.durationSec`, 25s, shown top-center), **not** a
  finish line — simpler than tracking a score/finish condition for a demo.

Both dispatch `onComplete` (a plain `signals` `Signal`, no payload) — see
"Big picture" above for why they never call `SceneManager.changeScene()`
themselves. Both also spawn a `ReturnToHubButton` (top-right) that
dispatches that same `onComplete` — a manual way out that doesn't depend on
finishing/timing out (see "Obstacles" below for the other reason it exists).

### A bigger, denser, center-focused floor

Both minigames build their `WorldEnvironment` with
`MinigameSettings.RUNNER_FLOOR_SETTINGS` instead of `WorldEnvironment`'s own
hub-sized defaults — `size: 900` (comfortably bigger than either minigame's
own lane length/max run distance, so the player never reaches the edge of
the ground collider before the finish gate/timer does its job),
`segments: 96` and `centerBias: 1.8` (denser than the hub's plain 32, and
non-uniformly so — see `FloorBuilder.build()`'s own doc on `centerBias`:
vertices cluster near the center, where the player actually is and where
`RunnerBendService`'s wave bend needs enough nearby detail to look smooth,
rather than paying for that same density all the way out to the floor's
rarely-seen far edges). `WorldEnvironment` exposes the actual size it built
as `env.floorSize` — both minigame scenes read that (not the `FLOOR_SIZE`
constant) when sizing their own lane visuals/obstacle placement.

### Obstacles — `game/builders/ObstacleBuilder.ts`

Solid (not trigger) boxes, `MinigameSettings.OBSTACLE_SETTINGS.spacing`
apart starting `startOffset` world units in. `buildObstacle()`'s
`RigidBody.onCollisionEnter` fires `onHit` once (guarded against firing
twice for the same box); each scene's own `onHit` callback freezes the
player for the rest of that scene's lifetime — disables whichever movement
controller currently owns them, zeroes `RigidBody.velocity`, and calls
`character.hit()` (see "Animation state graph" above) — there's no
un-freeze; `ReturnToHubButton` is the only way out from there.

- **`RunnerMinigameScene`** alternates each obstacle left/right of the
  lane's own centerline (`OBSTACLE_SETTINGS.runnerLateralOffset`) — the
  player steers around each one via the same pointer-follow control as
  normal.
- **`SwipeMinigameScene`** blocks every lane but one at each interval, and
  which lane stays open rotates (`i % laneCount`) — the player has to keep
  actually swiping, not just settle into one lane.

## Resource pickups — `game/entities/Collectible.ts`, `game/data/CollectibleSettings.ts`

A ring of `Money_Pile_Small` pickups (`generateCollectibleSpawnPositions()`,
`CollectibleSettings.ts`) spread around `PLAYER_SPAWN_POSITION` in
`HubScene` — the "central area" the player starts in, well clear of the two
minigame entry gates (`HubScene`'s own `RUNNER_GATE_POSITION`/
`SWIPE_GATE_POSITION`).

Each `Collectible` is its own `Entity`: a static `RigidBody(isTrigger: true)`
sized to `COLLECTIBLE_TUNING.attractRadius` detects the player, then homes
toward `getPlayerPosition()` — `MainPlayer.getCollectTargetPosition()`, feet
level raised by `PlayerSettings.collectTargetHeight` so it flies to roughly
body-center instead of the ground — along an `ArcSpline` curve (shared with
`FlyingResourceIcon.ts`, see `game/utils/ArcSpline.ts`) over a **fixed
real-time duration** (`COLLECTIBLE_TUNING.snapDurationSec`, eased,
NOT a closing speed — a running player re-bends the curve every tick but
never delays or hastens arrival), firing `onCollected(resourceAmount)` and
flagging itself `collected` right as it lands — **it never calls
`world.remove()` on itself**, since that would splice `World`'s own
`entities` array out from under the `for...of` loop that's mid-tick calling
it. `pruneCollectedPickups()` — run from `HubScene.update()`, strictly after
`world.update()` has returned for the frame — is what actually calls
`world.remove()`.

Loading follows `MainPlayer.loadCharacter()`'s own two-step split: `awake()`
adds the (synchronous) trigger `RigidBody`; a separate async `load()` (via
`core/three/ModelLoaderManager`, this project's shared GLTF/FBX/OBJ loader
with its own load-cache) fetches and positions the mesh, called right after
`world.add()`. Materials get `BendService.applyBend()` like everything else
in the 3D scene, or they'd sit flat while the floor curves away under them.

**Collect → HUD payout** (ported from `games/bandit/legacy`'s
`EconomyUI`/`FlyingResourceIcon` — see
[`docs/bandit-legacy-reference.md`](docs/bandit-legacy-reference.md)):
`HubScene.onCollectResource()` doesn't bump the money counter directly — it
calls `spawnFlyingIconToOverlayPoint()` (`game/ui/FlyingResourceIcon.ts`),
which flies a `CollectibleDefinition.icon` sprite from the pickup's last
world position to `GameUI.getMoneyIconOverlayPosition()` along a
quadratic-Bezier arc, and **only inside that flight's `onArrive`** does the
money total actually update — `GameState.addMoney()` (see "Big picture"
above for why the total lives outside any scene instance) followed by
`GameUI.setResourceCount()`, which snaps the digits instantly and plays an
icon punch-scale + rising `"+N"`, both ported verbatim from
`EconomyUI.playGainFeedback()`. This "mutate on landing, not on departure"
order is deliberate — matches every deposit flow in the legacy game.

Adding another pickup kind: add a new `CollectibleDefinition` to
`CollectibleSettings.ts` (model + resourceAmount + modelScale + `icon`, an
image under `raw-assets/non-preload/`, built via `npm run image`) and pass
it to `new Collectible(...)` instead of `MONEY_PILE_SMALL`.

## Data-driven settings — `game/data/`

Every tunable number lives in one of these, read **live** (not copied at
import time) by whatever consumes it, so editing a value — by hand, or via
the dat.GUI sliders `HubScene.wireDevGui()` wires up under `?dev` — takes
effect immediately with no rebuild, in whichever scene is currently active
(these are plain module-level objects, not per-scene copies):

| File | Holds | Read by |
|---|---|---|
| `PlayerSettings.ts` | `walkSpeed`, `runSpeedMultiplier`, `jumpSpeed`, `rollDuration`, `slideDuration`, `collectTargetHeight` + the pure `getPlayerMoveSpeed()` function | `PlayerMovementController`, `SwipeRunnerController`, `CharacterVisualComponent`, `MainPlayer.getCollectTargetPosition()` |
| `WorldSettings.ts` | `gravity`, `maxPhysicsDelta` | `PhysicsWorld.step()` |
| `GameSettings.ts` | Named `CameraSettings` presets (see Camera section) | `WorldEnvironment`/`VirtualCameraSystem` |
| `CharacterViews.ts` | Named color+face combos (ported from `bandit`'s own shop/Character-Views data, minus the shop/equip system) | `MainPlayer.loadCharacter()` |
| `LaneMath.ts` | The one `laneOffset(index, count, width)` formula | `SwipeRunnerController` AND `SwipeMinigameScene` (shared so the two can't drift apart) |
| `CollectibleSettings.ts` | Pickup `CollectibleDefinition`s (model/resourceAmount/modelScale/icon) + shared `COLLECTIBLE_TUNING` (attractRadius/snapDurationSec/arcHeight) + `generateCollectibleSpawnPositions()` | `Collectible`, `HubScene`, `GameUI` |
| `MinigameSettings.ts` | `RUNNER_LANE_DIRECTION` + per-minigame settings (`RUNNER_MINIGAME_SETTINGS.laneLength`, `SWIPE_MINIGAME_SETTINGS.durationSec`/`laneCount`/`laneWidth`/`laneColors`) + `RUNNER_FLOOR_SETTINGS` (size/segments/centerBias) + `OBSTACLE_SETTINGS` (spacing/startOffset/halfExtents/runnerLateralOffset) | `RunnerMinigameScene`, `SwipeMinigameScene`, `WorldEnvironment` |
| `GameState.ts` | The collected money total — the one piece of state that survives a scene switch (see "Big picture" above) | `HubScene` |

`RunnerBendService.ts`'s own `uniforms` (Y/X amplitude, Y/X frequency) live outside `game/data/` (they're shader uniforms, not plain data), but follow the same "edit by hand or via `?dev`" convention — wired once in `index.ts`'s `startGame()` under a "Runner Bend" dev-GUI folder (safe to wire exactly once, unlike `HubScene`'s own per-instance camera sliders, since `RunnerBendService.uniforms` is a static singleton that's never replaced on scene rebuild).

## UI — `game/ui/GameUI.ts` (used by `HubScene` only)

One `core/ui/BaseButton`, top-right, labeled "Reset," plus a money "pill"
(icon + amount), top-left. Positioned against `Game.overlayScreenData.
topRight`/`topLeft` minus a fixed margin — the same "screen-corner-minus-
margin" convention `bandit`'s own `EconomyUI`/`UIService` use for their
currency HUD — added directly to `game.uiLayer` (not nested under the
scene). No nine-slice button art exists in this project's own asset set, so
the button uses `PIXI.Texture.WHITE` + tint, the same fallback `bandit`
itself uses wherever it has no art yet.

Clicking it calls `HubScene.resetPlayer()`: teleport to spawn, zero
velocity, cut (not blend) the camera to `standard`. The minigame scenes
don't have a reset button — leaving one just ends that scene (`onComplete`)
and returns to the hub.

## Assets — own `raw-assets/`, own `registry/`, NOT shared with `bandit`

This game does **not** read `bandit`'s `public/bandit/...` output. It has
its own:

- `raw-assets/models/characters{m}/default/*.fbx` — the character rig +
  every animation clip, built via `GAME=bandit-controller node
  tools/models/build-models.mjs` into `public/bandit-controller/models/...`
  and `registry/assetsRegistry/modelsRegistry.ts` (imported as `MODELS` in
  `MainPlayer.ts`).
- `raw-assets/non-preload/skins/*.png` — the face decal images referenced
  by `CharacterViews.ts`, built via `GAME=bandit-controller node
  tools/image/build-image.mjs` into
  `public/bandit-controller/images/non-preload/skins/*.webp`.

**Important: never run `npm run all` for this game** unless you mean to
rebuild every asset type — that script (`tools/build-all.mjs`) deletes
every OTHER game's `public/<game>/` folder that doesn't match the current
`GAME` (single-active-game-at-a-time convention) and rewrites `.env`. Use
the narrower per-type scripts above (or `npm run models` / `npm run image`
with `GAME=bandit-controller` already set in `.env`) instead — they only
touch this game's own output.

## Where to look first when extending

- **New player ability (another one-shot action like roll/slide)**: add a
  state + transitions in `CharacterBody.setUp()` (remember `loop: false`
  and a real descend/finish condition, not a "just fired" one), a trigger
  pass-through on `ThirdPersonCharacter`, a timer + public method on
  `CharacterVisualComponent`, and a key/swipe binding on whichever
  controller(s) should expose it.
- **New camera preset**: add an entry to `CAMERA_SETTINGS_BY_MODE` in
  `GameSettings.ts` — `WorldEnvironment`'s constructor already registers
  everything in that map automatically, and HubScene's 1/2/3/4 demo hotkeys
  pick up new entries with no code change.
- **A third minigame**: add a new `game/scenes/YourMinigameScene.ts`
  (compose a `WorldEnvironment`, same shape as `RunnerMinigameScene`/
  `SwipeMinigameScene`), give it its own `onComplete: Signal`, add an entry
  gate for it in `HubScene.buildMinigameGates()`, and register + wire it in
  `index.ts`'s `startGame()` (see "Big picture" above for the exact
  register/signal-wiring shape every scene transition in this repo follows).
- **A third movement mode**: follow `SwipeRunnerController`'s shape — a
  `Component` that starts `enabled = false`, an `activate()`/`deactivate()`
  pair — added as a sibling component in `MainPlayer.awake()`, activated
  from whichever minigame scene owns it.
- **Real art for `falling`**: just point `MainPlayer.loadCharacter()`'s
  `'falling'` registration at a real clip instead of reusing `LandingNew`
  — the shared-clip guard in `AnimatorController.mix()` (see "Animation
  state graph" above) is inert once the ids resolve to different clips,
  nothing else needs to change.
