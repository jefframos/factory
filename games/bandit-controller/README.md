# Bandit Controller

A minimal, self-contained third-person character-controller tech demo — a
bent wireframe-grid floor, one player character with walk/run/jump/dodge/
slide, a data-driven virtual-camera system, and two parallel "runner mode"
corridors for testing subway-surfers-style controls. It was extracted from
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

## Big picture: two things run per frame

`index.ts` boots a plain `core/Game` subclass — no PIXI.Assets bundles, no
platform-specific storages, nothing this project's asset pipeline doesn't
need. It registers exactly one scene, `ControllerScene`
(`game/scenes/ControllerScene.ts`), which owns everything:

- **`World`** (`game/ecs/World.ts`) — the ECS: ticks every `Entity`'s
  `fixedUpdate()`/`update()`, then steps `PhysicsWorld`.
- **`VirtualCameraSystem`** (`game/camera/VirtualCameraSystem.ts`) — blends
  the actual THREE.PerspectiveCamera between named presets.

`ControllerScene.fixedUpdate()` runs the physics step, then the camera
system's blend, then repositions the real camera from whichever
`CameraSettings` is currently "current." `ControllerScene.update()` just
renders (`world.update()` drives animation/visual sync; `super.update()` —
`ThreeScene`'s own — does the actual THREE render call).

## ECS — `game/ecs/`

A tiny Unity-flavored Entity/Component system, ported unmodified from
`bandit`'s own (see that game's README for more detail — this one didn't
change any of it):

- `Entity` — a `THREE.Group` transform + a bag of `Component`s.
  `awake()`/`update()`/`fixedUpdate()`/`destroy()` lifecycle.
- `Component` — `awake()`/`start()`/`onEnable()`/`onDisable()`/`update()`/
  `fixedUpdate()`/`destroy()`, all optional. `component.enabled = false`
  freezes a component in place without removing it — this is how
  `ControllerScene` hands movement between the two player controllers (see
  below) without them fighting over the same `RigidBody.velocity` in the
  same tick.
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
`slide`. Driven by `AnimatorBoard` (`game/entities/animation/AnimationBoard.ts`)
— a minimal Unity-Animator-style state machine: each state IS a clip id,
transitions crossfade in when a condition or fired trigger matches (see
`registerTransition()`'s own doc for the exact `(from, to, duration,
condition?, trigger?, loop?)` signature).

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
`RigidBody.velocity` at a time; `ControllerScene` toggles between them via
`component.enabled`.

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

`deactivate()` turns it back off; `ControllerScene`'s exit trigger also
re-enables `PlayerMovementController`.

## Camera — `game/camera/VirtualCameraSystem.ts` + `game/data/GameSettings.ts`

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
- `ControllerScene` registers every mode from `CAMERA_SETTINGS_BY_MODE`,
  cuts to `standard` on build, and calls `cameraSystem.update(delta)` each
  fixed tick before reading `cameraSystem.current` to actually position
  `this.threeCamera`. Press **1/2/3/4** while playing to demo-blend between
  the registered modes directly (`awakeCameraHotkeys()` — unrelated to
  actual gameplay, just a way to preview presets).
- Entering either runner corridor blends to `'runner'`; either exit gate
  blends back to `standard`. The "Reset" button (see UI below) **cuts**
  instead of blends — it's a hard correction, not a cinematic beat.

## Two parallel "runner" corridors — `ControllerScene.buildRunnerLane()`

Both run along the same fixed world direction (`RUNNER_LANE_DIRECTION =
(0,0,-1)`, matching every camera preset's own `yawDeg: 0` convention — the
camera and the lane's forward have to agree, or the camera looks the wrong
way down the lane), `RUNNER_LANE_LENGTH` apart in Z, both realized as a
pair of `RigidBody(isTrigger: true)` gates plus a purely-visual translucent
plane marker at each gate.

- **x = 0**: the free-mode / continuous pointer-follow corridor. Enter
  gate calls `movementController.enterRunnerMode(...)` + blends camera to
  `'runner'`; exit gate reverses both.
- **x = `SWIPE_LANE_CENTER_X`** (the first corridor's gate half-width, plus
  a small gap, plus the second gate's own half-width — see the constant's
  own derivation): the discrete-lane swipe corridor. Enter gate disables
  `movementController`, calls `swipeRunnerController.activate(...)`, blends
  camera; exit gate reverses both and re-enables `movementController`.
  `buildSwipeLaneMarkers()` draws one full-width, differently-colored
  rectangle per lane (`LaneSettings.colors`), computed from the exact same
  `laneOffset()` call `SwipeRunnerController` itself snaps to, so the
  visible lanes and the ones the player actually lands on can never drift
  apart. **Each rectangle is subdivided along its length** (`PlaneGeometry`'s
  4th arg) — `BendService`'s bend is a per-vertex displacement, so a plain
  1×1 plane only bends at its 4 corners and would warp/sink out of view
  over an 80-unit strip instead of following the same curve the floor's
  own 32×32-segment mesh does (see `FloorBuilder`'s own doc on this exact
  issue — same fix, same reasoning).

## Resource pickups — `game/entities/Collectible.ts`, `game/data/CollectibleSettings.ts`

A ring of `Money_Pile_Small` pickups (`generateCollectibleSpawnPositions()`,
`CollectibleSettings.ts`) spread around `PLAYER_SPAWN_POSITION` — the
"central area" the player starts in, inside the radius the runner-lane gates
sit outside of (`RUNNER_ENTER_GATE_Z = -10`).

Each `Collectible` is its own `Entity`: a static `RigidBody(isTrigger: true)`
sized to `COLLECTIBLE_TUNING.attractRadius` detects the player, then every
`fixedUpdate` it lerps its own `transform.position` toward
`getPlayerPosition()` at `COLLECTIBLE_TUNING.snapSpeed` until within
`collectDistance`, at which point it fires `onCollected(resourceAmount)` and
flags itself `collected` — **it never calls `world.remove()` on itself**,
since that would splice `World`'s own `entities` array out from under the
`for...of` loop that's mid-tick calling it. `pruneCollectedPickups()` — run
from `ControllerScene.update()`, strictly after `world.update()` has
returned for the frame — is what actually calls `world.remove()`.

Loading follows `MainPlayer.loadCharacter()`'s own two-step split: `awake()`
adds the (synchronous) trigger `RigidBody`; a separate async `load()` (via
`core/three/ModelLoaderManager`, this project's shared GLTF/FBX/OBJ loader
with its own load-cache) fetches and positions the mesh, called right after
`world.add()`. Materials get `BendService.applyBend()` like everything else
in the 3D scene, or they'd sit flat while the floor curves away under them.

**Collect → HUD payout** (ported from `games/bandit/legacy`'s
`EconomyUI`/`FlyingResourceIcon` — see
[`docs/bandit-legacy-reference.md`](docs/bandit-legacy-reference.md)):
`ControllerScene.onCollectResource()` doesn't bump the money counter
directly — it calls `spawnFlyingIconToOverlayPoint()`
(`game/ui/FlyingResourceIcon.ts`), which flies a `CollectibleDefinition.icon`
sprite from the pickup's last world position to
`GameUI.getMoneyIconOverlayPosition()` along a quadratic-Bezier arc, and
**only inside that flight's `onArrive`** does the money counter actually
increment (`GameUI.setResourceCount()`, which snaps the digits instantly and
plays an icon punch-scale + rising `"+N"`, both ported verbatim from
`EconomyUI.playGainFeedback()`). This "mutate on landing, not on departure"
order is deliberate — matches every deposit flow in the legacy game.

Adding another pickup kind: add a new `CollectibleDefinition` to
`CollectibleSettings.ts` (model + resourceAmount + modelScale + `icon`, an
image under `raw-assets/non-preload/`, built via `npm run image`) and pass
it to `new Collectible(...)` instead of `MONEY_PILE_SMALL`.

## Data-driven settings — `game/data/`

Every tunable number lives in one of these, read **live** (not copied at
import time) by whatever consumes it, so editing a value — by hand, or via
the dat.GUI sliders `ControllerScene.build()` wires up under `?dev` — takes
effect immediately with no rebuild:

| File | Holds | Read by |
|---|---|---|
| `PlayerSettings.ts` | `walkSpeed`, `runSpeedMultiplier`, `jumpSpeed`, `rollDuration`, `slideDuration` | `ThirdPersonCharacter`, `PlayerMovementController`, `SwipeRunnerController`, `CharacterVisualComponent` |
| `WorldSettings.ts` | `gravity`, `maxPhysicsDelta` | `PhysicsWorld.step()` |
| `LaneSettings.ts` | `count`, `width`, `colors[]` for the swipe corridor | `ControllerScene` (visible rects) + `SwipeRunnerController.activate()` call site |
| `GameSettings.ts` | Named `CameraSettings` presets (see Camera section) | `ControllerScene`/`VirtualCameraSystem` |
| `CharacterViews.ts` | Named color+face combos (ported from `bandit`'s own shop/Character-Views data, minus the shop/equip system) | `MainPlayer.loadCharacter()` |
| `LaneMath.ts` | The one `laneOffset(index, count, width)` formula | `SwipeRunnerController` AND `ControllerScene` (shared so the two can't drift apart) |
| `CollectibleSettings.ts` | Pickup `CollectibleDefinition`s (model/resourceAmount/modelScale/icon) + shared `COLLECTIBLE_TUNING` (attractRadius/snapSpeed/collectDistance) + `generateCollectibleSpawnPositions()` | `Collectible`, `ControllerScene.buildCollectibles()`, `GameUI` |

## UI — `game/ui/GameUI.ts`

One `core/ui/BaseButton`, top-right, labeled "Reset." Positioned against
`Game.overlayScreenData.topRight` minus a fixed margin — the same
"screen-corner-minus-margin" convention `bandit`'s own `EconomyUI`/
`UIService` use for their currency HUD — added directly to `game.uiLayer`
(not nested under the scene). No nine-slice button art exists in this
project's own asset set, so it uses `PIXI.Texture.WHITE` + tint, the same
fallback `bandit` itself uses wherever it has no art yet.

Clicking it calls `ControllerScene.resetPlayer()`: teleport to spawn, zero
velocity, exit BOTH runner modes (`exitRunnerMode()` +
`swipeRunnerController.deactivate()` + re-enable `movementController`),
cut (not blend) the camera to `standard`.

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
  `GameSettings.ts` — `ControllerScene.build()` already registers
  everything in that map automatically, and the 1/2/3/4 demo hotkeys pick
  up new entries with no code change.
- **A third movement mode**: follow `SwipeRunnerController`'s shape — a
  `Component` that starts `enabled = false`, an `activate()`/`deactivate()`
  pair, and a new trigger-gate pair in `ControllerScene` that disables
  whichever controller currently owns movement before enabling the new one.
- **Real art for `falling`**: just point `MainPlayer.loadCharacter()`'s
  `'falling'` registration at a real clip instead of reusing `LandingNew`
  — the shared-clip guard in `AnimatorController.mix()` (see "Animation
  state graph" above) is inert once the ids resolve to different clips,
  nothing else needs to change.
