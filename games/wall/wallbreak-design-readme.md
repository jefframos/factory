# WALLBREAK
### A voxel wall-punching incremental — design + technical README
**Engine:** three.js (WebGL2) · **Target:** mobile portrait first, desktop supported
**Design goal:** hold a new player for their first **5 minutes**, and make minute 5 feel like a beginning, not an end.

---

## 1. What this is

A first-person-ish incremental game where the only verb is **punch the wall**. The wall is a real voxel grid: every punch removes actual chunks from the exact spot you tapped, and the hole you carve *is* the progress bar. Chunks drop cash. Cash buys buildings that punch for you. Buildings unlock multipliers. Multipliers let you break bigger walls.

It is the Wall Destroyer loop, with one structural change that matters:

> **In Wall Destroyer the wall is decoration over a number. Here the wall is the mechanic.**

Tap position determines which voxels die. Aiming is a real input. That single decision is what makes a voxel wall worth building in three.js instead of a 2D sprite, and it is the hook the whole first five minutes is built around.

---

## 2. Design pillars

**1. The punch must feel good before anything else exists.**
If the first tap does not produce a satisfying chunk burst, camera kick and a number, nothing downstream matters. Build the punch in week one, alone, with no economy.

**2. The wall is legible at a glance.**
A player should know how close the wall is to breaking without reading a number. The hole in the wall is the readout. The HP bar is the backup, not the primary.

**3. Every 30–45 seconds in the first five minutes, something new happens.**
Not "the number got bigger" — a *new thing on screen*: a new wall material, a new building appearing in the world, a new mechanic. This is the entire retention thesis. See §3.

**4. No friction before minute 5.**
No login. No tutorial modal. No ad. No energy. No store. No settings screen. Nothing that interrupts tapping.

---

## 3. The first five minutes (the spine)

This is the most important section in this document. **The first five minutes is a scripted sequence, not a sandbox.** The economy is tuned so that a player who taps at a normal rate hits each beat at roughly the listed time, and a player who taps slowly still hits every beat before minute 6.

### 3.1 Beat sheet

| Time | Beat | What the player sees / does | Why it's here |
|---|---|---|---|
| **0:00** | Cold open | The wall is already on screen, already cracked, already filling 70% of the frame. A pulsing `TAP` ring sits on the wall. No menu, no logo, no loading percent. | Zero decisions before the good part. Load in under 2s on 4G. |
| **0:03** | **First punch** | Tap → 6–10 voxels shatter, debris arcs, camera kicks, dust puff, `+1` floats up, haptic tick. The wall visibly loses a bite. | This is the whole game in 400ms. |
| **0:00–0:18** | Learn the verb | ~15 taps kill wall 1. Each tap carves a visibly wider hole from where you tapped. | Wall 1 must die in **under 20 seconds**. The first reward cannot be a maybe. |
| **0:18** | **First wall break** | Wall 1 collapses: 60ms hit-stop, all remaining voxels burst outward, big `WALL 1 DESTROYED`, cash fountain, screen flash. Then `Punch Harder` slides up — **level 1 is free**, one tap to claim. | Payoff + the game's first "I made a choice" moment, 3 seconds apart. |
| **0:35** | New material | Wall 2 is a different colour and a different material name. It has ~2.2× the HP but your free upgrade already doubled your damage. | Proves the loop repeats *and* rewards, immediately. |
| **1:00** | **First building** | `Puncher` becomes affordable (15 cash). Buying it spawns a little character/fist rig at the bottom of the frame that punches on its own every 2s. | The "aha": the game runs without me. This is the moment idle players convert. |
| **1:40** | Upgrade cascade | Hitting 5 Punchers unlocks **two** upgrades at once. The tray animates in both cards. | Teaches "buying more copies unlocks more things" without a word of text. |
| **2:15** | **Skill layer** | A glowing weak point appears on the wall and drifts slowly. Hitting it does **×5** and chains a **combo** (hits within 1.2s stack to ×1.5, ×2, ×2.5…). A shrinking ring shows the combo window. | Gives the tapping a reason to be *good* rather than fast. This is the piece most competitors lack. |
| **3:00** | Second building | `Clubber` (100 cash) unlocks. Damage per tap is now ~40× where it started. The counter has grown a digit — that growth is the reward. | Second rung of the ladder, on schedule. |
| **3:45** | Big wall | Wall 6. HP is now five digits. The wall is visibly a different thing — layered stone, deeper chunks, slower carve. | The player is now playing a different game than at 0:30, and can feel it. |
| **4:20** | **The tease** | Behind the current wall, visible through a hole the player carved themselves, is a **silhouette of something bigger** — a shape, a machine, a door. It does not resolve. A small meter labelled `REWIND` starts filling. | The 5-minute cliffhanger. Reason #1 to come back is curiosity, not a daily-reward slot. |
| **5:00** | **Checkpoint** | Player should be at: wall 6–8, 2–3 building types, ~8 upgrades owned, combo discovered, tease seen. | Full funnel in §3.3. |

### 3.2 Reward interval ladder

The single most reliable predictor of whether a player is still there at minute 5 is the **decay rate between rewards**. Target intervals between "something good happened":

```
3s → 8s → 20s → 45s → 90s → 150s → 240s
```

Every beat in §3.1 is scheduled to land on that ladder. If a designer adds content, it goes *between* these, never by lengthening a gap. When the ladder flattens (which it will, around minute 6–8), that is exactly where prestige takes over.

### 3.3 The 5-minute funnel (what you measure)

Instrument these. If the game is failing, one of these numbers tells you where.

| Checkpoint | Target | If it's below target |
|---|---|---|
| App open → first punch | < 10s, **95%** of opens | Load time or intro art is the problem. Cut the logo. |
| First punch → wall 1 destroyed | < 30s, **90%** | Wall 1 HP is too high. Lower it, don't add a tutorial. |
| First building bought | < 2:00, **80%** | Puncher is too expensive, or the idle pitch isn't visible. Make the Puncher rig appear on screen. |
| Wall 5 reached | < 3:30, **70%** | Damage growth is too slow. Raise upgrade multipliers, not tap speed. |
| Wall 7 reached | < 5:00, **60%** | Wall HP growth (2.2×) vs damage growth (×2 per upgrade) is out of balance. |
| Session > 5:00 | **55%** of those who made a first punch | Something between 2:15 and 4:20 is dead. Usually: no new toy, or combo is unclear. |

### 3.4 Forbidden before minute 5

- Ads of any kind (interstitial or rewarded — a rewarded ad at 4:50 breaks the spell; place the first at 8:00).
- Energy, stamina, cooldowns on tapping.
- Any modal that blocks the wall.
- Offline earnings screen (it implies the game is a chore — show it after minute 5).
- Store / IAP prompts.
- Text tutorials. Teach with motion: a card that slides up, a rig that appears, a weak point that glows.

---

## 4. Core loop and economy

### 4.1 Two currencies

| | **Cash** | **Bricks** |
|---|---|---|
| Source | Every point of wall damage | Only when a wall **dies** |
| Spends on | Buildings (idle DPS), damage multipliers | New building types, mechanics, prestige unlock |
| Role | Paces minutes | Gates content |

Continuous currency lets you tune pacing smoothly. Milestone currency lets you hard-gate a tier without a timer. Keep them visually distinct: cash is a coin, bricks are the wall's own material colour.

### 4.2 The formulas

```
damage_per_punch = BASE × Π(building_multipliers) × Π(upgrade_multipliers) × combo × weakpoint
cash_per_punch   = damage_dealt × CASH_RATE          // CASH_RATE = 1.0 early, falls to 0.35 late
building_cost(n) = base_cost × 1.15^n                // n = copies already owned
wall_hp(w)       = 20 × 2.2^(w-1)
```

The build ratio is deliberately aggressive: **wall HP grows 2.2× per wall, damage grows ~2× per upgrade, and upgrades unlock every ~1–2 minutes.** That means you plateau briefly between upgrades and then smash through two walls at once. That sawtooth is the loop.

### 4.3 Wall curve (first pass)

Numbers below are a starting point — expect to move them ±30% after playtest. The **target time** column is the real spec; solve HP to hit it.

| Wall | Material | HP | Cumulative target time |
|---|---|---|---|
| 1 | Concrete | 20 | 0:18 |
| 2 | Concrete | 45 | 0:45 |
| 3 | Brick | 100 | 1:05 |
| 4 | Brick | 220 | 1:35 |
| 5 | Stone | 480 | 2:10 |
| 6 | Stone | 1,050 | 2:50 |
| 7 | Iron | 2,300 | 3:30 |
| 8 | Iron | 5,000 | 4:10 |
| 9 | Obsidian | 11,000 | 4:50 |
| 10 | Obsidian | 24,000 | 5:30 |
| 12+ | Anomalous | 52k+ | — |

Material changes are the *visual* pacing signal. Every material has its own voxel colour, its own debris colour, and its own chunk size (concrete breaks in small chips, iron in big slabs, obsidian in long shards). The player feels the wall change before they read it.

### 4.4 Buildings (idle DPS)

Cost ladder ×6 per new building type:

| Building | Cost | Damage / sec | Notes |
|---|---|---|---|
| Puncher | 15 | 0.5 | Unlocks at 1:00. Renders as a small rig that punches. |
| Clubber | 100 | 3 | 3:00 |
| Swordsman | 600 | 18 | |
| Gunshooter | 3,600 | 110 | |
| Grenademan | 21,600 | 660 | |
| Wrecking Ball | 130,000 | 4,000 | |
| Bulldozer | 780,000 | 24,000 | |
| Airstrike Caller | 4.7M | 144,000 | |

Each building type has its own **on-screen rig** in the world — a silhouette at the bottom of the frame that visibly punches, slashes, shoots. Never represent a building as a card alone. If the player can't see it working, idle damage feels like a passive stat and the "aha" at 1:00 never lands.

### 4.5 Upgrades

Unlock thresholds by **copies of the linked building**: `1, 5, 25, 50, 75, 100, 125, 150, 200, 250…`

Effect ladder, by depth:
- **Tier 1–3: ×2.0** to that building's damage (chunky, legible, everyone can feel it)
- **Tier 4–6: +50%**
- **Tier 7+: +25%**

Cost = `6^tier × building_base_cost`. Upgrades **persist through prestige** — that is what makes resetting feel like a promotion instead of a loss.

`Punch Harder` is the exception: it multiplies *manual* damage and is the free gift at 0:18. It scales ×2 per level for the first three levels (so tapping stays king through minute 5), then drops to +50%.

### 4.6 Prestige — "Rewind"

- Every wall destroyed grants **Cosmic Knowledge**; later walls give more, so pushing deep beats resetting early.
- Unlocks at **wall 12**, which is *outside* the first five minutes by design — but the meter starts filling at 4:20 as a tease.
- `Rewind` converts Knowledge into permanent multiplier capsules, resets walls, cash, buildings and bricks, and **keeps all upgrades**.
- Rule of thumb: the run after a reset must reach your old wall in **under 10%** of the original time. First prestige should feel like a cheat code.

---

## 5. The voxel wall (detailed)

This is the centrepiece. Build it first, before the economy exists.

### 5.1 Structure

A wall is a 3D voxel block, not a flat plane:

```
        ┌─ voxel grid ─┐
  X (width)  16–24 voxels      →  fills the frame in portrait
  Y (height) 16–24 voxels      →  taller than the visible frame, bleeds off top
  Z (depth)   4–6 voxels       →  the "thickness". This is what makes the hole real.
```

Total ≈ **1,500–3,000 voxels** per wall. Comfortably inside a mobile budget because they are all one instanced draw call.

Depth matters more than width. A 1-voxel-thick wall reads as a texture; a 4–6 voxel-thick wall reads as a *thing you are breaking into*. When a chunk comes out you see the shaded interior and the next layer behind it. That is the entire illusion.

**Voxel shape:** a box with chamfered edges (a low-poly bevel), not a hard cube. ~44 triangles each is fine, or bake a bevel into the geometry once and instance it. Slight per-voxel size jitter (±3%) so the surface isn't machine-perfect.

### 5.2 Materials and colour

One `InstancedMesh` per material type. Never one mesh per voxel.

```js
// once, at wall build time
const geo = new THREE.BoxGeometry(1, 1, 1);       // or chamfered variant
const mat = new THREE.MeshLambertMaterial({ flatShading: true });
const mesh = new THREE.InstancedMesh(geo, mat, count);
mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
mesh.frustumCulled = false;                       // single object, culling only costs CPU

const c = new THREE.Color();
const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const p = new THREE.Vector3();
const s = new THREE.Vector3();

for (let i = 0; i < count; i++) {
  const v = grid[i];                              // { x, y, z, depth, alive }
  p.set(v.x * CELL, v.y * CELL, v.z * CELL);
  s.setScalar(CELL * 0.96 * (1 + (Math.random() - 0.5) * 0.06));
  m.compose(p, q, s);
  mesh.setMatrixAt(i, m);

  // THE most important visual trick: bake fake AO from depth into the instance colour.
  // Interior voxels are darker. Gives free depth with zero shader cost.
  const ao = 1 - Math.min(v.depth, 5) * 0.09;
  c.setHex(BASE_COLOR).multiplyScalar(ao * (0.94 + Math.random() * 0.12));
  mesh.setColorAt(i, c);
}
mesh.instanceMatrix.needsUpdate = true;
mesh.instanceColor.needsUpdate = true;
scene.add(mesh);
```

The `±6%` lightness jitter per voxel is the single biggest "this looks handmade and expensive" trick in the whole build. Without it a voxel wall reads as a flat cube. With it, it reads as a wall.

**Lighting:** one `DirectionalLight` + one `HemisphereLight`. **No shadow maps on mobile** — they cost more than the entire rest of the scene. The baked per-voxel AO is your shadowing.

### 5.3 The breach model (how the hole grows)

Do **not** remove voxels by nearest-distance to the tap point. That produces a circular bowl and the player's aiming feels meaningless.

Instead, each wall gets a precomputed **breach field**: a per-voxel value in 0–1, generated from 2–3 octaves of value noise along the X/Y plane, plus a bias toward the bottom-centre (walls fail from the bottom).

```
breach[v] = noise2D(v.x * 0.18, v.y * 0.18) * 0.7 + (1 - v.y / height) * 0.3
```

On a hit at point `H`:

1. Find voxels within `R` world units of `H` that are **still alive** and have `breach[v] < damageFraction`.
2. Sort ascending by `dist + breach[v] * R`. Kill the first `k`.
3. `k = clamp(floor(damage / voxelHP), 1, 24)` — so damage scales the *number of voxels that vanish*, not just the number.
4. `damageFraction` rises as the wall's HP drops, so a near-dead wall crumbles in big cascading bites.

The result: holes propagate along weak lines, branch, and look like real structural failure — and because step 2 weights by distance from *the point you tapped*, the player's aim genuinely steers the destruction. That is the mechanic.

### 5.4 Damage as visible topology

The wall's HP bar is a lie unless it maps to voxels. So:

```
voxelHP     = wallHP / liveVoxelCount
voxelsLeft  = liveVoxelCount
```

Every time a voxel dies, `liveVoxelCount--` and the HUD bar redraws as `liveVoxelCount / totalVoxels`. The bar and the hole are the same data. A player who never reads a number still knows they're at 80%.

When `liveVoxelCount` hits 0 → wall destroyed → the burst.

### 5.5 Layering (depth storytelling)

Behind layer 1, place a second, differently-coloured voxel layer, 1 cell back. And behind the whole wall, a simple unlit silhouette plane for the 4:20 tease.

Because the breach carves inward, the player sees the inner layer *through their own hole* before they've earned it. That is free narrative: "there's more wall behind this wall." It costs one extra InstancedMesh and one plane.

### 5.6 Debris

Do not spawn new meshes. Use a **preallocated debris pool** of 256 instances in a second `InstancedMesh`, with a parallel array of JS-side state:

```js
const DEBRIS_MAX = 256;
const debrisMesh = new THREE.InstancedMesh(geo, debrisMat, DEBRIS_MAX);
debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
debrisMesh.frustumCulled = false;

const pool = Array.from({ length: DEBRIS_MAX }, () => ({
  active: false,
  pos: new THREE.Vector3(), vel: new THREE.Vector3(),
  rot: new THREE.Euler(), spin: new THREE.Vector3(),
  life: 0, maxLife: 0, scale: 1,
}));

function onVoxelDeath(pos, color) {
  const s = pool.find(o => !o.active);
  if (!s) return;                                  // pool full: silently skip, never allocate
  s.active = true;
  s.pos.copy(pos);
  s.vel.set(rnd(-2.5, 2.5), rnd(1.5, 5.5), rnd(1.5, 4.0));
  s.spin.set(rnd(-6, 6), rnd(-6, 6), rnd(-6, 6));
  s.scale = 0.35;
  s.maxLife = s.life = 0.9 + Math.random() * 0.5;
  debrisMesh.setColorAt(slotIndex, color);         // inherit the wall's colour
}

// in the fixed-timestep update, ~0.15ms for 256 slots
```

Debris **lives in world space and falls out of frame** rather than fading in place. Chunks arcing past the camera is a big part of the satisfaction; a fade-out looks cheap.

### 5.7 Cracks and damage states

No crack textures. Damage is **topological** — the hole is the crack. But add two cheap reinforcements:

- **Fissure pass:** once a wall is below 40% HP, run the breach algorithm on a thin vertical line above the largest existing hole at a low rate, so the wall starts visibly splitting on its own. Sells "this thing is about to go."
- **Wobble:** scale the whole wall mesh by `1 + sin(t * 8) * 0.0025 * (1 - hpFrac)` once HP drops below 30%. Sub-pixel, but it reads as strain.

---

## 6. Game view and camera

### 6.1 Portrait mobile layout (primary)

```
┌───────────────────────────────┐
│  WALL 6 · STONE       ▓▓▓▓░░  │  ← HP bar (segmented by remaining voxels)
│                         8,431 │     + wall number / material, small
├───────────────────────────────┤
│                               │
│   ⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛      │
│   ⬛⬛⬛⬜⬜⬜⬛⬛⬛⬛⬛⬛      │  ← the voxel wall (3D canvas, full bleed)
│   ⬛⬛⬜⬜⬜⬜⬜⬛⬛⬛⬛⬛      │     bleeds off left/right/bottom edges
│   ⬛⬜⬜⬜⬜⬜⬜⬜⬛⬛⬛⬛      │
│   ⬛⬛⬜⬜⬜⬜⬜⬛⬛⬛⬛⬛      │
│                               │
│        ✊  ×2.5 COMBO         │  ← combo ring around the last tap point
│                               │
├───────────────────────────────┤
│  💰 1.24K      🧱 340         │  ← currency row, tabular numerals
├───────────────────────────────┤
│ ┌─────────┐ ┌─────────┐ ┌───┐ │
│ │ PUNCH   │ │ PUNCHER │ │ + │ │  ← upgrade tray, thumb-reachable
│ │ HARDER  │ │  15 💰  │ │   │ │     max 3 cards; swipe for more
│ │  ×2     │ │  +0.5/s │ │   │ │
│ └─────────┘ └─────────┘ └───┘ │
└───────────────────────────────┘
```

Rules:
- **The wall owns 55–70% of the screen.** Everything else is a strip.
- The wall bleeds off the left and right edges. Never show the wall's boundary — a framed wall looks like a picture.
- **Tap anywhere on the canvas to punch.** Punch lands at the tap point (projected onto the wall's front voxel plane). No dedicated punch button: a button moves your thumb off the action and kills the illusion.
- Currency and HP use **tabular numerals** and count up over ~180ms, never snap.
- Upgrade cards: max 3 visible, 100px+ tall, cost and effect legible at arm's length. New unlocks animate in with a 120ms slide.
- Safe areas: respect `env(safe-area-inset-*)`; nothing important in the bottom 34px or top 44px on iOS.

### 6.2 Landscape / desktop layout

Same scene, wider FOV budget:

```
┌──────────────────────────────────────────────────────┐
│ WALL 6 · STONE                          8,431  ▓▓▓░░ │
├──────────────────────────────┬───────────────────────┤
│                              │  PUNCH HARDER   ×2    │
│    ⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛        │  PUNCHER   15 💰      │
│    ⬛⬛⬜⬜⬜⬜⬛⬛⬛⬛        │  PUNCHER   +0.5/s     │
│    ⬛⬜⬜⬜⬜⬜⬜⬛⬛⬛        │  ─────────────────    │
│    ⬛⬜⬜⬜⬜⬜⬜⬜⬛⬛        │  CLUBBER  100 💰      │
│                              │  🔒 reach wall 4      │
│                              │  ─────────────────    │
├──────────────────────────────┴───────────────────────┤
│  💰 1.24K    🧱 340               COMBO ×2.5          │
└──────────────────────────────────────────────────────┘
```

Desktop input: click to punch, `Space` = punch centre, `1/2/3` = buy first three cards, `Esc` = nothing (no pause menu before minute 5).

### 6.3 Camera

```js
// Portrait: wall fills the frame vertically
const camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 60);
camera.position.set(0, 1.2, 14);
camera.lookAt(0, 1.0, 0);
camera.rotation.z = THREE.MathUtils.degToRad(-3);   // slight dutch — reads as energy
```

- **FOV 42** portrait / **50** landscape. Wider feels like a small wall in a big room; narrower feels like you're inside it.
- Slight downward pitch and a 3° roll. Straight-on cameras look like debug views.
- **Punch kick:** on every hit, `camera.position.z -= 0.09` and `camera.position.x += rnd(±0.05)`, then spring back over ~140ms. On big hits, add `rotation.z += 0.004`. This is the highest value-per-line-of-code feature in the game — do it before anything else.
- **Never** auto-rotate or idle-drift the camera. It steals attention from the wall.

### 6.4 The feel budget ("juice")

Each punch fires, in this order:

| Element | Value | Cost |
|---|---|---|
| Hit-stop (big hits / weak point only) | freeze sim 45ms | free |
| Camera kick | −0.09z, ±0.05x, spring 140ms | free |
| Voxel deaths | `k = 1..24` chunks | one `setMatrixAt` each |
| Debris | 3–8 chunks from pool | ~0.1ms |
| Dust puff | 1 additive billboard, 250ms, scales 0.3→1.4 | 1 draw call |
| Floating number | DOM element, 700ms, rises 90px, fades | cheap (DOM) |
| Screen flash | DOM overlay, `rgba(255,240,220,.28)` → 0 over 90ms | free |
| Haptic | `navigator.vibrate(12)` (Android; no-op iOS) | free |
| Audio | one-shot, pitch-shifted ±8% per hit | pooled `AudioBuffer` |

**Audio is not optional.** A wall-punching game with no sound is not a wall-punching game. Use 3–4 short samples with random pitch/volume variation so 200 hits don't become a machine gun. Weak-point hits get a distinct higher "clink".

---

## 7. three.js implementation

### 7.1 Scene graph (deliberately tiny)

```
scene
├── ambient (HemisphereLight)
├── key (DirectionalLight, no shadows)
├── wallMesh       InstancedMesh  (material A)    1 draw call
├── wallMeshB      InstancedMesh  (material B)    1 draw call  ← inner layer
├── debrisMesh     InstancedMesh  (dynamic)       1 draw call
├── dust           a pool of 8 billboards          up to 8 draw calls
├── rigs           1–3 low-poly building rigs      up to 3 draw calls
└── teasePlane     unlit silhouette               1 draw call
```

Total: **~12 draw calls, ~45k triangles.** That fits mobile with room to spare.

### 7.2 Renderer setup

```js
const renderer = new THREE.WebGLRenderer({
  antialias: false,          // DPR 2 + no AA looks better than AA at DPR 1, and is cheaper
  powerPreference: 'high-performance',
  alpha: false,
  stencil: false,
  depth: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
// no post-processing. No bloom, no SSAO, no FXAA on mobile.
```

Flash, vignette and vignette-pulse are **DOM overlays**, not shader passes. They cost nothing and they still work when the GPU is throttling.

### 7.3 Raycasting the wall

```js
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function punchFromPointer(clientX, clientY) {
  ndc.x = (clientX / window.innerWidth) * 2 - 1;
  ndc.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);

  const hits = raycaster.intersectObject(wallMesh, false);
  if (!hits.length) return;                      // tapped a hole → punch nearest live voxel
  const hit = hits[0];
  const instanceId = hit.instanceId;
  const point = hit.point;                       // world-space tap point

  resolveDamage(point, instanceId);
  spawnDebris(point, 4 + Math.floor(damageScaled));
  kickCamera();
  flash();
}
```

Notes:
- `instanceId` is available on `InstancedMesh` intersections — use it to identify the exact voxel hit and bias the breach field toward it.
- A tap through an existing hole returns no hit. In that case, project the ray onto the wall's back plane and take the nearest live voxel within `R`. **Never let a tap do nothing** — a dead tap is the fastest way to lose a player.
- Use `pointerdown`, never `click`. `click` fires on pointerup and adds 60–120ms of perceived lag, which destroys the punch.

### 7.4 Killing a voxel

```js
const _m = new THREE.Matrix4();

function killVoxel(i) {
  if (!grid[i].alive) return;
  grid[i].alive = false;
  liveVoxelCount--;

  // zero-scale instead of rebuilding geometry
  _m.makeScale(0, 0, 0);
  wallMesh.setMatrixAt(i, _m);
  wallMesh.instanceMatrix.needsUpdate = true;   // set once per punch, not per voxel
}
```

Setting a zero matrix is the correct call for <3k instances. It wastes a little vertex work but avoids index compaction entirely. **Batch the `needsUpdate` flag** — set it once at the end of a punch, not inside the loop.

If a wall ever needs >5k voxels, switch to a segmented approach (split the wall into 4 `InstancedMesh` chunks and rebuild only the chunk that lost voxels), but don't do that before you need it.

### 7.5 Fixed timestep (mandatory)

Economy, combo timers and debris must not run off frame delta on a device that swings between 30 and 120fps.

```js
let acc = 0, last = performance.now();
const STEP = 1 / 60;

function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min((t - last) / 1000, 0.1);   // clamp: survives tab-switch and hitches
  last = t;
  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps++ < 5) {           // max 5 catch-up steps
    updateEconomy(STEP);
    updateCombo(STEP);
    updateDebris(STEP);
    acc -= STEP;
  }
  updateCameraSpring(dt);                        // camera is framerate-dependent on purpose
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
```

Cap `dt` at 0.1s or a backgrounded tab returns and instantly pays out 40 minutes of punches.

### 7.6 Save

```js
{
  v: 1,
  wall: 6, liveVoxels: 812, wallHp: 8431, wallSeed: 88213,
  cash: 1240, bricks: 340,
  buildings: { puncher: 7, clubber: 1 },
  upgrades: ['ph_1', 'ph_2', 'pun_5a', 'pun_5b'],
  comboBest: 3.5,
  t: 1732467000000,          // last save — used for offline earnings AFTER minute 5
  seenTease: true
}
```

- `localStorage`, autosave every 5s and on `visibilitychange`.
- Store `wallSeed` so a reloaded wall has the **same breach pattern** — otherwise the hole you carved heals and the world feels fake. Regenerate voxel state from seed + `liveVoxels`, not from a full voxel dump.
- Offline earnings are computed but **not shown** until the player has passed minute 5 once (`seenTease` is a decent proxy).

### 7.7 Performance budget (mobile)

| Metric | Budget | Notes |
|---|---|---|
| Draw calls | ≤ 15 | Instancing does the work |
| Triangles | ≤ 60k | 3k voxels × 44 tris + debris |
| JS per frame | ≤ 3ms on a mid-range Android | Matrix writes dominate |
| Texture memory | < 8 MB | You need almost no textures |
| Time to interactive | < 2s on 4G | Ship < 1.5 MB of JS + models |
| Frame rate | 60fps target, 30fps floor | Degrade by lowering DPR to 1.5 first, then debris pool to 128 |
| DPR cap | 2.0 | A 3× DPR phone renders 9× the pixels for no visible gain |

Degradation ladder, in order: DPR 2 → 1.5 → 1.25, debris 256 → 128, dust billboards 8 → 4, then drop the inner voxel layer.

### 7.8 Touch hygiene

```css
canvas {
  touch-action: none;                 /* kills scroll, pinch-zoom and double-tap-zoom */
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  overscroll-behavior: none;
}
html, body { background: #0a0a0c; overflow: hidden; }
```

Listen on `pointerdown` and handle multi-touch by processing **every** changed pointer — two thumbs tapping should be two punches per beat, and that feels great.

---

## 8. Build order

Ship in this sequence. Each step is playable.

1. **The punch.** One static wall, tap → voxels die → debris → camera kick → sound. Nothing else. Do not proceed until this is fun on its own.
2. **The hole.** Breach field, growing holes, HP bar tied to live voxel count, wall destruction burst.
3. **Wall 2.** Seed variation, material colour change, one upgrade purchase.
4. **Idle.** Puncher, on-screen rig, cash/tick.
5. **Combo + weak point.** The ×5 moment.
6. **Curve.** All 10 walls, the full upgrade table, the 5-minute funnel instrumentation.
7. **The tease.** Inner layer, silhouette, Rewind meter.
8. **Prestige.** Then, and only then, look at minute 6+.

---

## 9. Open questions

- **Does the combo ring compete with the hole for attention?** Playtest at 2:15 specifically. If players stop looking at the wall, cut the ring and make the weak point pulse instead.
- **Is 4–6 voxel depth enough to read as solid?** Compare against 8 with a smaller X/Y grid. Depth sells the illusion; width sells the target.
- **Portrait-only at launch?** Strongly recommended. A landscape mode doubles the layout work for a small share of sessions, and the wall wants a tall frame.
- **Does tap-position aiming survive on small phones?** A 375px-wide screen holds ~20 voxel columns ≈ 18px each — workable, but verify that a thumb isn't occluding the wall. Consider biasing the camera so the wall's dense region sits above the thumb arc.

---

*First-pass numbers. Everything in §4 is a tuning target, not a truth — solve the HP curve to hit the §3.1 timings, then rebuild the table from lives players actually had.*

