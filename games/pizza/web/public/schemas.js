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
//   { key, type: 'select', label, source: <tab id>, optional? }
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
    ],
    buildings: [
        { key: 'name', type: 'text', label: 'Name' },
        { key: 'appearRequirement', type: 'requirement', label: 'Appear Requirement', optional: true },
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
            ],
        },
    ],
    shops: [
        { key: 'name', type: 'text', label: 'Name' },
        { key: 'tool', type: 'select', label: 'Tool', source: 'tools' },
        { key: 'action', type: 'select', label: 'Action', source: 'actions' },
        { key: 'appearRequirement', type: 'requirement', label: 'Appear Requirement', optional: true },
        {
            key: 'levels', type: 'list', label: 'Upgrade Levels',
            itemLabel: (item, i) => `Level ${i + 1} — ${item.cost ?? '?'} coins`,
            fields: [
                { key: 'cost', type: 'number', label: 'Cost' },
                { key: 'cooldownSec', type: 'number', label: 'Cooldown (sec)' },
                { key: 'hitIntervalSec', type: 'number', label: 'Hit Interval (sec)', optional: true },
                { key: 'hitScale', type: 'number', label: 'Hit Scale', optional: true },
                { key: 'resourcePerHit', type: 'number', label: 'Resource Per Hit', optional: true },
            ],
        },
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
