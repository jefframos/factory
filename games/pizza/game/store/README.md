# Stores (grocery / mart) — setup guide

A **store** is an area on the map where NPC clients come in, pick items out of the
storages inside it, queue at the cashier, pay once the player stands there, and leave.
Selling earns store progress; store **levels** unlock new map objects (farms, storages,
...). Everything lives in `game/store/`; the only hooks outside it are listed in
[Code map](#code-map).

Clients walk on a nav grid (around shelves, walls and each other) and run a small state
machine — waiting, browsing, wandering, ... — see
[Client behaviour & pathfinding](#client-behaviour--pathfinding).

```
entrance ──► storage line(s) ──► cashier line ──► exit
               (take items)      (player at cashier → client pays → money drop)
```

---

## 1. Map setup (Tiled — `games/pizza/tiled/testMap1.tmx`)

### Layers involved

| Layer | What goes there |
|---|---|
| `stores` | The store objects: `store`, `storeEntrance`, `storeExit`, `storeCashier`, `storeMoneyDrop`. **Nothing else** — no copies of mapSettings objects. |
| `mapSettings` | The **storages** (`type=storage`), their optional droppers, and everything a store level can enable (farms, buildings, ...). |

All ids/types are **custom properties** (`id`, `type`, `target`, `starter`) — the Tiled
object's own Name/Class fields are ignored. Only plain rectangles are read.

### Objects on the `stores` layer

| `type` | Properties | Meaning |
|---|---|---|
| `store` | `id` (e.g. `farmStore1`), optional `starter` | The store's area. Every storage whose **center** is inside this rect belongs to the store. `starter` = a building id (e.g. `stall1`); the store stays closed until that building reaches level 1. No `starter` = open from the start. |
| `storeEntrance` | `id`, `target` = store id | Clients spawn at a random point inside it. |
| `storeExit` | `id`, `target` = store id | Clients walk here after paying and despawn. |
| `storeCashier` | `id`, `target` = store id | The player stands here to serve. Clients queue in a line next to it. |
| `storeMoneyDrop` | `id`, `target` = store id | Paid money piles up here (one pile after another — a bigger rect holds more piles); the player walks over it to collect. |

A store missing any of its four parts is skipped (console warning `[StoreLayout] ...`).

### Storages (`mapSettings` layer)

- `type=storage`, `id=storageN`, drawn **inside** the store rect (see
  `storage1..3` in the current map). Size ~46x51 px matches the crate.
- Optional `type=dropper` with `target=storageN` — becomes the player's drop-off /
  purchase area instead of the storage's own footprint.
- Leave room in front of each storage for its **waiting clients** (see
  `storageSpotDirections` / `waitStyle` below) — they gather in a fan in front of it,
  `spotSpacing` apart, up to `maxClients` of them.

### Scale

32 px = 1 tile = 2 world units. The current store is 342x359 px ≈ 21x22 world units.

### After editing the .tmx — IMPORTANT

The game does **not** read the .tmx. It reads `games/pizza/raw-assets/json/map/testMap1.json`.

1. In Tiled: **File → Export** (Ctrl+E). The map has a built-in export target, so it writes
   straight to `raw-assets/json/map/testMap1.json`.
2. `npm run json` (or keep `npm run json:watch` running) copies it into `public/pizza/`.
3. If you add objects by hand-editing the files, bump `nextobjectid` in **both** the .tmx
   and the .json and use that id for the new object.

---

## 2. Configuration

Edit either through the **web editor** (`games/pizza/web`, tabs **Stores** and
**Storages**) or directly in the .ts files — the editor's Save writes the .ts files for
you. Both tabs have a **Default** entry (used by any id without an override) and
**By id** overrides.

### Stores tab → `game/store/StoreTypes.ts`

| Field | Meaning |
|---|---|
| `npcs` | Client looks, one picked at random per client (NPCs tab ids). |
| `maxClients` | Queue length — most clients inside the store at once, once **every** shelf (storage) is available. |
| `spawnIntervalSec` | Seconds between two clients arriving, once every shelf is available. |
| `startMaxClients` / `startSpawnIntervalSec` | Same, with only **one** shelf. Each shelf added steps linearly toward the values above. Blank = 2 / 1.6 × `spawnIntervalSec`. |
| `startPatienceMultiplier` | × mood step time with one shelf (more forgiving early), easing to ×1 with every shelf. Blank = 1.5. |
| `moodStepSec` | Seconds before a client's mood drops a step (happy → annoyed → sad → angry). Blank = 20. Early levels are forgiving: at store level 1 moods never drop below happy, at level 2 never below annoyed — nobody walks out or pays less (`MOOD_FLOOR_BY_LEVEL` in Store.ts). |
| `minClientPatience` / `maxClientPatience` | Each client's own tolerance — × mood step time, random in this range. Blank = 0.8 / 1.5. |
| `veryHappyPayMultiplier` / `unhappyPayPenalty` | Very happy clients pay × this (blank = 2); sad/angry ones pay this fraction less, rounded (blank = 0.2). |
| `moveSpeed` | Client walk speed (world units/sec). |
| `maxDistinctItems` | Most different items per client (random 1..N). |
| `maxAmountPerItem` | Most units of each item (random 1..N). |
| `priceMultiplier` | × each item's base price (Resources tab `price`). 1 = base price. |
| `pickDelaySec` | Seconds to take one unit from a storage. |
| `payDelaySec` | Seconds the player stands at the cashier before the front client pays. |
| `spotSpacing` / `spotMargin` | Distance between clients in a line / gap from the storage or cashier edge to the first client. |
| `storageSpotDirections` | Per storage: which way its waiting clients gather (`north`/`south`/`east`/`west`, map-up = north). Unlisted storages face the store's center. |
| `waitStyle` | `cluster` (default) — waiting clients fan out around the shelf/cashier; `line` — the old straight line. Queue order is the same either way. |
| `browseChance` | 0–1: how often a client waiting in a shelf line goes to look at another shelf (keeps its place). Blank = 0.4. |
| `clientRadius` | Personal space (world units): obstacles grow by this, clients steer apart at about twice it. Blank = 0.35. |
| `navCellSize` | Pathfinding grid cell size (world units). Blank = 0.3. |
| `cashierSpotDirection` | Same for the cashier line (blank = toward center). |
| `moneyPerBill` | Visual only — money per bill on the floor. |
| `billsPerPile` | Visual only — a money pile grows to this many bills, then the next pile starts beside it (row by row across the money drop). |
| `bubbleOffset` | Want-bubble height above the client's head. |
| `defaultStorageId` | Storage that is **free** and appears when the store opens. Blank = every storage must be bought. |
| `levels` | The progression ladder — see [section 3](#3-progression--unlocks). |
| `floorChecker` | Which Store View → Floor checker this store's floor uses. Blank = the default checker. |
| `wallStyle` | Which Store View → Wall style this store's walls use. Blank = the default style. |
| `disabled` | Removes the store entirely. |

### Store View tab → Floor → `game/store/StoreViewTypes.ts`

The store's floor is drawn in Tiled as plain rects with `type` = `floor` on its
`--storeView--<starter>` layers. Each rect becomes one checker mesh (`builders/CheckerFloorBuilder.ts`),
so the rects only set the floor's shape. The look comes from a **checker**: the **Default** one, unless
the store's `floorChecker` picks another by id. A floor on a store section's building uses that
section's store. Fields: `colorA` / `colorB`, `scale` (map tiles per checker square). Its height is the
store-floor layer in `world/FloorLayers.ts` (editor: Floor Layers tab).
Runtime lookup: `getStoreFloorChecker(storeId)`. To re-skin a floor that's already showing, call
`BuildingZone.setFloorChecker()`; a player-bought floor will plug in through these two.

### Store View tab → Wall → `game/store/StoreViewTypes.ts`

Walls are drawn in Tiled as a polyline (open) or polygon (closed loop) with `type` = `polyWall` on the
store's `--storeView--` layers. Each one becomes one mitered wall mesh with box colliders
(`builders/PolyWallBuilder.ts`), standing on the floor-layer base Y. **Wall Setup** (`WALL_SETUP`:
`height`, `thickness`) is shared by every wall in the game. The look is a **style** (`bottomColor` up to
`bottomHeight`, `topColor` above it): the Default one, unless the store's `wallStyle` (Stores tab)
picks another. Runtime: `getStoreWallStyle(storeId)`; `BuildingZone.setWallStyle()` re-skins shown walls.

**Windows and doors:** draw a plain rect with `type` = `polyWindow` or `polyDoor` on the same building's
`--storeView--` layers, overlapping the wall. The wall gets a hole along the stretch of wall the rect
overlaps. A door goes from the floor up to Wall Setup `doorHeight` and has **no collider** (walkable). A window
is `windowHeight` tall, centered on the wall's height, and keeps its collider. Don't overlap two openings.
Door toggles (bool custom properties on the `polyDoor` rect): **`isDouble`** hangs two half-width leaves, one hinged on
each side, which swing together to the same side. **`isHigh`** uses Wall Setup `tallDoorHeight` instead of `doorHeight`.
**`isSliding`** slides the door along the wall line into the wall (a pocket door) instead of swinging, and always clears
the whole doorway without poking past the straight wall beside it. If it fits the wall on one side, it's one panel
sliding that way. If it's too big, it becomes an automatic door: two halves parting sideways (the same as adding
`isDouble`). A half still wider than its wall splits into telescoping panels that stack inside the wall's thickness.
A wall polyline drawn back to its first point is treated as a closed loop.
Every door opening also gets a door (`store/StoreDoor.ts`), hinged on
the opening's start side. It swings open away from whoever comes near (the player, store clients and workers:
any entity with `opensDoors`) and closes once the doorway has been clear for a moment. It's visual only, with no collider.

**Sections and walls/floors:** building a store section never removes a floor, and never removes a wall on its
own. The section's own walls are drawn on its `--storeSection--` layer, as a `type` = `polyWall` polyline/polygon
inside the section rect (a polyline with no type is ignored, with a warning), with optional `polyWindow`/`polyDoor` rects. A `floor` rect inside the section
rect is the section's floor (one checker plane). Walls and floor appear when the section is built. Which checker or
wall style a section uses is set on its **Buildings** tab entry (`floorChecker` / `wallStyle`, blank = the store's).
To remove part of an existing wall (the store's, or another section's) when the section is built, draw a
**`polyWallExclusion`** rect on the section layer over that stretch: it's cut out full height, with no collider (any
window or door in it goes too). An exclusion belongs to the section named in its `target` property, else to the
nearest section rect within 4 world units. It never cuts its own section's walls. Exact duplicate walls are skipped.

### Store View tab → Door → `game/store/StoreViewTypes.ts`

How every door looks: a **model** (first entry, stretched over each leaf, × `scale`), or with no model, a plain
panel in `color` at `opacity` (below 1 = see-through glass). **Default** is the solid wood door. A building's
`doorStyle` (Buildings tab, e.g. a store section) wins, then the store's `doorStyle` (Stores tab), then Default.
`storeRoom1` uses **Glass** (light blue, opacity 0.35). Runtime: `getDoorStyle()` / `getStoreDoorStyle()`;
`BuildingZone.setDoorStyle()` restyles shown doors.

### Storages tab → `game/data/StorageTypes.ts` (fields that matter for stores)

| Field | Meaning |
|---|---|
| `resourceType` | The one item this storage holds. Clients ask for it **even when empty** (they wait for a refill). Unset = the storage offers whatever it currently holds. |
| `price` | Cost to buy it (player stands on it, coins drain). `amount: 0` = free. Ignored for a store's `defaultStorageId`. |
| `solid` | Collider (1 = full footprint). Clients walk through it regardless. |
| `frame` | Popup Frame Override. **Floor** (default when blank) = in-world: stored count painted on the floor south of the storage, and while for sale the price painted on its purchase area (dropper, or its own footprint), shrunk to fit — `components/FloorLabelComponent.ts`. Any other frame (e.g. `QueueFrame`) = floating UI-layer popup in that frame. `floorLabelSize` / `floorLabelGap` tune the floor labels. Only storages understand Floor for now. |
| `disabled` | Storage (and so its item) is gone from the game. |

### What clients buy & pay

- They only ask for items from **available** storages (enabled by level + bought/free).
- No clients spawn until the store is open, its zone is revealed (fog), **and** at
  least one storage is available.
- Price per unit = Resources-tab `price` (1 if unset) × `priceMultiplier`.

---

## 3. Progression & unlocks

- Store level is **0 while closed**, **1 when it opens** (starter built).
- Each `levels` entry: `{ level, requirementType, amount, enables: [{ entityId }] }`.
  - `level` — the level this entry is for (2, 3, ...).
  - `requirementType` — `money` (what clients paid) or `sales` (number of clients who paid).
  - `amount` — needed to reach this level, counted **from the previous level-up** (progress
    resets to 0 on each level; overflow is dropped).
  - `enables` — map ids that stay **hidden until this level**.
  - A `level: 1` entry's requirement is ignored — its `enables` appear when the store opens.
- `defaultStorageId` is automatically treated as "enabled at level 1".
- Enable-able ids: **storages, farms, buildings, queues, shops, marts, crafting tables**
  (anything spawned through `RequirementRegistry.registerSpawnGate`). Gates, triggers and
  craft stations are **not** covered.
- An enabled farm/storage still has to be **bought** if it has a price.
- While the player is inside a store's area (its `store` rect), a top-center panel
  (`ui/StoreUI.ts`) shows `STORE LV N` + a progress bar toward the next level; it fades out
  when they leave. A "STORE LEVEL UP!" notification plays on level-up.

### Current setup — `farmStore1`

| Level | Reached by | Enables |
|---|---|---|
| 1 | build `stall1` | `storage1` (carrots, free default) + `farm1` (price 0 → appears already owned) |
| 2 | 50 money | `farm2` (50) + `storage2` (tomatoes, 10) |
| 3 | +100 money | `farm3` (50) + `storage3` (broccoli, 10) |
| 4 | +200 money | `farm4` (50) + `storage4` (strawberries, 10) |
| 5 | +350 money | `farm5` (50) + `storage5` (corn, 10) |

Strawberry and corn grow on the tomato's curve (3 s + 3 s + 2 s, scale 0.2 → 0.6 → 1 → 4); corn's
crop view is scaled 0.75 (its model is ~2x the tomato's) so all three end up about the same size.
Pacing (`start*` settings) now spreads over all five shelves — full pace only once every shelf is out.

All five farms use **Auto Plant** (Farms tab — see the main README's Farming section): the
moment a farm appears every cell is already growing its assigned crop, the player walks over
to collect, and each cell replants instantly — so the whole loop is *walk over farm → carry
crops to the matching storage → clients buy them*.

---

## 4. Recipes

**Add a new store**
1. `stores` layer: draw a `store` rect (`id`, optional `starter`), plus `storeEntrance`,
   `storeExit`, `storeCashier`, `storeMoneyDrop` (each `target` = the store id).
2. Draw storages inside it on `mapSettings`.
3. Export the map (section 1). It works with the Default config right away.
4. Optional: Stores tab → add a By-id entry for its levels/default storage/line directions.

**Add a storage for a new item**
1. `mapSettings`: draw `type=storage`, `id=storageN` inside the store (export the map).
2. Storages tab → By id `storageN`: set `resourceType`, `price`, model/pile like the others.
3. Stores tab → if its waiting clients should gather on a particular side, add it to `storageSpotDirections`.
4. To unlock it later instead of right away: add `storageN` to a level's `enables`.

**Add a level**: Stores tab → store → Levels → + Add → set `level`, requirement, amount, and
its Enables ids. Ids must match the map's `id` property exactly.

**Change pacing**: `maxClients`, `spawnIntervalSec` (and their `start*` one-shelf versions), `moodStepSec`, `maxDistinctItems`,
`maxAmountPerItem`, level `amount`s, `priceMultiplier`.

---

## 5. Editor workflow

- The editor is `games/pizza/web`, started with `npm run editor` from the repo root. Save writes
  `web/data/*.json` **and** patches the .ts file (`web/sync/syncToSource.mjs`, mapping in
  `web/sync/entityMap.mjs` → `stores` / `storages`).
- After changing the editor's own code (`schemas.js`, `entityMap.mjs`) restart the server
  (restart button / `POST /api/restart`) and reload the page.
- Editing the .ts by hand? Keep `web/data/stores.json` / `storages.json` in sync, or the
  editor's consistency check (`/api/check-consistency`) will flag the drift and the next
  editor save will overwrite your hand edit.
- Map validation (`web/sync/validateMap.mjs`) checks store ids against the `stores` layer
  and storage ids against `mapSettings`.

---

## 6. Saved data

| Key | File | Holds |
|---|---|---|
| `PIZZA_STORE_PROGRESS` | `StoreProgressStorage.ts` | level + money/sales progress per store |
| `PIZZA_STORAGE_OWNERSHIP` | `StorageOwnershipStorage.ts` | bought storages + partial payments |
| `PIZZA_STORE_MONEY` | `StoreMoneyStorage.ts` | uncollected money on each money drop |
| `PIZZA_STORAGE_INVENTORY` | `data/StorageInventory.ts` (existing) | items in each storage |

All are cleared by the dev GUI's "Reset Everything" (`data/PlayerDataReset.ts`). Clients
themselves are **not** saved — a reload mid-shopping loses the items they already picked.

---

## Code map

| File | Role |
|---|---|
| `Store.ts` | One store: storages, lines, spawning, cashier/payment, opening + level-ups, level panel. `spawnStores()` is the entry point. |
| `StoreClient.ts` | A client's state machine (see [Client behaviour & pathfinding](#client-behaviour--pathfinding)). |
| `StoreLine.ts` | Queue ORDER at a shelf/cashier (who's next). Where each place stands comes from `StoreQueueSpots.ts`. |
| `StoreQueueSpots.ts` | Lays out queue spots on the nav grid — cluster or straight line. |
| `nav/StoreNavGrid.ts` | Walkability grid + A* + path smoothing. |
| `nav/NavAgent.ts` | Path following + steering around other clients and the player. Reusable by any future walker. |
| `nav/StoreNavDebug.ts` | Floor overlay of the grid, spots and paths (shown with Debug Colliders). |
| `StoreBubble.ts` | Want-bubble over clients. The level/progress panel is `ui/StoreUI.ts` (fed by PizzaScene from `Store.getHudState()`). |
| `StoreCashier.ts` / `StoreMoneyPile.ts` | Cashier trigger / money pile + collect. Each draws a solid counter (`cashierView` / `moneyDropView`, kitchen cabinets for now) once the store opens; bills pile on the money counter's top. |
| `StorePropVisual.ts` | Loads a counter's view, sits it bottom-center on its spot whatever the model's pivot, and fits a solid collider to its real bounds. |
| `StoragePurchaseZone.ts` | "For sale" zone for a priced storage. |
| `StoreLayout.ts` | Reads the `stores` map layer. |
| `StoreTypes.ts` | Config (Stores tab). |
| `StoreUnlocks.ts` | "Is this id enabled yet?" + storage availability rule. |
| `StoreProgressStorage.ts` / `StorageOwnershipStorage.ts` / `StoreMoneyStorage.ts` | Persistence. |

Hooks outside this folder:
- `scenes/PizzaScene.ts` — `setupStores()`; `setupStorages()` spawns storages through the
  spawn gate and swaps in `StoragePurchaseZone` for unbought ones.
- `world/RequirementRegistry.ts` — every spawn gate also checks `StoreUnlocks.isEnabled(id)`
  and rechecks on store level-up.
- `index.ts` — loads `StoreProgressStorage` / `StorageOwnershipStorage` at boot.
- `data/PlayerDataReset.ts` — clears the store saves.

## Client behaviour & pathfinding

### States (`StoreClient.ts`)

```
toShelf ──arrived──► queuing ◄──────► browsing
   ▲  │                 │ front          (looks at another shelf, keeps its place)
   │  │ front            ▼
   │  └──arrived──► picking ──item done──► toShelf (next item) / toCashier (list done)
   │                    │ shelf empty for 2 s
   │                    ▼
   └──restocked─── wandering   (strolls the store, bubble pulses the missing item)

toCashier ──arrived──► cashierQueue ──front──► readyToPay ──paid──► leaving ──► done
any shopping state, out of patience with nothing bought ──► leaving
```

| State | What the client does |
|---|---|
| `toShelf` | Walks to its place at the shelf that sells its current item (joins that queue). |
| `queuing` | Stands at its place, facing the shelf. Every 3–6 s, if someone is still ahead of it, it may go **browsing** (`browseChance`). |
| `browsing` | Walks to a free spot near another shelf (or beside its own, if there's only one) and looks at it for 2–4 s, then goes back. **Keeps its place in the queue**; heads straight back the moment it's next. |
| `picking` | At the front: takes one unit every `pickDelaySec`. Finishing an item cheers it up one mood step (when more items are left). |
| `wandering` | Everything left on its list has run out: after 2 s at the empty shelf it gives up its place (so people behind it can get other things) and strolls to random free spots in the store. Every second it checks **every item still on its list** and goes for the first one back in stock. |
| `toCashier` / `cashierQueue` / `readyToPay` | Walks to its place at the cashier, waits behind others, then waits at the front for the player. |
| `leaving` / `done` | Walks to the exit, then Store removes it. |

**Item order is flexible:** a client always goes for an item that is in stock first. Waiting
at an empty shelf (in line or at the front), it checks every second and switches to another
shelf with the same item, or else to any other item on its list that is in stock. Only when
nothing on its list is available does it wander.

The mood clock runs in every state before paying. **Adding an activity** (sitting, eating,
...): add a name to `ClientState`, one entry (`enter`/`update`/`exit`) to the `states`
table in the constructor, and the transitions into/out of it — nothing else changes.

### Walking (`nav/`)

- **Grid** (`StoreNavGrid`): covers the store area + entrance + exit (+1 unit), `navCellSize`
  cells (farmStore1: 99×132 ≈ 13k cells). Blocked: every storage of the store, the cashier
  and money-drop spots, every static solid physics body in reach (walls, buildings, solid
  crates — the same things the player bumps into) and unwalkable tiles — all grown by
  `clientRadius`. Rebuilt when physics bodies change (checked every 1 s, full check every
  5 s); an identical result is ignored, so nobody replans for nothing.
- **Paths**: A* (8 directions, no corner cutting), then smoothed to a few straight
  segments. ~0.5 ms for the longest path in farmStore1. Cells next to someone standing
  cost more, so paths bend around waiting clients.
- **Steering** (`NavAgent`): walkers push away from other clients and the player, and
  pass on the right when meeting someone head-on. Steps never land on blocked cells
  (they slide along obstacles instead). Replans when its goal moves, the grid changes,
  every 1.25 s while walking, and when stuck; stuck for ~2 s → walks straight
  (fail-open — may clip something, never freezes).
- **Queue spots** (`StoreQueueSpots`): spot 0 is always the pick-up/pay spot in front of the
  shelf/cashier. With `waitStyle: cluster` the others are free cells in a fan behind it
  (along `storageSpotDirections` first, then diagonals), at least `spotSpacing` apart and
  handed out round-robin across all queues, so neighbouring shelves share the floor and no
  two spots overlap.

Checked numerically on farmStore1's real layout (grid, spots, 5 agents from the entrance,
head-on, 4-way crossing, walking past a standing row): everyone arrives, nobody enters a
blocked cell, walkers keep ≥ ~0.4 apart.

### Debugging

Turn on **Debug Colliders** in the editor header (`PHYSICS_DEBUG`) and reload: each store
draws blocked cells (red), queue spots (green — front spots brighter) and every client's
current path (yellow). `StoreClient.getState()` gives the current state.

## Known limitations

- Only static solids that exist when the grid is built block paths; something that moves
  (e.g. a physics prop pushed around) isn't avoided until the next rebuild.
- Clients never block the player (they only steer away) and aren't physical — if the player
  stands still in a doorway, clients squeeze past.
- Wandering clients that come back after a restock rejoin at the back of the queue.
- A storage belongs to a store only by its center being inside the store rect.
