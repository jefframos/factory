# Stores (grocery / mart) — setup guide

A **store** is an area on the map where NPC clients come in, pick items out of the
storages inside it, queue at the cashier, pay once the player stands there, and leave.
Selling earns store progress; store **levels** unlock new map objects (farms, storages,
...). Everything lives in `game/store/`; the only hooks outside it are listed in
[Code map](#code-map).

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
- Leave room in front of each storage for its **client line** (see
  `storageSpotDirections` below) — lines are straight, `spotSpacing` apart, up to
  `maxClients` long.

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
| `maxClients` | Queue length — most clients inside the store at once. |
| `spawnIntervalSec` | Seconds between two clients arriving. |
| `moveSpeed` | Client walk speed (world units/sec). |
| `maxDistinctItems` | Most different items per client (random 1..N). |
| `maxAmountPerItem` | Most units of each item (random 1..N). |
| `priceMultiplier` | × each item's base price (Resources tab `price`). 1 = base price. |
| `pickDelaySec` | Seconds to take one unit from a storage. |
| `payDelaySec` | Seconds the player stands at the cashier before the front client pays. |
| `spotSpacing` / `spotMargin` | Distance between clients in a line / gap from the storage or cashier edge to the first client. |
| `storageSpotDirections` | Per storage: which way its line extends (`north`/`south`/`east`/`west`, map-up = north). Unlisted storages line up toward the store's center. |
| `cashierSpotDirection` | Same for the cashier line (blank = toward center). |
| `moneyPerBill` | Visual only — money per bill on the floor. |
| `billsPerPile` | Visual only — a money pile grows to this many bills, then the next pile starts beside it (row by row across the money drop). |
| `bubbleOffset` | Want-bubble height above the client's head. |
| `defaultStorageId` | Storage that is **free** and appears when the store opens. Blank = every storage must be bought. |
| `levels` | The progression ladder — see [section 3](#3-progression--unlocks). |
| `disabled` | Removes the store entirely. |

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


All three farms use **Auto Plant** (Farms tab — see the main README's Farming section): the
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
3. Stores tab → if its line would cross another, add it to `storageSpotDirections`.
4. To unlock it later instead of right away: add `storageN` to a level's `enables`.

**Add a level**: Stores tab → store → Levels → + Add → set `level`, requirement, amount, and
its Enables ids. Ids must match the map's `id` property exactly.

**Change pacing**: `maxClients`, `spawnIntervalSec`, `maxDistinctItems`,
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
| `StoreClient.ts` | A client's walk/pick/wait/pay/leave state machine. |
| `StoreLine.ts` | Evenly-spaced waiting spots (no overlap). |
| `StoreBubble.ts` | Want-bubble over clients. The level/progress panel is `ui/StoreUI.ts` (fed by PizzaScene from `Store.getHudState()`). |
| `StoreCashier.ts` / `StoreMoneyPile.ts` | Cashier trigger / money pile + collect. |
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

## Known limitations

- Clients walk in straight lines (through crates/walls) — keep entrance/exit/storages/
  cashier reachable in a straight line.
- Line directions are straight; with `maxClients` clients all at one storage its line can
  reach another line — tune `storageSpotDirections`/`maxClients` or move objects.
- A storage belongs to a store only by its center being inside the store rect.
