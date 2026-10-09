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

/** StoreTypes.ts's StoreSpotDirection — which way a store's waiting line extends (map north = up in Tiled). */
const STORE_WAIT_STYLE_OPTIONS = [
    { value: 'cluster', label: 'Cluster (gather around the shelf/cashier)' },
    { value: 'line', label: 'Line (straight line)' },
];

const STORE_SPOT_DIRECTION_OPTIONS = [
    { value: 'north', label: 'North (up on the map)' },
    { value: 'south', label: 'South (down on the map)' },
    { value: 'east', label: 'East (right on the map)' },
    { value: 'west', label: 'West (left on the map)' },
];

const FRAME_FIELD = {
    key: 'frame', type: 'select', label: 'Popup Frame Override (blank = this type\'s own default; Floor = painted on the ground, placed by the Floor Label fields below)', optional: true,
    options: [
        { value: 'Floor', label: 'Floor (in-world, painted on the ground)' },
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
 * FRAME_FIELD plus the in-world 'Floor' pseudo frame (PopupConfig.ts's FLOOR_FRAME — info painted on
 * the floor in 3D instead of a UI-layer popup). Only storages understand 'Floor' for now, so only
 * the Storages schema uses this variant; every other entity keeps plain FRAME_FIELD.
 */
const STORAGE_FRAME_FIELD = {
    ...FRAME_FIELD,
    label: 'Popup Frame Override (blank = Floor — stored count beside the storage, price on its purchase area; pick a frame for a floating popup instead)',
};

/** PopupConfig.ts's FloorLabelSide — which side of the footprint a 'Floor' frame label sits on. */
const FLOOR_LABEL_SIDE_FIELD = {
    key: 'floorLabelSide', type: 'select', label: 'Floor Label Side (Floor frame only — blank = South)', optional: true,
    options: [
        { value: 'south', label: 'South (below, on the map)' },
        { value: 'north', label: 'North (above, on the map)' },
        { value: 'east', label: 'East (right, on the map)' },
        { value: 'west', label: 'West (left, on the map)' },
    ],
};

/** PopupConfig.ts's FloorLabelConfig — only used when `frame` is 'Floor'. */
const FLOOR_LABEL_FIELDS = [
    FLOOR_LABEL_SIDE_FIELD,
    { key: 'floorLabelSize', type: 'number', label: 'Floor Label Size (Floor frame only — height on the ground, world units; blank = 2.7)', optional: true },
    { key: 'floorLabelGap', type: 'number', label: 'Floor Label Gap (Floor frame only — distance from the footprint\'s edge; blank = 0.3)', optional: true },
];

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
    ...FLOOR_LABEL_FIELDS,
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

// Every key under MODELS.Characters in modelsRegistry.ts that is actually an animation clip
// (CharacterMedium is the base mesh, not a clip, so it's excluded) — kept as a fixed inline
// list rather than `source` because these come from the auto-generated model registry, not
// another editor tab. Shared by every animation-clip field on the Player tab (see PlayerConfig.ts's
// own PlayerAnimationConfig doc) so all eight fields offer the same dropdown.
const CHARACTER_ANIMATION_OPTIONS = [
    'Digging', 'Excited', 'FallingIdle', 'Idle', 'Jump', 'JumpingUp', 'Landing', 'PickFruit',
    'PlantTree', 'Roll', 'Run', 'Running', 'Sitting', 'StandToRoll', 'StandToSit', 'StandingMeleeAttackDownwardCHOP',
    'StandingPICKAXE', 'Talking', 'TestIdle', 'Walking', 'Watering',
].map(name => ({ value: name, label: name }));

const ANIMATION_CLIP_FIELDS = [
    { key: 'idle', type: 'select', label: 'Idle', options: CHARACTER_ANIMATION_OPTIONS },
    { key: 'walk', type: 'select', label: 'Walk', options: CHARACTER_ANIMATION_OPTIONS },
    { key: 'run', type: 'select', label: 'Run', options: CHARACTER_ANIMATION_OPTIONS },
    { key: 'jumpUp', type: 'select', label: 'Jump Up', options: CHARACTER_ANIMATION_OPTIONS },
    { key: 'falling', type: 'select', label: 'Falling', options: CHARACTER_ANIMATION_OPTIONS },
    { key: 'landing', type: 'select', label: 'Landing', options: CHARACTER_ANIMATION_OPTIONS },
    { key: 'talk', type: 'select', label: 'Talk (quest-giver offer pose, unused by the player itself)', options: CHARACTER_ANIMATION_OPTIONS },
    { key: 'happy', type: 'select', label: 'Happy (quest-giver completion pose, unused by the player itself)', options: CHARACTER_ANIMATION_OPTIONS },
    { key: 'sitDown', type: 'select', label: 'Sit Down (played once when an NPC sits — e.g. the hire desk manager; then Sitting loops)', options: CHARACTER_ANIMATION_OPTIONS, optional: true },
    { key: 'sitting', type: 'select', label: 'Sitting (looped while seated)', options: CHARACTER_ANIMATION_OPTIONS, optional: true },
];

const ENTITY_SCHEMAS = {
    // Keyed by zoneNumber (a stringified number, e.g. "0" = "zone1" — see ZoneTypes.ts's own
    // doc), NOT by an entity id like every other tab here — entries are auto-discovered from
    // the real map's "zones" tilelayer (see renderZonesTab() in app.js), not hand-typed. A
    // zone with no requirement set just has no automatic unlock (still openable via the
    // in-game debug "Open Next Zone" button).
    zones: [
        { key: 'requirement', type: 'requirement', label: 'Unlock Requirement', optional: true },
        { key: 'cameraTemplateId', type: 'select', label: 'Camera Template (blank = the Camera Templates tab\'s own "default" entry)', source: 'cameraTemplates', optional: true },
    ],
    // The end-of-demo popup (DemoTypes.ts) — only the "default" entry is used.
    demo: [
        { key: 'endRequirement', type: 'requirement', label: 'Ends the Demo When (the popup shows once per save, after any build animation/camera trip it caused)', optional: true },
        { key: 'delaySec', type: 'number', label: 'Delay (seconds after that before the popup shows — blank = 0)', optional: true },
        { key: 'title', type: 'text', label: 'Popup Title' },
        { key: 'message', type: 'text', label: 'Popup Message' },
        { key: 'disabled', type: 'boolean', label: 'Disabled (no end-of-demo popup)', optional: true },
    ],
    // Free-designer-id (NOT zoneNumber-keyed, unlike `zones`/`zoneTutorials` above) — a "default"
    // entry is expected to always exist (see CameraTemplateTypes.ts's own doc); deleting it just
    // means every zone with no Camera Template of its own falls back to whatever
    // getCameraTemplate()'s OWN hardcoded fallback ends up resolving, which is itself the
    // "default" id — i.e. don't actually delete it, this schema just doesn't stop you.
    cameraTemplates: [
        { key: 'yawDeg', type: 'number', label: 'Yaw (deg)' },
        { key: 'pitchDeg', type: 'number', label: 'Pitch (deg, 0 = level with the player, 90 = straight overhead)' },
        { key: 'distance', type: 'number', label: 'Distance' },
        { key: 'followSpeed', type: 'number', label: 'Follow Speed (higher = snappier)' },
    ],
    // Keyed by zoneNumber, same auto-discovery-from-the-map convention as `zones` just above.
    // A step's `craftId`/`gateId`/`triggerId` are ALL present on the field list below but only
    // one is ever meaningful per entry (whichever `kind` selects) — same "extra field just sits
    // unused" convention buildings' `levels`/providers' `drops` list items already tolerate;
    // there's no conditional-field support in this schema engine to hide the other two. A
    // 'trigger' step has no resource to gather — the arrow just points at that trigger's placed
    // location until it activates (see ZoneTutorialController.ts's own doc). The store kinds
    // (Fill Storage / Serve Sale / Collect Money / Build) are the FTUE's shop lesson — see
    // ZoneTutorialTypes.ts.
    zoneTutorials: [
        {
            key: 'steps', type: 'list', label: 'Steps (walked through in order)',
            itemLabel: item => ({
                craft: `Craft: ${item.craftId ?? '?'}${item.gatherZone !== undefined ? ` (gather in zone ${item.gatherZone})` : ''}`,
                gate: `Gate: ${item.gateId ?? '?'}`,
                storage: `Fill Storage: ${item.storageId ?? '?'} x${item.amount ?? 1}${item.farmId ? ` (from ${item.farmId})` : ''}`,
                sale: `Serve Sale: ${item.storeId ?? '?'} (${item.amount ?? 1} total)`,
                collectMoney: `Collect Money: ${item.storeId ?? '?'}`,
                build: `Build: ${item.buildingId ?? '?'}`,
                buyStorage: `Buy Storage: ${item.storageId ?? '?'}${item.gatherZone !== undefined ? ` (gather in zone ${item.gatherZone})` : ''}`,
            })[item.kind] ?? `Trigger: ${item.triggerId ?? '?'}`,
            fields: [
                {
                    key: 'kind', type: 'select', label: 'Kind',
                    options: [
                        { value: 'craft', label: 'Craft' },
                        { value: 'gate', label: 'Gate' },
                        { value: 'trigger', label: 'Trigger' },
                        { value: 'storage', label: 'Fill Storage (gather its item from a farm, deposit it)' },
                        { value: 'sale', label: 'Serve Sale (stand at the store\'s cashier until a client pays)' },
                        { value: 'collectMoney', label: 'Collect Money (grab the store\'s money drop)' },
                        { value: 'build', label: 'Build (pay at the building\'s dropper until it\'s Lv 1)' },
                        { value: 'buyStorage', label: 'Buy Storage (gather its resource cost, e.g. chop trees for wood, then pay at it)' },
                    ],
                },
                { key: 'craftId', type: 'select', label: 'Craft Table (if Kind = Craft)', source: 'crafting', optional: true },
                { key: 'gateId', type: 'select', label: 'Gate (if Kind = Gate)', source: 'gates', optional: true },
                { key: 'triggerId', type: 'select', label: 'Trigger (if Kind = Trigger)', source: 'triggers', optional: true },
                { key: 'storageId', type: 'select', label: 'Storage (if Kind = Fill Storage — needs a Resource Type on the Storages tab; or Buy Storage — a storage or a mix station)', source: '$buyableIds', optional: true },
                { key: 'gatherZone', type: 'number', label: 'Gather Zone (if Kind = Buy Storage or Craft — only point at sources in this zone number, e.g. 3 for the tree zone; blank = nearest anywhere)', optional: true },
                { key: 'farmId', type: 'select', label: 'Farm (if Kind = Fill Storage — where the gather arrow points; blank = nearest farm growing that item)', source: 'farms', optional: true },
                { key: 'storeId', type: 'select', label: 'Store (if Kind = Serve Sale / Collect Money)', source: 'stores', optional: true },
                { key: 'amount', type: 'number', label: 'Amount (Fill Storage: units on the shelf; Serve Sale: total sales — blank = 1)', optional: true },
                { key: 'buildingId', type: 'select', label: 'Building (if Kind = Build)', source: 'buildings', optional: true },
                { key: 'iconTextureId', type: 'icon', label: 'Icon Override (blank = tutorial\'s own Arrow Icon below)', optional: true },
                { key: 'offset', type: 'vector3', label: 'Icon Offset (x, y, z — world units nudged onto the target position; default 0,0,0)' },
            ],
        },
        { key: 'arrowTextureId', type: 'icon', label: 'Arrow Icon (fallback for any step above with no Icon Override set)' },
        { key: 'use3dArrow', type: 'boolean', label: 'Use 3D Arrow (not implemented yet — screen-space arrow always shows regardless)' },
        { key: 'startRequirement', type: 'requirement', label: 'Start Requirement (starts on its own the moment this is met, wherever the player is — instead of when they walk into this zone)', optional: true },
    ],
    // One fixed row per ZoneColorKind — see ZoneColorTypes.ts's own doc. The label spells out
    // which entity type each kind actually renders on, since "buildingDropper"/"gateDropper"
    // read as near-identical ids at a glance otherwise.
    colors: [
        { key: 'color', type: 'color', label: 'Color' },
    ],
    gates: [
        { key: 'name', type: 'text', label: 'Name' },
        { key: 'requirement', type: 'requirement', label: 'Requirement' },
        { key: 'view', type: 'select', label: 'View (real mesh override, optional)', source: 'entityViews', optional: true },
        { key: 'viewRotationOffsetDeg', type: 'number', label: 'View Rotation Offset (deg, added on top of the View\'s own rotation)', optional: true },
        { key: 'viewScaleMultiplier', type: 'number', label: 'View Scale Multiplier (multiplied onto the View\'s own scale, e.g. 1.5 = 50% bigger)', optional: true },
        { ...FRAME_FIELD, label: 'Icon Panel Frame Override (blank = GateLock; Floor = painted on the ground beside the gate)' },
        ...FLOOR_LABEL_FIELDS,
        { key: 'particleEffectId', type: 'select', label: 'Particle Effect (ambient, while the gate stands)', source: 'particleEffects', optional: true },
        { key: 'destroyParticleEffectId', type: 'select', label: 'Destroy Particle Effect (fires when the gate finishes collapsing)', source: 'particleEffects', optional: true },
        { key: 'destroyParticleCount', type: 'number', label: 'Destroy Particle Count', optional: true },
        { key: 'cameraFocusHeightOffset', type: 'number', label: 'Camera Focus Height Offset (raises the camera\'s look-at point during the unlock sequence, which pushes the gate lower on screen — blank = centered on the gate)', optional: true },
        { key: 'disabled', type: 'boolean', label: 'Disabled (takes this gate out of the game entirely — never built, and any OTHER entity waiting on {type:\'gate\'} referencing it treats it as already met instead of blocking forever)', optional: true },
    ],
    buildings: [
        { key: 'name', type: 'text', label: 'Name' },
        { key: 'icon', type: 'icon', label: 'Icon (shown wherever this building is referenced elsewhere, e.g. a gate requiring one of its levels)', optional: true },
        { key: 'appearRequirement', type: 'requirement', label: 'Appear Requirement', optional: true },
        { key: 'baseView', type: 'select', label: 'Base View (before level 1, optional)', source: 'entityViews', optional: true },
        { key: 'baseFillFull', type: 'boolean', label: 'Base Fill Full (level 0 renders 100% built, regardless of run position)', optional: true },
        { key: 'baseFillFraction', type: 'number', label: 'Base Fill Fraction (0-1 — how built level 0 already looks before any deposit; later levels sharing its mesh grow linearly from here up to 1. Blank = default eased curve)', optional: true },
        { key: 'solid', type: 'number', label: 'Solid (0 = no collider/walk-through, 1 = full trigger area, 0.5 = half size centered — 0 by default; ignored if Solid From Map is checked)', optional: true },
        { key: 'solidFromMap', type: 'boolean', label: 'Solid From Map (ignore Solid above — instead, one collider per "useOwnMesh" piece, sized to that piece\'s own bounds, using its own \'solid\' map property. Lets e.g. walls be solid while a floor piece sharing the same id stays walk-through)', optional: true },
        {
            key: 'levels', type: 'list', label: 'Levels',
            itemLabel: item => `Level ${item.level ?? '?'}`,
            fields: [
                { key: 'level', type: 'number', label: 'Level' },
                { key: 'requirements', type: 'costMap', label: 'Requirements', source: 'resources' },
                { key: 'money', type: 'number', label: 'Money (coins paid from the wallet at the dropper, on top of Requirements — blank = none)', optional: true },
                {
                    key: 'effect', type: 'group', label: 'Effect',
                    fields: [
                        { key: 'type', type: 'text', label: 'Type' },
                        { key: 'value', type: 'number', label: 'Value' },
                        { key: 'description', type: 'text', label: 'Description' },
                    ],
                },
                { key: 'view', type: 'select', label: 'View (real mesh override, optional)', source: 'entityViews', optional: true },
                { key: 'fillFull', type: 'boolean', label: 'Fill Full (this level renders 100% built, regardless of run position)', optional: true },
                { key: 'forceOwnMesh', type: 'boolean', label: 'Force Own Mesh (use this building\'s Tiled "useOwnMesh" pieces at THIS level even though Base View/View above would otherwise resolve to a real model — for a building whose unbuilt site should show a placeholder View but whose built level should show whatever\'s actually drawn on the map)', optional: true },
            ],
        },
        { key: 'updateParticleEffectId', type: 'select', label: 'Update Particle Effect (fires every time this building levels up)', source: 'particleEffects', optional: true },
        { key: 'updateParticleCount', type: 'number', label: 'Update Particle Count', optional: true },
        { key: 'floorLabelIcon', type: 'icon', label: 'Floor Label Icon (Floor frame only — drawn above the cost to show what\'s being built, e.g. ItemIcon_Shop_old-2 for a shop; blank = just the cost)', optional: true },
        { key: 'buildDurationMultiplier', type: 'number', label: 'Build Duration Multiplier (x how long the build animation takes when it levels up — walls rising, pieces sweeping in; the camera holds on it until done. 1.5 = 50% slower; blank = 1)', optional: true },
        { key: 'baseAtDropper', type: 'boolean', label: 'Base Site At Dropper (the unbuilt level-0 Base View stands at the center of this building\'s dropper instead of at the building\'s own position — falls back to the building position if it has no dropper)', optional: true },
        { key: 'noSiteBeforeBuilt', type: 'boolean', label: 'Nothing Before Built (no site, placeholder box or drawn pieces before level 1 — just the dropper outline + price, like a for-sale storage)', optional: true },
        { key: 'priceInsideDropper', type: 'boolean', label: 'Price Inside Dropper (cost painted inside the dropper, centered — like a for-sale storage — instead of beside it / a popup)', optional: true },
        { key: 'anchorAtDropper', type: 'boolean', label: 'Anchor Popup/Particles At Dropper (requirements panel, Level Up! callout, and update particle burst all spawn at this building\'s own dropper instead of its mesh — falls back to the mesh if it has no dropper)', optional: true },
        { key: 'npcId', type: 'select', label: 'NPC (optional — spawns an animated NPC at this building)', source: 'npcs', optional: true },
        { key: 'npcOffset', type: 'vector3', label: 'NPC Offset (x, y, z — nudges off the building\'s own mesh position; only used when NPC is set)', optional: true },
        ...POPUP_FIELDS,
        { key: 'disabled', type: 'boolean', label: 'Disabled (takes this building out of the game entirely — never built, and any OTHER entity waiting on {type:\'building\'} referencing it treats it as already met instead of blocking forever)', optional: true },
        { key: 'floorChecker', type: 'select', label: 'Floor Checker (store sections / store buildings: the checker for THIS building\'s own floor rects — Store View tab -> Floor; blank = the store\'s)', source: 'storeFloors', optional: true },
        { key: 'wallStyle', type: 'select', label: 'Wall Style (store sections / store buildings: the style for THIS building\'s own walls — Store View tab -> Wall; blank = the store\'s)', source: 'storeWalls', optional: true },
        { key: 'doorStyle', type: 'select', label: 'Door Style (store sections / store buildings: the style for the doors in THIS building\'s own walls — Store View tab -> Door; blank = the store\'s)', source: 'storeDoors', optional: true },
    ],
    shops: [
        { key: 'name', type: 'text', label: 'Name' },
        { key: 'tool', type: 'select', label: 'Tool', source: 'tools' },
        { key: 'action', type: 'select', label: 'Action (the swing whose stats an upgrade raises — blank for a tool with no action, e.g. the Carrier)', source: 'actions', optional: true },
        { key: 'appearRequirement', type: 'requirement', label: 'Appear Requirement', optional: true },
        { key: 'baseView', type: 'select', label: 'Base View (before any upgrade, optional)', source: 'entityViews', optional: true },
        { key: 'solid', type: 'number', label: 'Solid (0 = no collider/walk-through, 1 = full trigger area, 0.5 = half size centered — 0 by default)', optional: true },
        { key: 'showcase', type: 'boolean', label: 'Showcase (float the upgraded tool above the shop, bobbing like a crafting table — the Carrier shows the crate the player wears)', optional: true },
        { key: 'showcaseScale', type: 'number', label: 'Showcase Scale (x the model\'s native size — blank = 1)', optional: true },
        { key: 'showcaseHeight', type: 'number', label: 'Showcase Height (world units above the shop\'s base — blank = 2.6)', optional: true },
        { key: 'particleEffectId', type: 'select', label: 'Showcase Particles (ambient effect around the floating item)', source: 'particleEffects', optional: true },
        { key: 'totalLevels', type: 'number', label: 'Total Upgrade Levels (purchases needed to reach max — level N/totalLevels blends every attribute N/totalLevels of the way from Min to Max)' },
        { key: 'baseCost', type: 'number', label: 'Base Cost (coins for the FIRST upgrade)' },
        { key: 'costScale', type: 'number', label: 'Cost Scale (each subsequent upgrade costs this many times the previous one — cost = baseCost * costScale ^ levelsAlreadyBought)' },
        { key: 'cooldownSec', type: 'number', label: 'Cooldown (sec, after buying any level, before the next purchase can start)' },
        {
            key: 'levels', type: 'list', label: 'Level Costs (optional — one entry per upgrade, in order; when set, replaces Base Cost/Cost Scale and the shop sells at most this many upgrades)', optional: true,
            itemLabel: (item, index) => `Upgrade ${(index ?? 0) + 1}: ${[item.money ? `${item.money} cash` : '', ...Object.entries(item.resources || {}).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`)].filter(Boolean).join(' + ') || 'free'}`,
            fields: [
                { key: 'money', type: 'number', label: 'Cash', optional: true },
                { key: 'resources', type: 'costMap', label: 'Resources (taken from the player\'s backpack)', source: 'resources', optional: true },
            ],
        },
        ...POPUP_FIELDS,
        { key: 'disabled', type: 'boolean', label: 'Disabled (takes this shop out of the game entirely — never built)', optional: true },
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
        { key: 'disabled', type: 'boolean', label: 'Disabled (takes this crafting table out of the game entirely — never built)', optional: true },
    ],
    // A TRIGGER — a placed volume (drawn as a "trigger"-typed object on the map's mapSettings
    // layer, matched here by the SAME id) that marks itself activated the instant the player
    // walks into it. Carries no effect of its own — reference this trigger's id from any
    // Requirement field elsewhere (Zones' Unlock Requirement, a Gate's own Requirement, ...)
    // via that field's "Trigger" kind (see REQUIREMENT_TYPE_FIELDS.trigger below) to make
    // something actually happen when it fires.
    triggers: [
        { key: 'destroyOnTrigger', type: 'boolean', label: 'Destroy On Trigger (one-shot switch — leave off to let it re-activate every time the player re-enters)' },
        { key: 'disabled', type: 'boolean', label: 'Disabled (takes this trigger out of the game entirely — never built, and any OTHER entity waiting on {type:\'trigger\'} referencing it treats it as already met instead of blocking forever)', optional: true },
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
        {
            key: 'category', type: 'select', label: 'Category (purely a filter/classification label below — only "Farm" actually changes runtime behavior, hiding it from the main-screen panels in favor of InventoryPopup\'s own Farm tab)', optional: true,
            options: [
                { value: 'main', label: 'Main (default — shown on the main-screen resource panels)' },
                { value: 'farm', label: 'Farm (a crop\'s own harvest yield — Backpack popup\'s Farm tab only, not the main screen)' },
                { value: 'animal', label: 'Animal (what catching an Animals-tab entry banks, e.g. Pig — still shown on the main screen, same as Main)' },
            ],
        },
        { key: 'price', type: 'number', label: 'Mart Price (base price a Mart buys/sells this at — blank means this resource can never be bought or sold at any mart)', optional: true },
        { key: 'sellable', type: 'boolean', label: 'Sellable To Marts (blocks selling this resource back even though it has a Mart Price — still buyable; meaningless with no Mart Price set)', optional: true },
        { key: 'pileScale', type: 'number', label: 'Pile Scale (draw size on the carrier/in storages and while flying there — only the model grows, spots/spacing stay the same; blank = 1)', optional: true },
        { key: 'carrierSpacing', type: 'number', label: 'Carrier Spacing (how close it stacks on the player\'s back — 0.7 = 30% closer; drawn size unchanged; blank = 1)', optional: true },
        { key: 'storageOffsetY', type: 'number', label: 'Storage Height Offset (world units added to where it sits in storages — negative = lower; blank = 0)', optional: true },
        {
            key: 'carrierOrientation', type: 'select', label: 'Carrier Orientation (how it sits on the player\'s back — storages unaffected; blank = Lying)', optional: true,
            options: [
                { value: 'lying', label: 'Lying (tall items like carrots lie down, squat ones stay upright)' },
                { value: 'onSide', label: 'On Its Side (always laid down, whatever its shape — e.g. corn)' },
                { value: 'standing', label: 'Standing (as modeled)' },
                { value: 'upsideDown', label: 'Upside Down' },
            ],
        },
        { key: 'disabled', type: 'boolean', label: 'Disabled (takes this resource out of the game entirely — no Provider ever drops it, it\'s hidden from every resource panel/inventory tab even with leftover banked count, and any Crafting recipe cost naming it is treated as if that line didn\'t exist)', optional: true },
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
        { key: 'animationTrigger', type: 'text', label: 'Animation Trigger (action-layer clip id, e.g. "chop" — must be unique per action)' },
        { key: 'animationModel', type: 'select', label: 'Character Animation Clip', options: CHARACTER_ANIMATION_OPTIONS },
    ],
    items: [
        { key: 'label', type: 'text', label: 'Label' },
    ],
    tools: [
        { key: 'label', type: 'text', label: 'Label' },
        { key: 'icon', type: 'icon', label: 'Icon' },
        { key: 'models', type: 'modelList', label: 'Models' },
        { key: 'maxLevel', type: 'number', label: 'Max Level (0 = never upgraded, e.g. rope/hammer — hides the level UI wherever this tool appears)' },
        { key: 'startLevel', type: 'number', label: 'Start Level On Acquire (attributes start this far up the 0..Max Level ladder; shops only sell Max − Start upgrades; shown in game as Lv.1)', optional: true },
        { key: 'startWith', type: 'boolean', label: 'Start With (a brand-new save begins owning one of whichever item shares this tool\'s id, instead of having to craft/earn it)', optional: true },
        {
            key: 'actionTime', type: 'group', label: 'Action Time (seconds — Min = level 0, Max = fully upgraded; only for tools with a timed action, e.g. Shovel = time to plant a no-seed farm cell)', optional: true,
            fields: [
                { key: 'min', type: 'number', label: 'Min' },
                { key: 'max', type: 'number', label: 'Max' },
            ],
        },
        {
            key: 'capacity', type: 'group', label: 'Capacity (Carrier only — farm items it holds; Min = level 0, Max = Max Level, rounded in between, e.g. 3 -> 13 over 10 levels = +1 per upgrade)', optional: true,
            fields: [
                { key: 'min', type: 'number', label: 'Min' },
                { key: 'max', type: 'number', label: 'Max' },
            ],
        },
        {
            key: 'attributes', type: 'group', label: 'Upgrade Attribute Ranges (Min = level 0/never upgraded, Max = fully maxed) — optional, only needed if a shop upgrades this tool', optional: true,
            fields: [
                {
                    key: 'damage', type: 'group', label: 'Damage (hits one swing counts as)',
                    fields: [
                        { key: 'min', type: 'number', label: 'Min' },
                        { key: 'max', type: 'number', label: 'Max' },
                    ],
                },
                {
                    key: 'hitAngleDeg', type: 'group', label: 'Hit Angle (deg, full AoE cone aperture)',
                    fields: [
                        { key: 'min', type: 'number', label: 'Min' },
                        { key: 'max', type: 'number', label: 'Max' },
                    ],
                },
                {
                    key: 'hitRangeMeters', type: 'group', label: 'Hit Range (meters, how far that cone reaches)',
                    fields: [
                        { key: 'min', type: 'number', label: 'Min' },
                        { key: 'max', type: 'number', label: 'Max' },
                    ],
                },
                {
                    key: 'speed', type: 'group', label: 'Speed (attacks per second)',
                    fields: [
                        { key: 'min', type: 'number', label: 'Min' },
                        { key: 'max', type: 'number', label: 'Max' },
                    ],
                },
                {
                    key: 'resourcePerHit', type: 'group', label: 'Resource Per Hit (yield banked per hit)',
                    fields: [
                        { key: 'min', type: 'number', label: 'Min' },
                        { key: 'max', type: 'number', label: 'Max' },
                    ],
                },
            ],
        },
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
        { key: 'disabled', type: 'boolean', label: 'Disabled (takes this queue out of the game entirely — never built)', optional: true },
    ],
    // Farm plot entries — both the shared "default" and each entry in "byId" — see FarmTypes.
    // ts's own doc. Ids come from the map's own "farm"-typed mapSettings objects, same
    // auto-discovery-by-id convention as queues. Deliberately does NOT include `tiles` —
    // FARM_TILE_CONFIG is a single game-wide export, not per-plot (see FARM_TILE_FIELDS below,
    // rendered once at the top of the Farms tab instead of on every entry card).
    // Storage entries — both the shared "default" and each entry in "byId" — see StorageTypes.ts's
    // own doc. Ids come from the map's own "storage"-typed mapSettings objects; a dropper whose
    // `target` is that id becomes its drop-off area.
    storages: [
        { key: 'name', type: 'text', label: 'Name', optional: true },
        {
            key: 'accepts', type: 'select', label: 'Accepts (what flies off the player into this storage)',
            options: [
                { value: 'farm', label: 'Crops (farm harvests — default)' },
                { value: 'main', label: 'Resources (wood, stone, ...)' },
                { value: 'animal', label: 'Animals' },
                { value: 'all', label: 'Everything' },
            ],
        },
        { key: 'resourceType', type: 'select', label: 'Only This Resource (e.g. one specific crop — overrides Accepts; blank = anything Accepts allows)', source: 'resources', optional: true },
        { key: 'shelf', type: 'select', label: 'Shelf (draw it as this Shelves-tab shelf: its model, items on its fixed slots, and it holds at most one item per slot — blank = the normal crate + pile)', source: 'shelves', optional: true },
        { key: 'maxItems', type: 'number', label: 'Max Items (holds at most this many — the player can\'t drop off more; blank = a shelf\'s slot count, else unlimited)', optional: true },
        { key: 'collect', type: 'boolean', label: 'Collect (the player TAKES from it instead of dropping off — its items fly onto the player\'s stack while there\'s room; e.g. an animal stall\'s egg box, whose entry here has the stall\'s id)', optional: true },
        { key: 'trash', type: 'boolean', label: 'Trash (takes ONLY garbage — Accepts/Only This Resource are ignored — and destroys it: no pile, no count; signpost shows a trash icon; stores never sell from it)', optional: true },
        { key: 'dumpAnyAfterSec', type: 'number', label: 'Dump Anything After (trash only — seconds standing in it, garbage gone, before it also takes every stack item: crops, eggs, butter...; never wood/stone. Blank = garbage only)', optional: true },
        { key: 'particleEffectId', type: 'select', label: 'Particle Effect (ambient, from the drop point — Particle Effects tab; blank = none)', source: 'particleEffects', optional: true },
        { key: 'particleSpawnRate', type: 'number', label: 'Particle Spawn Rate (particles per second — blank = 4)', optional: true },
        { key: 'view', type: 'select', label: 'View (Entity Views tab — the storage mesh; when set it wins over Model/Scale/Rotation below)', source: 'entityViews', optional: true },
        { ...FLOOR_LABEL_SIDE_FIELD, key: 'signpostSide', label: 'Signpost Side (which edge of the storage its signpost stands on — blank = North; the signpost itself is the shared Signpost card above)', options: [
            { value: 'north', label: 'North (above, on the map)' },
            { value: 'south', label: 'South (below, on the map)' },
            { value: 'east', label: 'East (right, on the map)' },
            { value: 'west', label: 'West (left, on the map)' },
        ] },
        { key: 'hideSignpost', type: 'boolean', label: 'Hide Signpost (no post and no icon for this storage — e.g. the trash)', optional: true },
        { key: 'signpostGap', type: 'number', label: 'Signpost Gap (distance from the storage\'s edge, world units — blank = 0.2)', optional: true },
        {
            key: 'signpostFacing', type: 'select', label: 'Signpost Facing (which way the post and its sign face — the side the sign reads from; blank = South)', optional: true,
            options: [
                { value: 'south', label: 'South' },
                { value: 'north', label: 'North' },
                { value: 'east', label: 'East' },
                { value: 'west', label: 'West' },
            ],
        },
        { key: 'signpostRotationDeg', type: 'number', label: 'Signpost Rotation (degrees — fine-tunes the yaw on top of Signpost Facing; blank = 0)', optional: true },
        { key: 'models', type: 'modelList', label: 'Model (first entry used — e.g. Restaurant.Crate; ignored when View is set)' },
        { key: 'scale', type: 'number', label: 'Scale (Restaurant.Crate is 2 x 0.8 x 2 at 1)' },
        { key: 'rotationDeg', type: 'number', label: 'Rotation (degrees)' },
        {
            key: 'dropOffset', type: 'group', label: 'Drop Offset (where the pile starts / items land, relative to the storage — world units)',
            fields: [
                { key: 'x', type: 'number', label: 'X' },
                { key: 'y', type: 'number', label: 'Y' },
                { key: 'z', type: 'number', label: 'Z' },
            ],
        },
        {
            key: 'pile', type: 'group', label: 'Pile (stored items shown as a grid of real models — fewer per row if items are too big)',
            fields: [
                { key: 'columns', type: 'number', label: 'Columns (e.g. 3 for 3x3, 2 for 2x2)' },
                { key: 'rows', type: 'number', label: 'Rows' },
                { key: 'layers', type: 'number', label: 'Max Layers (more is still stored, just not drawn)' },
            ],
        },
        { key: 'itemScale', type: 'number', label: 'Item Scale (blank = same as the player stack\'s)', optional: true },
        { key: 'itemYawDeg', type: 'number', label: 'Item Rotation (degrees — every stored item turned the same way, e.g. 0 or 90 so carrots lie parallel; blank = scattered, natural-pile look)', optional: true },
        { key: 'itemOrientation', type: 'select', label: 'Item Orientation (how stored items are turned — blank = Lying)', optional: true, options: [
            { value: 'lying', label: 'Lying (tall items like carrots on their side)' },
            { value: 'standing', label: 'Standing (as the model is authored)' },
            { value: 'upsideDown', label: 'Upside Down (as authored, flipped — e.g. carrots tip-down)' },
        ] },
        STORAGE_FRAME_FIELD,
        { key: 'floorLabelSize', type: 'number', label: 'Floor Label Size (Floor frame — height on the floor, world units; the price label also shrinks to fit the purchase area — blank = 2.7)', optional: true },
        { key: 'popupBobOffset', type: 'number', label: 'Popup Height Offset (popup frames only — gap above the top of the pile, blank = 1)', optional: true },
        { key: 'solid', type: 'number', label: 'Solid (0 = no collider/walk-through, 1 = full storage footprint, 0.5 = half size centered — 0 by default)', optional: true },
        {
            key: 'price', type: 'group', label: 'Price (the player buys this storage by standing on it — amount 0 = free; a store\'s Default Storage is always free)',
            fields: [
                { key: 'currency', type: 'select', label: 'Currency', options: CURRENCY_OPTIONS },
                { key: 'amount', type: 'number', label: 'Amount' },
            ],
        },
        {
            key: 'resourceCost', type: 'list', label: 'Resource Cost (resources it ALSO costs, paid from the backpack alongside the price — e.g. 20 wood; empty = coins only)', optional: true,
            itemLabel: item => `${item.amount ?? '?'} ${item.resourceType || 'resource'}`,
            fields: [
                { key: 'resourceType', type: 'select', label: 'Resource', source: 'resources' },
                { key: 'amount', type: 'number', label: 'Amount' },
            ],
        },
        { key: 'disabled', type: 'boolean', label: 'Disabled (takes this storage out of the game entirely)', optional: true },
    ],
    // Store entries — both the shared "default" and each entry in "byId" — see store/StoreTypes.ts's
    // own doc. Ids come from the map's own "store"-typed objects on the "stores" layer. What a store
    // sells isn't set here: it's every storage drawn inside its area (see Storages tab), and its
    // optional "starter" building is a custom property on the map object itself.
    stores: [
        { key: 'name', type: 'text', label: 'Name', optional: true },
        {
            key: 'npcs', type: 'list', label: 'Client Looks (each client picks one at random — NPCs tab)',
            itemLabel: item => item.npcId || 'npc',
            fields: [
                { key: 'npcId', type: 'select', label: 'NPC', source: 'npcs' },
            ],
        },
        { key: 'maxClients', type: 'number', label: 'Max Clients (queue length — most clients inside the store at once)' },
        { key: 'spawnIntervalSec', type: 'number', label: 'Spawn Interval (seconds between two clients arriving)' },
        { key: 'moveSpeed', type: 'number', label: 'Client Walk Speed (world units / second)' },
        { key: 'maxDistinctItems', type: 'number', label: 'Max Different Items per Client (1 = always one kind of item)' },
        { key: 'maxAmountPerItem', type: 'number', label: 'Max Amount of Each Item (random 1..this)' },
        { key: 'priceMultiplier', type: 'number', label: 'Price Multiplier (x each item\'s Resources-tab price — 1 = base price)' },
        { key: 'pickDelaySec', type: 'number', label: 'Pick Time (seconds to take ONE unit from a storage)' },
        { key: 'payDelaySec', type: 'number', label: 'Pay Time (seconds the player must stand at the cashier before the front client pays)' },
        { key: 'spotSpacing', type: 'number', label: 'Waiting Spot Spacing (distance between clients in a line — world units)' },
        { key: 'spotMargin', type: 'number', label: 'First Spot Gap (distance from the storage/cashier edge to the first client — world units)' },
        {
            key: 'storageSpotDirections', type: 'list', label: 'Storage Line Directions (storages not listed line up toward the store\'s center)', optional: true,
            itemLabel: item => `${item.storageId || 'storage'} → ${item.direction || '?'}`,
            fields: [
                { key: 'storageId', type: 'text', label: 'Storage Id (as drawn on the map, e.g. storage1)' },
                { key: 'direction', type: 'select', label: 'Direction', options: STORE_SPOT_DIRECTION_OPTIONS },
            ],
        },
        { key: 'cashierSpotDirection', type: 'select', label: 'Cashier Line Direction (blank = toward the store\'s center)', options: STORE_SPOT_DIRECTION_OPTIONS, optional: true },
        { key: 'waitStyle', type: 'select', label: 'Wait Style (how waiting clients stand — queue order is the same either way; blank = Cluster)', options: STORE_WAIT_STYLE_OPTIONS, optional: true },
        { key: 'browseChance', type: 'number', label: 'Browse Chance (0-1 — how often a client waiting in a shelf line wanders off to look at another shelf; blank = 0.4)', optional: true },
        { key: 'clientRadius', type: 'number', label: 'Client Radius (personal space — obstacles grow by this, clients steer apart at about twice it; blank = 0.35)', optional: true },
        { key: 'navCellSize', type: 'number', label: 'Nav Cell Size (pathfinding grid — smaller = tighter paths, more cells; blank = 0.3)', optional: true },
        { key: 'moneyPerBill', type: 'number', label: 'Money per Bill (how much one bill on the money drop represents — visual only)' },
        { key: 'billsPerPile', type: 'number', label: 'Bills per Pile (how tall a money pile gets before the next one starts beside it — visual only)' },
        { key: 'bubbleOffset', type: 'number', label: 'Bubble Height (above the client\'s head — world units)' },
        { key: 'cashierView', type: 'select', label: 'Cashier Counter (solid prop in the cashier rect — the player serves standing against it; blank = kitchen cabinet)', source: 'entityViews', optional: true },
        { key: 'moneyDropView', type: 'select', label: 'Money Drop Counter (solid prop — paid bills pile on its top; blank = no counter, the bills pile on the floor)', source: 'entityViews', optional: true },
        { key: 'startSpawnIntervalSec', type: 'number', label: 'Start Spawn Interval (with ONE shelf — each extra shelf steps toward Spawn Interval, reached with all shelves; blank = 1.6x Spawn Interval)', optional: true },
        { key: 'startMaxClients', type: 'number', label: 'Start Max Clients (with ONE shelf — steps toward Max Clients as shelves are added; blank = 2)', optional: true },
        { key: 'clientsPerWorker', type: 'number', label: 'Clients per Worker (extra clients allowed inside per hired worker, on top of the shelf-based max — fractions add up; blank = 1)', optional: true },
        { key: 'clientsPerLevel', type: 'number', label: 'Clients per Store Level (extra clients per level above 1 — blank = 0.5)', optional: true },
        { key: 'overflowClients', type: 'number', label: 'Overflow Clients (when the store is full and nobody has paid for Stuck Time, one more comes in each Stuck Time, up to this many — any payment closes them; blank = 2)', optional: true },
        { key: 'angryDropSec', type: 'number', label: 'Angry Drop Time (seconds a client stays ANGRY while still waiting before it throws what it carries on the floor as garbage and leaves without paying — blank = 8)', optional: true },
        { key: 'maxGarbage', type: 'number', label: 'Max Garbage (pieces on the floor at which clients stop coming altogether until the player cleans up — blank = 15)', optional: true },
        { key: 'garbageSpawnSlowdown', type: 'number', label: 'Garbage Slowdown (below Max Garbage, each piece makes clients come this much less often — 0.15 = +15% spawn interval per piece; blank = 0.15)', optional: true },
        { key: 'forgivingEarlyLevels', type: 'boolean', label: 'Forgiving Early Levels (level 1 clients never drop below happy, level 2 below annoyed — off = clients can always get angry)', optional: true },
        { key: 'stuckSec', type: 'number', label: 'Stuck Time (seconds full with no payment before an overflow client comes in — blank = 15)', optional: true },
        { key: 'startPatienceMultiplier', type: 'number', label: 'Start Patience Multiplier (x Mood Step Time with ONE shelf, easing to x1 with all shelves; blank = 1.5)', optional: true },
        { key: 'moodStepSec', type: 'number', label: 'Mood Step Time (seconds before a client\'s mood drops one step — blank = 20)', optional: true },
        { key: 'minClientPatience', type: 'number', label: 'Min Client Patience (each client\'s own tolerance: x Mood Step Time, random between min and max — blank = 0.8)', optional: true },
        { key: 'maxClientPatience', type: 'number', label: 'Max Client Patience (blank = 1.5)', optional: true },
        { key: 'veryHappyPayMultiplier', type: 'number', label: 'Very Happy Pay Multiplier (x what a very happy client pays — blank = 2)', optional: true },
        { key: 'unhappyPayPenalty', type: 'number', label: 'Sad/Angry Pay Penalty (fraction taken off, 0.2 = 20% less — blank = 0.2)', optional: true },
        { key: 'openRequirement', type: 'requirement', label: 'Open Early (the store opens at Lv 1 as soon as this is met, before its map "starter" building is built — clients, cashier, money drop and Lv 1 storages/farms work without the building; meanwhile each client wants one unit of one item and never gets upset; used by the FTUE)', optional: true },
        { key: 'earlySpawnIntervalSec', type: 'number', label: 'Early Spawn Interval (seconds between two clients arriving while open early — blank = normal pacing)', optional: true },
        { key: 'earlyMaxClients', type: 'number', label: 'Early Max Clients (most clients at once while open early, before the starter is built — they never get upset then; blank = normal pacing)', optional: true },
        { key: 'defaultStorageId', type: 'text', label: 'Default Storage (storage id on the map — FREE, appears when the store opens; blank = every storage must be bought)', optional: true },
        {
            key: 'levels', type: 'list', label: 'Levels (store is Lv 1 when it opens; each entry is what it takes to REACH that level, counted from the previous one)', optional: true,
            itemLabel: item => `Lv ${item.level ?? '?'} — ${item.amount ?? '?'} ${item.requirementType === 'sales' ? 'sales' : 'money'}${item.enables?.length ? ` — enables ${item.enables.map(e => e.entityId).filter(Boolean).join(', ')}` : ''}`,
            fields: [
                { key: 'level', type: 'number', label: 'Level (2, 3, ... — a Lv 1 entry just enables things on opening, its requirement is ignored)' },
                {
                    key: 'requirementType', type: 'select', label: 'Requirement',
                    options: [
                        { value: 'money', label: 'Money earned (what clients paid)' },
                        { value: 'sales', label: 'Sales (number of clients who paid)' },
                    ],
                },
                { key: 'amount', type: 'number', label: 'Amount' },
                { key: 'patienceMultiplier', type: 'number', label: 'Patience x (while at this level — x every new client\'s patience; e.g. 1.5 early on; blank = 1)', optional: true },
                { key: 'spawnIntervalMultiplier', type: 'number', label: 'Arrival Interval x (while at this level — x time between clients arriving; 1.3 = 30% fewer; blank = 1)', optional: true },
                {
                    key: 'moodFloor', type: 'select', label: 'Lowest Client Mood at this level (e.g. Happy at Lv 1: nobody gets annoyed, walks out or drops garbage — blank = no floor)', optional: true,
                    options: [
                        { value: 'happy', label: 'Happy' },
                        { value: 'annoyed', label: 'Annoyed' },
                        { value: 'sad', label: 'Sad' },
                    ],
                },
                {
                    key: 'enables', type: 'list', label: 'Enables (map object ids that stay hidden until this level — storage, farm, building, queue, shop, mart, crafting table, mix station, animal stall, farm desk)', optional: true,
                    itemLabel: item => item.entityId || 'entity',
                    fields: [
                        { key: 'entityId', type: 'select', label: 'Map Object (from the Tiled map)', source: '$storeEnableableIds' },
                    ],
                },
                {
                    key: 'hints', type: 'list', label: 'Next-Unlock Hints (extra chips on the HUD strip teasing this level — Enables, buildings appearing at this level and zones opening at it are shown automatically)', optional: true,
                    itemLabel: item => item.label || 'hint',
                    fields: [
                        { key: 'icon', type: 'icon', label: 'Icon (blank = the store icon)', optional: true },
                        { key: 'label', type: 'text', label: 'Label (short — e.g. "Pickaxe")' },
                    ],
                },
            ],
        },
        {
            key: 'workers', type: 'list', label: 'Workers (the store starts with these — saved the first time it opens, so each keeps its own level after that; every worker wears the NPCs tab\'s "worker" look)', optional: true,
            itemLabel: item => `${item.id || 'worker'} — ${item.role || '?'} Lv ${item.level ?? 1}`,
            fields: [
                { key: 'id', type: 'text', label: 'Id (unique in this store, e.g. cashier1, restocker2)' },
                {
                    key: 'role', type: 'select', label: 'Role',
                    options: [
                        { value: 'cashier', label: 'Cashier (serves at the cashier, collects the money drop — one per store)' },
                        { value: 'restocker', label: 'Restocker (refills the emptiest shelf from the farms)' },
                        { value: 'cleaner', label: 'Cleaner (picks garbage off the floor and throws it in the trash)' },
                    ],
                },
                { key: 'level', type: 'number', label: 'Starting Level (blank = 1)', optional: true },
            ],
        },
        { key: 'hideStorageDropperView', type: 'boolean', label: 'Hide Storage Dropper View (no dotted outline around this store\'s storage/trash drop areas, owned or for sale)', optional: true },
        { key: 'hideCashierDropperView', type: 'boolean', label: 'Hide Cashier Dropper View (no dotted outline around the cashier area)', optional: true },
        { key: 'hideMoneyDropDropperView', type: 'boolean', label: 'Hide Money Drop Dropper View (no dotted outline around the money drop the player grabs earnings from)', optional: true },
        { key: 'hideHireDeskDropperView', type: 'boolean', label: 'Hide Hire Desk Dropper View (no dotted outline around the hire desk spot)', optional: true },
        { key: 'workerColor', type: 'color', label: 'Staff Color (every worker of this store — blank = the NPCs tab\'s "worker" look)', optional: true },
        { key: 'floorChecker', type: 'select', label: 'Floor Checker (Store View tab -> Floor — blank = the default checker)', source: 'storeFloors', optional: true },
        { key: 'wallStyle', type: 'select', label: 'Wall Style (Store View tab -> Wall — blank = the default style)', source: 'storeWalls', optional: true },
        { key: 'doorStyle', type: 'select', label: 'Door Style (Store View tab -> Door — blank = the default style)', source: 'storeDoors', optional: true },
        {
            key: 'workerHat', type: 'group', label: 'Staff Hat (every worker of this store wears it — no model = none)',
            fields: [
                { key: 'models', type: 'modelList', label: 'Hat Model (first entry used — the Hats group)' },
                { key: 'scale', type: 'number', label: 'Scale (x the size fitted to the head — blank = 1)', optional: true },
                { key: 'offsetY', type: 'number', label: 'Lift (fraction of the head size — blank = 0)', optional: true },
                { key: 'rotationDeg', type: 'number', label: 'Rotation (degrees — blank = 0)', optional: true },
            ],
        },
        {
            key: 'cashierWorker', type: 'group', label: 'Cashier Worker Settings (serves at the cashier npcPoint while clients wait, collects the money drop to the wallet every N sales or when idle, wanders near the cashier otherwise)',
            fields: [
                { key: 'collectEverySales', type: 'number', label: 'Collect Every N Sales (walks to the money drop after this many sales in a row — blank = 5)', optional: true },
                { key: 'wanderRadius', type: 'number', label: 'Wander Radius (how far from the cashier point it strolls while idle — world units; blank = 2)', optional: true },
                {
                    key: 'levels', type: 'list', label: 'Levels (stats per worker level — the entry for Level, or the highest below it, is used; empty = the store\'s client Walk Speed and Pay Time)', optional: true,
                    itemLabel: item => `Lv ${item.level ?? '?'} — speed ${item.moveSpeed ?? '?'}, pay ${item.payDelaySec ?? '?'}s`,
                    fields: [
                        { key: 'level', type: 'number', label: 'Level' },
                        { key: 'moveSpeed', type: 'number', label: 'Walk Speed (world units / second)' },
                        { key: 'payDelaySec', type: 'number', label: 'Pay Time (seconds at the cashier before the front client pays)' },
                    ],
                },
            ],
        },
        {
            key: 'hiring', type: 'group', label: 'Hire Desk (what a "hireDesk" drawn on the map\'s sections layer sells — the desk appears once its section is built)',
            fields: [
                { key: 'npcId', type: 'select', label: 'Desk NPC (blank = the "worker" look)', source: 'npcs', optional: true },
                {
                    key: 'roles', type: 'list', label: 'Roles (in popup order — empty = cashier 100, restocker 75, cleaner 75)', optional: true,
                    itemLabel: item => `${item.role || '?'} — ${item.cost ?? '?'} money${item.maxCount ? `, max ${item.maxCount}` : ''}`,
                    fields: [
                        {
                            key: 'role', type: 'select', label: 'Role',
                            options: [
                                { value: 'cashier', label: 'Cashier (one per store)' },
                                { value: 'restocker', label: 'Restocker' },
                                { value: 'cleaner', label: 'Cleaner' },
                            ],
                        },
                        { key: 'cost', type: 'number', label: 'Cost (money per hire)' },
                        { key: 'maxCount', type: 'number', label: 'Max (total of this role, starting workers included — blank = 3; a cashier is always 1)', optional: true },
                        {
                            key: 'upgrades', type: 'list', label: 'Upgrades (the hire desk\'s Upgrade tab — each entry is what it costs to REACH that level; the highest level listed is the max, and it should match the levels this role\'s Worker Settings below have stats for. Empty = Lv2 50, Lv3 100)', optional: true,
                            itemLabel: item => `Lv ${item.level ?? '?'} — ${item.cost ?? '?'} money`,
                            fields: [
                                { key: 'level', type: 'number', label: 'Level (2, 3, ...)' },
                                { key: 'cost', type: 'number', label: 'Cost (money)' },
                            ],
                        },
                    ],
                },
            ],
        },
        {
            key: 'cleanerWorker', type: 'group', label: 'Cleaner Worker Settings (picks the nearest garbage off the floor into the crate on its back, throws it in the nearest trash)',
            fields: [
                { key: 'wanderRadius', type: 'number', label: 'Wander Radius (how far from the middle of the shelves it strolls while idle — world units; blank = 3)', optional: true },
                {
                    key: 'levels', type: 'list', label: 'Levels (stats per worker level — the entry for its level, or the highest below it, is used; empty = speed 4, carries 2)', optional: true,
                    itemLabel: item => `Lv ${item.level ?? '?'} — speed ${item.moveSpeed ?? '?'}, carries ${item.carryCapacity ?? '?'}`,
                    fields: [
                        { key: 'level', type: 'number', label: 'Level' },
                        { key: 'moveSpeed', type: 'number', label: 'Walk Speed (world units / second — the player walks at 5)' },
                        { key: 'carryCapacity', type: 'number', label: 'Carry Spaces (pieces on its back at once)' },
                    ],
                },
            ],
        },
        {
            key: 'restockerWorker', type: 'group', label: 'Restocker Worker Settings (takes the shelf with the fewest items whose crop is ready on a farm, harvests it into the crate on its back, brings it to the shelf)',
            fields: [
                { key: 'wanderRadius', type: 'number', label: 'Wander Radius (how far from the middle of the shelves it strolls while idle — world units; blank = 3)', optional: true },
                {
                    key: 'levels', type: 'list', label: 'Levels (stats per worker level — the entry for its level, or the highest below it, is used; empty = speed 4, carries 2)', optional: true,
                    itemLabel: item => `Lv ${item.level ?? '?'} — speed ${item.moveSpeed ?? '?'}, carries ${item.carryCapacity ?? '?'}`,
                    fields: [
                        { key: 'level', type: 'number', label: 'Level' },
                        { key: 'moveSpeed', type: 'number', label: 'Walk Speed (world units / second — the player walks at 5)' },
                        { key: 'carryCapacity', type: 'number', label: 'Carry Spaces (items on its back at once)' },
                    ],
                },
            ],
        },
        { key: 'disabled', type: 'boolean', label: 'Disabled (takes this store out of the game entirely)', optional: true },
    ],
    // Store View tab -> Floor — see game/store/StoreViewTypes.ts's FloorCheckerConfig.
    storeFloors: [
        { key: 'name', type: 'text', label: 'Name (shown in the editor — later in a floor shop)', optional: true },
        { key: 'colorA', type: 'color', label: 'Color A' },
        { key: 'colorB', type: 'color', label: 'Color B' },
        { key: 'scale', type: 'number', label: 'Square Size (map tiles per checker square — 1 = one 32px tile, 0.5 = smaller, 2 = bigger)' },
    ],
    // Store View tab -> Wall — see game/store/StoreViewTypes.ts's WallStyleConfig / WallSetupConfig.
    storeWalls: [
        { key: 'name', type: 'text', label: 'Name (shown in the editor — later in a shop)', optional: true },
        { key: 'bottomColor', type: 'color', label: 'Bottom Color' },
        { key: 'topColor', type: 'color', label: 'Top Color' },
        { key: 'bottomHeight', type: 'number', label: 'Bottom Band Height (world units from the floor — where Bottom Color ends)' },
        { key: 'bottomOpacity', type: 'number', label: 'Bottom Opacity (1 = solid, 0.35 = see-through glass — blank = 1)', optional: true },
        { key: 'topOpacity', type: 'number', label: 'Top Opacity (1 = solid, 0.35 = see-through glass, e.g. a shop-front: solid bottom, glass top — blank = 1)', optional: true },
    ],
    // Mix Stations tab — see game/data/MixStationTypes.ts (map setup + flow in its doc).
    mixStations: [
        { key: 'name', type: 'text', label: 'Name (build notification + editor)', optional: true },
        {
            key: 'inputs', type: 'list', label: 'Ingredients (in the order of the map storages\' "order" property — 0 = first)',
            itemLabel: (item, index) => `${index ?? 0}: ${item.amount ?? 1} ${item.resourceType ?? '?'}`,
            fields: [
                { key: 'resourceType', type: 'select', label: 'Resource', source: 'resources' },
                { key: 'amount', type: 'number', label: 'Amount (used per batch)' },
                { key: 'capacity', type: 'number', label: 'Box Holds (how many the ingredient box takes — several batches; blank = 4)', optional: true },
            ],
        },
        { key: 'resourceType', type: 'select', label: 'Makes', source: 'resources' },
        { key: 'outputAmount', type: 'number', label: 'Makes Per Batch' },
        { key: 'mixSec', type: 'number', label: 'Mix Time (seconds the player stands in the dropper area per batch — pauses while they step out)' },
        { key: 'maxOutput', type: 'number', label: 'Dispenser Holds (most products waiting — no new batch while full)' },
        { key: 'surfaceHeight', type: 'number', label: 'Surface Height (world units — the station\'s top, where ingredients and the product sit)' },
        { key: 'boxModels', type: 'modelList', label: 'Ingredient Box Model (first entry used — sits on the station\'s top at each "storage" spot; empty = no box)', optional: true },
        { key: 'boxScale', type: 'number', label: 'Box Scale (x the box model\'s own size — Restaurant.Crate is 2 wide; blank = 1)', optional: true },
        {
            key: 'price', type: 'group', label: 'Build Price (paid at the dropper — amount 0 and no Resource Cost = built from the start)',
            fields: [
                { key: 'currency', type: 'select', label: 'Currency', options: CURRENCY_OPTIONS },
                { key: 'amount', type: 'number', label: 'Amount' },
            ],
        },
        {
            key: 'resourceCost', type: 'list', label: 'Resource Cost (resources the build ALSO costs, paid from the backpack — e.g. 15 stone; empty = price only)', optional: true,
            itemLabel: item => `${item.amount ?? '?'} ${item.resourceType || 'resource'}`,
            fields: [
                { key: 'resourceType', type: 'select', label: 'Resource', source: 'resources' },
                { key: 'amount', type: 'number', label: 'Amount' },
            ],
        },
        { key: 'disabled', type: 'boolean', label: 'Disabled (the station isn\'t spawned — also skipped when no map storage sells what it makes)', optional: true },
    ],
    // Farm Upgrades tab — see game/data/FarmUpgradeTypes.ts. Keyed by farm id; the default ladder
    // is used by every farm without its own entry.
    farmUpgrades: [
        {
            key: 'levels', type: 'list', label: 'Upgrade Levels (what it costs to REACH each level and what the farm does from then on — the highest is the max)',
            itemLabel: item => `Lv ${item.level ?? '?'} — ${item.cost ?? '?'} money: +${Math.round((item.priceBonus ?? 0) * 100)}% price${item.growSpeed ? `, x${item.growSpeed} speed` : ''}${item.yieldBonus ? `, +${item.yieldBonus} per harvest` : ''}`,
            fields: [
                { key: 'level', type: 'number', label: 'Level (2, 3, ...)' },
                { key: 'cost', type: 'number', label: 'Cost (money)' },
                { key: 'priceBonus', type: 'number', label: 'Price Bonus (+ fraction on this farm\'s crop in the store — 0.4 = +40%; blank = 0)', optional: true },
                { key: 'growSpeed', type: 'number', label: 'Grow Speed (x — 1.5 = crops grow 1.5x faster; applies to crops planted from then on; blank = 1)', optional: true },
                { key: 'yieldBonus', type: 'number', label: 'Yield Bonus (+ units per harvest, player and restockers; blank = 0)', optional: true },
            ],
        },
    ],
    // Farm Desks tab — see game/data/FarmDeskTypes.ts. A "farmDesk" rect on the map (NPC spot) + a dropper targeting it.
    farmDesks: [
        { key: 'name', type: 'text', label: 'Name (popup title + editor)', optional: true },
        { key: 'npcId', type: 'select', label: 'NPC (the farm manager — blank = the "worker" look)', source: 'npcs', optional: true },
        { key: 'appearRequirement', type: 'requirement', label: 'Appear Requirement (desk + NPC show once met; blank = right away — a store level can also list it under Enables)', optional: true },
        { key: 'buttonLabel', type: 'text', label: 'Button Label (blank = "Farms")', optional: true },
        { key: 'disabled', type: 'boolean', label: 'Disabled (not spawned)', optional: true },
    ],
    // Shelves tab — see game/data/ShelfTypes.ts. A storage picks one with its own `shelf` field.
    shelves: [
        { key: 'name', type: 'text', label: 'Name (shown in the editor)', optional: true },
        { key: 'models', type: 'modelList', label: 'Shelf Model (first entry used — e.g. Store.ShelfBoxes)' },
        { key: 'scale', type: 'number', label: 'Scale (x the model\'s own size — and its slot positions)' },
        { key: 'rotationDeg', type: 'number', label: 'Rotation (deg, on top of the storage object\'s own rotation on the map — blank = 0)', optional: true },
        { key: 'hideNodes', type: 'text', label: 'Hide Nodes (comma-separated model node names, a trailing * = prefix — e.g. "carton*, box, box_*" hides shelf-boxes\' decorative boxes)', optional: true },
        { key: 'itemScale', type: 'number', label: 'Item Scale (x each item\'s size on this shelf — blank = the storage\'s own Item Scale)', optional: true },
        {
            key: 'slots', type: 'list', label: 'Slots (where items sit, filled in this order — the count is how many items the shelf holds)',
            itemLabel: (item, index) => `Slot ${(index ?? 0) + 1}: ${(item.position ?? []).map(v => Number(v).toFixed(2)).join(', ')}`,
            fields: [
                { key: 'position', type: 'vector3', label: 'Position (x, y, z — the item\'s bottom-center, in the model\'s own units before Scale; shelf-boxes\' shelves are at y 0.175 and 0.55)' },
            ],
        },
    ],
    // Animal Stalls tab — see game/data/AnimalStallTypes.ts. The stall's PRICE and its egg box live on
    // the Storages tab, under the stall's own id.
    animalStalls: [
        { key: 'name', type: 'text', label: 'Name (build notification + editor)', optional: true },
        { key: 'animalModels', type: 'modelList', label: 'Animal Model (one picked at random per animal — e.g. Pets.AnimalChick)' },
        { key: 'animalScale', type: 'number', label: 'Animal Scale (x the model\'s own size)' },
        { key: 'animalYawOffsetDeg', type: 'number', label: 'Animal Yaw Offset (deg — for a model that doesn\'t face +Z; blank = 0)', optional: true },
        { key: 'animalCount', type: 'number', label: 'Animals (spawned when the stall is built)' },
        { key: 'wanderSpeed', type: 'number', label: 'Wander Speed (world units / second)' },
        { key: 'minPauseSec', type: 'number', label: 'Min Pause (seconds standing still between walks)' },
        { key: 'maxPauseSec', type: 'number', label: 'Max Pause (seconds)' },
        { key: 'resourceType', type: 'select', label: 'Produces (laid into the stall\'s box)', source: 'resources' },
        { key: 'produceIntervalSec', type: 'number', label: 'Produce Every (seconds per animal — paused while the box is full)' },
        { key: 'disabled', type: 'boolean', label: 'Disabled (the stall isn\'t spawned)', optional: true },
    ],
    // Store View tab -> Fence — see game/store/StoreViewTypes.ts's FenceStyleConfig / PolyFenceBuilder.ts.
    storeFences: [
        { key: 'name', type: 'text', label: 'Name (shown in the editor)', optional: true },
        { key: 'color', type: 'color', label: 'Color (posts and rails)' },
        { key: 'height', type: 'number', label: 'Height (post height, world units from the floor)' },
        { key: 'postSpacing', type: 'number', label: 'Post Spacing (most distance between two posts, world units — every corner gets a post too)' },
        { key: 'postWidth', type: 'number', label: 'Post Width (world units — also how thick the collider is)' },
        { key: 'railCount', type: 'number', label: 'Rails (horizontal rails between two posts)' },
        { key: 'railThickness', type: 'number', label: 'Rail Thickness (world units)' },
    ],
    // Store View tab -> Fence Door — see game/store/StoreViewTypes.ts's FenceDoorSetupConfig / world/FenceDoor.ts.
    storeFenceDoors: [
        { key: 'name', type: 'text', label: 'Name (shown in the editor)', optional: true },
        { key: 'models', type: 'modelList', label: 'Model (first entry used — stretched along the fence to fill the hole)' },
        { key: 'width', type: 'number', label: 'Hole Width (world units, centered on where the polyDoor crosses the fence — blank = the whole crossing)', optional: true },
        { key: 'height', type: 'number', label: 'Height (model height, world units from the floor)' },
        { key: 'depthScale', type: 'number', label: 'Depth Scale (x the model\'s depth on top of keeping its proportions — blank = 1)', optional: true },
        { key: 'colliderInset', type: 'number', label: 'Collider Inset (solid support at each side of the hole, world units from each end inward — the middle stays walkable; 0 = no colliders)' },
        { key: 'rotationOffsetDeg', type: 'number', label: 'Rotation Offset (deg — for a model whose width doesn\'t run along its own X; blank = 0)', optional: true },
    ],
    // Store View tab -> Door — see game/store/StoreViewTypes.ts's DoorStyleConfig.
    storeDoors: [
        { key: 'name', type: 'text', label: 'Name (shown in the editor — later in a shop)', optional: true },
        { key: 'models', type: 'modelList', label: 'Model (optional — single doors: first entry used, stretched over the door leaf; empty = a plain panel in Color/Opacity below)' },
        { key: 'doubleModels', type: 'modelList', label: 'Double Door Model (optional — each of a double door\'s two leaves, e.g. "isDouble" openings; empty = Model above)' },
        { key: 'scale', type: 'number', label: 'Model Scale (× the size fitted to the leaf — blank = 1; model only)', optional: true },
        { key: 'color', type: 'color', label: 'Color (plain panel, when there is no model)' },
        { key: 'opacity', type: 'number', label: 'Opacity (plain panel: 1 = solid, 0.3 = see-through glass)' },
    ],
    storeWallSetups: [
        { key: 'name', type: 'text', label: 'Name (shown in the editor)', optional: true },
        { key: 'height', type: 'number', label: 'Height (world units, from the floor up)' },
        { key: 'thickness', type: 'number', label: 'Thickness (world units, centered on the drawn line — also the collider thickness)' },
        { key: 'doorHeight', type: 'number', label: 'Door Height (a "polyDoor" rect over a wall cuts a hole from the floor up to this — no collider, walkable)' },
        { key: 'tallDoorHeight', type: 'number', label: 'Tall Door Height (a "polyDoor" with the isHigh bool prop uses this instead of Door Height — keep it a bit under Height so a strip of wall stays above)' },
        { key: 'windowHeight', type: 'number', label: 'Window Height (a "polyWindow" rect over a wall cuts a hole this tall, centered on the wall height)' },
    ],
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
        {
            key: 'assignedCropId', type: 'select', label: 'Assigned Crop (single-crop plot — skips the seed picker entirely: standing on an empty cell auto-plants this crop after a short delay, no seed spent. Leave unset for a normal "pick any held seed" plot. Ignores Allowed Crops above when set.)',
            source: 'crops', optional: true,
        },
        { key: 'requiredTool', type: 'select', label: 'Required Tool (the player must own this tool to plant here at all — for an Assigned Crop plot, the tool\'s own Action Time is also how long planting takes)', source: 'tools', optional: true },
        { key: 'autoPlant', type: 'boolean', label: 'Auto Plant (needs Assigned Crop — no planting step: every cell is growing from the start and replants instantly after each harvest; the player only collects. Ignores Required Tool.)', optional: true },
        { key: 'solid', type: 'number', label: 'Solid (0 = no collider/walk-through, 1 = full trigger area, 0.5 = half size centered — 0 by default)', optional: true },
        { key: 'disabled', type: 'boolean', label: 'Disabled (takes this farm plot out of the game entirely — never built, whether for-sale or already owned)', optional: true },
    ],
    // Mart entries — both the shared "default" and each entry in "byId" — see MartTypes.ts's
    // own doc. Ids come from the map's own "mart"-typed mapSettings objects, same
    // auto-discovery-by-id convention as farms/queues. A mart buys/sells arbitrary quantities
    // (no per-item purchase limit, unlike the single-tool-upgrade Shops tab) — what it SELLS is
    // this entry's own `offers` list; what it BUYS BACK is every Resources-tab entry with a
    // Mart Price and Sellable not unchecked, regardless of whether it's also in `offers` (see
    // MartTypes.ts's own top doc).
    marts: [
        { key: 'name', type: 'text', label: 'Name' },
        {
            key: 'offers', type: 'list', label: 'For Sale (what this mart sells TO the player)',
            itemLabel: item => item.resourceType || 'offer',
            fields: [
                { key: 'resourceType', type: 'select', label: 'Resource (must have a Mart Price set on the Resources tab to actually be buyable)', source: 'resources' },
                { key: 'priceMultiplier', type: 'number', label: 'Price Multiplier (multiplies the resource\'s own Mart Price for buying here — blank defaults to 1x)', optional: true },
            ],
        },
        { key: 'appearRequirement', type: 'requirement', label: 'Appear Requirement', optional: true },
        { key: 'solid', type: 'number', label: 'Solid (0 = no collider/walk-through, 1 = full trigger area, 0.5 = half size centered — 0 by default)', optional: true },
        { key: 'view', type: 'select', label: 'View (real mesh override, optional)', source: 'entityViews', optional: true },
        { key: 'npcId', type: 'select', label: 'NPC (optional — spawns an animated NPC at this mart)', source: 'npcs', optional: true },
        { key: 'npcOffset', type: 'vector3', label: 'NPC Offset (x, y, z — nudges off the mart\'s own center; only used when NPC is set)', optional: true },
        { key: 'disabled', type: 'boolean', label: 'Disabled (takes this mart out of the game entirely — never built)', optional: true },
    ],
    // A CRAFTING RECIPE — the shared pool every Crafting Table picks from (see
    // CraftingRecipeTypes.ts's own doc): ingredients -> one result, registered once by its own
    // hand-typed id so more than one table can list the same recipe without duplicating it.
    craftingRecipes: [
        { key: 'ingredients', type: 'costMap', label: 'Ingredients', source: 'resources' },
        {
            key: 'result', type: 'group', label: 'Result',
            fields: [
                { key: 'resourceType', type: 'select', label: 'Resource', source: 'resources' },
                { key: 'amount', type: 'number', label: 'Amount' },
            ],
        },
    ],
    // A CRAFTING TABLE — tap-a-recipe-row-to-craft, any recipe, any number of times (unlike the
    // Crafting tab below, a single-active-recipe auto-drain table). Ids come from the map's own
    // "craftTable"-typed mapSettings objects, same auto-discovery-by-id convention as marts.
    // `recipes` is just a list of Crafting Recipes tab ids — add a recipe there first, then pick
    // it here (see CraftingTableTypes.ts's own doc for why the ingredients/result themselves
    // aren't edited a second time on this tab).
    craftingTables: [
        { key: 'name', type: 'text', label: 'Name' },
        {
            key: 'recipes', type: 'list', label: 'Recipes (pick from the Crafting Recipes tab)',
            itemLabel: item => item.recipeId || 'recipe',
            fields: [
                { key: 'recipeId', type: 'select', label: 'Recipe', source: 'craftingRecipes' },
            ],
        },
        { key: 'appearRequirement', type: 'requirement', label: 'Appear Requirement', optional: true },
        { key: 'solid', type: 'number', label: 'Solid (0 = no collider/walk-through, 1 = full trigger area, 0.5 = half size centered — 0 by default)', optional: true },
        { key: 'view', type: 'select', label: 'View (real mesh override, optional)', source: 'entityViews', optional: true },
        { key: 'disabled', type: 'boolean', label: 'Disabled (takes this crafting table out of the game entirely — never built)', optional: true },
    ],
    // FARM_TILE_CONFIG's own two fields — the empty/prepared tile pair EVERY farm plot shares
    // (see FarmTypes.ts's own doc for why this is a single game-wide export, not per-plot).
    // Rendered once, above the Default/By-id cards, by app.js's renderFarmsTab() — not a normal
    // ENTITY_SCHEMAS entry read through the generic per-id card path the rest of this file backs.
    /** StorageTypes.ts's STORAGE_SIGNPOST_CONFIG — the Storages tab's shared Signpost card (see app.js's SHARED_SECTIONS). */
    storageSignpost: [
        { key: 'models', type: 'modelList', label: 'Signpost Model (first entry used — empty = no signposts)' },
        { key: 'scale', type: 'number', label: 'Signpost Scale' },
        { key: 'offset', type: 'vector3', label: 'Signpost Offset (x, y, z — nudges every signpost off its side/gap spot; x/z turn with each storage Signpost Rotation; the icon follows)' },
        { key: 'iconOffset', type: 'vector3', label: 'Icon Offset (x, y, z — item icon center from the signpost base; y = height above the ground; x/z turn with each storage Signpost Rotation)' },
        { key: 'iconScale', type: 'number', label: 'Icon Scale (item icon size, world units)' },
    ],
    farmTiles: [
        { key: 'empty', type: 'select', label: 'Empty (shown before ANY plot is bought)', source: 'entityViews', optional: true },
        { key: 'prepared', type: 'select', label: 'Prepared (shown once a plot is bought, before anything is planted)', source: 'entityViews', optional: true },
        { key: 'icon', type: 'icon', label: 'Notification Icon (shown in the "Farm Unlocked!" popup when ANY plot is bought)', optional: true },
        { key: 'availableTint', type: 'color', label: 'Available Tint (Prepared tile mesh while a cell is EMPTY — blank = white / no tint)', optional: true },
        { key: 'occupiedTint', type: 'color', label: 'Occupied Tint (Prepared tile mesh while a cell has something planted — usually darker than Available Tint, to contrast)', optional: true },
    ],
    // A plantable crop — game-design content (Wheat, ...), not read from the map at all (see
    // CropTypes.ts's own doc). What it COSTS to plant lives on the Seeds tab instead (a seed's
    // own Crop field points here) — a crop itself only owns its growth ladder and harvest yield.
    crops: [
        { key: 'name', type: 'text', label: 'Name' },
        { key: 'initialMesh', type: 'select', label: 'Initial Mesh (shown the instant a seed is planted, before Stage 1\'s own mesh takes over — optional)', source: 'entityViews', optional: true },
        {
            key: 'stages', type: 'list', label: 'Growth Stages (ordered seedling -> harvestable; the LAST stage is the harvestable one)',
            itemLabel: (item, i) => `Stage ${i + 1} — ${item.mesh || '(inherits previous mesh)'}`,
            fields: [
                { key: 'durationSec', type: 'number', label: 'Duration (sec, ignored on the last/harvestable stage)' },
                { key: 'mesh', type: 'select', label: 'Mesh (optional — omitted keeps showing whichever mesh was already up)', source: 'entityViews', optional: true },
                {
                    key: 'start', type: 'group', label: 'Start (at this stage\'s own elapsed time 0)',
                    fields: [
                        { key: 'offset', type: 'vector3', label: 'Offset (x, y, z)' },
                        { key: 'scale', type: 'number', label: 'Scale' },
                    ],
                },
                {
                    key: 'end', type: 'group', label: 'End (reached once this stage\'s Duration has fully elapsed)',
                    fields: [
                        { key: 'offset', type: 'vector3', label: 'Offset (x, y, z)' },
                        { key: 'scale', type: 'number', label: 'Scale' },
                    ],
                },
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
    // A SEED — the bankable, plantable item (see SeedTypes.ts's own doc for why this is
    // separate from both Crops and Resources). `cropId` is what a Farm Plot Tile's own
    // seed-picker uses to know which Crops tab entry planting this seed starts growing;
    // planting always costs exactly one seed, no separate Plant Cost field.
    seeds: [
        { key: 'label', type: 'text', label: 'Label' },
        { key: 'cropId', type: 'select', label: 'Crop (what this seed grows into when planted)', source: 'crops' },
        // icon/models/scale/rotationDeg are stored in AssetLibraryRegistry.ts, not SeedTypes.ts —
        // same externalFields split Resources/Providers already use (see those tabs' own doc).
        { key: 'icon', type: 'icon', label: 'Icon', optional: true },
        { key: 'models', type: 'modelList', label: 'Models' },
        { key: 'scale', type: 'numberRange', label: 'Scale' },
        { key: 'rotationDeg', type: 'numberRange', label: 'Rotation (deg)' },
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
        { key: 'maxEntities', type: 'number', label: 'Max Entities In Line (blank/1 = today\'s single-giver behavior)', optional: true },
        { key: 'queueSpacing', type: 'number', label: 'Queue Spacing (world units a queued giver keeps behind the one ahead of it — only matters above 1 entity)', optional: true },
        { key: 'spawnIntervalSec', type: 'number', label: 'Spawn Interval (sec between each ADDITIONAL giver beyond the first — only matters above 1 entity)', optional: true },
        {
            key: 'variants', type: 'list', label: 'Variants',
            itemLabel: (item, i) => `Variant ${i + 1} — weight ${item.weight ?? '?'}`,
            fields: [
                { key: 'view', type: 'select', label: 'View (static mesh — leave blank if using NPC below)', source: 'entityViews', optional: true },
                { key: 'npc', type: 'select', label: 'NPC (animated, walks/idles instead of a static mesh — leave blank if using View above)', source: 'npcs', optional: true },
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
    // A stationary NPC's own look — first-pass NPC system, just a Character Views tab id (see
    // NpcTypes.ts's own doc). Assign one to a Mart's own "NPC" field (Marts tab) to spawn it
    // there. Free-designer id, same shape as Character Views itself.
    npcs: [
        { key: 'characterViewId', type: 'select', label: 'Character View', source: 'characterViews' },
        { key: 'scale', type: 'number', label: 'Scale (uniform; blank defaults to 0.0075, same rig scale the player itself uses)', optional: true },
        { key: 'viewRadius', type: 'number', label: 'View Radius (world units — blank means this NPC never looks at the player at all)', optional: true },
        { key: 'viewAngleDeg', type: 'number', label: 'View Angle (deg, full aperture — how wide a facing cone counts as "in front of the NPC"; only used when View Radius is set)', optional: true },
        {
            key: 'colors', type: 'list', label: 'Random Colors (each spawn picks one — e.g. store clients; empty = the Character View\'s color)', optional: true,
            itemLabel: item => item.color || 'color',
            fields: [{ key: 'color', type: 'color', label: 'Color' }],
        },
        {
            key: 'faces', type: 'list', label: 'Random Faces (each spawn picks one; empty = the Character View\'s face)', optional: true,
            itemLabel: item => (item.face || 'face').split('/').pop(),
            fields: [{ key: 'face', type: 'faceIcon', label: 'Face (images/non-preload)' }],
        },
        {
            key: 'hats', type: 'list', label: 'Random Hats (pool — a spawn that wears a hat picks one, weighted; empty = never a hat)', optional: true,
            itemLabel: item => `${(item.models?.[0] || 'hat').split('.').pop()} — weight ${item.weight ?? '?'}`,
            fields: [
                { key: 'models', type: 'modelList', label: 'Hat Model (first entry used — the Hats group)' },
                { key: 'weight', type: 'number', label: 'Weight (relative odds — 2 = twice as likely as a 1)' },
                { key: 'scale', type: 'number', label: 'Scale (x the size fitted to the head — blank = 1)', optional: true },
                { key: 'offsetY', type: 'number', label: 'Lift (fraction of the head size, negative = lower — blank = 0)', optional: true },
                { key: 'rotationDeg', type: 'number', label: 'Rotation (degrees — turn a hat that faces the wrong way; blank = 0)', optional: true },
            ],
        },
        { key: 'noHatChance', type: 'number', label: 'No Hat Chance (0-1 — 0.5 = half of the spawns wear no hat; blank = 0)', optional: true },
        { key: 'minScale', type: 'number', label: 'Random Min Scale (each spawn picks a scale between min and max — blank = Scale above)', optional: true },
        { key: 'maxScale', type: 'number', label: 'Random Max Scale', optional: true },
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
    // Global player-balance knobs (see PlayerConfig.ts's own doc) — only ever meant to have one
    // entry, "default", but reuses the same open-ended partialRecord list every other id-keyed
    // tab (shops/tools/crafting/...) already renders with, rather than a bespoke single-form tab.
    // game/world/FloorLayers.ts — bottom to top. Each gap is measured from the layer below it.
    floorLayers: [
        { key: 'groundY', type: 'number', label: 'Ground (Y of the base "groundLayer")' },
        { key: 'groundLayerGap', type: 'number', label: 'Ground Layer Gap (each extra "groundLayer2", "groundLayer3"... sits this much above the one below)' },
        { key: 'groundLayerCount', type: 'number', label: 'Ground Layer Count (how many ground layers to make room for — the store floor goes above the top one)' },
        { key: 'storeFloorGap', type: 'number', label: 'Store Floor Gap (store checker floor above the top ground layer — this is also the BASE Y buildings, storages, droppers... stand on)' },
        { key: 'decalGap', type: 'number', label: 'Dropper Gap (dropper / purchase / trigger outlines above the store floor)' },
        { key: 'labelGap', type: 'number', label: 'Floor Text Gap (prices and costs painted on the floor, above the outlines)' },
    ],
    player: [
        { key: 'walkSpeed', type: 'number', label: 'Walk Speed (world units/sec)' },
        { key: 'runSpeedMultiplier', type: 'number', label: 'Run Speed Multiplier (applied to Walk Speed while sprinting)' },
        { key: 'resourceDetectionRadius', type: 'number', label: 'Resource Detection Radius (world units — how far away a resource can be auto-gathered from)' },
        { key: 'resourceDetectionAngleDeg', type: 'number', label: 'Resource Detection Angle (deg, full aperture — how wide a facing cone counts as "in front of the player")' },
        { key: 'idleToWalkSpeed', type: 'number', label: 'Idle -> Walk Deadzone (near-zero stick magnitude at/below which the animator sits in Idle)' },
        { key: 'walkToRunSpeed', type: 'number', label: 'Walk -> Run Threshold (0-1, fraction of full analog stick deflection at/above which Walk switches to Run — e.g. 0.75 = past 75%)' },
        {
            key: 'animations', type: 'group', label: 'Animations (clip id must match a MODELS.Characters key)',
            fields: ANIMATION_CLIP_FIELDS,
        },
        {
            // Nested `models` is stored as plain "Group.Key" strings (only a TOP-LEVEL `models`
            // key gets MODELS.* serialization — see syncToSource.mjs's isModelRefArray()), which
            // is exactly what PlayerCarrierConfig.models is typed as.
            key: 'carrier', type: 'group', label: 'Carrier (the crate on the player\'s back the carry stack sits in — mounted on the Chest bone, units are character-rig units, ~100 = 0.75 world units; how much it holds is the Carrier tool\'s Capacity, Tools tab)',
            fields: [
                { key: 'models', type: 'modelList', label: 'Model (first entry used — empty = placeholder cube)' },
                {
                    key: 'offset', type: 'group', label: 'Offset from Chest bone (-Z = behind the character)',
                    fields: [
                        { key: 'x', type: 'number', label: 'X' },
                        { key: 'y', type: 'number', label: 'Y' },
                        { key: 'z', type: 'number', label: 'Z' },
                    ],
                },
                {
                    key: 'rotationDeg', type: 'group', label: 'Rotation (degrees)',
                    fields: [
                        { key: 'x', type: 'number', label: 'X' },
                        { key: 'y', type: 'number', label: 'Y' },
                        { key: 'z', type: 'number', label: 'Z' },
                    ],
                },
                { key: 'scale', type: 'number', label: 'Scale (multiplies the model\'s native size — Restaurant.Crate is 2 x 0.8 x 2)' },
                { key: 'itemScale', type: 'number', label: 'Stacked Item Scale (multiplies each carried item\'s real world size — also applied while it flies onto the stack; 1 = true size)', optional: true },
                { key: 'itemYawDeg', type: 'number', label: 'Stacked Item Rotation (degrees — every carried item turned the same way and the tower stacked perfectly straight, e.g. 0 or 90 for carrots; blank = scattered natural look)', optional: true },
                {
                    key: 'stackMode', type: 'select', label: 'Stack Mode (how carried items pile up in it)',
                    options: [
                        { value: 'grid', label: 'Grid (3x3 layers inside the crate)' },
                        { value: 'tower', label: 'Tower (one per level, stacked up high — very visible)' },
                    ],
                },
            ],
        },
        { key: 'harvestIntoStack', type: 'boolean', label: 'Harvest Into Stack (farm harvests fly straight onto the carry stack, limited by the Carrier\'s capacity — off = banked instantly, no limit)' },
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
    // Added alongside the Trigger tab — "this zone/gate unlocks once trigger volume X fires."
    // See TriggerTypes.ts's own doc for why a trigger itself carries no effect config: this
    // field, on whichever entity actually cares, IS the effect.
    trigger: [
        { key: 'triggerId', type: 'select', label: 'Trigger', source: 'triggers' },
    ],
    // "Appears once store X reaches level N" — same effect as listing the id under that store
    // level's own Enables, but set from the entity being unlocked (and also usable by zones
    // and craft tables, which Enables can't hide). See MilestoneRequirement.ts.
    store: [
        { key: 'storeId', type: 'select', label: 'Store', source: 'stores' },
        { key: 'level', type: 'number', label: 'Store Level (at least)' },
    ],
    // "Appears once storage X is built (bought, or free)" — e.g. a farm unlocked by its shelf.
    storage: [
        { key: 'storageId', type: 'select', label: 'Storage', source: 'storages' },
    ],
    // "Once store X has made N sales in total" (lifetime — never reset by a store level-up),
    // e.g. the FTUE's "zone 2 opens after the first sale". See MilestoneRequirement.ts.
    storeSales: [
        { key: 'storeId', type: 'select', label: 'Store', source: 'stores' },
        { key: 'sales', type: 'number', label: 'Total Sales (at least — clients who ever paid)' },
    ],
};
