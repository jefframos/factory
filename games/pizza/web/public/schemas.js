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
/** EconomyTypes.ts's CurrencyType, mirrored as a fixed inline option list (same "game-side enum-like set, not sourced from any tab" convention as FRAME_FIELD/popupMode) — used by any 'select' field pricing something in one of these. */
const CURRENCY_OPTIONS = [
    { value: 'money', label: 'Money' },
    { value: 'gem', label: 'Gems' },
    { value: 'energy', label: 'Energy' },
];

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
    // Keyed by zoneNumber (a stringified number, e.g. "0" = "zone1" — see ZoneTypes.ts's own
    // doc), NOT by an entity id like every other tab here — entries are auto-discovered from
    // the real map's "zones" tilelayer (see renderZonesTab() in app.js), not hand-typed. A
    // zone with no requirement set just has no automatic unlock (still openable via the
    // in-game debug "Open Next Zone" button).
    zones: [
        { key: 'requirement', type: 'requirement', label: 'Unlock Requirement', optional: true },
    ],
    gates: [
        { key: 'name', type: 'text', label: 'Name' },
        { key: 'requirement', type: 'requirement', label: 'Requirement' },
        { key: 'view', type: 'select', label: 'View (real mesh override, optional)', source: 'entityViews', optional: true },
        { key: 'viewRotationOffsetDeg', type: 'number', label: 'View Rotation Offset (deg, added on top of the View\'s own rotation)', optional: true },
        { key: 'viewScaleMultiplier', type: 'number', label: 'View Scale Multiplier (multiplied onto the View\'s own scale, e.g. 1.5 = 50% bigger)', optional: true },
        { ...FRAME_FIELD, label: 'Icon Panel Frame Override (blank = GateLock)' },
        { key: 'particleEffectId', type: 'select', label: 'Particle Effect (ambient, while the gate stands)', source: 'particleEffects', optional: true },
        { key: 'destroyParticleEffectId', type: 'select', label: 'Destroy Particle Effect (fires when the gate finishes collapsing)', source: 'particleEffects', optional: true },
        { key: 'destroyParticleCount', type: 'number', label: 'Destroy Particle Count', optional: true },
        { key: 'cameraFocusHeightOffset', type: 'number', label: 'Camera Focus Height Offset (raises the camera\'s look-at point during the unlock sequence, which pushes the gate lower on screen — blank = centered on the gate)', optional: true },
    ],
    buildings: [
        { key: 'name', type: 'text', label: 'Name' },
        { key: 'icon', type: 'icon', label: 'Icon (shown wherever this building is referenced elsewhere, e.g. a gate requiring one of its levels)', optional: true },
        { key: 'appearRequirement', type: 'requirement', label: 'Appear Requirement', optional: true },
        { key: 'baseView', type: 'select', label: 'Base View (before level 1, optional)', source: 'entityViews', optional: true },
        { key: 'solid', type: 'number', label: 'Solid (0 = no collider/walk-through, 1 = full trigger area, 0.5 = half size centered — 0 by default)', optional: true },
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
        { key: 'updateParticleEffectId', type: 'select', label: 'Update Particle Effect (fires every time this building levels up)', source: 'particleEffects', optional: true },
        { key: 'updateParticleCount', type: 'number', label: 'Update Particle Count', optional: true },
        ...POPUP_FIELDS,
    ],
    shops: [
        { key: 'name', type: 'text', label: 'Name' },
        { key: 'tool', type: 'select', label: 'Tool', source: 'tools' },
        { key: 'action', type: 'select', label: 'Action', source: 'actions' },
        { key: 'appearRequirement', type: 'requirement', label: 'Appear Requirement', optional: true },
        { key: 'baseView', type: 'select', label: 'Base View (before any upgrade, optional)', source: 'entityViews', optional: true },
        { key: 'solid', type: 'number', label: 'Solid (0 = no collider/walk-through, 1 = full trigger area, 0.5 = half size centered — 0 by default)', optional: true },
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
        { key: 'solid', type: 'number', label: 'Solid (0 = no collider/walk-through, 1 = full trigger area, 0.5 = half size centered — 0 by default)', optional: true },
        { key: 'particleEffectId', type: 'select', label: 'Particle Effect', source: 'particleEffects', optional: true },
        { key: 'destroyParticleEffectId', type: 'select', label: 'Destroy Particle Effect (fires when a destroyOnComplete table is removed)', source: 'particleEffects', optional: true },
        { key: 'destroyParticleCount', type: 'number', label: 'Destroy Particle Count', optional: true },
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
        { key: 'solid', type: 'number', label: 'Solid (0 = no collider/walk-through, 1 = full trigger area, 0.5 = half size centered — 0 by default)', optional: true },
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
        { key: 'particleEffectId', type: 'select', label: 'Particle Effect (ambient, while NOT depleted)', source: 'particleEffects', optional: true },
        { key: 'destroyParticleEffectId', type: 'select', label: 'Destroy Particle Effect (fires on a full harvest)', source: 'particleEffects', optional: true },
        { key: 'destroyParticleCount', type: 'number', label: 'Destroy Particle Count', optional: true },
    ],
    dynamicResourcePlacements: [
        // Not sourced from another tab — a small fixed choice, same as shapeResourcePlacements'
        // own Spawn Type field below. Only ONE of the two fields below actually applies,
        // whichever this selects — see DynamicResourceTypes.ts's own doc for why both fields
        // stay on every entry instead of the form hiding whichever doesn't apply.
        {
            key: 'spawnType', type: 'select', label: 'Spawn Type', optional: true,
            options: [
                { value: 'resource', label: 'Resource (loose pickup on contact)' },
                { value: 'provider', label: 'Provider (real gatherable tree/deposit/bush, respawns over time)' },
            ],
        },
        { key: 'resourceType', type: 'select', label: 'Resource (used when Spawn Type = Resource)', source: 'resources', optional: true },
        { key: 'providerType', type: 'select', label: 'Provider (used when Spawn Type = Provider)', source: 'providers', optional: true },
        // '$spawnerTileTypes' is not a manifest tab id — app.js's getOptions() special-cases
        // it to read from /api/spawner-tile-types (ground tile names actually resolvable off
        // a "spawnerLayer" tilelayer on the real Tiled map — see tiledMap.mjs's
        // readSpawnerTileTypes()), not from any tab's own data.
        { key: 'spawnerTileType', type: 'select', label: 'Spawner Tile Type', source: '$spawnerTileTypes' },
        { key: 'density', type: 'number', label: 'Density' },
        { key: 'minDistance', type: 'number', label: 'Min Distance' },
        { key: 'checkIntervalSec', type: 'number', label: 'Check Interval (sec)' },
    ],
    shapeResourcePlacements: [
        // Not sourced from another tab — a small fixed choice, same as popupMode's own inline
        // options elsewhere in this file. Only ONE of the fields below actually applies,
        // whichever this selects — see ShapeResourceTypes.ts's own doc for why all three
        // stay on every entry instead of the form hiding whichever doesn't apply.
        {
            key: 'spawnType', type: 'select', label: 'Spawn Type', optional: true,
            options: [
                { value: 'resource', label: 'Resource (picked up on contact)' },
                { value: 'animal', label: 'Animal (wanders, must be caught)' },
                { value: 'provider', label: 'Provider (real gatherable tree/deposit/bush, respawns over time)' },
            ],
        },
        { key: 'resourceType', type: 'select', label: 'Resource (used when Spawn Type = Resource)', source: 'resources', optional: true },
        { key: 'animalType', type: 'select', label: 'Animal (used when Spawn Type = Animal)', source: 'animals', optional: true },
        { key: 'providerType', type: 'select', label: 'Provider (used when Spawn Type = Provider)', source: 'providers', optional: true },
        // '$spawnerShapeIds' is not a manifest tab id — app.js's getOptions() special-cases
        // it to read from /api/spawner-shape-ids (the "id" custom property of every
        // "spawner"-type object drawn on the map's mapSettings layer — see tiledMap.mjs's
        // readMapObjectIds()), not from any tab's own data.
        { key: 'shapeId', type: 'select', label: 'Spawner Shape', source: '$spawnerShapeIds' },
        { key: 'count', type: 'number', label: 'Count (target instances inside this shape at once — ignored if Density below is set above 0)' },
        { key: 'density', type: 'number', label: 'Density (target instances per tile-area of the shape — for a LARGE shape; overrides Count when > 0)', optional: true },
        { key: 'minDistance', type: 'number', label: 'Min Distance' },
        { key: 'checkIntervalSec', type: 'number', label: 'Check Interval (sec)' },
    ],
    animals: [
        { key: 'label', type: 'text', label: 'Label' },
        { key: 'resourceType', type: 'select', label: 'Resource (world model + caught-state icon — never banked, a catch makes it a follower instead)', source: 'resources' },
        { key: 'captureSec', type: 'number', label: 'Capture Time (sec) — how long the player must stand in range holding the requirement' },
        // A PAIR — either both set or both left blank (a bare-handed catch, no item needed at
        // all). See AnimalTypes.ts's own doc on why "amount" is the closest thing this codebase
        // has to a "level" for an item today.
        { key: 'requirementItem', type: 'select', label: 'Required Item (optional — blank means no item needed)', source: 'items', optional: true },
        { key: 'requirementAmount', type: 'number', label: 'Required Amount', optional: true },
        { key: 'wanderSpeed', type: 'number', label: 'Wander Speed (world units/sec)' },
        { key: 'wanderPauseRangeSec', type: 'numberRange', label: 'Wander Pause (sec)' },
        { key: 'triggerRadius', type: 'number', label: 'Trigger Radius (world units — how close the player must stand to capture; blank defaults to 1)', optional: true },
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
        { key: 'solid', type: 'number', label: 'Solid (0 = no collider/walk-through, 1 = full trigger area, 0.5 = half size centered — 0 by default)', optional: true },
        ...POPUP_FIELDS,
    ],
    // Farm plot entries — both the shared "default" and each entry in "byId" — see FarmTypes.
    // ts's own doc. Ids come from the map's own "farm"-typed mapSettings objects, same
    // auto-discovery-by-id convention as queues. Deliberately does NOT include `tiles` —
    // FARM_TILE_CONFIG is a single game-wide export, not per-plot (see FARM_TILE_FIELDS below,
    // rendered once at the top of the Farms tab instead of on every entry card).
    farms: [
        {
            key: 'price', type: 'group', label: 'Price',
            fields: [
                { key: 'currency', type: 'select', label: 'Currency', options: CURRENCY_OPTIONS },
                { key: 'amount', type: 'number', label: 'Amount' },
            ],
        },
        { key: 'appearRequirement', type: 'requirement', label: 'Appear Requirement (this plot\'s own unlock, on top of its zone needing to already be revealed)', optional: true },
        // No multi-select field type exists in the editor's render engine yet (see this file's
        // own field-shape doc) — allowedCrops is left off this schema for now, so a plot always
        // shows as "any crop"; edit FarmTypes.ts by hand for a plot that needs the real
        // restriction until that field type exists.
        { key: 'solid', type: 'number', label: 'Solid (0 = no collider/walk-through, 1 = full trigger area, 0.5 = half size centered — 0 by default)', optional: true },
    ],
    // FARM_TILE_CONFIG's own two fields — the empty/prepared tile pair EVERY farm plot shares
    // (see FarmTypes.ts's own doc for why this is a single game-wide export, not per-plot).
    // Rendered once, above the Default/By-id cards, by app.js's renderFarmsTab() — not a normal
    // ENTITY_SCHEMAS entry read through the generic per-id card path the rest of this file backs.
    farmTiles: [
        { key: 'empty', type: 'select', label: 'Empty (shown before ANY plot is bought)', source: 'entityViews', optional: true },
        { key: 'prepared', type: 'select', label: 'Prepared (shown once a plot is bought, before anything is planted)', source: 'entityViews', optional: true },
        { key: 'icon', type: 'icon', label: 'Notification Icon (shown in the "Farm Unlocked!" popup when ANY plot is bought)', optional: true },
    ],
    // A plantable crop — game-design content (Wheat, ...), not read from the map at all (see
    // CropTypes.ts's own doc); a Farms tab plot references one of these by id via its own
    // Allowed Crops field.
    crops: [
        { key: 'name', type: 'text', label: 'Name' },
        {
            key: 'plantCost', type: 'group', label: 'Plant Cost',
            fields: [
                { key: 'currency', type: 'select', label: 'Currency', options: CURRENCY_OPTIONS },
                { key: 'amount', type: 'number', label: 'Amount' },
            ],
        },
        {
            key: 'stages', type: 'list', label: 'Growth Stages (ordered seedling -> harvestable; the LAST stage is the harvestable one)',
            itemLabel: (item, i) => `Stage ${i + 1} — ${item.tile || 'tile?'}`,
            fields: [
                { key: 'durationSec', type: 'number', label: 'Duration (sec, ignored on the last/harvestable stage)' },
                { key: 'tile', type: 'text', label: 'Tile' },
            ],
        },
        {
            key: 'yield', type: 'group', label: 'Harvest Yield',
            fields: [
                { key: 'resourceType', type: 'select', label: 'Resource', source: 'resources' },
                { key: 'amount', type: 'number', label: 'Amount' },
            ],
        },
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
    // Reusable 2D particle-emitter presets (see ParticleRegistry.ts's own doc) — create one
    // here, then pick it by name wherever a "Particle Effect" field appears (e.g. the Crafting
    // tab). One texture can back several differently-tinted/timed presets; ParticleSystem
    // batches by texture, not by preset, so that's still one draw call regardless.
    particleEffects: [
        { key: 'name', type: 'text', label: 'Name' },
        { key: 'texture', type: 'faceIcon', label: 'Texture (images/non-preload)' },
        { key: 'color', type: 'color', label: 'Tint Color' },
        {
            key: 'blendMode', type: 'select', label: 'Blend Mode',
            options: [
                { value: 'additive', label: 'Additive (glows, brightens overlaps — magic/fire/light)' },
                { value: 'normal', label: 'Normal (flat alpha blend — cartoonish, no overlap glow)' },
            ],
        },
        { key: 'fadeInSec', type: 'number', label: 'Fade In (sec)' },
        { key: 'fadeOutSec', type: 'number', label: 'Fade Out (sec)' },
        { key: 'lifetimeSec', type: 'number', label: 'Lifetime (sec, fade in/out included)' },
        { key: 'sizeMin', type: 'number', label: 'Size Min (world units)' },
        { key: 'sizeMax', type: 'number', label: 'Size Max (world units)' },
        { key: 'riseSpeedMin', type: 'number', label: 'Rise Speed Min (world units/sec — continuous/ambient emitters only)' },
        { key: 'riseSpeedMax', type: 'number', label: 'Rise Speed Max (world units/sec — continuous/ambient emitters only)' },
        { key: 'spreadRadius', type: 'number', label: 'Spread Radius (XZ, world units — continuous/ambient emitters only)' },
        { key: 'maxOpacity', type: 'number', label: 'Max Opacity (0-1)' },
        { key: 'offset', type: 'vector3', label: 'Offset (x, y, z — nudges on top of wherever the entity places the emitter)' },
        { key: 'burstSpeedMin', type: 'number', label: 'Burst Speed Min (world units/sec — one-shot bursts only, e.g. on-destroy)', optional: true },
        { key: 'burstSpeedMax', type: 'number', label: 'Burst Speed Max (world units/sec — one-shot bursts only)', optional: true },
        { key: 'gravity', type: 'number', label: 'Gravity (world units/sec² — pulls a burst back down; one-shot bursts only)', optional: true },
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
    // Added for the Zones tab — "this zone unlocks once gate X is unlocked" — but usable from
    // any other Requirement field too (gates/buildings/shops/queues/crafting all share this
    // same widget). See MilestoneRequirement.ts's own GateMilestoneRequirement doc.
    gate: [
        { key: 'gateId', type: 'select', label: 'Gate', source: 'gates' },
    ],
};
