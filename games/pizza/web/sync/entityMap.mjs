// entityMap.mjs
//
// Maps each editor tab id to the REAL source-of-truth TS file/export it
// mirrors, and lists exactly which properties the editor is allowed to
// touch on each entry ("managed keys" — the same fields GameDataBaker.ts
// strips down to, i.e. everything except view/presentation data). syncToSource.mjs
// reads this to know which AST node to patch and which properties on an
// entry object literal to leave alone (mesh, color, models, position,
// toolId, ...) versus upsert/remove.
//
// `optionalKeys` (a subset of `managedKeys`) lists which managed fields are
// ACTUALLY optional on the real TS interface (`field?: T`) — only THOSE are
// deleted from the source when a posted entry omits them; every other
// managed key missing from posted data is left untouched instead of wiped.
// This distinction matters: a key can be absent from posted data either
// because a designer genuinely cleared an optional field, OR because the
// editor's own JSON mirror simply predates that field being added to the
// schema (exactly what happened to `tools.icon` — a stale mirror with no
// `icon` key at all got POSTed back and silently deleted a REQUIRED
// property from ToolRegistry.ts before this distinction existed). Treating
// "missing" as "skip, don't touch" by default is the safe direction to err
// in — a required field project should never lose data to a stale mirror.
//
// `tools` manages `label` and `icon` — every OTHER field on TOOL_LIBRARY
// (color, hand offset/rotation, THREE.Vector3 instances, the 3D `models`
// list) is purely visual/3D-specific and deliberately untouched. `icon` is
// the one visual-ish field that IS safe to manage here: it's just a bare
// texture-name string (same "icon" field shape used across this codebase —
// AssetLibraryRegistry, ItemConfig-via-toolId), not a 3D asset reference,
// and the editor's icon picker (see app.js's renderIconField()) previews it
// directly from the matching source PNG. `label` didn't originally exist on
// ToolVisualEntry at all (TOOL_LIBRARY was visual-only) — it was added
// specifically so the Tools tab's "Label" field has something real to write
// to instead of silently going nowhere.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.resolve(__dirname, '..', '..', 'game');

export const ENTITY_SOURCE_MAP = {
    // Keyed by zoneNumber (a stringified number — see ZoneTypes.ts's own doc: "zone1" in
    // level-designer terms is zoneNumber 0), NOT an arbitrary designer-typed id like every
    // other partialRecord tab here. protectEntries: true for the same reason assetLibrary
    // has it — the Zones tab's OWN render (see app.js's renderZonesTab()) auto-discovers and
    // re-adds every zoneNumber actually painted on the map every time it's opened, so a
    // config-only entry (a requirement set for a zone number the map doesn't currently paint,
    // e.g. mid-edit in Tiled) shouldn't get silently deleted just because one save's POST
    // happened not to include it.
    zones: {
        file: path.join(GAME_DIR, 'data', 'ZoneTypes.ts'),
        exportName: 'ZONE_CONFIG',
        kind: 'partialRecord',
        managedKeys: ['requirement'],
        optionalKeys: ['requirement'],
        protectEntries: true,
    },
    // Keyed by zoneNumber, same convention (and same protectEntries reasoning — see that
    // entry's own doc) as `zones` just above: the Zone Tutorials tab auto-discovers zoneNumbers
    // from the same painted "zones" tilelayer, so a config-only entry for a zoneNumber not
    // currently painted shouldn't get silently deleted just because one save's POST happened
    // not to include it.
    zoneTutorials: {
        file: path.join(GAME_DIR, 'tutorial', 'ZoneTutorialTypes.ts'),
        exportName: 'ZONE_TUTORIAL_CONFIG',
        kind: 'partialRecord',
        // `steps` has no unmanaged sibling fields on any of its items (ZoneTutorialStep is
        // exactly {kind, craftId, gateId, triggerId} — see ZoneTutorialTypes.ts), same "no
        // listMerge needed" reasoning as questGivers' own `variants` — a plain wholesale
        // replacement of the whole array is always safe here.
        managedKeys: ['steps', 'arrowTextureId', 'use3dArrow'],
        optionalKeys: ['arrowTextureId', 'use3dArrow'],
        protectEntries: true,
    },
    // A single dotted-outline color per named zone kind (dropper/trigger/queue/craft/farm/...) —
    // see ZoneColorTypes.ts's own doc for why this was pulled out of nine separate hardcoded
    // constants scattered across BuildingZone.ts/ShopZone.ts/GateDropZone.ts/DropZone.ts/
    // Trigger.ts/CraftZone.ts/QueueZone.ts/FarmZone.ts/FarmPlotTile.ts. Fixed, small,
    // hand-authored set (one entry per ZoneColorKind, never designer-added/removed) — same
    // enumRecord reasoning as Gate/Building, not an open id-map like Shops/Crafting.
    colors: {
        file: path.join(GAME_DIR, 'data', 'ZoneColorTypes.ts'),
        exportName: 'ZONE_COLOR_CONFIG',
        kind: 'enumRecord',
        enumName: 'ZoneColorKind',
        managedKeys: ['color'],
    },
    gates: {
        file: path.join(GAME_DIR, 'data', 'GateTypes.ts'),
        exportName: 'GATE_CONFIG',
        kind: 'enumRecord',
        enumName: 'GateId',
        managedKeys: ['name', 'requirement', 'view', 'frame', 'viewRotationOffsetDeg', 'viewScaleMultiplier', 'particleEffectId', 'destroyParticleEffectId', 'destroyParticleCount', 'cameraFocusHeightOffset'],
        optionalKeys: ['view', 'frame', 'viewRotationOffsetDeg', 'viewScaleMultiplier', 'particleEffectId', 'destroyParticleEffectId', 'destroyParticleCount', 'cameraFocusHeightOffset'],
    },
    buildings: {
        file: path.join(GAME_DIR, 'data', 'BuildingTypes.ts'),
        exportName: 'BUILDING_CONFIG',
        kind: 'enumRecord',
        enumName: 'BuildingId',
        managedKeys: ['name', 'icon', 'appearRequirement', 'levels', 'popupMode', 'popupBobOffset', 'baseView', 'frame', 'solid', 'updateParticleEffectId', 'updateParticleCount'],
        optionalKeys: ['icon', 'appearRequirement', 'popupMode', 'popupBobOffset', 'baseView', 'frame', 'solid', 'updateParticleEffectId', 'updateParticleCount'],
        // BuildingLevelConfig also carries a `mesh` field (per-level placeholder art) that
        // this editor doesn't manage — a plain wholesale replacement of the `levels` array
        // (what every OTHER list field in this map gets, since none of their items have
        // unmanaged siblings) would silently delete every level's mesh. listMerge tells
        // syncToSource.mjs to instead merge each array item by index, touching only the
        // named sub-fields on each existing item and leaving `mesh` alone — see
        // syncToSource.mjs's upsertArrayByIndex() for the actual merge. `view` (an optional
        // EntityViewRegistry id — see BuildingLevelConfig.view's own doc) IS managed here.
        listMerge: { levels: ['level', 'requirements', 'effect', 'view'] },
    },
    shops: {
        file: path.join(GAME_DIR, 'shop', 'ShopTypes.ts'),
        exportName: 'SHOP_CONFIG_BY_ID',
        kind: 'partialRecord',
        managedKeys: ['name', 'tool', 'action', 'appearRequirement', 'levels', 'popupMode', 'popupBobOffset', 'baseView', 'frame', 'solid'],
        optionalKeys: ['appearRequirement', 'popupMode', 'popupBobOffset', 'baseView', 'frame', 'solid'],
        // Same "levels has an unmanaged sibling field" reasoning as buildings' own listMerge —
        // ShopUpgradeLevel's `view` (optional) IS managed here alongside the ladder's own
        // cost/cooldown/hitInterval/hitScale/resourcePerHit fields.
        listMerge: { levels: ['cost', 'cooldownSec', 'hitIntervalSec', 'hitScale', 'resourcePerHit', 'view'] },
    },
    crafting: {
        file: path.join(GAME_DIR, 'crafting', 'CraftTypes.ts'),
        exportName: 'CRAFT_CONFIG_BY_ID',
        kind: 'partialRecord',
        // showModel/toolId/models/scale/rotationDeg/float are the table's own visual config
        // (CraftTableConfig, unlike resources/providers, keeps these INLINE rather than routing
        // them to AssetLibraryRegistry via externalFields — a craft table isn't a spawnable
        // AssetLibraryKey the way a resource/provider is, it's a one-off placement) — see
        // CraftTypes.ts's own doc on each field. `toolId` is a plain string reference into
        // TOOL_LIBRARY, resolved at runtime by CraftZone.createTableMesh(), not an enum value —
        // no ENUM_VALUE_FIELDS entry needed for it. `particleEffectId` is likewise a plain
        // string reference, into PARTICLE_REGISTRY this time (see the `particleEffects`
        // mapping below) — resolved at runtime by CraftZone.awake()'s ParticleEmitterComponent.
        managedKeys: ['name', 'recipes', 'destroyOnComplete', 'appearRequirement', 'showModel', 'toolId', 'models', 'scale', 'rotationDeg', 'float', 'heightOffset', 'popupMode', 'popupBobOffset', 'frame', 'solid', 'particleEffectId', 'destroyParticleEffectId', 'destroyParticleCount'],
        optionalKeys: ['appearRequirement', 'showModel', 'toolId', 'models', 'scale', 'rotationDeg', 'float', 'heightOffset', 'popupMode', 'popupBobOffset', 'frame', 'solid', 'particleEffectId', 'destroyParticleEffectId', 'destroyParticleCount'],
    },
    // A RESOURCE is the bankable item (Wood/Stone/Berries/Bark/Pebble/GrassFiber) — what
    // ends up in BackpackStorage. What actually PRODUCES one is a separate concern — see
    // `providers` below (Tree/Stone Deposit/Berry Bush: the world dispensers with an
    // action/life/respawn cycle and a weighted drop table of resources) — this is the split
    // ResourceTypes.ts/ProviderTypes.ts now make in the game code itself.
    resources: {
        file: path.join(GAME_DIR, 'actions', 'ResourceTypes.ts'),
        exportName: 'RESOURCE_CONFIG',
        kind: 'enumRecord',
        enumName: 'ResourceType',
        managedKeys: ['label', 'amountPerGather', 'category', 'price', 'sellable'],
        // Unset means 'main' (see ResourceConfig.category's own doc) — a mirror/entry that
        // predates this field just leaves it alone rather than getting force-set to 'main'.
        // `price`/`sellable` are MartTypes.ts's own concern (see that file's own doc) — unset
        // price means this resource can never be bought/sold at any mart at all; unset sellable
        // means true whenever a price IS set.
        optionalKeys: ['category', 'price', 'sellable'],
        // The Resources tab ALSO has icon/models/scale/rotationDeg fields, but ResourceConfig
        // itself carries none of those — see entityMap's own top-of-file doc on
        // `externalFields`. For a LOOSE ground-loot resource (bark/pebble/grassFiber, no
        // provider at all) this is the ONLY place its world appearance is set. For a
        // provider-dispensed resource (wood/stone/berries) it happens to share the same
        // AssetLibraryRegistry entry the matching provider's own visual fields point at
        // (see ProviderRegistry.ts's resolveProviderAssetKey()) — editing it from either tab
        // writes the same entry, which is intentional, not a bug.
        externalFields: { icon: 'assetLibrary', models: 'assetLibrary', scale: 'assetLibrary', rotationDeg: 'assetLibrary' },
    },
    // A PROVIDER is the world dispenser the player actually acts on (chop/mine/gather) — see
    // this file's own doc on the resources/providers split. `drops` is required
    // (`ProviderConfig.drops: ResourceDropEntry[]`, never optional) — a provider always has
    // to say what it gives, even if that's just one 100%-weight entry.
    providers: {
        file: path.join(GAME_DIR, 'actions', 'ProviderTypes.ts'),
        exportName: 'PROVIDER_CONFIG',
        kind: 'enumRecord',
        enumName: 'ProviderType',
        managedKeys: ['label', 'action', 'maxLife', 'amountPerGather', 'respawnSec', 'drops', 'solid', 'particleEffectId', 'destroyParticleEffectId', 'destroyParticleCount'],
        optionalKeys: ['solid', 'particleEffectId', 'destroyParticleEffectId', 'destroyParticleCount'],
        // Same reasoning as Resources' own externalFields — a provider's world appearance
        // lives in AssetLibraryRegistry.ts, keyed by the SAME id as the provider (see
        // ProviderRegistry.ts's resolveProviderAssetKey() — a plain identity mapping).
        // This is also what makes a BRAND NEW provider work with no second registration
        // step: as soon as this tab's Save writes its icon/models/scale/rotationDeg here
        // (even all-default), resolveProviderAssetKey() finds a matching entry by construction.
        externalFields: { icon: 'assetLibrary', models: 'assetLibrary', scale: 'assetLibrary', rotationDeg: 'assetLibrary' },
    },
    actions: {
        file: path.join(GAME_DIR, 'actions', 'ActionTypes.ts'),
        exportName: 'ACTION_CONFIG',
        kind: 'enumRecord',
        enumName: 'ActionType',
        managedKeys: ['hitIntervalSec', 'hitScale', 'resourcePerHit', 'cancelOnLeaveRange', 'tool'],
        optionalKeys: ['tool'],
    },
    items: {
        file: path.join(GAME_DIR, 'crafting', 'ItemTypes.ts'),
        exportName: 'ITEM_CONFIG',
        kind: 'enumRecord',
        enumName: 'ItemType',
        managedKeys: ['label'],
    },
    animals: {
        file: path.join(GAME_DIR, 'actions', 'AnimalTypes.ts'),
        exportName: 'ANIMAL_CONFIG',
        kind: 'enumRecord',
        enumName: 'AnimalType',
        managedKeys: ['label', 'resourceType', 'captureSec', 'requirementItem', 'requirementAmount', 'wanderSpeed', 'wanderPauseRangeSec', 'triggerRadius'],
        // requirementItem/requirementAmount are a PAIR (see AnimalConfig's own doc) — either
        // both set or both left out entirely for a no-requirement animal. triggerRadius is
        // independently optional — left out entirely falls back to AnimalNode's own
        // DEFAULT_TRIGGER_RADIUS (1).
        optionalKeys: ['requirementItem', 'requirementAmount', 'triggerRadius'],
    },
    dynamicResourcePlacements: {
        file: path.join(GAME_DIR, 'world', 'DynamicResourceTypes.ts'),
        exportName: 'DYNAMIC_RESOURCE_PLACEMENTS',
        kind: 'array',
        // spawnType/resourceType/providerType are ALL optional on a given entry (only
        // whichever one `spawnType` actually selects is meaningful — see
        // DynamicResourceTypes.ts's own doc) — no separate optionalKeys needed for an 'array'
        // mapping, since syncArray()'s own pick() already skips any key that's undefined.
        managedKeys: ['spawnType', 'resourceType', 'providerType', 'spawnerTileType', 'density', 'minDistance', 'checkIntervalSec'],
    },
    // Sibling to dynamicResourcePlacements above — same 'array' sync (see syncArray()'s own
    // doc), just against ShapeResourceTypes.ts/SHAPE_RESOURCE_PLACEMENTS, keyed by shapeId
    // (a "spawner"-type object's "id" on the map's mapSettings layer) instead of spawnerTileType.
    shapeResourcePlacements: {
        file: path.join(GAME_DIR, 'world', 'ShapeResourceTypes.ts'),
        exportName: 'SHAPE_RESOURCE_PLACEMENTS',
        kind: 'array',
        // spawnType/resourceType/animalType/providerType are ALL optional on a given entry
        // (only whichever one spawnType actually selects is meaningful — see
        // ShapeResourceTypes.ts's own doc) — no separate optionalKeys needed for an 'array'
        // mapping, since syncArray()'s own pick() (see that function's own doc) already skips
        // any key that's undefined.
        managedKeys: ['spawnType', 'resourceType', 'animalType', 'providerType', 'shapeId', 'count', 'density', 'minDistance', 'checkIntervalSec'],
    },
    queues: {
        file: path.join(GAME_DIR, 'data', 'QueueTypes.ts'),
        kind: 'queues',
        defaultExportName: 'DEFAULT_QUEUE_CONFIG',
        byIdExportName: 'QUEUE_CONFIG_BY_ID',
        managedKeys: ['cooldownSec', 'possibleTasks', 'appearRequirement', 'popupMode', 'popupBobOffset', 'view', 'frame', 'solid'],
        optionalKeys: ['appearRequirement', 'popupMode', 'popupBobOffset', 'view', 'frame', 'solid'],
    },
    // A FARM PLOT — a "farm"-typed object drawn on the Tiled map's "mapSettings" layer (see
    // WorldObjectRegistry.ts), open-ended by id like queues/shops/crafting, not enum-backed.
    // Same {default, byId} two-export shape as queues (kind: 'queues') since every plot not
    // explicitly overridden here should just use DEFAULT_FARM_PLOT_CONFIG — see FarmTypes.ts's
    // own doc. Unlike queues, a THIRD export (`tileExportName`) exists alongside default/byId —
    // FARM_TILE_CONFIG, the single game-wide empty/prepared tile pair every plot shares (see
    // FarmTypes.ts's own doc for why this is deliberately NOT per-plot) — synced separately by
    // syncQueues() via `tileExportName`/`tileManagedKeys`, replacing that export wholesale
    // (same "single object, no unmanaged fields" reasoning DEFAULT_QUEUE_CONFIG's own wholesale
    // replace already uses).
    farms: {
        file: path.join(GAME_DIR, 'data', 'FarmTypes.ts'),
        kind: 'queues',
        defaultExportName: 'DEFAULT_FARM_PLOT_CONFIG',
        byIdExportName: 'FARM_PLOT_CONFIG_BY_ID',
        managedKeys: ['price', 'appearRequirement', 'allowedCrops', 'solid'],
        optionalKeys: ['appearRequirement', 'allowedCrops', 'solid'],
        tileExportName: 'FARM_TILE_CONFIG',
        tileManagedKeys: ['empty', 'prepared', 'icon', 'availableTint', 'occupiedTint'],
    },
    // A MART — a "mart"-typed object drawn on the Tiled map's "mapSettings" layer, open-ended
    // by id like shops/crafting/farms, not enum-backed. Same {default, byId} two-export shape
    // as queues/farms (kind: 'queues' — see that shared mechanism's own doc on farms above) —
    // every mart not explicitly overridden here just uses DEFAULT_MART_CONFIG (empty offers,
    // see MartTypes.ts's own doc), same "always has a sensible default" reasoning farms use
    // rather than shops' own "skip with a warning" (a mart with nothing configured is just an
    // empty, harmless general store, not a shop with no idea which tool to upgrade).
    marts: {
        file: path.join(GAME_DIR, 'data', 'MartTypes.ts'),
        kind: 'queues',
        defaultExportName: 'DEFAULT_MART_CONFIG',
        byIdExportName: 'MART_CONFIG_BY_ID',
        managedKeys: ['name', 'offers', 'appearRequirement', 'solid', 'view'],
        optionalKeys: ['appearRequirement', 'solid', 'view'],
    },
    // The shared recipe pool every Crafting Table lists from by id — see CraftingRecipeTypes.ts's
    // own doc. Open-ended by hand-typed id, same `kind: 'partialRecord'` shape as `crafting`/
    // `shops` below (a level designer invents new recipe ids freely from this tab).
    craftingRecipes: {
        file: path.join(GAME_DIR, 'data', 'CraftingRecipeTypes.ts'),
        exportName: 'CRAFTING_RECIPE_CONFIG',
        kind: 'partialRecord',
        managedKeys: ['ingredients', 'result'],
    },
    // A CRAFTING TABLE — a "craftTable"-typed object drawn on the Tiled map's "mapSettings"
    // layer, open-ended by id like marts/shops/farms. Same {default, byId} two-export shape as
    // marts (kind: 'queues') — every table not explicitly overridden here just uses
    // DEFAULT_CRAFTING_TABLE_CONFIG (empty recipes, see CraftingTableTypes.ts's own doc). NOT
    // the same entity as the "crafting" tab below (CraftTypes.ts's own single-active-recipe
    // auto-drain table) — this one is a tap-a-recipe-row-to-craft popup, any recipe, any
    // number of times, the same "walk up, tap Open, transact" shape as marts. `recipes` is a
    // list of `craftingRecipes` tab ids, not embedded ingredient data (see that tab's own doc).
    craftingTables: {
        file: path.join(GAME_DIR, 'data', 'CraftingTableTypes.ts'),
        kind: 'queues',
        defaultExportName: 'DEFAULT_CRAFTING_TABLE_CONFIG',
        byIdExportName: 'CRAFTING_TABLE_CONFIG_BY_ID',
        managedKeys: ['name', 'recipes', 'appearRequirement', 'solid', 'view'],
        optionalKeys: ['appearRequirement', 'solid', 'view'],
    },
    // A TRIGGER — a "trigger"-typed object drawn on the Tiled map's "mapSettings" layer (see
    // WorldObjectRegistry.ts), open-ended by id like shops/crafting, not enum-backed. Unlike
    // zones/zoneTutorials (also placed-on-map, but auto-discovered from the "zones" tilelayer
    // every time the tab opens), a trigger's id is manually typed by the designer to match
    // whatever they named the Tiled object — same convention shops/crafting/queues already use
    // for their own map-placed, open-ended ids — so no protectEntries/auto-discovery here.
    //
    // Deliberately carries NO effect/action config of its own (that lived here briefly, then
    // moved out — see TriggerTypes.ts's own doc) — a trigger only ever manages
    // destroyOnTrigger; what activating it actually DOES is configured on whichever Zone/Gate/
    // etc's own `requirement` field references it (REQUIREMENT_TYPE_FIELDS.trigger in
    // schemas.js), via MilestoneRequirement.ts's 'trigger' kind.
    triggers: {
        file: path.join(GAME_DIR, 'data', 'TriggerTypes.ts'),
        exportName: 'TRIGGER_CONFIG_BY_ID',
        kind: 'partialRecord',
        managedKeys: ['destroyOnTrigger'],
    },
    // A CROP — game-design content (Wheat, ...), small and fixed like BuildingId/ItemType, so
    // enum-backed rather than an open id-map like farms above — see CropTypes.ts's own doc.
    // Carries no cost/currency of its own any more — planting a crop costs exactly one of
    // whichever `seeds` entry (below) points its own `cropId` back at this one; that link lives
    // entirely on the Seeds tab's side.
    crops: {
        file: path.join(GAME_DIR, 'data', 'CropTypes.ts'),
        exportName: 'CROP_CONFIG',
        kind: 'enumRecord',
        enumName: 'CropId',
        managedKeys: ['name', 'initialMesh', 'stages', 'yield'],
        optionalKeys: ['initialMesh'],
    },
    // A SEED — the bankable, plantable item (see SeedTypes.ts's own doc for why this is its own
    // enum/file/storage rather than folded into `crops` or `resources`). `cropId` is the ONLY
    // link between a seed and what it grows into — enum-backed like `crops`, so a brand new
    // seed id also needs a matching new SeedId enum member (ensureEnumMember handles that, same
    // as any other enumRecord tab). Icon/models/scale/rotationDeg route to AssetLibraryRegistry.ts,
    // same externalFields convention `resources`/`providers` already use.
    seeds: {
        file: path.join(GAME_DIR, 'data', 'SeedTypes.ts'),
        exportName: 'SEED_CONFIG',
        kind: 'enumRecord',
        enumName: 'SeedId',
        managedKeys: ['label', 'cropId'],
        externalFields: { icon: 'assetLibrary', models: 'assetLibrary', scale: 'assetLibrary', rotationDeg: 'assetLibrary' },
    },
    tools: {
        file: path.join(GAME_DIR, 'actions', 'ToolRegistry.ts'),
        exportName: 'TOOL_LIBRARY',
        // Plain object literal keyed by whatever tool ids exist (`satisfies Record<string,
        // ToolVisualEntry>`, not a Record<SomeEnum, ...>) — open-ended like shops/crafting,
        // not enum-backed like gates/buildings, so no enum-member bookkeeping applies here.
        kind: 'partialRecord',
        // `models` is required (ToolVisualEntry.models: ModelDefinition[], never optional) —
        // NOT in optionalKeys, so a mirror that predates this field just leaves the existing
        // value alone (see optionalKeys' own doc) rather than risking wiping it. No
        // protectEntries here: deleting a tool ENTIRELY via this tab's own Delete button is a
        // deliberate, whole-entry action the tab itself fully owns — protectEntries only ever
        // needs to matter for a DIFFERENT tab's cross-sync into a shared file (see
        // syncExternalField()'s own doc — it never deletes anything on its own regardless).
        managedKeys: ['label', 'icon', 'models'],
    },
    assetLibrary: {
        file: path.join(GAME_DIR, 'world', 'AssetLibraryRegistry.ts'),
        exportName: 'ASSET_LIBRARY',
        // Also a plain `satisfies Record<string, AssetLibraryEntry>` object literal, same as
        // TOOL_LIBRARY — open-ended by key, not enum-backed.
        kind: 'partialRecord',
        // Every field on AssetLibraryEntry is managed now (icon/models/scale/rotationDeg).
        managedKeys: ['icon', 'models', 'scale', 'rotationDeg'],
        optionalKeys: ['icon'],
        // MUST be protectEntries — unlike tools/shops/crafting, most entries here don't
        // belong to this tab at all: `resources` and `providers` (see their own
        // externalFields) upsert INTO this same file by id, so an id like "crystalDeposit"
        // or "palm" only ever exists here as a byproduct of the Providers tab, never posted
        // by the Asset Library tab's own listing. Without protectEntries, saving the Asset
        // Library tab treats every id absent from ITS OWN post as deleted and wipes them —
        // exactly the "tools" scenario this flag exists for (see that mapping's own doc),
        // just missed here. This tab's Delete button already goes through the per-field
        // upsert loop in syncRecord()/syncExternalField(), so protecting whole-entry removal
        // only takes away the wholesale "vanished from a differently-scoped post" deletion,
        // not a deliberate single-entry delete.
        protectEntries: true,
    },
    // Reusable real-mesh definitions (model + scale/rotation + offset), keyed by a plain
    // string id a building level, shop level, gate, or queue can OPTIONALLY reference via its
    // own `view` field — see EntityViewRegistry.ts's own doc. Same open-ended-by-key shape as
    // assetLibrary/tools; this tab's own Delete button is meant to actually delete an entry,
    // same reasoning as those two for skipping protectEntries.
    entityViews: {
        file: path.join(GAME_DIR, 'world', 'EntityViewRegistry.ts'),
        exportName: 'ENTITY_VIEW_CONFIG',
        kind: 'partialRecord',
        managedKeys: ['models', 'scale', 'rotationDeg', 'offset'],
    },
    // The NPC/prop that walks a queue's waypoint path in and out (see QuestGiverEntity.ts's
    // own doc) — `variants` has no unmanaged sibling fields on any of its items (view/weight/
    // lootTable are exactly what QuestGiverVariant has), so unlike buildings'/shops' own
    // `levels` this needs no listMerge — a plain wholesale replacement of the whole array is
    // always safe here.
    questGivers: {
        file: path.join(GAME_DIR, 'data', 'QuestGiverTypes.ts'),
        exportName: 'QUEST_GIVER_CONFIG_BY_ID',
        kind: 'partialRecord',
        managedKeys: ['variants', 'moveSpeed'],
    },
    // A selectable player appearance — color/headShape/face/isStarter (see
    // CharacterViewTypes.ts's own doc). No unmanaged sibling fields on any entry, so a
    // plain wholesale per-entry upsert (no listMerge — there's no nested list here at all)
    // is always safe.
    characterViews: {
        file: path.join(GAME_DIR, 'data', 'CharacterViewTypes.ts'),
        exportName: 'CHARACTER_VIEW_CONFIG',
        kind: 'partialRecord',
        managedKeys: ['color', 'headShape', 'face', 'isStarter'],
        optionalKeys: ['isStarter'],
    },
    // Reusable, named task pools (see LootTableTypes.ts's own doc) — a QuestGiverVariant
    // references one of these by id instead of carrying its own possibleTasks list inline, so
    // the same pool can back more than one variant/queue and so the editor can manage tasks as
    // a flat, directly-addable list rather than nested two levels deep inside a variant.
    lootTables: {
        file: path.join(GAME_DIR, 'data', 'LootTableTypes.ts'),
        exportName: 'LOOT_TABLE_CONFIG',
        kind: 'partialRecord',
        managedKeys: ['possibleTasks'],
    },
    // Reusable 2D particle-emitter presets (see ParticleRegistry.ts's own doc) — open-ended by
    // key, same shape as tools/assetLibrary/entityViews. Every field on ParticleEffectDescriptor
    // is managed; there's no unmanaged visual/3D sibling data here the way tools/assetLibrary
    // have, so no protectEntries/listMerge needed.
    particleEffects: {
        file: path.join(GAME_DIR, 'vfx', 'ParticleRegistry.ts'),
        exportName: 'PARTICLE_REGISTRY',
        kind: 'partialRecord',
        managedKeys: ['name', 'texture', 'color', 'blendMode', 'fadeInSec', 'fadeOutSec', 'lifetimeSec', 'sizeMin', 'sizeMax', 'riseSpeedMin', 'riseSpeedMax', 'spreadRadius', 'maxOpacity', 'offset', 'burstSpeedMin', 'burstSpeedMax', 'gravity'],
        // burstSpeedMin/burstSpeedMax/gravity are the only genuinely optional fields on
        // ParticleEffectDescriptor (see that interface's own doc) — an ambient-only effect like
        // craftingMyst never sets them, and this list is what tells syncToSource.mjs a MISSING
        // one means "actually delete it" rather than "this mirror predates the field."
        optionalKeys: ['burstSpeedMin', 'burstSpeedMax', 'gravity'],
    },
};
