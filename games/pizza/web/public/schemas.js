// schemas.js
//
// Declares, per entity-type tab, what fields one entry has and how each
// field should be edited — plain text, a number, a checkbox, a dropdown
// sourced from another tab's live data (e.g. "tool" pulls its options from
// the Tools tab), a requirement picker, a resource-amount cost map, or a
// collapsible list of sub-entries. app.js's form engine (see render.js)
// reads these declaratively instead of every tab hand-rolling its own
// inputs — adding a new field to an existing entity, or a new entity type
// entirely, means editing this file, not the rendering code.
//
// Field descriptor shapes (see render.js for how each is drawn):
//   { key, type: 'text' | 'number' | 'boolean', label, optional? }
//   { key, type: 'select', label, source: <tab id>, optional? } — options sourced live from
//     another tab's data (or the virtual '$spawnerTileTypes' source).
//   { key, type: 'select', label, options: [{value, label}, ...], optional? } — a FIXED inline
//     option list instead of `source` (e.g. popupMode's None/Complete/Simple) — never varies
//     with another tab's data, so nothing to source live.
//   { key, type: 'requirement', label, optional? }
//   { key, type: 'costMap', label, source: <tab id> }
//   { key, type: 'group', label, fields: [...] }
//   { key, type: 'list', label, itemLabel: (item) => string, fields: [...] }
//   { key, type: 'icon', label, optional? } — a texture-name string (e.g. 'mining-pickaxe')
//     stored bare, no path/bundle/extension — the exact form the game's own icon fields use
//     (PIXI.Texture.from(name) resolves it from whatever spritesheet bundle happens to have
//     that name once packed). Rendered as a thumbnail preview + text field + a "Browse"
//     gallery sourced from every image actually found under raw-assets/images/*{tps}*/ (see
//     app.js's renderIconField() and server.mjs's /api/images) — picking one just writes its
//     bare filename, same as typing it by hand.
//   { key, type: 'modelList', label } — a `ModelDefinition[]` field (e.g. a tool/prop's 3D
//     `models` list). Stored in the JSON mirror as an array of bare "Group.Key" dot-paths
//     (e.g. "Props.Tree") into games/pizza/registry/assetsRegistry/modelsRegistry.ts's
//     categorized MODELS export — syncToSource.mjs turns each one back into a real
//     `MODELS.Group.Key` reference on save (see its own doc). Rendered as a "node" picker —
//     one row per model, each a Group dropdown cascading into a Name dropdown within that
//     group (the registry has 190+ models across 6 groups; one flat list would be unusable)
//     — with add/remove rows, since some entries genuinely hold more than one (a tree scatters
//     between MODELS.Props.Tree and MODELS.Props.TreeHigh).
//   { key, type: 'numberRange', label } — a `NumberRange` field (AssetLibraryRegistry.ts's
//     own type: `number | [number, number]`) — a spawn-variance knob like `scale`/
//     `rotationDeg` (a fixed value applies to every spawn identically; a [min, max] tuple
//     rolls a new value each spawn — see AssetLibraryRegistry.ts's resolveRange()). Rendered
//     as a "Random range" checkbox toggling between one number input (fixed) and two (min/
//     max) — stored as a plain JSON number or 2-element array either way, no encoding needed
//     since that's already NumberRange's own on-disk shape.
//
// `source` on a 'select'/'costMap' field names another manifest tab id —
// its options are that tab's current entries (id + label/name), read live
// from allData at render time, so adding a new resource/tool/item/building
// on its own tab immediately shows up as a pickable option everywhere else
// without touching this file.

const REQUIREMENT_FIELD = { key: null, type: 'requirement', label: 'Requirement' };

/**
 * FrameRegistry.ts's own preset names, mirrored here as a fixed inline option list (same
 * "game-side enum-like set, not sourced from any tab" convention as popupMode below) — see
 * that file's own doc. Each zone TYPE (buildings/shops/queues/crafting) already defaults to
 * its own preset (BuildingFrame/ShopFrame/QueueFrame/CraftingFrame) without setting this at
 * all; this field lets ONE SPECIFIC entity override that per-id (e.g. one particular shop
 * using a fancier frame than every other shop). Gates use their own separate `frame` field
 * (see the gates schema below) since they have no popupMode/POPUP_FIELDS at all.
 */
const FRAME_FIELD = {
    key: 'frame', type: 'select', label: 'Popup Frame Override (blank = this type\'s own default)', optional: true,
    options: [
        { value: 'Main', label: 'Main' },
        { value: 'Large', label: 'Large' },
        { value: 'Info', label: 'Info' },
        { value: 'Popup', label: 'Popup' },
        { value: 'Simple', label: 'Simple' },
        { value: 'GateLock', label: 'GateLock' },
        { value: 'BuildingFrame', label: 'BuildingFrame' },
        { value: 'ShopFrame', label: 'ShopFrame' },
        { value: 'QueueFrame', label: 'QueueFrame' },
        { value: 'CraftingFrame', label: 'CraftingFrame' },
    ],
};

/**
 * Shared requirements-popup fields — appended to every zone-type entity's schema (buildings,
 * shops, queues, crafting; see PopupConfig.ts's own doc for the shared game-side types these
 * write). `popupMode` is a FIXED inline option list (see this file's own field-shape doc above),
 * not sourced from any tab — 'None'/'Complete'/'Simple' are the only three the game code
 * actually understands (PopupMode). Leaving `popupMode` unset behaves as 'complete' (every
 * entity's own pre-existing panel, unchanged); leaving `popupBobOffset` unset sits the popup
 * right at the entity's own base instead of floating above it; leaving FRAME_FIELD unset uses
 * this entity type's own default preset (see that field's own doc).
 */
const POPUP_FIELDS = [
    {
        key: 'popupMode', type: 'select', label: 'Requirements Popup', optional: true,
        options: [
            { value: 'complete', label: 'Complete (default)' },
            { value: 'simple', label: 'Simple (resources only, no header icon)' },
            { value: 'none', label: 'None (no popup at all)' },
        ],
    },
    { key: 'popupBobOffset', type: 'number', label: 'Popup Height Offset (blank = sit at the entity\'s base)', optional: true },
    FRAME_FIELD,
];

/**
 * Field rows for the Map tab's two tile lists (see app.js's renderMapTilesTab()) — not a
 * normal ENTITY_SCHEMAS entry since mapTiles' data shape (`{tileSize, grounds[], resources[]}`)
 * isn't a homogeneous record/array of same-shaped entries, so it gets its own bespoke renderer
 * instead of the generic renderEntryCard()/renderActiveTab() path. `groundFields` has no
 * provider picker — only a RESOURCE tile spawns a gatherable provider (see TileMapConfig.ts's
 * RESOURCE_LAYER_NAME); a ground tile is just terrain.
 */
const MAP_TILE_FIELDS = {
    groundFields: [
        { key: 'name', type: 'text', label: 'Name' },
        { key: 'color', type: 'text', label: 'Color' },
        { key: 'walkable', type: 'boolean', label: 'Walkable' },
        { key: 'transparent', type: 'boolean', label: 'Transparent (renders nothing — check Walkable too for an invisible walkway)' },
    ],
    resourceFields: [
        { key: 'name', type: 'text', label: 'Name' },
        { key: 'color', type: 'text', label: 'Color' },
        { key: 'providerType', type: 'select', label: 'Provider', source: 'providers', optional: true },
    ],
};

const ENTITY_SCHEMAS = {
    gates: [
        { key: 'name', type: 'text', label: 'Name' },
        { key: 'requirement', type: 'requirement', label: 'Requirement' },
        { key: 'view', type: 'select', label: 'View (real mesh override, optional)', source: 'entityViews', optional: true },
        { key: 'viewRotationOffsetDeg', type: 'number', label: 'View Rotation Offset (deg, added on top of the View\'s own rotation)', optional: true },
        { key: 'viewScaleMultiplier', type: 'number', label: 'View Scale Multiplier (multiplied onto the View\'s own scale, e.g. 1.5 = 50% bigger)', optional: true },
        { ...FRAME_FIELD, label: 'Icon Panel Frame Override (blank = GateLock)' },
    ],
    buildings: [
        { key: 'name', type: 'text', label: 'Name' },
        { key: 'icon', type: 'icon', label: 'Icon (shown wherever this building is referenced elsewhere, e.g. a gate requiring one of its levels)', optional: true },
        { key: 'appearRequirement', type: 'requirement', label: 'Appear Requirement', optional: true },
        { key: 'baseView', type: 'select', label: 'Base View (before level 1, optional)', source: 'entityViews', optional: true },
        {
            key: 'levels', type: 'list', label: 'Levels',
            itemLabel: item => `Level ${item.level ?? '?'}`,
            fields: [
                { key: 'level', type: 'number', label: 'Level' },
                { key: 'requirements', type: 'costMap', label: 'Requirements', source: 'resources' },
                {
                    key: 'effect', type: 'group', label: 'Effect',
                    fields: [
                        { key: 'type', type: 'text', label: 'Type' },
                        { key: 'value', type: 'number', label: 'Value' },
                        { key: 'description', type: 'text', label: 'Description' },
                    ],
                },
                { key: 'view', type: 'select', label: 'View (real mesh override, optional)', source: 'entityViews', optional: true },
            ],
        },
        ...POPUP_FIELDS,
    ],
    shops: [
        { key: 'name', type: 'text', label: 'Name' },
        { key: 'tool', type: 'select', label: 'Tool', source: 'tools' },
        { key: 'action', type: 'select', label: 'Action', source: 'actions' },
        { key: 'appearRequirement', type: 'requirement', label: 'Appear Requirement', optional: true },
        { key: 'baseView', type: 'select', label: 'Base View (before any upgrade, optional)', source: 'entityViews', optional: true },
        {
            key: 'levels', type: 'list', label: 'Upgrade Levels',
            itemLabel: (item, i) => `Level ${i + 1} — ${item.cost ?? '?'} coins`,
            fields: [
                { key: 'cost', type: 'number', label: 'Cost' },
                { key: 'cooldownSec', type: 'number', label: 'Cooldown (sec)' },
                { key: 'hitIntervalSec', type: 'number', label: 'Hit Interval (sec)', optional: true },
                { key: 'hitScale', type: 'number', label: 'Hit Scale', optional: true },
                { key: 'resourcePerHit', type: 'number', label: 'Resource Per Hit', optional: true },
                { key: 'view', type: 'select', label: 'View (real mesh override, optional)', source: 'entityViews', optional: true },
            ],
        },
        ...POPUP_FIELDS,
    ],
    crafting: [
        { key: 'name', type: 'text', label: 'Name' },
        { key: 'destroyOnComplete', type: 'boolean', label: 'Destroy On Complete' },
        { key: 'appearRequirement', type: 'requirement', label: 'Appear Requirement', optional: true },
        {
            key: 'recipes', type: 'list', label: 'Recipes',
            itemLabel: item => item.id || 'recipe',
            fields: [
                { key: 'id', type: 'text', label: 'Recipe Id' },
                {
                    key: 'result', type: 'group', label: 'Result',
                    fields: [
                        { key: 'item', type: 'select', label: 'Item', source: 'items' },
                        { key: 'amount', type: 'number', label: 'Amount' },
                    ],
                },
                { key: 'cost', type: 'costMap', label: 'Cost', source: 'resources' },
            ],
        },
        // Off by default (false/unset) — the table stays the plain placeholder box, exactly
        // the pre-existing behavior. Turning this on swaps in a real model: either an existing
        // Tool's own model (Tool takes priority when both are set — e.g. showcase the axe this
        // table crafts, using the exact model the player wields once they have one) or a
        // directly-picked model list, same shape as the Resources/Providers tabs' own visual
        // fields. `float` only does anything while this is on — the box never floats.
        { key: 'showModel', type: 'boolean', label: 'Show 3D Model (instead of the placeholder box)' },
        { key: 'toolId', type: 'select', label: 'Use Tool\'s Model', source: 'tools', optional: true },
        { key: 'models', type: 'modelList', label: 'Models (ignored if a Tool is picked above)' },
        { key: 'scale', type: 'numberRange', label: 'Scale' },
        { key: 'rotationDeg', type: 'numberRange', label: 'Rotation (deg)' },
        { key: 'float', type: 'boolean', label: 'Float (idle up/down bob)' },
        { key: 'heightOffset', type: 'number', label: 'Height Offset (nudge the model up/down)', optional: true },
        ...POPUP_FIELDS,
    ],
    // A RESOURCE is the bankable item (Wood/Stone/Berries/Bark/Pebble/GrassFiber) — what
    // actually PRODUCES one (a tree, a stone deposit, a berry bush) is a separate concern,
    // see the `providers` tab below.
    resources: [
        { key: 'label', type: 'text', label: 'Label' },
        // icon/models/scale/rotationDeg are all stored in a DIFFERENT source file
        // (AssetLibraryRegistry.ts, not ResourceTypes.ts — see entityMap.mjs's
        // `externalFields` doc). For a loose ground-loot resource (bark/pebble/grassFiber —
        // no provider at all) this IS its whole world appearance. For a provider-dispensed
        // resource (wood/stone/berries) this happens to be the SAME entry the matching
        // provider's own visual points at (see the Providers tab) — editing either writes
        // the same place, on purpose.
        { key: 'icon', type: 'icon', label: 'Icon', optional: true },
        { key: 'models', type: 'modelList', label: 'Models' },
        { key: 'scale', type: 'numberRange', label: 'Scale' },
        { key: 'rotationDeg', type: 'numberRange', label: 'Rotation (deg)' },
        { key: 'amountPerGather', type: 'number', label: 'Amount Per Gather (loose pickups only — a provider-dispensed resource uses the PROVIDER\'s own amountPerGather instead)' },
    ],
    // A PROVIDER is the world dispenser the player actually chops/mines/forages — action,
    // life, respawn, and a WEIGHTED DROP TABLE of resources (see the Resources tab above).
    providers: [
        { key: 'label', type: 'text', label: 'Label' },
        { key: 'icon', type: 'icon', label: 'Icon', optional: true },
        { key: 'models', type: 'modelList', label: 'Models' },
        { key: 'scale', type: 'numberRange', label: 'Scale' },
        { key: 'rotationDeg', type: 'numberRange', label: 'Rotation (deg)' },
        { key: 'action', type: 'select', label: 'Action', source: 'actions' },
        { key: 'maxLife', type: 'number', label: 'Max Life' },
        { key: 'amountPerGather', type: 'number', label: 'Amount Per Gather (total units per harvest, before the drop table splits them up)' },
        { key: 'respawnSec', type: 'number', label: 'Respawn (sec)' },
        // Weighted yield table — a single 100%-weight entry is the normal case (a tree only
        // ever gives wood). Weights are RELATIVE, not required to sum to 100 — a 9/1 split
        // reads the same as 90/10. e.g. a "stone" deposit dropping 90% stone / 10% pebble:
        // two rows, {resource: stone, weight: 90} and {resource: pebble, weight: 10}.
        {
            key: 'drops', type: 'list', label: 'Drop Table',
            itemLabel: item => `${item.resourceType ?? '(unset)'} × ${item.weight ?? '?'}`,
            fields: [
                { key: 'resourceType', type: 'select', label: 'Resource', source: 'resources' },
                { key: 'weight', type: 'number', label: 'Weight' },
            ],
        },
    ],
    dynamicResourcePlacements: [
        { key: 'resourceType', type: 'select', label: 'Resource', source: 'resources' },
        // '$spawnerTileTypes' is not a manifest tab id — app.js's getOptions() special-cases
        // it to read from /api/spawner-tile-types (ground tile names actually resolvable off
        // a "spawnerLayer" tilelayer on the real Tiled map — see tiledMap.mjs's
        // readSpawnerTileTypes()), not from any tab's own data.
        { key: 'spawnerTileType', type: 'select', label: 'Spawner Tile Type', source: '$spawnerTileTypes' },
        { key: 'density', type: 'number', label: 'Density' },
        { key: 'minDistance', type: 'number', label: 'Min Distance' },
        { key: 'checkIntervalSec', type: 'number', label: 'Check Interval (sec)' },
    ],
    actions: [
        { key: 'hitIntervalSec', type: 'number', label: 'Hit Interval (sec)' },
        { key: 'hitScale', type: 'number', label: 'Hit Scale' },
        { key: 'resourcePerHit', type: 'number', label: 'Resource Per Hit' },
        { key: 'cancelOnLeaveRange', type: 'boolean', label: 'Cancel On Leave Range' },
        { key: 'tool', type: 'select', label: 'Tool', source: 'tools', optional: true },
    ],
    items: [
        { key: 'label', type: 'text', label: 'Label' },
    ],
    tools: [
        { key: 'label', type: 'text', label: 'Label' },
        { key: 'icon', type: 'icon', label: 'Icon' },
        { key: 'models', type: 'modelList', label: 'Models' },
    ],
    // AssetLibraryRegistry.ts's icon is optional there (`icon?: string`, falls back to a
    // blank white square — see getAssetIcon()), unlike ToolVisualEntry.icon which is
    // required — hence `optional: true` here but not on the Tools entry above. `models` is
    // required on both, same as Tools.
    assetLibrary: [
        { key: 'icon', type: 'icon', label: 'Icon', optional: true },
        { key: 'models', type: 'modelList', label: 'Models' },
        { key: 'scale', type: 'numberRange', label: 'Scale' },
        { key: 'rotationDeg', type: 'numberRange', label: 'Rotation (deg)' },
    ],
    // Queues entries (both the shared "default" and each entry in "byId") share this shape.
    queues: [
        { key: 'cooldownSec', type: 'number', label: 'Cooldown (sec)' },
        { key: 'appearRequirement', type: 'requirement', label: 'Appear Requirement', optional: true },
        {
            key: 'possibleTasks', type: 'list', label: 'Possible Tasks (IGNORED if this queue id has an entry in the Quest Givers tab — a giver-driven queue draws tasks from its current variant\'s Loot Table instead; only used for a queue with no giver at all)',
            itemLabel: item => item.resourceType || 'task',
            fields: [
                { key: 'resourceType', type: 'select', label: 'Resource', source: 'resources' },
                { key: 'amount', type: 'number', label: 'Amount Required' },
                { key: 'rewardAmount', type: 'number', label: 'Reward Amount' },
            ],
        },
        { key: 'view', type: 'select', label: 'View (real mesh override, optional)', source: 'entityViews', optional: true },
        ...POPUP_FIELDS,
    ],
    // Reusable real-mesh definitions — a building level/shop level/gate/queue can OPTIONALLY
    // point its own `view` field at one of these ids instead of using its placeholder box (see
    // EntityViewRegistry.ts's own doc). Not itself tied to any one entity kind, same "shared,
    // joined by id convention" shape as the Asset Library tab.
    entityViews: [
        { key: 'models', type: 'modelList', label: 'Models' },
        { key: 'scale', type: 'numberRange', label: 'Scale' },
        { key: 'rotationDeg', type: 'numberRange', label: 'Rotation (deg)' },
        { key: 'offset', type: 'vector3', label: 'Offset (x, y, z)' },
    ],
    // The NPC/prop that walks a queue's waypoint path in and out (see QuestGiverEntity.ts's
    // own doc) — each variant is its own look (an Entity View) PLUS a Loot Table id (see the
    // lootTables tab below), so "a rarer look gives different/better tasks" is just two
    // variants pointing at different loot tables with different weights.
    questGivers: [
        { key: 'moveSpeed', type: 'number', label: 'Move Speed (world units/sec)' },
        {
            key: 'variants', type: 'list', label: 'Variants',
            itemLabel: (item, i) => `Variant ${i + 1} — weight ${item.weight ?? '?'}`,
            fields: [
                { key: 'view', type: 'select', label: 'View', source: 'entityViews' },
                { key: 'weight', type: 'number', label: 'Weight (lower = rarer; the lowest-weight variant is always what appears first)' },
                { key: 'lootTable', type: 'select', label: 'Loot Table', source: 'lootTables' },
            ],
        },
    ],
    // A selectable player appearance — color + head shape + default face (see
    // CharacterViewTypes.ts's own doc). Exactly one entry should have "Starter" checked —
    // that's the look MainPlayer spawns with before the player equips a shop skin.
    characterViews: [
        { key: 'color', type: 'color', label: 'Color' },
        {
            key: 'headShape', type: 'select', label: 'Head Shape',
            options: [{ value: 'cube', label: 'Cube' }],
        },
        { key: 'face', type: 'faceIcon', label: 'Face (images/non-preload)' },
        { key: 'isStarter', type: 'boolean', label: 'Starter (spawn look until the player equips a shop skin — exactly one view should have this checked)' },
    ],
    // Reusable, named task pools — create one here, then point a Quest Giver variant's "Loot
    // Table" field at it. The same table can back more than one variant.
    lootTables: [
        {
            key: 'possibleTasks', type: 'list', label: 'Possible Tasks',
            itemLabel: item => item.resourceType || 'task',
            fields: [
                { key: 'resourceType', type: 'select', label: 'Resource', source: 'resources' },
                { key: 'amount', type: 'number', label: 'Amount Required' },
                { key: 'rewardAmount', type: 'number', label: 'Reward Amount' },
            ],
        },
    ],
};

/** The requirement union's per-type contextual fields — shared by every 'requirement' field regardless of which entity it's attached to. */
const REQUIREMENT_TYPE_FIELDS = {
    building: [
        { key: 'buildingId', type: 'select', label: 'Building', source: 'buildings' },
        { key: 'level', type: 'number', label: 'Level' },
    ],
    item: [
        { key: 'item', type: 'select', label: 'Item', source: 'items' },
    ],
    resource: [
        { key: 'resourceType', type: 'select', label: 'Resource', source: 'resources' },
        { key: 'amount', type: 'number', label: 'Amount' },
    ],
};
