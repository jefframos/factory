// graph.js
//
// The "Graph" tab (see app.js's renderTabs()/renderActiveTab(), which call
// renderGraphTab() below — this file is a plain global-scope script, same
// convention as app.js itself, no bundler/module system involved) — a
// READ-ONLY visualization of the whole game's unlock/dependency graph:
// which resource feeds which provider, which resources a craft table
// consumes and what item it produces, which resources fund a building
// level, what a gate/appearRequirement is actually waiting on, which tool a
// shop upgrades. Built entirely from the same per-tab JSON the rest of the
// editor already edits (fetched fresh via /api/data/:id, same as init()) —
// never writes anything, never touches game code, purely a different way
// of looking at data that already exists.
//
// Rendered with Cytoscape.js (vendored under graph/vendor/ — see that
// folder's own files) plus its dagre layout plugin, for a readable
// left-to-right "what feeds what" flow instead of a tangled force-directed
// blob. Node icons reuse the exact same /api/images asset lookup app.js's
// icon fields already use, so a resource/item/tool node shows the same
// thumbnail its own tab does.

/** One color + short label per node "kind" — used for both the node's border/background tint (see NODE_STYLE below) and the legend. Kept in one place so the graph and the legend can never drift out of sync with each other. */
const GRAPH_KIND_STYLE = {
    resource: { color: '#3fb950', label: 'Resource' },
    item: { color: '#58a6ff', label: 'Item' },
    tool: { color: '#d2a8ff', label: 'Tool' },
    provider: { color: '#c9944b', label: 'Provider' },
    building: { color: '#9a9ba3', label: 'Building' },
    shop: { color: '#e3b341', label: 'Shop' },
    craft: { color: '#f778ba', label: 'Craft table' },
    queue: { color: '#79c0ff', label: 'Queue' },
    gate: { color: '#e5484d', label: 'Gate' },
    animal: { color: '#ffa657', label: 'Animal' },
    // Two distinct kinds (not one shared "spawner") since they come from two different tabs
    // with two different id shapes (array index either way, but a different array — see
    // lookupRawEntry()'s own doc) — kept visually close (both greens, unlike any other kind
    // here) so they still read as "the same FAMILY of thing" at a glance.
    dynamicSpawner: { color: '#56d364', label: 'Dynamic Spawner (tile area)' },
    shapeSpawner: { color: '#2ea043', label: 'Shape Spawner (drawn area)' },
    zone: { color: '#f2cc60', label: 'Zone' },
    // Progression view only (see buildProgressionGraphElements()) — a MilestoneRequirement's
    // 'trigger' type (e.g. a tutorial walk-to-here trip wire), nested inside its own zone's
    // "Tutorial" box rather than sitting loose among that zone's gates/crafting/etc.
    trigger: { color: '#2dd4bf', label: 'Trigger (tutorial)' },
};

/** Which real editor tab (a manifest.json id) each node kind's own data actually lives on — used by showNodeDetail()'s "Open <tab> tab" button. `queue` intentionally points at 'queues' even though a queue's own entry lives under its `byId` sub-object, not the tab's top level — switching tabs is all this does, not deep-linking to the specific entry. */
const GRAPH_KIND_TAB = {
    resource: 'resources',
    item: 'items',
    tool: 'tools',
    provider: 'providers',
    building: 'buildings',
    shop: 'shops',
    craft: 'crafting',
    queue: 'queues',
    gate: 'gates',
    animal: 'animals',
    dynamicSpawner: 'dynamicResourcePlacements',
    shapeSpawner: 'shapeResourcePlacements',
    zone: 'zones',
};

let cy;
/** Which of the graph tab's two sub-views is showing — 'general' (the original whole-game unlock/dependency graph) or 'progression' (see buildProgressionGraphElements()'s own doc). Persisted only for the lifetime of this render (renderGraphTab() rebuilds from scratch on every tab switch), same as the rest of this file's module state. */
let activeGraphView = 'general';
/** The full per-tab data fetched by the most recent refreshGraph() — kept around so showNodeDetail() can look a clicked node's own raw entry back up without a second fetch. */
let lastGraphData = null;
/** The {nodes, edges} Cytoscape elements built by the most recent refreshGraph() for whichever view is active — kept around so the Export JSON button can reuse them without rebuilding. */
let lastGraphElements = null;
/** Cached across Refresh clicks within one page session — same "fetch once, reuse" convention app.js's own imageAssetsPromise uses. */
let graphImageAssetsPromise = null;
function loadGraphImageAssets() {
    if (!graphImageAssetsPromise) {
        graphImageAssetsPromise = fetch('/api/images').then(r => r.json()).catch(() => ({ assets: [] }));
    }
    return graphImageAssetsPromise;
}

/**
 * Fetches every tab this graph draws from, in parallel — a subset of what init() fetches for
 * the whole editor, since not every tab (actions, entityViews, lootTables, characterViews,
 * mapTiles) contributes a node or edge here. Also pulls the two map-derived, read-only zone
 * endpoints (see tiledMap.mjs's readZoneCells()/readZoneContents()) — `zoneCells` for which
 * zoneNumbers actually exist to draw a node for, `zoneContents` for the "in zone" edges (see
 * buildGraphElements()'s own doc on both).
 */
async function loadGraphData() {
    const ids = ['resources', 'items', 'tools', 'providers', 'buildings', 'shops', 'crafting', 'gates', 'queues', 'animals', 'dynamicResourcePlacements', 'shapeResourcePlacements', 'zones'];
    const [entries, zoneCells, zoneContents] = await Promise.all([
        Promise.all(ids.map(async id => [id, await fetch(`/api/data/${id}`).then(r => r.json())])),
        fetch('/api/zone-cells').then(r => r.json()).catch(() => ({ zones: [], error: 'fetch failed' })),
        fetch('/api/zone-contents').then(r => r.json()).catch(() => ({ byZone: {}, error: 'fetch failed' })),
    ]);
    return { ...Object.fromEntries(entries), zoneCells, zoneContents };
}

/** True if `req` (a MilestoneRequirement — see MilestoneRequirement.ts) names a real source node this graph already has, given its own `type` discriminant. Returns the node id it points at, or undefined for a requirement that isn't fully filled in yet. */
function requirementSourceNodeId(req) {
    if (!req) return undefined;
    if (req.type === 'building' && req.buildingId) return `building:${req.buildingId}`;
    if (req.type === 'item' && req.item) return `item:${req.item}`;
    if (req.type === 'resource' && req.resourceType) return `resource:${req.resourceType}`;
    if (req.type === 'gate' && req.gateId) return `gate:${req.gateId}`;
    return undefined;
}

/**
 * Turns the fetched per-tab data into Cytoscape elements — every node/edge id is prefixed with
 * its own kind (`resource:wood`, `provider:tree`, ...) so two different tabs' ids never collide
 * even though several id-spaces in this game happen to share literal strings (see this repo's
 * own history on `stone`/`crystalCopy` id collisions — the graph deliberately can't repeat that
 * mistake, since every node id already carries its kind).
 */
function buildGraphElements(data, iconByName) {
    const nodes = new Map();
    const edges = [];

    function addNode(kind, id, label, iconName) {
        const nodeId = `${kind}:${id}`;
        if (!nodes.has(nodeId)) {
            nodes.set(nodeId, {
                data: {
                    id: nodeId,
                    // `rawId` (the id WITHOUT its kind prefix) is what showNodeDetail() needs
                    // to look this node's own entry back up in `data` — the prefix only exists
                    // to keep cytoscape's own element ids collision-free (see this function's
                    // own doc), it was never part of the real id anywhere else.
                    rawId: id,
                    label: label ?? id,
                    kind,
                    icon: iconName ? iconByName.get(iconName) : undefined,
                },
            });
        }
        return nodeId;
    }

    // Every EXISTING caller only ever names a source/target this function already knows is
    // safe (every entity loop below adds a node for EVERY entry in its own data source
    // upfront, before anything can reference it — see e.g. the resources loop, which is why a
    // building's cost requirement referencing a resourceType always finds a node already
    // there). The zone "in zone" edges added below are the first caller that DOESN'T have that
    // guarantee — an id painted on the map's mapSettings layer (e.g. a typo'd gate id with no
    // matching GATE_CONFIG entry) has no corresponding node — so this silently skips a dangling
    // reference instead of handing Cytoscape an edge to a node id that was never created,
    // which throws and blanks the whole graph rather than just omitting one bad edge.
    function addEdge(source, target, label) {
        if (!source || !target || !nodes.has(source) || !nodes.has(target)) return;
        edges.push({ data: { id: `${source}->${target}:${edges.length}`, source, target, label: label ?? '' } });
    }

    for (const [id, r] of Object.entries(data.resources ?? {})) {
        addNode('resource', id, r.label, r.icon);
    }
    for (const [id, t] of Object.entries(data.tools ?? {})) {
        addNode('tool', id, t.label, t.icon);
    }
    // ItemConfig itself carries no icon (see schemas.js's own doc) — items/tools conventionally
    // share the SAME bare id for the axe/pickaxe pair (a naming convention, not a real link —
    // see renameEntity.mjs's own doc on this), so borrowing the matching tool's icon when one
    // exists is the closest thing to a real icon an item node can show.
    for (const [id, i] of Object.entries(data.items ?? {})) {
        addNode('item', id, i.label, data.tools?.[id]?.icon);
    }

    for (const [id, p] of Object.entries(data.providers ?? {})) {
        const providerNodeId = addNode('provider', id, p.label, p.icon);
        for (const drop of p.drops ?? []) {
            if (!drop.resourceType) continue;
            const resourceNodeId = addNode('resource', drop.resourceType, data.resources?.[drop.resourceType]?.label, data.resources?.[drop.resourceType]?.icon);
            addEdge(providerNodeId, resourceNodeId, `${drop.weight ?? '?'}`);
        }
    }

    for (const [id, c] of Object.entries(data.crafting ?? {})) {
        const craftNodeId = addNode('craft', id, c.name, undefined);
        for (const recipe of c.recipes ?? []) {
            for (const [resourceId, amount] of Object.entries(recipe.cost ?? {})) {
                const resourceNodeId = addNode('resource', resourceId, data.resources?.[resourceId]?.label, data.resources?.[resourceId]?.icon);
                addEdge(resourceNodeId, craftNodeId, `${amount}`);
            }
            if (recipe.result?.item) {
                const itemNodeId = addNode('item', recipe.result.item, data.items?.[recipe.result.item]?.label, data.tools?.[recipe.result.item]?.icon);
                addEdge(craftNodeId, itemNodeId, `${recipe.result.amount ?? 1}`);
            }
        }
        const reqSource = requirementSourceNodeId(c.appearRequirement);
        if (reqSource) addEdge(reqSource, craftNodeId, 'unlocks');
    }

    for (const [id, b] of Object.entries(data.buildings ?? {})) {
        const buildingNodeId = addNode('building', id, b.name, b.icon);
        for (const level of b.levels ?? []) {
            for (const [resourceId, amount] of Object.entries(level.requirements ?? {})) {
                const resourceNodeId = addNode('resource', resourceId, data.resources?.[resourceId]?.label, data.resources?.[resourceId]?.icon);
                addEdge(resourceNodeId, buildingNodeId, `Lv${level.level} ×${amount}`);
            }
        }
        const reqSource = requirementSourceNodeId(b.appearRequirement);
        if (reqSource) addEdge(reqSource, buildingNodeId, 'unlocks');
    }

    for (const [id, s] of Object.entries(data.shops ?? {})) {
        const shopNodeId = addNode('shop', id, s.name, undefined);
        if (s.tool) {
            const toolNodeId = addNode('tool', s.tool, data.tools?.[s.tool]?.label, data.tools?.[s.tool]?.icon);
            addEdge(shopNodeId, toolNodeId, 'upgrades');
        }
        const reqSource = requirementSourceNodeId(s.appearRequirement);
        if (reqSource) addEdge(reqSource, shopNodeId, 'unlocks');
    }

    for (const [id, q] of Object.entries(data.queues?.byId ?? {})) {
        const queueNodeId = addNode('queue', id, id, undefined);
        for (const task of q.possibleTasks ?? []) {
            if (!task.resourceType) continue;
            const resourceNodeId = addNode('resource', task.resourceType, data.resources?.[task.resourceType]?.label, data.resources?.[task.resourceType]?.icon);
            addEdge(resourceNodeId, queueNodeId, `×${task.amount ?? '?'}`);
        }
        const reqSource = requirementSourceNodeId(q.appearRequirement);
        if (reqSource) addEdge(reqSource, queueNodeId, 'unlocks');
    }

    for (const [id, g] of Object.entries(data.gates ?? {})) {
        const gateNodeId = addNode('gate', id, g.name, undefined);
        const reqSource = requirementSourceNodeId(g.requirement);
        if (reqSource) addEdge(reqSource, gateNodeId, 'unlocks');
    }

    for (const [id, a] of Object.entries(data.animals ?? {})) {
        // An animal's OWN world model AND caught-state icon are the AssetLibraryRegistry entry
        // keyed by its `resourceType` (never actually banked to BackpackStorage — see
        // AnimalTypes.ts's own doc) — same lookup pattern a provider's own resource drop uses
        // elsewhere in this function, just for the node's OWN icon this time instead of an edge
        // target's.
        const animalNodeId = addNode('animal', id, a.label, data.resources?.[a.resourceType]?.icon);
        // requirementItem/requirementAmount is its OWN flat pair (see AnimalConfig's own doc) —
        // NOT a MilestoneRequirement, so requirementSourceNodeId()/the 'unlocks' convention
        // every other kind uses doesn't apply here; drawn as its own "needs" edge instead.
        if (a.requirementItem) {
            const itemNodeId = addNode('item', a.requirementItem, data.items?.[a.requirementItem]?.label, data.tools?.[a.requirementItem]?.icon);
            addEdge(itemNodeId, animalNodeId, `needs ×${a.requirementAmount ?? 1}`);
        }
    }

    // Dynamic Resources — one placement per (spawnType, resourceType|providerType,
    // spawnerTileType) combination, scattered across a painted ground TYPE (e.g. every
    // "grass" cell), not one drawn area — see DynamicResourceTypes.ts's own doc. Node id is
    // the array INDEX (this tab's shape is 'array', not id-keyed — same convention
    // getOptions() already uses for it), since two placements can otherwise share the exact
    // same identity/terrain pair. 'provider' spawns a REAL gatherable provider — reuses the
    // SAME 'provider' node the providers loop above already created (a tree scattered here is
    // still the same tree a resourcesLayer-painted one would be), not a new kind.
    (data.dynamicResourcePlacements ?? []).forEach((placement, index) => {
        const isProvider = (placement.spawnType ?? 'resource') === 'provider';
        const identity = isProvider ? placement.providerType : placement.resourceType;
        if (!identity) return;
        const spawnerNodeId = addNode('dynamicSpawner', String(index), `${identity} @ ${placement.spawnerTileType || '?'}`, undefined);
        if (isProvider) {
            const providerNodeId = addNode('provider', identity, data.providers?.[identity]?.label, data.providers?.[identity]?.icon);
            addEdge(spawnerNodeId, providerNodeId, 'spawns');
        } else {
            const resourceNodeId = addNode('resource', identity, data.resources?.[identity]?.label, data.resources?.[identity]?.icon);
            addEdge(spawnerNodeId, resourceNodeId, 'spawns');
        }
    });

    // Shape Resources — sibling to Dynamic Resources above, drawn as one hand-placed AREA
    // (a "spawner"-type mapSettings object, its own id = this placement's shapeId) instead of
    // a painted ground type — see ShapeResourceTypes.ts's own doc. spawnType picks whether
    // this spawns a loose resource, an AnimalNode, or a real gatherable provider (see that
    // file's own doc on why only one of resourceType/animalType/providerType is ever
    // meaningful on a given entry) — 'provider' reuses the SAME 'provider' node the providers
    // loop above already created, same reasoning as the Dynamic Resources loop above.
    (data.shapeResourcePlacements ?? []).forEach((placement, index) => {
        const spawnType = placement.spawnType ?? 'resource';
        const identity = spawnType === 'animal' ? placement.animalType : spawnType === 'provider' ? placement.providerType : placement.resourceType;
        if (!identity) return;
        const spawnerNodeId = addNode('shapeSpawner', String(index), `${identity} @ ${placement.shapeId || '?'}`, undefined);
        if (spawnType === 'animal') {
            const animalNodeId = addNode('animal', identity, data.animals?.[identity]?.label, data.resources?.[data.animals?.[identity]?.resourceType]?.icon);
            addEdge(spawnerNodeId, animalNodeId, 'spawns');
        } else if (spawnType === 'provider') {
            const providerNodeId = addNode('provider', identity, data.providers?.[identity]?.label, data.providers?.[identity]?.icon);
            addEdge(spawnerNodeId, providerNodeId, 'spawns');
        } else {
            const resourceNodeId = addNode('resource', identity, data.resources?.[identity]?.label, data.resources?.[identity]?.icon);
            addEdge(spawnerNodeId, resourceNodeId, 'spawns');
        }
    });

    // Zones — one node per zoneNumber the map's own "zones" tilelayer actually paints right
    // now (data.zoneCells, see tiledMap.mjs's readZoneCells()), NOT every key in data.zones —
    // a zone number with a saved requirement but no longer painted (see app.js's own "not
    // currently painted" section on the Zones tab) still has config, but showing it here would
    // draw a node for a zone that doesn't really exist on the map anymore.
    //
    // Two edge kinds converge on a zone node: its OWN unlock requirement (same 'unlocks'
    // convention every other requirement-gated kind uses) and "in zone" edges FROM whatever's
    // actually placed inside it (data.zoneContents, see readZoneContents()'s own doc) — a
    // gate/building/shop/queue/craft table's own node already exists from the loops above, so
    // this only needs to draw the edge, not re-create the node. A "spawner"-type mapSettings
    // object's id is a shapeId, which isn't itself a graph node — it's cross-referenced
    // against shapeResourcePlacements to find which spawner NODE(s) actually reference that
    // shapeId (usually one, but nothing stops two placements sharing an area).
    const ZONE_CONTENT_KIND_BY_MAP_TYPE = { gate: 'gate', building: 'building', shop: 'shop', queue: 'queue', craft: 'craft' };
    for (const zone of data.zoneCells?.zones ?? []) {
        const zoneNodeId = addNode('zone', String(zone.zoneNumber), `Zone ${zone.zoneNumber + 1}`, undefined);

        const reqSource = requirementSourceNodeId(data.zones?.[String(zone.zoneNumber)]?.requirement);
        if (reqSource) addEdge(reqSource, zoneNodeId, 'unlocks');

        const contents = data.zoneContents?.byZone?.[String(zone.zoneNumber)] ?? {};
        for (const [mapType, ids] of Object.entries(contents)) {
            if (mapType === 'spawner') {
                for (const shapeId of ids) {
                    data.shapeResourcePlacements?.forEach((placement, index) => {
                        if (placement.shapeId === shapeId) {
                            addEdge(`shapeSpawner:${index}`, zoneNodeId, 'in zone');
                        }
                    });
                }
                continue;
            }
            const kind = ZONE_CONTENT_KIND_BY_MAP_TYPE[mapType];
            if (!kind) continue;
            for (const id of ids) {
                addEdge(`${kind}:${id}`, zoneNodeId, 'in zone');
            }
        }
    }

    return { nodes: [...nodes.values()], edges };
}

/**
 * Builds the "Progression" view — same underlying data as buildGraphElements(), but answering a
 * different question: not "what feeds what" across the whole game, but "what does the game make
 * me unlock, zone by zone, to get to the next one." Two things buildGraphElements() doesn't do:
 *
 * 1. Clusters every gate/craft table/building/shop/queue into a compound Cytoscape node per
 *    zone it's actually placed in (data.zoneContents, same source buildGraphElements()'s own
 *    "in zone" edges use) — so a designer sees each zone's own content as one visual group
 *    instead of scattered nodes with "in zone" edges pointing at a same zone node.
 * 2. Draws each zone's own unlock requirement as an edge INTO the next zone's cluster (plus a
 *    dashed fallback edge between consecutive zones with no requirement configured yet, so an
 *    incomplete design still reads as a path, just a visibly weak link) — that chain of edges,
 *    read left-to-right after the dagre layout, IS the progression path.
 *
 * Resources/items/tools have no zone placement data (they're not painted on the map), so they
 * appear only where a requirement actually names one — as an unparented node feeding into
 * whichever gated entity or zone needs it, same as any other requirement source.
 *
 * Triggers (a MilestoneRequirement's `type: 'trigger'`, e.g. a tutorial walk-to-here trip wire)
 * get their own node kind AND their own nested compound "Tutorial" box inside their zone's own
 * cluster — a zone's trigger(s) are conceptually a different thing from its gates/crafting/etc
 * (a one-time scripted beat, not a placed, re-enterable entity), so they get visually set apart
 * as their own sub-group rather than sitting loose among the rest of that zone's contents.
 *
 * Two edge "weights" keep the actual progression path legible instead of drowning in every
 * individual "needs" dependency: edges that ARE the zone-to-zone path (`pathEdge`) render bold
 * and orange; ordinary per-entity `needs` edges render thin and faded. A same-labeled but
 * invisible `sequenceGuide` edge is also added between every consecutive zone pair (regardless
 * of whether a real requirement edge already crosses that boundary) purely to pin dagre's rank
 * order to zone order left-to-right — without it, a `needs` edge from a resource/item shared by
 * entities in different zones can pull the layout's rank assignment out of zone order entirely,
 * which is what actually produced the "spider web" look this replaces.
 */
function buildProgressionGraphElements(data) {
    const nodes = new Map();
    const edges = [];

    function addNode(kind, id, label, parent, classes) {
        const nodeId = `${kind}:${id}`;
        if (!nodes.has(nodeId)) {
            nodes.set(nodeId, { data: { id: nodeId, rawId: id, label: label ?? id, kind, parent }, classes });
        } else if (parent && !nodes.get(nodeId).data.parent) {
            nodes.get(nodeId).data.parent = parent;
        }
        return nodeId;
    }

    // Same dangling-reference guard as buildGraphElements()'s own addEdge — see that function's doc.
    function addEdge(source, target, label, classes) {
        if (!source || !target || !nodes.has(source) || !nodes.has(target)) return;
        edges.push({ data: { id: `${source}->${target}:${edges.length}`, source, target, label: label ?? '' }, classes });
    }

    const zones = [...(data.zoneCells?.zones ?? [])].sort((a, b) => a.zoneNumber - b.zoneNumber);
    for (const zone of zones) {
        addNode('zone', String(zone.zoneNumber), `Zone ${zone.zoneNumber + 1}`, undefined, 'zoneCluster');
    }

    // Reverse-map (kind, id) -> zone number from zoneContents, restricted to the entity kinds a
    // zone can actually contain — same ZONE_CONTENT_KIND_BY_MAP_TYPE convention buildGraphElements()
    // uses for its own "in zone" edges. Triggers are handled separately below since they nest
    // inside their own "Tutorial" box rather than parenting straight to the zone.
    const ZONE_CONTENT_KIND_BY_MAP_TYPE = { gate: 'gate', building: 'building', shop: 'shop', queue: 'queue', craft: 'craft' };
    const zoneOfEntity = new Map();
    // triggerId -> its Tutorial box node id (only zones with at least one trigger get a box).
    const tutorialBoxByTrigger = new Map();
    for (const zone of zones) {
        const contents = data.zoneContents?.byZone?.[String(zone.zoneNumber)] ?? {};
        for (const [mapType, ids] of Object.entries(contents)) {
            const kind = ZONE_CONTENT_KIND_BY_MAP_TYPE[mapType];
            if (kind) {
                for (const id of ids) zoneOfEntity.set(`${kind}:${id}`, String(zone.zoneNumber));
                continue;
            }
            if (mapType === 'trigger' && ids.length > 0) {
                const boxId = addNode('tutorialBox', String(zone.zoneNumber), 'Tutorial', `zone:${zone.zoneNumber}`, 'tutorialBox');
                for (const triggerId of ids) tutorialBoxByTrigger.set(triggerId, boxId);
            }
        }
    }
    const zoneParentFor = (kind, id) => {
        const z = zoneOfEntity.get(`${kind}:${id}`);
        return z !== undefined ? `zone:${z}` : undefined;
    };

    for (const [id, g] of Object.entries(data.gates ?? {})) addNode('gate', id, g.name, zoneParentFor('gate', id));
    for (const [id, c] of Object.entries(data.crafting ?? {})) addNode('craft', id, c.name, zoneParentFor('craft', id));
    for (const [id, b] of Object.entries(data.buildings ?? {})) addNode('building', id, b.name, zoneParentFor('building', id));
    for (const [id, s] of Object.entries(data.shops ?? {})) addNode('shop', id, s.name, zoneParentFor('shop', id));
    for (const [id, q] of Object.entries(data.queues?.byId ?? {})) addNode('queue', id, id, zoneParentFor('queue', id));
    for (const [triggerId, boxId] of tutorialBoxByTrigger) addNode('trigger', triggerId, triggerId, boxId);

    /** Resolves a MilestoneRequirement to its source node id, creating the node on first reference (resources/items have no zone placement, so they're always unparented here — see this function's own doc). A trigger with no known zone (shouldn't happen, but a trigger id typo'd in a requirement with no matching zoneContents entry is possible) is added unparented rather than dropped. */
    function ensureRequirementNode(req) {
        if (!req) return undefined;
        if (req.type === 'building' && req.buildingId) return addNode('building', req.buildingId, data.buildings?.[req.buildingId]?.name, zoneParentFor('building', req.buildingId));
        if (req.type === 'item' && req.item) return addNode('item', req.item, data.items?.[req.item]?.label);
        if (req.type === 'resource' && req.resourceType) return addNode('resource', req.resourceType, data.resources?.[req.resourceType]?.label);
        if (req.type === 'gate' && req.gateId) return addNode('gate', req.gateId, data.gates?.[req.gateId]?.name, zoneParentFor('gate', req.gateId));
        if (req.type === 'trigger' && req.triggerId) return addNode('trigger', req.triggerId, req.triggerId, tutorialBoxByTrigger.get(req.triggerId));
        return undefined;
    }

    // "needs" edges: what unlocks each individual gate/craft table/building/shop/queue — thin
    // and faded (see this function's own doc on why) so they read as background detail.
    for (const [id, g] of Object.entries(data.gates ?? {})) addEdge(ensureRequirementNode(g.requirement), `gate:${id}`, 'needs', 'needsEdge');
    for (const [id, c] of Object.entries(data.crafting ?? {})) addEdge(ensureRequirementNode(c.appearRequirement), `craft:${id}`, 'needs', 'needsEdge');
    for (const [id, b] of Object.entries(data.buildings ?? {})) addEdge(ensureRequirementNode(b.appearRequirement), `building:${id}`, 'needs', 'needsEdge');
    for (const [id, s] of Object.entries(data.shops ?? {})) addEdge(ensureRequirementNode(s.appearRequirement), `shop:${id}`, 'needs', 'needsEdge');
    for (const [id, q] of Object.entries(data.queues?.byId ?? {})) addEdge(ensureRequirementNode(q.appearRequirement), `queue:${id}`, 'needs', 'needsEdge');

    // THE path: each zone's own unlock requirement, drawn straight into the next zone's cluster
    // — bold and orange (pathEdge) so it stands out from the faded "needs" edges above.
    for (const zone of zones) {
        const src = ensureRequirementNode(data.zones?.[String(zone.zoneNumber)]?.requirement);
        if (src) addEdge(src, `zone:${zone.zoneNumber}`, 'unlocks zone', 'pathEdge');
    }

    // Every consecutive zone pair gets an ordering guide (see this function's own doc on why):
    // invisible when a real path edge already crosses that boundary, or the visible dashed
    // "no requirement set" fallback when it doesn't — either way, dagre's rank order is pinned
    // to zone order and can no longer be pulled out of sequence by an unrelated needs-edge.
    for (let i = 1; i < zones.length; i++) {
        const prev = zones[i - 1];
        const cur = zones[i];
        const hasRealReqEdge = !!ensureRequirementNode(data.zones?.[String(cur.zoneNumber)]?.requirement);
        if (hasRealReqEdge) {
            addEdge(`zone:${prev.zoneNumber}`, `zone:${cur.zoneNumber}`, '', 'sequenceGuide');
        } else {
            addEdge(`zone:${prev.zoneNumber}`, `zone:${cur.zoneNumber}`, 'next (no requirement set)', 'pathEdge fallbackEdge');
        }
    }

    return { nodes: [...nodes.values()], edges };
}

/** Strips the Cytoscape element wrapper down to plain {nodes, edges} data for the Export JSON button — designers analyzing this don't need cytoscape's own `data`-wrapper/`classes` shape, just id/label/kind/parent per node and source/target/label per edge. Triggers a real file download via a throwaway Blob URL + `<a download>`, same convention as any other client-only "save a file" button. */
function exportGraphElementsAsJson(nodes, edges, filename) {
    const plainNodes = nodes.map(n => ({ id: n.data.id, label: n.data.label, kind: n.data.kind, rawId: n.data.rawId, parent: n.data.parent }));
    const plainEdges = edges.map(e => ({ source: e.data.source, target: e.data.target, label: e.data.label }));
    const json = JSON.stringify({ nodes: plainNodes, edges: plainEdges }, null, 2);

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function graphStylesheet() {
    const kindSelectors = Object.entries(GRAPH_KIND_STYLE).map(([kind, { color }]) => ({
        selector: `node[kind = "${kind}"]`,
        style: { 'border-color': color, 'background-color': color },
    }));

    return [
        {
            selector: 'node',
            style: {
                shape: 'round-rectangle',
                width: 46,
                height: 46,
                'border-width': 3,
                'background-color': '#26272c',
                'background-fit': 'cover',
                'background-clip': 'node',
                label: 'data(label)',
                'font-size': 10,
                color: '#e8e8ea',
                'text-valign': 'bottom',
                'text-margin-y': 6,
                'text-wrap': 'wrap',
                'text-max-width': 80,
                'text-outline-width': 2,
                'text-outline-color': '#1c1d21',
            },
        },
        // A node WITHOUT an icon shows as a plain color-filled tile (its kind's own color, set
        // by the per-kind selectors below) — one WITH an icon shows the icon itself, framed by
        // that same color as its border, so kind is still readable at a glance either way.
        { selector: 'node[icon]', style: { 'background-image': 'data(icon)', 'background-color': '#1c1d21' } },
        ...kindSelectors,
        {
            selector: 'edge',
            style: {
                width: 2,
                'line-color': '#5a5b63',
                'target-arrow-color': '#5a5b63',
                'target-arrow-shape': 'triangle',
                'curve-style': 'bezier',
                label: 'data(label)',
                'font-size': 9,
                color: '#9a9ba3',
                'text-background-color': '#1c1d21',
                'text-background-opacity': 0.85,
                'text-background-padding': 2,
            },
        },
        // Zone cluster nodes in the Progression view (see buildProgressionGraphElements()) are
        // compound parents, not real entities — drawn as a large dashed translucent container
        // with its label pinned to the top, instead of the small filled tile every other kind
        // uses, so the eye reads it as "a group" first and "a node" second.
        {
            selector: '.zoneCluster',
            style: {
                shape: 'round-rectangle',
                'background-opacity': 0.10,
                'border-width': 2,
                'border-style': 'dashed',
                padding: '24px',
                label: 'data(label)',
                'text-valign': 'top',
                'text-halign': 'center',
                'font-size': 14,
                'font-weight': 700,
                'text-margin-y': -6,
            },
        },
        // The "Tutorial" box (see buildProgressionGraphElements()) is itself a nested compound
        // node inside its zone's own cluster — smaller/tighter padding and a distinct teal tint
        // (matching the trigger kind's own color) so it reads as "a box inside the box" rather
        // than blending into the zone cluster it's nested in.
        {
            selector: '.tutorialBox',
            style: {
                shape: 'round-rectangle',
                'background-opacity': 0.16,
                'background-color': '#2dd4bf',
                'border-color': '#2dd4bf',
                'border-width': 2,
                'border-style': 'dashed',
                padding: '14px',
                label: 'data(label)',
                'text-valign': 'top',
                'text-halign': 'center',
                'font-size': 11,
                'font-weight': 600,
                color: '#2dd4bf',
                'text-margin-y': -4,
            },
        },
        // Progression view edge weights (see buildProgressionGraphElements()'s own doc): the
        // bold orange path IS the zone-to-zone unlock chain; everything else fades into the
        // background so the eye follows the path instead of every individual dependency.
        {
            selector: '.pathEdge',
            style: { width: 3, 'line-color': '#ff7a45', 'target-arrow-color': '#ff7a45', 'font-size': 10, 'font-weight': 600, color: '#ff7a45' },
        },
        { selector: '.fallbackEdge', style: { 'line-style': 'dashed', opacity: 0.65 } },
        { selector: '.needsEdge', style: { opacity: 0.45, 'font-size': 8 } },
        // Purely a rank-order guide for dagre (see buildProgressionGraphElements()'s own doc) —
        // never meant to be seen.
        { selector: '.sequenceGuide', style: { opacity: 0, 'target-arrow-shape': 'none' } },
        { selector: 'node:selected', style: { 'border-width': 5, 'border-color': '#ff7a45' } },
        { selector: 'edge:selected', style: { 'line-color': '#ff7a45', 'target-arrow-color': '#ff7a45', width: 3 } },
        // Cytoscape renders to a <canvas>, not real DOM nodes — a plain CSS class has no effect
        // on its elements at all, so the click-to-highlight behavior in refreshGraph() needs its
        // OWN stylesheet rule here, not a .graph-dimmed entry in style.css.
        { selector: '.graph-dimmed', style: { opacity: 0.12 } },
    ];
}

function buildLegend() {
    const legend = document.createElement('div');
    legend.className = 'graph-legend';
    for (const { color, label } of Object.values(GRAPH_KIND_STYLE)) {
        const item = document.createElement('span');
        item.className = 'graph-legend-item';
        const swatch = document.createElement('span');
        swatch.className = 'graph-legend-swatch';
        swatch.style.background = color;
        item.appendChild(swatch);
        item.appendChild(document.createTextNode(label));
        legend.appendChild(item);
    }
    return legend;
}

/** Looks a clicked node's own raw entry back up in `lastGraphData` by kind+rawId — the SAME object its own real tab edits, not a copy, so the detail panel always reflects whatever's currently loaded. `queue` reads from the nested `byId` sub-object (see GRAPH_KIND_TAB's own doc); every other kind is a flat top-level record. */
function lookupRawEntry(kind, rawId) {
    if (!lastGraphData) return undefined;
    if (kind === 'queue') return lastGraphData.queues?.byId?.[rawId];
    // dynamicResourcePlacements/shapeResourcePlacements are both 'array'-shaped tabs (see
    // getOptions()'s own 'array' branch) — rawId is the array INDEX (a string, per addNode()'s
    // own template-literal id), not an entity id, same reasoning buildGraphElements()'s own
    // per-placement node-id doc gives.
    if (kind === 'dynamicSpawner' || kind === 'shapeSpawner') return lastGraphData[GRAPH_KIND_TAB[kind]]?.[Number(rawId)];
    return lastGraphData[GRAPH_KIND_TAB[kind]]?.[rawId];
}

/** Renders a clicked node's own setup into the detail panel — kind/id header, an "Open <tab> tab" button that jumps to its real editor tab (see app.js's global activeId/renderTabs/renderActiveTab — graph.js is a plain script sharing that same global scope, not a module, so calling them directly here is the same convention every other cross-file call in this editor already uses), and a plain formatted dump of its own raw data underneath. Deliberately a generic key/value dump rather than a bespoke per-kind view — this panel's job is "show me what's really there," not re-implement each tab's own form. */
function showNodeDetail(panel, node) {
    const kind = node.data('kind');
    const rawId = node.data('rawId');
    const entry = lookupRawEntry(kind, rawId);

    panel.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'graph-detail-header';
    const kindLabel = document.createElement('span');
    kindLabel.className = 'graph-detail-kind';
    kindLabel.style.color = GRAPH_KIND_STYLE[kind]?.color ?? 'inherit';
    kindLabel.textContent = GRAPH_KIND_STYLE[kind]?.label ?? kind;
    header.appendChild(kindLabel);
    const title = document.createElement('h3');
    title.textContent = node.data('label');
    header.appendChild(title);
    const idLine = document.createElement('div');
    idLine.className = 'graph-detail-id';
    idLine.textContent = `id: ${rawId}`;
    header.appendChild(idLine);
    panel.appendChild(header);

    const tabId = GRAPH_KIND_TAB[kind];
    if (tabId) {
        const openBtn = document.createElement('button');
        openBtn.className = 'primary small';
        openBtn.textContent = `Open "${tabId}" tab to edit`;
        openBtn.onclick = () => {
            activeId = tabId;
            renderTabs();
            renderActiveTab();
        };
        panel.appendChild(openBtn);
    }

    const pre = document.createElement('pre');
    pre.className = 'graph-detail-json';
    pre.textContent = entry !== undefined
        ? JSON.stringify(entry, null, 2)
        : '(no data found for this node — it may only exist as an implied endpoint, e.g. a dropped resource with no entry of its own yet)';
    panel.appendChild(pre);
}

function clearNodeDetail(panel) {
    panel.innerHTML = '<p class="hint">Click a node to see its own setup here.</p>';
}

/** Wires up a drag handle between `canvas` and `panel` (siblings inside a flex row) to resize how much width the canvas gets, panel taking whatever's left — see this tab's own doc for why this matters more now that clicking a node opens a side panel competing for the same horizontal space. Purely a runtime flex-basis tweak, not persisted across reloads — cheap, and a designer resizing mid-session is the only case that matters. */
function setupGraphResizeHandle(handle, canvas) {
    let dragging = false;

    handle.addEventListener('mousedown', e => {
        dragging = true;
        e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
        if (!dragging) return;
        const wrapRect = canvas.parentElement.getBoundingClientRect();
        const newWidth = Math.min(Math.max(e.clientX - wrapRect.left, 240), wrapRect.width - 200);
        canvas.style.flex = `0 0 ${newWidth}px`;
        cy?.resize();
    });
    window.addEventListener('mouseup', () => {
        dragging = false;
    });
}

/**
 * Sets `splitRow`'s height to fill the rest of the viewport below wherever it actually landed
 * — the CSS-only guess this replaced (a fixed `calc(100vh - 220px)`) drifted out of sync with
 * reality any time the header/toolbar/legend's own real height changed, leaving the graph
 * looking cramped inside a mostly-empty page. Measuring `getBoundingClientRect().top` after
 * everything ABOVE it has actually been laid out is exact regardless of what's up there, and
 * re-running on window resize keeps it correct as the browser window itself changes size.
 * `visualViewport` (not just `window.innerHeight`) accounts for a virtual keyboard or mobile
 * browser chrome resizing the visible area without a real `resize` event on some devices —
 * harmless to prefer even on a desktop-only editor like this one.
 */
function sizeGraphSplitRowToViewport(splitRow) {
    const resize = () => {
        const top = splitRow.getBoundingClientRect().top;
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        splitRow.style.height = `${Math.max(viewportHeight - top - 16, 300)}px`;
        cy?.resize();
    };
    resize();

    // One listener per Graph-tab render (renderGraphTab() rebuilds the whole DOM subtree on
    // every switch back to this tab), removed the moment the element it's sizing is no longer
    // in the document — the next tab switch's own `contentEl.innerHTML = ''` detaches it, at
    // which point this stops adjusting anything and cleans itself up instead of accumulating a
    // new listener every single time this tab is opened.
    window.addEventListener('resize', function onResize() {
        if (!splitRow.isConnected) {
            window.removeEventListener('resize', onResize);
            return;
        }
        resize();
    });
}

/** The two sub-views this tab can show, keyed the same as activeGraphView. Each names its own element builder, layout tweaks (the Progression view's compound zone clusters need more horizontal room between ranks to stay readable), and the filename its Export JSON button writes. */
const GRAPH_VIEWS = {
    general: {
        label: 'General',
        buildElements: (data, iconByName) => buildGraphElements(data, iconByName),
        layout: { name: 'dagre', rankDir: 'LR', nodeSep: 30, rankSep: 90, animate: false },
        exportFilename: 'pizza-graph-general.json',
        emptyStatusSuffix: '',
    },
    progression: {
        label: 'Progression',
        buildElements: (data) => buildProgressionGraphElements(data),
        // `ranker: 'longest-path'` (dagre's own option, passed through as-is by cytoscape-dagre)
        // pushes every node as far left as its dependencies allow instead of network-simplex's
        // more "balanced" default assignment — combined with the sequenceGuide edges (see
        // buildProgressionGraphElements()'s own doc), this is what keeps zones in a clean
        // left-to-right row instead of a tangled web. Extra nodeSep/rankSep gives the compound
        // zone/tutorial boxes room to breathe without their borders touching.
        layout: { name: 'dagre', rankDir: 'LR', nodeSep: 50, rankSep: 160, ranker: 'longest-path', align: 'UL', animate: false },
        exportFilename: 'pizza-graph-progression.json',
        emptyStatusSuffix: ' — zones cluster their own gates/crafting/buildings/shops/queues (plus a nested "Tutorial" box for triggers); follow the bold orange path left-to-right to see what unlocks the next zone.',
    },
};

/** (Re)fetches every source tab and rebuilds the currently active view's graph from scratch — the Refresh button's whole job, also called once when the tab first opens or the sub-view is switched. Destroys any previous Cytoscape instance first; Cytoscape doesn't like being re-initialized onto the same container without that. */
async function refreshGraph(canvas, statusEl, panel) {
    const view = GRAPH_VIEWS[activeGraphView];
    statusEl.textContent = 'Loading…';
    try {
        const [data, { assets }] = await Promise.all([loadGraphData(), loadGraphImageAssets()]);
        lastGraphData = data;
        const iconByName = new Map(assets.map(a => [a.name, a.url]));
        const { nodes, edges } = view.buildElements(data, iconByName);
        lastGraphElements = { nodes, edges };

        cy?.destroy();
        cy = cytoscape({
            container: canvas,
            elements: [...nodes, ...edges],
            style: graphStylesheet(),
            layout: view.layout,
            wheelSensitivity: 0.2,
        });

        clearNodeDetail(panel);

        // Clicking a node highlights just its own direct inputs/outputs (one hop each way) —
        // dimming everything else, since the full graph is dense enough that "what feeds this,
        // what does this feed" is the actual question a designer clicking a node has — AND
        // shows that node's own raw setup in the side panel (see showNodeDetail()).
        cy.on('tap', 'node', evt => {
            const node = evt.target;
            const neighborhood = node.closedNeighborhood();
            cy.elements().not(neighborhood).addClass('graph-dimmed');
            neighborhood.removeClass('graph-dimmed');
            showNodeDetail(panel, node);
        });
        cy.on('tap', evt => {
            if (evt.target === cy) {
                cy.elements().removeClass('graph-dimmed');
                clearNodeDetail(panel);
            }
        });

        statusEl.textContent = `${nodes.length} nodes, ${edges.length} edges — click a node to highlight its own inputs/outputs and see its setup, click empty space to clear.${view.emptyStatusSuffix}`;
    } catch (err) {
        statusEl.textContent = `Failed to build graph: ${err.message}`;
    }
}

/** Entry point — called by app.js's renderActiveTab() whenever the Graph tab is active. Rebuilds its own DOM into `container` every time (cheap enough, and simplest way to guarantee no stale event handlers/detached Cytoscape instance survive a tab switch away and back). */
function renderGraphTab(container) {
    const subTabs = document.createElement('div');
    subTabs.className = 'graph-subtabs';
    container.appendChild(subTabs);

    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'primary';
    refreshBtn.textContent = 'Refresh';
    toolbar.appendChild(refreshBtn);

    const exportBtn = document.createElement('button');
    exportBtn.textContent = 'Export JSON';
    toolbar.appendChild(exportBtn);

    const status = document.createElement('span');
    status.className = 'status';
    toolbar.appendChild(status);
    container.appendChild(toolbar);

    container.appendChild(buildLegend());

    const splitRow = document.createElement('div');
    splitRow.className = 'graph-split-row';

    const canvas = document.createElement('div');
    canvas.className = 'graph-canvas';
    splitRow.appendChild(canvas);

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'graph-resize-handle';
    splitRow.appendChild(resizeHandle);

    const panel = document.createElement('div');
    panel.className = 'graph-detail-panel';
    clearNodeDetail(panel);
    splitRow.appendChild(panel);

    container.appendChild(splitRow);
    setupGraphResizeHandle(resizeHandle, canvas);
    sizeGraphSplitRowToViewport(splitRow);

    for (const [viewId, view] of Object.entries(GRAPH_VIEWS)) {
        const btn = document.createElement('button');
        btn.textContent = view.label;
        btn.className = viewId === activeGraphView ? 'active' : '';
        btn.onclick = () => {
            if (activeGraphView === viewId) return;
            activeGraphView = viewId;
            for (const child of subTabs.children) child.classList.toggle('active', child === btn);
            refreshGraph(canvas, status, panel);
        };
        subTabs.appendChild(btn);
    }

    refreshBtn.onclick = () => refreshGraph(canvas, status, panel);
    exportBtn.onclick = () => {
        if (!lastGraphElements) return;
        exportGraphElementsAsJson(lastGraphElements.nodes, lastGraphElements.edges, GRAPH_VIEWS[activeGraphView].exportFilename);
    };
    refreshGraph(canvas, status, panel);
}
