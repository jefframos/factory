// app.js
//
// Schema-driven form editor — see schemas.js for what each entity type's
// entries look like and which fields are dropdowns sourced from another
// tab's data. This file only knows how to walk a field-schema array and
// draw/bind widgets for it (renderFields() and friends below); it has no
// per-entity-type special casing beyond reading ENTITY_SCHEMAS[activeId].
//
// All of a tab's data lives in memory (`allData`) from the moment the page
// loads — switching tabs never loses edits, since nothing is re-fetched
// until the next full init() (page load or a server restart). Fields
// mutate their owning object directly on change; a tab's edits are only
// written to disk when its "Save changes" button is clicked (see
// persist()) — so a designer can freely poke around without every
// keystroke hitting the filesystem.

/** Sentinel activeId for the Graph tab (see renderTabs()/renderActiveTab()) — never a real manifest.json entry id, so it can't collide with one. */
const GRAPH_TAB_ID = '__graph__';
/** Sentinel activeId for the Map Suggestions tab (see renderTabs()/renderActiveTab()/renderMapSuggestionsTab()) — same "read-only, not a manifest entry" convention as GRAPH_TAB_ID. */
const MAP_SUGGESTIONS_TAB_ID = '__map_suggestions__';

let manifest = [];
let allData = {};
let activeId = null;
const dirtyTabs = new Set();
/** Last result from /api/validate-map, or null before the first check — see checkMap(). Cleared to null whenever a tab is saved, since a save can change whether an id matches the map and the stale result would be misleading until re-checked. */
let mapValidation = null;
/** Ground tile names resolvable off a "spawnerLayer" tilelayer on the real map (see tiledMap.mjs's readSpawnerTileTypes()) — fetched once at init/restart, backs the '$spawnerTileTypes' virtual select source (see getOptions()). */
let spawnerTileTypes = [];
/** Which spawner area the Dynamic Resources tab is currently filtered to — 'all' or one area name — see renderDynamicResourcesByArea(). Kept across re-renders of that tab (add/delete/save) but not reset on tab switch, since flipping back to this tab with the same filter still held is the expected behavior, not a surprise. */
let dynamicResourceAreaFilter = 'all';
/** Every "spawner"-type object's "id" custom property drawn on the map's mapSettings layer (e.g. "animalSpawner1" — see tiledMap.mjs's readSpawnerShapeIds()) — fetched once at init/restart, backs the '$spawnerShapeIds' virtual select source (see getOptions()) and the Shape Resources tab's own grouping (see renderShapeResourcesByArea()). */
let spawnerShapeIds = [];
/** Every zone actually painted on the map's "zones" tilelayer right now — `{ zones: [{zoneNumber, cellCount, minCol, maxCol, minRow, maxRow, cells}], error }` (see tiledMap.mjs's readZoneCells()). Fetched once at init/restart; backs the Zones tab's own map visualization AND its auto-discovery of which zoneNumbers need an entry (see renderZonesTab()). */
let zoneCells = { zones: [], error: null };
/** Which spawner shape the Shape Resources tab is currently filtered to — 'all' or one shapeId — same convention as dynamicResourceAreaFilter, see renderShapeResourcesByArea(). */
let shapeResourceAreaFilter = 'all';
/** Which ResourceConfig.category the Resources tab is currently filtered to — 'all', 'main', 'farm', or 'animal' — see renderResourcesByCategory(). Same "kept across re-renders, not reset on tab switch" convention as dynamicResourceAreaFilter. */
let resourceCategoryFilter = 'all';
/** The categorized model catalog from /api/models (see modelsCatalog.mjs) — `{ groups: [{ name, items: [{ key, id, path, fullPath, format }] }] }`. Fetched once at init/restart, same pattern as spawnerTileTypes: small enough to prefetch eagerly rather than lazy-load per field. */
let modelsCatalog = { groups: [], error: null };
/** The real map's own tile-grid dimensions (see /api/map-size, tiledMap.mjs's readMapSize()) — fetched once at init/restart, backs the Map Suggestions tab's own scaling of its archetype layouts (authored against a fixed reference grid, see MAP_SUGGESTION_REFERENCE_COLS/ROWS) to this map's actual size. */
let mapSize = { width: 0, height: 0, tileWidth: 0, tileHeight: 0, error: null };
/** Which Map Suggestions archetype is currently shown — persists across re-renders the same way dynamicResourceAreaFilter does, see renderMapSuggestionsTab(). */
let mapSuggestionArchetype = 'loop';
/** Re-rolled by the Map Suggestions tab's own "Shuffle" button — same seeded-jitter convention as MapLayoutSuggestionTool.ts (the in-game dev-GUI counterpart this tab mirrors), so a given seed always jitters the same way. */
let mapSuggestionSeed = 1;
/** Which zone key (if any) the Map Suggestions tab's legend/canvas currently has focused — see focusMapSuggestionZone(). */
let mapSuggestionFocusKey = null;

/** Cache-busting query value appended to every /tiled-asset/ image URL (see makeTileSwatch()) — the browser would otherwise keep serving a stale grounds.png/resources.png from cache after someone repaints the spritesheet on disk, since the URL itself never changes. Bumped on every init() (page load / server restart) and by the Map tab's own "Refresh images" button, so a designer who just re-exported the PNG can see it without a hard reload. */
let tileImageVersion = Date.now();

/** localStorage key for the "which section/item was open" UI state — see loadUiState()/saveUiState(). */
const UI_STATE_STORAGE_KEY = 'pizza-editor-ui-state';
/**
 * Which entry `<details>` card is expanded on each tab, keyed by tab id then by that entry's
 * own key/id (a queues tab's 'default' pseudo-entry and an array tab's numeric index both work
 * the same way here) — restored by renderEntryCard() below, populated from loadUiState() at
 * init() and kept live by each card's own 'toggle' listener. A tab this editor has never had a
 * card opened on simply has no entry here, which renderEntryCard() treats as "nothing open,"
 * not an error.
 */
let openEntryByTab = {};

const tabsEl = document.getElementById('tabs');
const contentEl = document.getElementById('content');
const sourceHintEl = document.getElementById('source-hint');

/** Reads the last-saved { activeId, openEntryByTab } — see saveUiState()'s own doc. Anything in it that no longer matches current data (a deleted tab/entry) is left for init()/renderEntryCard()'s own existence checks to silently fall back on, not handled here. */
function loadUiState() {
    try {
        return JSON.parse(localStorage.getItem(UI_STATE_STORAGE_KEY)) ?? {};
    } catch {
        return {};
    }
}

/** Persisted on every tab switch (renderTabs()'s button handlers) and every entry card open/close (renderEntryCard()'s 'toggle' listener) — restored by init()/renderEntryCard() so a page reload (or the editor server's own restart) lands back on the same section and, if it still exists, the same expanded entry. */
function saveUiState() {
    try {
        localStorage.setItem(UI_STATE_STORAGE_KEY, JSON.stringify({ activeId, openEntryByTab }));
    } catch {
        // Best-effort — a private window or a full storage quota just means state doesn't
        // persist across reload, not something worth surfacing as an error.
    }
}

async function fetchJson(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) {
        throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
    }
    return res.json();
}

async function init() {
    tileImageVersion = Date.now();
    manifest = await fetchJson('/api/manifest');
    allData = {};
    for (const entry of manifest) {
        allData[entry.id] = await fetchJson(`/api/data/${entry.id}`);
    }
    try {
        const result = await fetchJson('/api/spawner-tile-types');
        spawnerTileTypes = result.tileTypes ?? [];
    } catch {
        spawnerTileTypes = [];
    }
    try {
        const result = await fetchJson('/api/spawner-shape-ids');
        spawnerShapeIds = result.shapeIds ?? [];
    } catch {
        spawnerShapeIds = [];
    }
    try {
        zoneCells = await fetchJson('/api/zone-cells');
    } catch (err) {
        zoneCells = { zones: [], error: err.message };
    }
    try {
        modelsCatalog = await fetchJson('/api/models');
    } catch (err) {
        modelsCatalog = { groups: [], error: err.message };
    }
    try {
        mapSize = await fetchJson('/api/map-size');
    } catch (err) {
        mapSize = { width: 0, height: 0, tileWidth: 0, tileHeight: 0, error: err.message };
    }
    dirtyTabs.clear();

    // Restore the last-open section (and, per-tab, the last-open entry — see
    // renderEntryCard()) so a reload/restart lands back where the designer left off, same as
    // BuildingZone's own persisted-state instinct elsewhere in this codebase. `!activeId` skips
    // this on anything but a truly fresh load — a live re-init (server restart while a tab was
    // already active) keeps whatever's already selected in memory instead of overriding it.
    const savedUiState = loadUiState();
    openEntryByTab = savedUiState.openEntryByTab ?? {};
    if (!activeId) {
        activeId = savedUiState.activeId ?? null;
    }
    // Falls back to the first tab whenever the restored (or already-active) id no longer names
    // a real tab — e.g. the saved section was deleted, or this is the very first-ever load.
    if (!activeId || (activeId !== GRAPH_TAB_ID && activeId !== MAP_SUGGESTIONS_TAB_ID && !manifest.some(e => e.id === activeId))) {
        activeId = manifest[0]?.id ?? null;
    }
    renderTabs();
    renderActiveTab();
}

function renderTabs() {
    tabsEl.innerHTML = '';
    for (const entry of manifest) {
        const btn = document.createElement('button');
        btn.textContent = entry.label + (dirtyTabs.has(entry.id) ? ' •' : '');
        // manifest.json's own `group` field (world/farming/progression/economy/system) — purely
        // a visual grouping so a designer can tell at a glance which of the now 20+ tabs belong
        // together, no functional effect. See style.css's own `.tab-group-*` rules for the actual
        // color-per-group palette; a tab with no group (shouldn't happen, but harmless) just
        // renders unstyled.
        btn.className = [entry.id === activeId ? 'active' : '', entry.group ? `tab-group-${entry.group}` : ''].filter(Boolean).join(' ');

        const issues = mapValidation?.entities[entry.id];
        if (issues && (issues.missingOnMap.length > 0 || issues.missingInConfig.length > 0)) {
            const badge = document.createElement('span');
            badge.className = 'tab-badge';
            badge.textContent = issues.severity === 'error' ? '🔴' : issues.severity === 'warning' ? '🟠' : '🔵';
            btn.appendChild(badge);
        }

        btn.onclick = () => {
            activeId = entry.id;
            saveUiState();
            renderTabs();
            renderActiveTab();
        };
        tabsEl.appendChild(btn);
    }

    // The Graph tab (see graph/graph.js) is a read-only VISUALIZATION over the same data every
    // other tab edits, not a data-editing tab itself — deliberately NOT in manifest.json (which
    // is the registry of real id-keyed JSON-backed entity types syncToSource.mjs knows how to
    // write back to source). Appended after the data tabs, same active/click wiring, just with
    // its own sentinel id instead of a manifest entry.
    const graphBtn = document.createElement('button');
    graphBtn.textContent = 'Graph';
    graphBtn.className = activeId === GRAPH_TAB_ID ? 'active' : '';
    graphBtn.onclick = () => {
        activeId = GRAPH_TAB_ID;
        saveUiState();
        renderTabs();
        renderActiveTab();
    };
    tabsEl.appendChild(graphBtn);

    // Same "read-only visualization, not a manifest entry" convention as the Graph tab above —
    // see renderMapSuggestionsTab()'s own doc.
    const suggestionsBtn = document.createElement('button');
    suggestionsBtn.textContent = 'Map Suggestions';
    suggestionsBtn.className = activeId === MAP_SUGGESTIONS_TAB_ID ? 'active' : '';
    suggestionsBtn.onclick = () => {
        activeId = MAP_SUGGESTIONS_TAB_ID;
        saveUiState();
        renderTabs();
        renderActiveTab();
    };
    tabsEl.appendChild(suggestionsBtn);
}

async function checkMap() {
    const btn = document.getElementById('check-map-btn');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
        mapValidation = await fetchJson('/api/validate-map');
    } catch (err) {
        mapValidation = { mapError: err.message, entities: {} };
    }
    btn.disabled = false;
    btn.textContent = 'Check map';
    renderTabs();
    renderActiveTab();
}

/** Renders the current tab's map-validation banner, or nothing if no check has run yet or this tab isn't map-checked at all (resources/actions/items/tools/dynamicResourcePlacements have no Tiled placement concept — see validateMap.mjs's own doc). */
function renderMapBanner() {
    if (!mapValidation) return null;

    if (mapValidation.mapError) {
        const banner = document.createElement('div');
        banner.className = 'map-check-banner error';
        banner.innerHTML = `<span class="title">Couldn't read the Tiled map</span><span>${mapValidation.mapError}</span>`;
        return banner;
    }

    const issues = mapValidation.entities[activeId];
    if (!issues) return null;

    if (issues.missingOnMap.length === 0 && issues.missingInConfig.length === 0) {
        const banner = document.createElement('div');
        banner.className = 'map-check-banner ok';
        banner.textContent = '✓ Every id here matches an object on the Tiled map.';
        return banner;
    }

    const banner = document.createElement('div');
    banner.className = `map-check-banner ${issues.severity}`;

    if (issues.missingOnMap.length > 0) {
        const label = MISSING_ON_MAP_LABEL[activeId] ?? 'not found on the Tiled map';
        const block = document.createElement('div');
        block.innerHTML = `<span class="title">In this tab but ${label}:</span>`;
        const list = document.createElement('ul');
        for (const id of issues.missingOnMap) {
            const li = document.createElement('li');
            li.textContent = id;
            list.appendChild(li);
        }
        block.appendChild(list);
        banner.appendChild(block);
    }

    if (issues.missingInConfig.length > 0) {
        const block = document.createElement('div');
        block.innerHTML = '<span class="title">Drawn on the Tiled map but missing from this tab:</span>';
        const list = document.createElement('ul');
        for (const id of issues.missingInConfig) {
            const li = document.createElement('li');
            li.textContent = id + ' ';
            // Only offered for a tab this file actually knows how to blank-create into (see
            // createMissingMapEntry()'s own doc) — a tab this editor doesn't map-check at all
            // never reaches this branch in the first place (see validateMap.mjs's own
            // MAP_CHECKED_ENTITIES), so every id landing here always has a real create path.
            const createBtn = document.createElement('button');
            createBtn.className = 'small';
            createBtn.textContent = '+ Create';
            createBtn.title = `Add a blank entry for "${id}" so you can fill it in`;
            createBtn.onclick = () => createMissingMapEntry(id);
            li.appendChild(createBtn);
            list.appendChild(li);
        }
        block.appendChild(list);
        banner.appendChild(block);
    }

    return banner;
}

/** Which field on an ARRAY-shaped tab's entry holds the id validateMap.mjs cross-checks against the map (see that file's own `configIds` doc) — a record-shaped tab (gates/buildings/queues/shops/crafting) doesn't need this, since its own container key already IS that id. */
const MISSING_IN_CONFIG_ARRAY_FIELD = {
    shapeResourcePlacements: 'shapeId',
};

/**
 * "Drawn on the Tiled map but missing from this tab" convenience (see renderMapBanner()'s own
 * "+ Create" button) — adds a blank entry pre-filled with just enough to point at `id`, so a
 * designer can open it and fill in the rest instead of hand-typing the id via "+ Add item"/
 * "+ Add entry" (see onAddEntry(), whose "just an empty {}" convention this otherwise mirrors
 * exactly). Safe to call with a stale/already-created id — no-ops instead of creating a
 * duplicate.
 */
function createMissingMapEntry(id) {
    const manifestEntry = manifest.find(e => e.id === activeId);
    const data = allData[activeId];

    if (manifestEntry.shape === 'array') {
        const field = MISSING_IN_CONFIG_ARRAY_FIELD[activeId];
        if (field && data.some(item => item[field] === id)) {
            return;
        }
        data.push(field ? { [field]: id } : {});
    } else {
        const container = manifestEntry.shape === 'queues' ? data.byId : data;
        if (container[id] !== undefined) {
            return;
        }
        container[id] = {};
    }

    markDirty();
    // Optimistically drops this ONE id out of the still-showing missingInConfig list instead
    // of a full /api/validate-map round-trip — correct until the next explicit "Check map"
    // click re-validates for real, which is fine since nothing else about the check changed.
    const issues = mapValidation?.entities[activeId];
    if (issues) {
        issues.missingInConfig = issues.missingInConfig.filter(existingId => existingId !== id);
    }
    renderActiveTab();
}

/** Human-readable consequence of a "config id has no matching map object" mismatch — matches what PizzaScene actually does for each entity type (see validateMap.mjs's own doc), so the banner tells a designer what will really happen instead of just "mismatch." */
const MISSING_ON_MAP_LABEL = {
    gates: 'not on the map — will spawn at its hardcoded fallback position',
    buildings: 'not on the map — will spawn at its hardcoded fallback position',
    queues: 'not on the map — this queue config will never be used',
    shops: 'not on the map — PizzaScene will skip spawning this shop entirely',
    crafting: 'not on the map — PizzaScene will skip spawning this craft table entirely',
};

function markDirty() {
    dirtyTabs.add(activeId);
    renderTabs();
    updateStatus();
}

function updateStatus() {
    const status = document.getElementById('save-status');
    if (!status) return;
    if (dirtyTabs.has(activeId)) {
        status.className = 'status error';
        status.textContent = 'Unsaved changes';
    } else {
        status.className = 'status ok';
        status.textContent = 'Saved';
    }
}

async function persist(tabId) {
    try {
        const result = await fetchJson(`/api/data/${tabId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(allData[tabId]),
        });
        dirtyTabs.delete(tabId);
        // A saved id might now match (or no longer match) something on the map — the last
        // check is stale the moment any tab's ids could have changed, so drop it rather than
        // show a banner that no longer reflects what's actually on disk.
        mapValidation = null;
        // Saving mapTiles regenerates grounds.png/resources.png server-side (see
        // server.mjs's PUT handler) — bump the cache-busting version and rebuild the tab so the
        // swatches actually show the new file instead of the browser's cached copy of the old
        // one. Without this, "Save" looks like it did nothing until a manual "Refresh images"
        // click or a hard reload. Must happen BEFORE re-reading #save-status below — rebuilding
        // the tab tears down and recreates that element, so grabbing it any earlier would leave
        // the status message written onto a detached, invisible node.
        if (tabId === 'mapTiles') {
            tileImageVersion = Date.now();
            renderActiveTab();
        }
        renderTabs();
        const status = document.getElementById('save-status');
        if (status) {
            if (result.warning) {
                status.className = 'status error';
                status.textContent = result.warning;
            } else if (result.warnings?.length > 0) {
                status.className = 'status error';
                status.textContent = `Saved, but: ${result.warnings.join('; ')}`;
            } else if (result.syncedToSource) {
                status.className = 'status ok';
                status.textContent = 'Saved — written to the game\'s source file.';
            } else {
                status.className = 'status ok';
                status.textContent = 'Saved (no source file for this tab — reference list only).';
            }
        }
    } catch (err) {
        const status = document.getElementById('save-status');
        if (status) {
            status.className = 'status error';
            status.textContent = `Save failed: ${err.message}`;
        }
    }
}

// ---------------------------------------------------------------------------
// Tab / entry-list rendering
// ---------------------------------------------------------------------------

function renderActiveTab() {
    contentEl.innerHTML = '';
    contentEl.classList.toggle('graph-tab-active', activeId === GRAPH_TAB_ID);
    if (!activeId) return;

    if (activeId === GRAPH_TAB_ID) {
        sourceHintEl.textContent = 'A read-only visualization — see the source of any node\'s own data on its own tab to edit it.';
        renderGraphTab(contentEl);
        return;
    }

    if (activeId === MAP_SUGGESTIONS_TAB_ID) {
        sourceHintEl.textContent = 'A design sketch, not real data — nothing here writes to the map or any tab. Move real zones/objects in Tiled to match.';
        renderMapSuggestionsTab(contentEl);
        return;
    }

    const manifestEntry = manifest.find(e => e.id === activeId);
    sourceHintEl.textContent = manifestEntry?.sourceHint
        ? `source: ${manifestEntry.sourceHint}`
        : '';

    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';

    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.gap = '8px';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'primary';
    saveBtn.textContent = 'Save changes';
    saveBtn.onclick = () => persist(activeId);
    left.appendChild(saveBtn);

    if (manifestEntry.shape !== 'mapTiles' && manifestEntry.shape !== 'zones') {
        // mapTiles has its own per-section "+ Add ground/resource tile" buttons (see
        // renderMapTilesTab()) since it holds two independent lists, not one — a single
        // toolbar-level "+ Add entry" wouldn't know which list to add to. zones has NO add
        // button at all — every entry is auto-discovered from the map's own "zones" tilelayer
        // (see renderZonesTab()), never hand-typed.
        const addBtn = document.createElement('button');
        addBtn.textContent = manifestEntry.shape === 'array' ? '+ Add item' : '+ Add entry';
        addBtn.onclick = onAddEntry;
        left.appendChild(addBtn);
    }

    toolbar.appendChild(left);
    const status = document.createElement('span');
    status.className = 'status';
    status.id = 'save-status';
    toolbar.appendChild(status);
    contentEl.appendChild(toolbar);
    updateStatus();

    const mapBanner = renderMapBanner();
    if (mapBanner) contentEl.appendChild(mapBanner);

    const data = allData[activeId];
    const schema = ENTITY_SCHEMAS[activeId] ?? [];
    const missingOnMap = new Set(mapValidation?.entities[activeId]?.missingOnMap ?? []);

    if (manifestEntry.shape === 'queues') {
        // farms carries a THIRD, independent single-object export (FARM_TILE_CONFIG — the
        // empty/prepared tile pair every plot shares, see FarmTypes.ts's own doc) alongside the
        // usual default/byId pair — rendered here as its own card, above both, since it isn't
        // per-plot at all and has no schema in common with the price/appearRequirement/solid
        // fields the entry cards below edit.
        if (data.tiles) {
            contentEl.appendChild(sectionLabel('Tile Settings — shared by every farm plot, not per-plot'));
            contentEl.appendChild(renderEntryCard(null, 'tiles', data.tiles, ENTITY_SCHEMAS.farmTiles ?? [], false, false, missingOnMap, 'Tile Settings'));
        }
        contentEl.appendChild(sectionLabel(`Default — used by any ${activeId === 'farms' ? 'plot' : 'queue'} placed on the map with no id-specific override below`));
        contentEl.appendChild(renderEntryCard(null, 'default', data.default, schema, false, false, missingOnMap));
        contentEl.appendChild(sectionLabel(`By ${activeId === 'farms' ? 'plot' : 'queue'} id — only takes effect for a${activeId === 'farms' ? ' plot' : ' queue'} object on the Tiled map with a matching id`));
        for (const [id, value] of Object.entries(data.byId ?? {})) {
            contentEl.appendChild(renderEntryCard(data.byId, id, value, schema, true, true, missingOnMap));
        }
        return;
    }

    if (activeId === 'dynamicResourcePlacements') {
        renderDynamicResourcesByArea(data, schema);
        return;
    }

    if (activeId === 'shapeResourcePlacements') {
        renderShapeResourcesByArea(data, schema);
        return;
    }

    if (activeId === 'resources') {
        renderResourcesByCategory(data, schema, missingOnMap);
        return;
    }

    if (manifestEntry.shape === 'mapTiles') {
        renderMapTilesTab(data);
        return;
    }

    if (manifestEntry.shape === 'zones') {
        renderZonesTab(data, schema);
        return;
    }

    if (manifestEntry.shape === 'array') {
        data.forEach((value, index) => {
            contentEl.appendChild(renderEntryCard(data, index, value, schema, true, false, missingOnMap));
        });
        return;
    }

    for (const [id, value] of Object.entries(data)) {
        contentEl.appendChild(renderEntryCard(data, id, value, schema, true, true, missingOnMap));
    }
}

/**
 * Dynamic Resources gets its own rendering instead of the generic array
 * list — a plain flat list of placements answers "what does this ONE
 * placement do," but the actual question a designer has is "what spawns
 * in area X" (e.g. everything scattered across "grass"), which means
 * grouping by `spawnerTileType` and letting a filter narrow to one area at
 * a time. Grouping alone (no filter) already answers the question; the
 * filter just cuts the noise once there are many areas.
 */
function renderDynamicResourcesByArea(data, schema) {
    const areaNames = [...new Set(data.map(v => v.spawnerTileType).filter(Boolean))].sort();

    const filterRow = document.createElement('div');
    filterRow.className = 'field-row';
    const label = document.createElement('label');
    label.textContent = 'Filter by area';
    filterRow.appendChild(label);
    const control = document.createElement('div');
    control.className = 'field-control';
    const select = document.createElement('select');
    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = `All areas (${areaNames.length})`;
    select.appendChild(allOpt);
    for (const name of areaNames) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
    }
    if (dynamicResourceAreaFilter !== 'all' && !areaNames.includes(dynamicResourceAreaFilter)) {
        dynamicResourceAreaFilter = 'all';
    }
    select.value = dynamicResourceAreaFilter;
    select.onchange = () => {
        dynamicResourceAreaFilter = select.value;
        renderActiveTab();
    };
    control.appendChild(select);
    filterRow.appendChild(control);
    contentEl.appendChild(filterRow);

    const groups = new Map();
    data.forEach((value, index) => {
        const area = value.spawnerTileType || '(no area set)';
        (groups.get(area) ?? groups.set(area, []).get(area)).push({ value, index });
    });

    const areasToShow = dynamicResourceAreaFilter === 'all' ? [...groups.keys()].sort() : [dynamicResourceAreaFilter];

    if (areasToShow.every(area => !groups.has(area))) {
        contentEl.appendChild(sectionLabel('No dynamic resource placements for this area yet.'));
        return;
    }

    // Either half of a placement's identity — its resourceType (Spawn Type = Resource, the
    // default) or its providerType (Spawn Type = Provider) — see DynamicResourceTypes.ts's
    // own doc on why only one of the two ever actually applies. Same helper
    // renderShapeResourcesByArea() below uses for its own resource/animal/provider split.
    const identityOf = value => (value.spawnType ?? 'resource') === 'provider' ? value.providerType : value.resourceType;

    for (const area of areasToShow) {
        const items = groups.get(area);
        if (!items) continue;
        const resourceList = items.map(i => identityOf(i.value)).filter(Boolean).join(', ') || '(nothing set)';
        contentEl.appendChild(sectionLabel(`${area} — ${items.length} placement${items.length === 1 ? '' : 's'}: ${resourceList}`));
        for (const { value, index } of items) {
            const identity = identityOf(value);
            const entryLabel = identity ? `${identity} → ${area}` : undefined;
            contentEl.appendChild(renderEntryCard(data, index, value, schema, true, false, new Set(), entryLabel));
        }
    }
}

/**
 * Shape Resources gets the same by-area grouping as Dynamic Resources above (see
 * renderDynamicResourcesByArea()'s own doc for the full reasoning) — just grouped by
 * `shapeId` (a "spawner"-type object's id on the map) instead of `spawnerTileType`.
 */
function renderShapeResourcesByArea(data, schema) {
    const areaNames = [...new Set(data.map(v => v.shapeId).filter(Boolean))].sort();

    const filterRow = document.createElement('div');
    filterRow.className = 'field-row';
    const label = document.createElement('label');
    label.textContent = 'Filter by spawner shape';
    filterRow.appendChild(label);
    const control = document.createElement('div');
    control.className = 'field-control';
    const select = document.createElement('select');
    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = `All shapes (${areaNames.length})`;
    select.appendChild(allOpt);
    for (const name of areaNames) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
    }
    if (shapeResourceAreaFilter !== 'all' && !areaNames.includes(shapeResourceAreaFilter)) {
        shapeResourceAreaFilter = 'all';
    }
    select.value = shapeResourceAreaFilter;
    select.onchange = () => {
        shapeResourceAreaFilter = select.value;
        renderActiveTab();
    };
    control.appendChild(select);
    filterRow.appendChild(control);
    contentEl.appendChild(filterRow);

    const groups = new Map();
    data.forEach((value, index) => {
        const area = value.shapeId || '(no shape set)';
        (groups.get(area) ?? groups.set(area, []).get(area)).push({ value, index });
    });

    const areasToShow = shapeResourceAreaFilter === 'all' ? [...groups.keys()].sort() : [shapeResourceAreaFilter];

    if (areasToShow.every(area => !groups.has(area))) {
        contentEl.appendChild(sectionLabel('No shape resource placements for this spawner yet.'));
        return;
    }

    for (const area of areasToShow) {
        const items = groups.get(area);
        if (!items) continue;
        // Either half of a placement's identity — its resourceType (Spawn Type = Resource,
        // the default), its animalType (Spawn Type = Animal), or its providerType (Spawn Type
        // = Provider) — see ShapeResourceTypes.ts's own doc on why only one ever applies.
        const identityOf = value => value.spawnType === 'animal' ? value.animalType : value.spawnType === 'provider' ? value.providerType : value.resourceType;
        const itemList = items.map(i => identityOf(i.value)).filter(Boolean).join(', ') || '(nothing set)';
        contentEl.appendChild(sectionLabel(`${area} — ${items.length} placement${items.length === 1 ? '' : 's'}: ${itemList}`));
        for (const { value, index } of items) {
            const identity = identityOf(value);
            const entryLabel = identity ? `${identity} → ${area}` : undefined;
            contentEl.appendChild(renderEntryCard(data, index, value, schema, true, false, new Set(), entryLabel));
        }
    }
}

/**
 * Resources gets a category filter (All / Main / Farm / Animal — see ResourceConfig.category's
 * own doc) instead of a plain flat list — this enum has grown from a handful of true
 * gatherable resources into a mix of main-HUD resources, crop harvest yields, and
 * animal-catch payouts, and a flat A-Z list makes those hard to tell apart at a glance. Same
 * filter-dropdown shape renderDynamicResourcesByArea()/renderShapeResourcesByArea() already
 * use, just filtering by `category` instead of by map area.
 */
function renderResourcesByCategory(data, schema, missingOnMap) {
    const CATEGORY_LABELS = { main: 'Main', farm: 'Farm', animal: 'Animal' };
    const ids = Object.keys(data);

    const filterRow = document.createElement('div');
    filterRow.className = 'field-row';
    const label = document.createElement('label');
    label.textContent = 'Filter by category';
    filterRow.appendChild(label);
    const control = document.createElement('div');
    control.className = 'field-control';
    const select = document.createElement('select');
    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = `All (${ids.length})`;
    select.appendChild(allOpt);
    for (const [value, categoryLabel] of Object.entries(CATEGORY_LABELS)) {
        const count = ids.filter(id => (data[id].category || 'main') === value).length;
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = `${categoryLabel} (${count})`;
        select.appendChild(opt);
    }
    select.value = resourceCategoryFilter;
    select.onchange = () => {
        resourceCategoryFilter = select.value;
        renderActiveTab();
    };
    control.appendChild(select);
    filterRow.appendChild(control);
    contentEl.appendChild(filterRow);

    // Unset on an entry means 'main' — same default ResourceConfig.category's own doc
    // describes at runtime (undefined = shown on the main-screen panels).
    const idsToShow = ids.filter(id => resourceCategoryFilter === 'all' || (data[id].category || 'main') === resourceCategoryFilter);

    if (idsToShow.length === 0) {
        contentEl.appendChild(sectionLabel('No resources in this category yet.'));
        return;
    }

    for (const id of idsToShow) {
        contentEl.appendChild(renderEntryCard(data, id, data[id], schema, true, true, missingOnMap));
    }
}

/**
 * The Map tab — a lookup table of every tile registered in map/tiles.json, each row showing
 * the actual sprite it crops from games/pizza/tiled/grounds.png or resources.png (served by
 * server.mjs's /tiled-asset/ route) next to its editable name/color, so a designer can see what
 * they're painting in Tiled without alt-tabbing to check a hex color against a filled square.
 * Resources additionally get a "Provider" dropdown (sourced from the Providers tab) — this is
 * the actual "which tile spawns which tree" assignment TileMapConfig.ts's
 * buildResourceSpawnsFromTileMap() reads (see this tab's manifest sourceHint).
 */
function renderMapTilesTab(data) {
    data.tileSize = data.tileSize ?? 32;

    const sizeRow = fieldRow('Tile size (px)');
    const sizeInput = document.createElement('input');
    sizeInput.type = 'number';
    sizeInput.value = data.tileSize;
    sizeInput.oninput = () => {
        data.tileSize = Number(sizeInput.value) || 32;
        markDirty();
        renderActiveTab();
    };
    sizeRow.control.appendChild(sizeInput);
    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'small';
    refreshBtn.textContent = '↻ Refresh images';
    refreshBtn.title = 'Re-fetch grounds.png/resources.png from disk — use this after repainting a tile in the spritesheet itself';
    refreshBtn.onclick = () => {
        tileImageVersion = Date.now();
        renderActiveTab();
    };
    sizeRow.control.appendChild(refreshBtn);
    contentEl.appendChild(sizeRow.row);

    const numbersRow = fieldRow('Bake tile numbers onto the exported images');
    const numbersToggle = document.createElement('input');
    numbersToggle.type = 'checkbox';
    numbersToggle.checked = !!data.showTileNumbers;
    numbersToggle.title = 'Regenerates grounds.png/resources.png with each tile\'s id printed on its square — save to apply';
    numbersToggle.onchange = () => {
        data.showTileNumbers = numbersToggle.checked;
        markDirty();
    };
    numbersRow.control.appendChild(numbersToggle);
    contentEl.appendChild(numbersRow.row);

    // Ground tiles predating the `walkable` field have no such key yet — treat them as
    // walkable (matches isGroundWalkable()'s own undefined-is-walkable default) so the
    // checkbox doesn't show every pre-existing tile as blocked.
    data.grounds.forEach(tile => { tile.walkable = tile.walkable ?? true; });

    contentEl.appendChild(sectionLabel('Grounds — base terrain painted on groundLayer'));
    contentEl.appendChild(renderTileList(data.grounds, '/tiled-asset/grounds.png', data.tileSize, MAP_TILE_FIELDS.groundFields, 'ground tile'));

    contentEl.appendChild(sectionLabel('Resources — gatherable tiles painted on resourcesLayer; assign a Provider to make one spawnable'));
    contentEl.appendChild(renderTileList(data.resources, '/tiled-asset/resources.png', data.tileSize, MAP_TILE_FIELDS.resourceFields, 'resource tile'));
}

/** Distinct-enough colors, cycled by zoneNumber % length — see drawZoneCanvas(). Not sourced from any tile's own color (zones aren't a visible tileset, just markers), so this is its own small fixed palette. */
const ZONE_COLORS = ['#e05252', '#4fa8e0', '#4fd18a', '#e0b34f', '#a06be0', '#e06bb0', '#6be0d1', '#c9e04f'];

/** World-of-tiles preview — one small colored square per painted "zones" cell, laid out at the SAME relative col/row positions the real map uses (so the shape a designer painted in Tiled is recognizable here), scaled to fit within `maxPx` on its longer side. Purely a visual index into "where is zone N" — not an editable canvas; clicking a zone still means scrolling to its entry card below. */
function drawZoneCanvas(zones, maxPx) {
    const canvas = document.createElement('canvas');
    if (zones.length === 0) {
        canvas.width = 1;
        canvas.height = 1;
        return canvas;
    }

    const minCol = Math.min(...zones.map(z => z.minCol));
    const maxCol = Math.max(...zones.map(z => z.maxCol));
    const minRow = Math.min(...zones.map(z => z.minRow));
    const maxRow = Math.max(...zones.map(z => z.maxRow));
    const cols = maxCol - minCol + 1;
    const rows = maxRow - minRow + 1;
    const cellPx = Math.max(1, Math.floor(maxPx / Math.max(cols, rows)));

    canvas.width = cols * cellPx;
    canvas.height = rows * cellPx;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    zones.forEach((zone, i) => {
        ctx.fillStyle = ZONE_COLORS[zone.zoneNumber % ZONE_COLORS.length];
        for (const cell of zone.cells) {
            ctx.fillRect((cell.col - minCol) * cellPx, (cell.row - minRow) * cellPx, cellPx, cellPx);
        }
    });

    return canvas;
}

/**
 * Grid coordinates below are authored against this fixed reference grid, matching
 * MapLayoutSuggestionTool.ts (the in-game `?dev` dat.GUI counterpart to this tab — same three
 * archetypes, same jitter rule) so a designer sees the identical layout here and in-engine.
 * Deliberately NOT rescaled to this particular map's real width/height (see
 * renderMapSuggestionsTab()) — rescaling would distort the hand-tuned proportions between
 * zones; instead the real map's own bounds are drawn as an outline INSIDE this same reference
 * grid, so a designer can see at a glance whether their map is bigger or smaller than what an
 * archetype assumes.
 */
const MAP_SUGGESTION_REFERENCE_COLS = 30;
const MAP_SUGGESTION_REFERENCE_ROWS = 18;

const MAP_SUGGESTION_ZONE_COLOR = {
    spawn: '#e8e8ea',
    hub: '#c99a6c',
    shop: '#ff7a52',
    mart: '#f0ae52',
    farm: '#6fc298',
    craft: '#7db3d8',
    queue: '#c07eb0',
    gate: '#e5484d',
    wall: '#8b9382',
};

const MAP_SUGGESTION_ZONE_LABEL = {
    spawn: 'Spawn',
    hub: 'Hub / Building',
    shop: 'Tool Shop',
    mart: 'Mart',
    farm: 'Farm Zone',
    craft: 'Craft Tables',
    queue: 'Quest Queue',
    gate: 'Gate',
    wall: 'Castle Wall',
};

const MAP_SUGGESTION_ZONE_DESC = {
    spawn: 'Where the player enters each session — everything reachable from here in the first look matters most.',
    hub: 'The leveled main building. The session\'s long-term anchor.',
    shop: 'Buys tool levels with Money on a geometric cost curve — the fast, cheap "one more upgrade" loop.',
    mart: 'Secondary trade point — best used as the sink for a second currency once one exists.',
    farm: 'Plantable crop plots that tick over time — the natural home for offline/idle accrual.',
    craft: 'Turns raw resources into tools and items. A starter table doubles as the onboarding beat.',
    queue: 'Delivery tasks, flat Money reward. Space these along natural walking paths, not clustered.',
    gate: 'A requirement-gated blocker — plays an unlock sequence once its condition is met, then opens permanently.',
    wall: 'Decorative perimeter dressing (the corner-tower / wall-half kit) — reads as a boundary, not a system.',
};

/** Three hand-tuned stances, not a random scatter — "Shuffle" only jitters positions WITHIN whichever archetype is selected, see renderMapSuggestionsTab(). Kept in exact sync with games/pizza/game/debug/MapLayoutSuggestionTool.ts. */
const MAP_SUGGESTION_ARCHETYPES = {
    loop: {
        label: 'Compact Loop',
        blurb: 'Everything inside a two-minute walk of spawn — fast pick, quickly hooked.',
        zones: [
            { key: 'spawn', col: 14, row: 10, w: 1, h: 1 },
            { key: 'hub', col: 12, row: 6, w: 4, h: 4 },
            { key: 'shop', col: 17, row: 7, w: 2, h: 2 },
            { key: 'mart', col: 17, row: 11, w: 2, h: 2 },
            { key: 'craft', col: 9, row: 11, w: 3, h: 2 },
            { key: 'farm', col: 8, row: 2, w: 6, h: 4 },
            { key: 'queue', col: 19, row: 5, w: 1, h: 1, n: 1 },
            { key: 'queue', col: 19, row: 14, w: 1, h: 1, n: 2 },
            { key: 'queue', col: 6, row: 9, w: 1, h: 1, n: 3 },
            { key: 'gate', col: 24, row: 10, w: 1, h: 2 },
        ],
        path: ['spawn', 'hub', 'shop', 'mart', 'craft', 'farm'],
    },
    ring: {
        label: 'Ring Around the Keep',
        blurb: 'Wall + gates do real RequirementRegistry work; farm sits outside the walls.',
        zones: [
            { key: 'wall', col: 9, row: 4, w: 12, h: 10 },
            { key: 'spawn', col: 14, row: 13, w: 1, h: 1 },
            { key: 'hub', col: 11, row: 6, w: 5, h: 5 },
            { key: 'shop', col: 17, row: 6, w: 2, h: 2 },
            { key: 'mart', col: 8, row: 10, w: 2, h: 2 },
            { key: 'craft', col: 17, row: 10, w: 2, h: 2 },
            { key: 'gate', col: 13, row: 4, w: 2, h: 1 },
            { key: 'gate', col: 20, row: 8, w: 1, h: 2 },
            { key: 'farm', col: 1, row: 12, w: 6, h: 5 },
            { key: 'queue', col: 14, row: 1, w: 1, h: 1, n: 1 },
            { key: 'queue', col: 23, row: 8, w: 1, h: 1, n: 2 },
        ],
        path: ['spawn', 'hub', 'shop', 'craft', 'mart'],
    },
    valley: {
        label: 'Sprawling Valley',
        blurb: 'Spawn to a far gate, left to right — built for longer sessions / prestige.',
        zones: [
            { key: 'spawn', col: 2, row: 9, w: 1, h: 1 },
            { key: 'queue', col: 5, row: 9, w: 1, h: 1, n: 1 },
            { key: 'shop', col: 8, row: 6, w: 2, h: 2 },
            { key: 'craft', col: 8, row: 11, w: 2, h: 2 },
            { key: 'hub', col: 12, row: 6, w: 4, h: 4 },
            { key: 'mart', col: 18, row: 9, w: 2, h: 2 },
            { key: 'farm', col: 22, row: 4, w: 6, h: 5 },
            { key: 'queue', col: 21, row: 12, w: 1, h: 1, n: 2 },
            { key: 'gate', col: 28, row: 8, w: 1, h: 2 },
        ],
        path: ['spawn', 'queue1', 'shop', 'craft', 'hub', 'mart', 'farm'],
    },
};

/** mulberry32 — deterministic per seed, so "Shuffle" is a reproducible variant, not just noise. */
function mapSuggestionRng(seed) {
    let a = seed;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Applies this seed's jitter to an archetype's zones — wall/gate keep their exact authored position (jittering a gate could open it into open air), every other zone gets a small nudge. */
function jitterMapSuggestionZones(archetype, seed) {
    const rand = mapSuggestionRng(seed * 977);
    return archetype.zones.map(z => {
        const amount = z.key === 'wall' || z.key === 'gate' ? 0 : 1;
        const jitter = () => Math.round((rand() - 0.5) * 2 * amount);
        return { ...z, col: z.col + jitter(), row: z.row + jitter() };
    });
}

function mapSuggestionZoneAt(zones, ref) {
    const match = ref.match(/\d+$/);
    const n = match ? Number(match[0]) : undefined;
    const key = ref.replace(/\d+$/, '');
    return zones.find(z => z.key === key && (n === undefined ? z.n === undefined : z.n === n));
}

/** Draws one archetype (at `seed`'s jitter) plus the real map's own bounds outline — canvas pixel size fits `maxPx` on the reference grid's longer side, same "fit to frame" convention drawZoneCanvas() uses for the Zones tab. `focusKey` (if any) gets a brighter fill + white outline so clicking a zone/legend row is visible on the canvas itself. */
function drawMapSuggestionCanvas(archetype, seed, focusKey, maxPx) {
    const cols = MAP_SUGGESTION_REFERENCE_COLS;
    const rows = MAP_SUGGESTION_REFERENCE_ROWS;
    const cellPx = Math.max(4, Math.floor(maxPx / Math.max(cols, rows)));

    const canvas = document.createElement('canvas');
    canvas.width = cols * cellPx;
    canvas.height = rows * cellPx;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#14151a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#26272c';
    ctx.lineWidth = 1;
    for (let c = 0; c <= cols; c++) { ctx.beginPath(); ctx.moveTo(c * cellPx, 0); ctx.lineTo(c * cellPx, canvas.height); ctx.stroke(); }
    for (let r = 0; r <= rows; r++) { ctx.beginPath(); ctx.moveTo(0, r * cellPx); ctx.lineTo(canvas.width, r * cellPx); ctx.stroke(); }

    // The real map's own bounds, drawn inside the same reference grid — see this file's own
    // doc on why the archetype itself is never rescaled to match.
    if (!mapSize.error && mapSize.width > 0 && mapSize.height > 0) {
        ctx.strokeStyle = '#5b8def';
        ctx.setLineDash([cellPx * 0.4, cellPx * 0.25]);
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, Math.min(mapSize.width, cols * 4) * cellPx, Math.min(mapSize.height, rows * 4) * cellPx);
        ctx.setLineDash([]);
    }

    const zones = jitterMapSuggestionZones(archetype, seed);
    const centerOf = z => ({ x: (z.col + z.w / 2) * cellPx, y: (z.row + z.h / 2) * cellPx });

    const wall = zones.find(z => z.key === 'wall');
    if (wall) {
        ctx.strokeStyle = MAP_SUGGESTION_ZONE_COLOR.wall;
        ctx.lineWidth = Math.max(3, cellPx * 0.22);
        ctx.setLineDash([cellPx * 0.5, cellPx * 0.28]);
        ctx.strokeRect(wall.col * cellPx, wall.row * cellPx, wall.w * cellPx, wall.h * cellPx);
        ctx.setLineDash([]);
    }

    let prev = mapSuggestionZoneAt(zones, 'spawn');
    ctx.strokeStyle = '#e8e8ea';
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = Math.max(1.5, cellPx * 0.06);
    ctx.setLineDash([cellPx * 0.18, cellPx * 0.22]);
    for (const ref of archetype.path.slice(1)) {
        const next = mapSuggestionZoneAt(zones, ref);
        if (prev && next) {
            const p1 = centerOf(prev), p2 = centerOf(next);
            ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        }
        prev = next ?? prev;
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    for (const zone of zones) {
        if (zone.key === 'wall') continue;
        const color = MAP_SUGGESTION_ZONE_COLOR[zone.key];
        const focused = focusKey === zone.key;
        const x = zone.col * cellPx, y = zone.row * cellPx, w = zone.w * cellPx, h = zone.h * cellPx;

        if (zone.key === 'spawn') {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y + h / 2); ctx.lineTo(x + w / 2, y + h); ctx.lineTo(x, y + h / 2);
            ctx.closePath();
            ctx.fill();
            continue;
        }

        ctx.globalAlpha = focused ? 1 : 0.85;
        ctx.fillStyle = color;
        ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
        ctx.globalAlpha = 1;
        if (focused) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
        }

        if (w >= cellPx * 1.5 && zone.key !== 'gate') {
            ctx.fillStyle = '#14151a';
            ctx.font = `bold ${Math.max(9, Math.floor(cellPx * 0.32))}px monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText((zone.key + (zone.n ?? '')).toUpperCase(), x + w / 2, y + h / 2);
        }
    }

    canvas.__zones = zones;
    canvas.__cellPx = cellPx;
    return canvas;
}

/**
 * The Map Suggestions tab — a read-only design sketch, same "not a manifest entry" convention
 * as the Graph tab. Draws the same three hand-tuned zone-layout archetypes
 * games/pizza/game/debug/MapLayoutSuggestionTool.ts overlays live in-engine (behind `?dev`'s
 * dat.GUI), here as a canvas the designer can browse without launching the game — pick an
 * archetype, Shuffle for a jittered variant, click a zone (on the canvas or in the legend) to
 * read what real system it maps to. Nothing here writes to any tab or the map file.
 */
function renderMapSuggestionsTab(container) {
    const archKey = mapSuggestionArchetype;
    const archetype = MAP_SUGGESTION_ARCHETYPES[archKey];

    const subtabs = document.createElement('div');
    subtabs.className = 'graph-subtabs';
    for (const key of Object.keys(MAP_SUGGESTION_ARCHETYPES)) {
        const btn = document.createElement('button');
        btn.textContent = MAP_SUGGESTION_ARCHETYPES[key].label;
        btn.className = key === archKey ? 'active' : '';
        btn.onclick = () => {
            mapSuggestionArchetype = key;
            mapSuggestionSeed = 1;
            mapSuggestionFocusKey = null;
            renderActiveTab();
        };
        subtabs.appendChild(btn);
    }
    container.appendChild(subtabs);

    if (mapSize.error) {
        container.appendChild(sectionLabel(`Couldn't read the map's own size, showing suggestions with no bounds overlay: ${mapSize.error}`));
    }

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '18px';
    row.style.alignItems = 'flex-start';
    row.style.flexWrap = 'wrap';

    const canvasCol = document.createElement('div');
    const canvas = drawMapSuggestionCanvas(archetype, mapSuggestionSeed, mapSuggestionFocusKey, 520);
    canvas.style.borderRadius = '6px';
    canvas.style.cursor = 'pointer';
    canvas.onclick = (e) => {
        const rect = canvas.getBoundingClientRect();
        const scale = canvas.width / rect.width;
        const gx = ((e.clientX - rect.left) * scale) / canvas.__cellPx;
        const gy = ((e.clientY - rect.top) * scale) / canvas.__cellPx;
        const hit = [...canvas.__zones].reverse().find(z => z.key !== 'wall' && gx >= z.col && gx <= z.col + z.w && gy >= z.row && gy <= z.row + z.h);
        if (hit) {
            mapSuggestionFocusKey = hit.key;
            renderActiveTab();
        }
    };
    canvasCol.appendChild(canvas);

    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.gap = '10px';
    controls.style.marginTop = '10px';
    controls.style.alignItems = 'center';

    const shuffleBtn = document.createElement('button');
    shuffleBtn.className = 'primary';
    shuffleBtn.textContent = 'Shuffle this layout';
    shuffleBtn.onclick = () => {
        mapSuggestionSeed += 1;
        renderActiveTab();
    };
    controls.appendChild(shuffleBtn);

    const seedTag = document.createElement('span');
    seedTag.className = 'hint';
    seedTag.textContent = `seed ${mapSuggestionSeed}${mapSize.width ? ` · map is ${mapSize.width}×${mapSize.height} tiles` : ''}`;
    controls.appendChild(seedTag);

    canvasCol.appendChild(controls);
    row.appendChild(canvasCol);

    const sidebar = document.createElement('div');
    sidebar.style.minWidth = '260px';
    sidebar.style.flex = '1';

    const focusBox = document.createElement('div');
    focusBox.style.marginBottom = '14px';
    const focusTitle = document.createElement('h3');
    focusTitle.style.margin = '0 0 4px';
    focusTitle.style.fontSize = '15px';
    const focusDesc = document.createElement('p');
    focusDesc.className = 'hint';
    focusDesc.style.fontFamily = 'inherit';
    focusDesc.style.fontSize = '13px';
    focusDesc.style.color = 'var(--text)';
    if (mapSuggestionFocusKey) {
        focusTitle.textContent = MAP_SUGGESTION_ZONE_LABEL[mapSuggestionFocusKey];
        focusDesc.textContent = MAP_SUGGESTION_ZONE_DESC[mapSuggestionFocusKey];
    } else {
        focusTitle.textContent = archetype.label;
        focusDesc.textContent = archetype.blurb;
    }
    focusBox.appendChild(focusTitle);
    focusBox.appendChild(focusDesc);
    sidebar.appendChild(focusBox);

    const legend = document.createElement('div');
    legend.className = 'graph-legend';
    legend.style.flexDirection = 'column';
    const seenKeys = new Set();
    for (const zone of jitterMapSuggestionZones(archetype, mapSuggestionSeed)) {
        if (seenKeys.has(zone.key)) continue;
        seenKeys.add(zone.key);
        const item = document.createElement('div');
        item.className = 'graph-legend-item';
        item.style.cursor = 'pointer';
        item.style.opacity = mapSuggestionFocusKey && mapSuggestionFocusKey !== zone.key ? '0.6' : '1';
        const swatch = document.createElement('span');
        swatch.className = 'graph-legend-swatch';
        swatch.style.background = MAP_SUGGESTION_ZONE_COLOR[zone.key];
        item.appendChild(swatch);
        const label = document.createElement('span');
        label.textContent = MAP_SUGGESTION_ZONE_LABEL[zone.key];
        item.appendChild(label);
        item.onclick = () => {
            mapSuggestionFocusKey = zone.key;
            renderActiveTab();
        };
        legend.appendChild(item);
    }
    sidebar.appendChild(legend);
    row.appendChild(sidebar);

    container.appendChild(row);
}

/**
 * The Zones tab — see manifest.json's own sourceHint. Two halves:
 *   1. A read-only canvas map (drawZoneCanvas()) colored per zone, plus a legend, so a
 *      designer can see AT A GLANCE which painted shape is which zone number without cross-
 *      referencing Tiled.
 *   2. One entry card per zone number that ACTUALLY EXISTS on the map right now (auto-created
 *      into `data` here if this is the first time it's been seen — mirrors how mapTiles seeds
 *      `walkable` defaults inline), each editable via the generic renderEntryCard()/
 *      renderRequirementField() machinery every other tab already uses — a zone's config is
 *      just `{ requirement?: MilestoneRequirement }` (see ZoneTypes.ts), nothing special.
 * A zoneNumber with a saved requirement but NO LONGER painted on the map (e.g. the "zones"
 * layer got repainted in Tiled since) still gets its own card, under a separate heading —
 * entityMap.mjs's `protectEntries: true` is what keeps that config from being silently
 * deleted the next time this tab saves, exactly like assetLibrary's own cross-tab entries.
 */
function renderZonesTab(data, schema) {
    if (zoneCells.error) {
        contentEl.appendChild(sectionLabel(`Couldn't read zone data from the map: ${zoneCells.error}`));
    }

    const paintedNumbers = new Set(zoneCells.zones.map(z => z.zoneNumber));
    for (const zoneNumber of paintedNumbers) {
        data[String(zoneNumber)] ??= {};
    }

    if (zoneCells.zones.length > 0) {
        const mapWrap = document.createElement('div');
        mapWrap.style.display = 'flex';
        mapWrap.style.gap = '16px';
        mapWrap.style.alignItems = 'flex-start';
        mapWrap.style.marginBottom = '16px';

        mapWrap.appendChild(drawZoneCanvas(zoneCells.zones, 360));

        const legend = document.createElement('div');
        for (const zone of zoneCells.zones) {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.gap = '6px';
            row.style.marginBottom = '2px';
            const swatch = document.createElement('span');
            swatch.style.display = 'inline-block';
            swatch.style.width = '12px';
            swatch.style.height = '12px';
            swatch.style.background = ZONE_COLORS[zone.zoneNumber % ZONE_COLORS.length];
            row.appendChild(swatch);
            const label = document.createElement('span');
            label.textContent = `Zone ${zone.zoneNumber + 1} (zoneNumber ${zone.zoneNumber}) — ${zone.cellCount} cell${zone.cellCount === 1 ? '' : 's'}`;
            row.appendChild(label);
            legend.appendChild(row);
        }
        mapWrap.appendChild(legend);
        contentEl.appendChild(mapWrap);
    } else if (!zoneCells.error) {
        contentEl.appendChild(sectionLabel('No "zones" tilelayer cells painted on the map yet — paint some in Tiled, then reload this editor.'));
    }

    const sortedPainted = [...paintedNumbers].sort((a, b) => a - b);
    if (sortedPainted.length > 0) {
        contentEl.appendChild(sectionLabel('Painted on the map now'));
        for (const zoneNumber of sortedPainted) {
            const zone = zoneCells.zones.find(z => z.zoneNumber === zoneNumber);
            const entryLabel = `Zone ${zoneNumber + 1} (zoneNumber ${zoneNumber}) — ${zone.cellCount} cell${zone.cellCount === 1 ? '' : 's'}`;
            contentEl.appendChild(renderEntryCard(data, String(zoneNumber), data[String(zoneNumber)], schema, true, false, new Set(), entryLabel));
        }
    }

    const staleNumbers = Object.keys(data).map(Number).filter(n => !paintedNumbers.has(n)).sort((a, b) => a - b);
    if (staleNumbers.length > 0) {
        contentEl.appendChild(sectionLabel('Configured, but not currently painted on the map'));
        for (const zoneNumber of staleNumbers) {
            const entryLabel = `Zone ${zoneNumber + 1} (zoneNumber ${zoneNumber}) — not on map`;
            contentEl.appendChild(renderEntryCard(data, String(zoneNumber), data[String(zoneNumber)], schema, true, false, new Set(), entryLabel));
        }
    }
}

/** One tile array (grounds or resources) as a list of swatch + field rows, with its own add button — each array index IS the tile id (matched against a Tiled gid via firstgid offset, see TileMapConfig.ts), so rows are ordered, not keyed. */
function renderTileList(tiles, sheetUrl, tileSize, fields, addLabel) {
    const wrap = document.createElement('div');
    wrap.className = 'tile-list';

    tiles.forEach((tile, index) => {
        const row = document.createElement('div');
        row.className = 'tile-row';
        row.appendChild(makeTileSwatch(sheetUrl, index, tileSize, tiles.length));

        const fieldsCol = document.createElement('div');
        fieldsCol.className = 'tile-row-fields';
        renderFields(fieldsCol, tile, fields, markDirty);
        row.appendChild(fieldsCol);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'danger small';
        removeBtn.textContent = 'Remove';
        removeBtn.onclick = () => {
            if (!confirm(`Remove "${tile.name || `tile ${index}`}"? Any Tiled gid pointing at this index (or any index after it) will resolve to the wrong tile until the map is repainted.`)) return;
            tiles.splice(index, 1);
            markDirty();
            renderActiveTab();
        };
        row.appendChild(removeBtn);

        wrap.appendChild(row);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'primary small';
    addBtn.textContent = `+ Add ${addLabel}`;
    addBtn.onclick = () => {
        tiles.push({ name: '', color: '#ffffff' });
        markDirty();
        renderActiveTab();
    };
    wrap.appendChild(addBtn);

    return wrap;
}

/**
 * A cropped, scaled-up preview of one tile from a single-row spritesheet — background-size
 * stretches the WHOLE sheet to `count` display-widths, then background-position shifts left by
 * `index` display-widths, so only that one tile shows. Matches TileMapConfig.ts's own "index N ×
 * tileSize px, single row" convention exactly (see its own doc). Carries a small id badge in the
 * corner showing that same index — the array index IS the tile id resolveGroundDef()/
 * resolveResourceDef() look up by by (gid - firstgid), so this is the number a designer needs to
 * match against what's painted in Tiled, not just a decoration.
 */
function makeTileSwatch(sheetUrl, index, tileSize, count) {
    const DISPLAY_SCALE = 2;
    const displaySize = tileSize * DISPLAY_SCALE;
    const wrap = document.createElement('span');
    wrap.className = 'tile-swatch';
    wrap.style.width = `${displaySize}px`;
    wrap.style.height = `${displaySize}px`;
    wrap.style.backgroundImage = `url(${sheetUrl}?v=${tileImageVersion})`;
    wrap.style.backgroundSize = `${count * displaySize}px ${displaySize}px`;
    wrap.style.backgroundPosition = `-${index * displaySize}px 0`;

    const badge = document.createElement('span');
    badge.className = 'tile-swatch-id';
    badge.textContent = index;
    wrap.appendChild(badge);

    return wrap;
}

function sectionLabel(text) {
    const el = document.createElement('p');
    el.className = 'hint section-label';
    el.textContent = text;
    return el;
}

function onAddEntry() {
    const manifestEntry = manifest.find(e => e.id === activeId);
    const data = allData[activeId];

    if (manifestEntry.shape === 'array') {
        data.push({});
    } else {
        const id = prompt('New entry id:');
        if (!id) return;
        const container = manifestEntry.shape === 'queues' ? data.byId : data;
        if (container[id] !== undefined) {
            alert('That id already exists.');
            return;
        }
        container[id] = {};
    }
    markDirty();
    renderActiveTab();
}

/**
 * Duplicates one entry in place, right after the original — a deep clone under a fresh,
 * never-used id (`${key}Copy`, `${key}Copy2`, ... on collision), with its `name`/`label` field
 * (whichever it has, if either) suffixed " Copy" so the duplicate is visibly distinguishable
 * in the collapsed list, not just by id. Purely a local `allData` edit, same as onAddEntry()
 * and the old client-only rename used to be — a brand-new row references nothing by id yet
 * (nothing points AT it until it's actually saved and, separately, wired up: a cost map
 * entry added, a drop table row pointed at it, ...), so unlike a RENAME there's no other file
 * anywhere that could go stale here; the ordinary Save pipeline is all this ever needs.
 * `container`/`key` mirror renderEntryCard()'s own doc on the same pair.
 */
function duplicateEntry(container, key) {
    const original = container[key];
    const clone = JSON.parse(JSON.stringify(original));

    if (Array.isArray(container)) {
        container.splice(Number(key) + 1, 0, clone);
    } else {
        let newId = `${key}Copy`;
        for (let n = 2; container[newId] !== undefined; n++) {
            newId = `${key}Copy${n}`;
        }
        if (typeof clone.name === 'string' && clone.name) {
            clone.name = `${clone.name} Copy`;
        } else if (typeof clone.label === 'string' && clone.label) {
            clone.label = `${clone.label} Copy`;
        }
        container[newId] = clone;
    }

    markDirty();
    renderActiveTab();
}

/**
 * Renames an id-keyed entry via the server's /api/rename/:entityId endpoint (see
 * renameEntity.mjs's own doc) — a REAL rename: the id changes in this tab's own source .ts
 * file AND everywhere else that referenced it (AssetLibraryRegistry's matching key,
 * map/tiles.json's provider placements, drop tables/cost maps/requirement pickers on OTHER
 * tabs, ...), not just this tab's own local JSON. This deliberately does NOT mutate `allData`
 * itself the way the old client-only rename used to — the rename can touch OTHER tabs' data on
 * disk too, so the only correct way to reflect the result is a full init() reload from disk,
 * same as after a server restart. Any UNSAVED edit in ANY tab (this one or another) is
 * discarded by that reload, same risk setupRestartButton() already warns about — so this asks
 * first if anything is dirty, rather than silently losing work.
 *
 * A `notFound` response (see renameEntity.mjs's own doc on that flag) means this exact id has
 * never actually been Saved yet — a fresh "+ Add"/Duplicate row that only exists in THIS
 * browser's own local draft. There's nothing on disk to rename, and (more importantly) nothing
 * ANYWHERE ELSE could possibly already reference an id that was never saved — so that case
 * falls back to the plain local rename the OLD id-input behavior used to always do, no server
 * round-trip or reload needed at all.
 */
async function renameEntry(container, idInput, oldId) {
    const newId = idInput.value.trim();
    if (!newId || newId === oldId) {
        idInput.value = oldId;
        return;
    }
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(newId)) {
        alert('Ids must start with a letter, and contain only letters, digits, and underscores.');
        idInput.value = oldId;
        return;
    }
    if (dirtyTabs.size > 0 && !confirm('You have unsaved changes on one or more tabs that will be LOST (renaming reloads everything fresh from disk). Rename anyway?')) {
        idInput.value = oldId;
        return;
    }

    idInput.disabled = true;
    const status = document.getElementById('save-status');
    try {
        const res = await fetch(`/api/rename/${activeId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldId, newId }),
        });
        const result = await res.json();
        if (!res.ok) {
            if (result.notFound) {
                // Never actually Saved — nothing on disk, nothing anywhere else could
                // reference it yet, so just rename it locally, same as the old id-input
                // behavior always did. No reload, no lost work, no round-trip needed.
                if (container[newId] !== undefined) {
                    idInput.disabled = false;
                    idInput.value = oldId;
                    alert('That id already exists.');
                    return;
                }
                container[newId] = container[oldId];
                delete container[oldId];
                markDirty();
                renderActiveTab();
                return;
            }
            throw new Error(result.error ?? `HTTP ${res.status}`);
        }
        await init();
        const refreshedStatus = document.getElementById('save-status');
        if (refreshedStatus) {
            refreshedStatus.className = result.warnings?.length > 0 ? 'status error' : 'status ok';
            refreshedStatus.textContent = result.warnings?.length > 0
                ? `Renamed "${oldId}" to "${newId}", but: ${result.warnings.join('; ')}`
                : `Renamed "${oldId}" to "${newId}" everywhere it's referenced.`;
        }
    } catch (err) {
        idInput.disabled = false;
        idInput.value = oldId;
        if (status) {
            status.className = 'status error';
            status.textContent = `Rename failed: ${err.message}`;
        } else {
            alert(`Rename failed: ${err.message}`);
        }
    }
}

/**
 * One collapsible card for a single entry. `container`/`key` identify where
 * this entry actually lives (null container = the queues "default" slot,
 * which can't be renamed or deleted) so rename/delete can mutate the real
 * data in place and re-render the whole tab — cheap enough at this data
 * size, and simpler than threading a scoped re-render through every field
 * type just for the rename/delete case.
 */
function renderEntryCard(container, key, value, schema, removable, renamable, missingOnMap, labelOverride) {
    const details = document.createElement('details');
    details.className = 'entry';

    // Restores this card's expanded/collapsed state from the last time this editor was used
    // (see openEntryByTab's own doc) — String(key) so an array tab's numeric index and a
    // record tab's string id both compare consistently against what got saved. Only one entry
    // per tab is ever remembered as "open," matching how a designer actually works this UI:
    // one card expanded at a time to fill in its fields.
    details.open = openEntryByTab[activeId] === String(key);
    details.addEventListener('toggle', () => {
        if (details.open) {
            openEntryByTab[activeId] = String(key);
        } else if (openEntryByTab[activeId] === String(key)) {
            delete openEntryByTab[activeId];
        }
        saveUiState();
    });

    const summary = document.createElement('summary');

    // If this entity type has an 'icon' field, show its resolved thumbnail right on the
    // collapsed row — the whole point of previewing an icon is seeing it WITHOUT having to
    // open every entry one at a time to check what got assigned.
    const iconField = schema.find(f => f.type === 'icon');
    if (iconField && value?.[iconField.key]) {
        summary.appendChild(makeIconThumb(value[iconField.key], 'entry-icon-thumb'));
    }

    if (renamable) {
        const idInput = document.createElement('input');
        idInput.value = key;
        idInput.onclick = e => e.stopPropagation();
        idInput.onchange = () => renameEntry(container, idInput, key);
        summary.appendChild(idInput);
    } else {
        const label = document.createElement('span');
        label.className = 'entry-fixed-label';
        label.textContent = labelOverride ?? value?.name ?? value?.label ?? String(key);
        summary.appendChild(label);
    }

    if (missingOnMap?.has(String(key))) {
        const flag = document.createElement('span');
        flag.className = 'entry-map-flag missing-on-map';
        flag.textContent = 'not on map';
        flag.title = MISSING_ON_MAP_LABEL[activeId] ?? 'not found on the Tiled map';
        summary.appendChild(flag);
    }

    if (removable) {
        const duplicateBtn = document.createElement('button');
        duplicateBtn.className = 'small';
        duplicateBtn.textContent = 'Duplicate';
        duplicateBtn.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            duplicateEntry(container, key);
        };
        summary.appendChild(duplicateBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'danger small';
        deleteBtn.textContent = 'Delete';
        deleteBtn.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            if (!confirm(`Delete "${key}"?`)) return;
            if (Array.isArray(container)) {
                container.splice(key, 1);
            } else {
                delete container[key];
            }
            markDirty();
            renderActiveTab();
        };
        summary.appendChild(deleteBtn);
    }

    details.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'entry-body';
    renderFields(body, value, schema, markDirty);
    details.appendChild(body);

    return details;
}

// ---------------------------------------------------------------------------
// Field engine — see schemas.js's own doc for the field descriptor shapes.
// ---------------------------------------------------------------------------

function getOptions(sourceId) {
    // A '$'-prefixed source isn't a manifest tab id — it's a map-derived option list fetched
    // straight from the real Tiled map (see readSpawnerTileTypes()), not any tab's own data.
    if (sourceId === '$spawnerTileTypes') {
        return spawnerTileTypes.map(t => ({
            value: t.name,
            label: t.painted ? t.name : `${t.name} (not painted on a spawner layer yet)`,
        }));
    }
    if (sourceId === '$spawnerShapeIds') {
        return spawnerShapeIds.map(id => ({ value: id, label: id }));
    }

    const manifestEntry = manifest.find(e => e.id === sourceId);
    const data = allData[sourceId];
    if (!manifestEntry || !data) return [];

    if (manifestEntry.shape === 'array') {
        return data.map((v, i) => ({ value: String(i), label: v.label ?? v.name ?? String(i) }));
    }
    if (manifestEntry.shape === 'queues') {
        return Object.keys(data.byId ?? {}).map(id => ({ value: id, label: id }));
    }
    return Object.entries(data).map(([id, v]) => ({ value: id, label: v?.label ?? v?.name ?? id }));
}

function optionLabel(sourceId, value) {
    const found = getOptions(sourceId).find(o => o.value === value);
    return found ? found.label : value;
}

function fieldRow(labelText) {
    const row = document.createElement('div');
    row.className = 'field-row';
    const label = document.createElement('label');
    label.textContent = labelText;
    row.appendChild(label);
    const control = document.createElement('div');
    control.className = 'field-control';
    row.appendChild(control);
    return { row, control };
}

function renderFields(container, obj, fields, onDirty) {
    for (const field of fields) {
        if (field.type === 'requirement') {
            renderRequirementField(container, obj, field, onDirty);
            continue;
        }

        const { row, control } = fieldRow(field.label);

        if (field.type === 'group') {
            obj[field.key] = obj[field.key] ?? {};
            renderFields(control, obj[field.key], field.fields, onDirty);
        } else if (field.type === 'costMap') {
            renderCostMap(control, obj, field, onDirty);
        } else if (field.type === 'list') {
            renderList(control, obj, field, onDirty);
        } else if (field.type === 'icon') {
            renderIconField(control, obj, field, onDirty);
        } else if (field.type === 'faceIcon') {
            renderFaceIconField(control, obj, field, onDirty);
        } else if (field.type === 'modelList') {
            renderModelListField(control, obj, field, onDirty);
        } else if (field.type === 'numberRange') {
            renderNumberRangeField(control, obj, field, onDirty);
        } else if (field.type === 'vector3') {
            renderVector3Field(control, obj, field, onDirty);
        } else if (field.optional && field.type !== 'select') {
            renderOptionalLeaf(control, obj, field, onDirty);
        } else {
            control.appendChild(makeLeafInput(obj, field, onDirty));
        }

        container.appendChild(row);
    }
}

function makeLeafInput(obj, field, onDirty) {
    if (field.type === 'text') {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = obj[field.key] ?? '';
        input.oninput = () => {
            obj[field.key] = input.value;
            onDirty();
        };
        return input;
    }

    if (field.type === 'number') {
        const input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.value = obj[field.key] ?? '';
        input.oninput = () => {
            // A field reaching this branch (rather than renderOptionalLeaf, see renderFields'
            // own dispatch) is always REQUIRED — clearing the input to '' must not write
            // `undefined` into the live record, or a stray backspace silently drops a
            // required key from the next Save (syncToSource.mjs only half-catches this: it
            // refuses to delete the key from the real .ts source, but still warns after the
            // fact rather than preventing it). Leave the last valid value in place instead.
            if (input.value === '') {
                return;
            }
            obj[field.key] = Number(input.value);
            onDirty();
        };
        input.onblur = () => {
            // If the user left the input empty (rather than typing a replacement number), snap
            // it back to the still-current, still-required value instead of leaving the field
            // looking blank while the underlying record disagrees.
            if (input.value === '') {
                input.value = obj[field.key] ?? '';
            }
        };
        return input;
    }

    if (field.type === 'color') {
        const input = document.createElement('input');
        input.type = 'color';
        input.value = obj[field.key] ?? '#ffffff';
        input.oninput = () => {
            obj[field.key] = input.value;
            onDirty();
        };
        return input;
    }

    if (field.type === 'boolean') {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!obj[field.key];
        input.onchange = () => {
            obj[field.key] = input.checked;
            onDirty();
        };
        return input;
    }

    if (field.type === 'select') {
        const select = document.createElement('select');
        if (field.optional) {
            const blank = document.createElement('option');
            blank.value = '';
            blank.textContent = '(none)';
            select.appendChild(blank);
        }
        // `field.options` is a fixed inline list (e.g. popupMode's None/Complete/Simple) —
        // not sourced from another tab's live data at all, unlike `field.source`. Checked
        // first since a field never has both.
        const options = field.options ?? getOptions(field.source);
        for (const opt of options) {
            const el = document.createElement('option');
            el.value = opt.value;
            el.textContent = opt.label;
            select.appendChild(el);
        }
        const currentValue = obj[field.key] ?? '';
        // A saved value that no longer matches any current option (a renamed/deleted
        // sibling entry, or — for '$spawnerTileTypes' — a name the map/tiles.json doesn't
        // even define) would otherwise render as silently blank/defaulted to the first
        // option, which reads as data having been quietly lost. Appending it keeps the
        // real stored value visible and flagged instead.
        if (currentValue && !options.some(o => o.value === currentValue)) {
            const unknown = document.createElement('option');
            unknown.value = currentValue;
            unknown.textContent = `${currentValue} (not found)`;
            select.appendChild(unknown);
        }
        select.value = currentValue;
        select.onchange = () => {
            obj[field.key] = select.value === '' ? undefined : select.value;
            onDirty();
        };
        return select;
    }

    const fallback = document.createElement('span');
    fallback.textContent = `(unsupported field type "${field.type}")`;
    return fallback;
}

/** A number/text/boolean field marked `optional` — a checkbox controls whether the key is present at all (e.g. a shop upgrade level that only bumps hitScale leaves hitIntervalSec/resourcePerHit entirely unset, not zeroed). */
function renderOptionalLeaf(control, obj, field, onDirty) {
    function redraw() {
        control.innerHTML = '';
        const enabled = obj[field.key] !== undefined;

        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.className = 'optional-toggle';
        toggle.checked = enabled;
        toggle.title = 'Include this field';
        toggle.onchange = () => {
            if (toggle.checked) {
                obj[field.key] = field.type === 'number' ? 0 : field.type === 'boolean' ? false : '';
            } else {
                delete obj[field.key];
            }
            onDirty();
            redraw();
        };
        control.appendChild(toggle);

        if (enabled) {
            control.appendChild(makeLeafInput(obj, field, onDirty));
        }
    }
    redraw();
}

/** A MilestoneRequirement union — a type picker plus whichever contextual fields that type needs (see schemas.js's REQUIREMENT_TYPE_FIELDS). */
function renderRequirementField(container, obj, field, onDirty) {
    const { row, control } = fieldRow(field.label);
    const wrap = document.createElement('div');
    wrap.className = 'requirement-field';
    const body = document.createElement('div');

    function defaultRequirement(type) {
        if (type === 'building') {
            return { type: 'building', buildingId: getOptions('buildings')[0]?.value ?? '', level: 1 };
        }
        if (type === 'item') {
            return { type: 'item', item: getOptions('items')[0]?.value ?? '' };
        }
        if (type === 'gate') {
            return { type: 'gate', gateId: getOptions('gates')[0]?.value ?? '' };
        }
        if (type === 'trigger') {
            return { type: 'trigger', triggerId: getOptions('triggers')[0]?.value ?? '' };
        }
        return { type: 'resource', resourceType: getOptions('resources')[0]?.value ?? '', amount: 1 };
    }

    function redraw() {
        body.innerHTML = '';
        if (obj[field.key] === undefined) {
            // A REQUIRED requirement field (e.g. a gate's own `requirement` — unlike an
            // `optional: true` one, which stays hidden until its own checkbox above is
            // checked) has to self-initialize here, the same way renderCostMap()/etc default
            // their own value — otherwise a brand-new entry's requirement stays permanently
            // undefined (no type dropdown ever renders to set it from), and syncToSource.mjs
            // has nothing to write for it at all since it never sees a defined value to save.
            if (field.optional) {
                return;
            }
            obj[field.key] = defaultRequirement('resource');
        }

        const typeSelect = document.createElement('select');
        for (const t of Object.keys(REQUIREMENT_TYPE_FIELDS)) {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t;
            typeSelect.appendChild(opt);
        }
        typeSelect.value = obj[field.key].type;
        typeSelect.onchange = () => {
            obj[field.key] = defaultRequirement(typeSelect.value);
            onDirty();
            redraw();
        };
        body.appendChild(typeSelect);

        const subContainer = document.createElement('div');
        subContainer.className = 'requirement-subfields';
        body.appendChild(subContainer);
        renderFields(subContainer, obj[field.key], REQUIREMENT_TYPE_FIELDS[obj[field.key].type], onDirty);
    }

    if (field.optional) {
        const toggleLabel = document.createElement('label');
        toggleLabel.className = 'toggle-row';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = obj[field.key] !== undefined;
        checkbox.onchange = () => {
            obj[field.key] = checkbox.checked ? defaultRequirement('resource') : undefined;
            if (!checkbox.checked) delete obj[field.key];
            onDirty();
            redraw();
        };
        toggleLabel.appendChild(checkbox);
        toggleLabel.append(' Has requirement');
        wrap.appendChild(toggleLabel);
    }

    wrap.appendChild(body);
    redraw();
    control.appendChild(wrap);
    container.appendChild(row);
}

/** A resource/amount map (e.g. a building level's requirements, a recipe's cost) — rows of "resource dropdown + amount", not free-typed keys. */
function renderCostMap(control, obj, field, onDirty) {
    obj[field.key] = obj[field.key] ?? {};
    const map = obj[field.key];

    function redraw() {
        control.innerHTML = '';
        const list = document.createElement('div');
        list.className = 'cost-map';

        for (const rid of Object.keys(map)) {
            const row = document.createElement('div');
            row.className = 'cost-row';
            const nameSpan = document.createElement('span');
            nameSpan.textContent = optionLabel(field.source, rid);
            const amountInput = document.createElement('input');
            amountInput.type = 'number';
            amountInput.step = 'any';
            amountInput.value = map[rid];
            amountInput.oninput = () => {
                map[rid] = Number(amountInput.value);
                onDirty();
            };
            const removeBtn = document.createElement('button');
            removeBtn.className = 'danger small';
            removeBtn.textContent = '×';
            removeBtn.onclick = () => {
                delete map[rid];
                onDirty();
                redraw();
            };
            row.append(nameSpan, amountInput, removeBtn);
            list.appendChild(row);
        }
        control.appendChild(list);

        const addRow = document.createElement('div');
        addRow.className = 'cost-row add-row';
        const select = document.createElement('select');
        const available = getOptions(field.source).filter(o => !(o.value in map));
        for (const opt of available) {
            const el = document.createElement('option');
            el.value = opt.value;
            el.textContent = opt.label;
            select.appendChild(el);
        }
        const addBtn = document.createElement('button');
        addBtn.className = 'small';
        addBtn.textContent = '+ Add';
        addBtn.disabled = available.length === 0;
        addBtn.onclick = () => {
            if (!select.value) return;
            map[select.value] = 1;
            onDirty();
            redraw();
        };
        addRow.append(select, addBtn);
        control.appendChild(addRow);
    }
    redraw();
}

/** A collapsible array of sub-entries sharing one field schema (building levels, shop upgrade levels, craft recipes, queue tasks). */
function renderList(control, obj, field, onDirty) {
    obj[field.key] = obj[field.key] ?? [];
    const arr = obj[field.key];

    function redraw() {
        control.innerHTML = '';
        arr.forEach((item, index) => {
            const item_ = item ?? (arr[index] = {});
            const details = document.createElement('details');
            details.className = 'list-item';
            const summary = document.createElement('summary');
            const labelSpan = document.createElement('span');
            labelSpan.textContent = field.itemLabel ? field.itemLabel(item_, index) : `Item ${index + 1}`;
            summary.appendChild(labelSpan);
            const removeBtn = document.createElement('button');
            removeBtn.className = 'danger small';
            removeBtn.textContent = 'Remove';
            removeBtn.onclick = e => {
                e.preventDefault();
                e.stopPropagation();
                arr.splice(index, 1);
                onDirty();
                redraw();
            };
            summary.appendChild(removeBtn);
            details.appendChild(summary);

            const body = document.createElement('div');
            body.className = 'list-item-body';
            renderFields(body, item_, field.fields, onDirty);
            details.appendChild(body);

            control.appendChild(details);
        });

        const addBtn = document.createElement('button');
        addBtn.className = 'primary small';
        addBtn.textContent = `+ Add ${field.label}`;
        addBtn.onclick = () => {
            arr.push({});
            onDirty();
            redraw();
        };
        control.appendChild(addBtn);
    }
    redraw();
}

// ---------------------------------------------------------------------------
// Icon picker — see schemas.js's 'icon' field type doc.
// ---------------------------------------------------------------------------

/** Cached result of /api/images — fetched once, lazily, the first time any icon field either previews a value or opens its Browse gallery, then shared by every icon field on the page (a designer flipping between tools shouldn't re-fetch 279 filenames per field). */
let imageAssetsPromise = null;
function loadImageAssets() {
    if (!imageAssetsPromise) {
        imageAssetsPromise = fetchJson('/api/images').catch(err => ({ assets: [], error: err.message }));
    }
    return imageAssetsPromise;
}

/** Same caching convention as loadImageAssets(), for /api/non-preload-images (see that route's own doc in server.mjs) — the "faceIcon" field type's asset source. */
let nonPreloadImageAssetsPromise = null;
function loadNonPreloadImageAssets() {
    if (!nonPreloadImageAssetsPromise) {
        nonPreloadImageAssetsPromise = fetchJson('/api/non-preload-images').catch(err => ({ assets: [], error: err.message }));
    }
    return nonPreloadImageAssetsPromise;
}

/**
 * A small `<img>` that resolves its own src asynchronously from the shared image-asset
 * cache — used both for an icon field's own preview and for an entry card's collapsed-row
 * thumbnail (see renderEntryCard()). Kept as one function so both places share the exact
 * same "look up by bare name, fall back to a visibly-missing state" behavior instead of
 * drifting into two slightly different implementations.
 */
function makeIconThumb(name, className = 'icon-preview') {
    const img = document.createElement('img');
    img.className = className;
    if (!name) {
        img.style.visibility = 'hidden';
        return img;
    }
    loadImageAssets().then(({ assets }) => {
        const asset = assets.find(a => a.name === name);
        img.src = asset ? asset.url : '';
        img.classList.toggle('missing', !asset);
        img.title = asset ? `${name} (${asset.bundle})` : `"${name}" not found under raw-assets/images`;
    });
    return img;
}

/**
 * A texture-name field: thumbnail preview + text input (typing a name by
 * hand still works, e.g. for an icon not yet scanned) + a "Browse" toggle
 * that lazily loads /api/images into a FOLDER-navigable thumbnail grid —
 * a "Folder" dropdown (populated from every distinct asset.bundle) narrows
 * the grid to one bundle at a time instead of dumping every scanned image
 * into one flat list; "All folders" goes back to everything. Clicking a
 * thumbnail sets the field to that image's BARE filename — the exact
 * string the game's own icon fields store (see this field type's own doc
 * in schemas.js). Just a thin config wrapper around renderAssetPickerField()
 * — see that function's own doc for the shared implementation.
 */
function renderIconField(control, obj, field, onDirty) {
    renderAssetPickerField(control, obj, field, onDirty, {
        loadAssets: loadImageAssets,
        getValue: asset => asset.name,
        getGroup: asset => asset.bundle,
        getLabel: asset => asset.name,
        findAsset: (assets, value) => assets.find(a => a.name === value),
        groupLabel: 'Folder',
        notFoundHint: 'not found under raw-assets/images',
    });
}

/**
 * Same folder-navigable picker as renderIconField(), pointed at
 * /api/non-preload-images instead (see server.mjs's own route doc) — grouped by each
 * asset's own top-level subfolder ("skins", "islands", ...) rather than a packed bundle
 * name. Clicking a thumbnail sets the field to that image's full RELATIVE PATH under
 * images/non-preload (e.g. "skins/pirate.webp") — the convention CharacterViewConfig.face/
 * ShopStorage.ShopItem.texture actually store, NOT a bare frame name (these files are
 * addressed by path, never packed into an atlas — see CharacterViewTypes.ts's own doc).
 */
function renderFaceIconField(control, obj, field, onDirty) {
    renderAssetPickerField(control, obj, field, onDirty, {
        loadAssets: loadNonPreloadImageAssets,
        getValue: asset => asset.relPath,
        getGroup: asset => asset.folder,
        getLabel: asset => asset.name,
        findAsset: (assets, value) => assets.find(a => a.relPath === value),
        groupLabel: 'Folder',
        notFoundHint: 'not found under images/non-preload',
    });
}

/**
 * Shared implementation behind renderIconField()/renderFaceIconField() — a text input
 * (typing a value by hand still works) + thumbnail preview + a "Browse" toggle opening a
 * folder-dropdown-filtered, search-filtered thumbnail grid. `config` supplies everything
 * that differs between an asset source addressed by bare name (packed icons) vs one
 * addressed by relative path (non-preload faces) — see renderIconField()/
 * renderFaceIconField()'s own docs for the two current configs.
 */
function renderAssetPickerField(control, obj, field, onDirty, config) {
    const wrap = document.createElement('div');
    wrap.className = 'icon-field';

    const previewRow = document.createElement('div');
    previewRow.className = 'icon-preview-row';
    const previewSlot = document.createElement('span');
    previewSlot.className = 'icon-preview-slot';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = obj[field.key] ?? '';
    input.placeholder = '(none)';
    const browseBtn = document.createElement('button');
    browseBtn.className = 'small';
    browseBtn.textContent = 'Browse…';
    previewRow.append(previewSlot, input, browseBtn);
    wrap.appendChild(previewRow);

    const gallery = document.createElement('div');
    gallery.className = 'icon-gallery';
    gallery.hidden = true;
    wrap.appendChild(gallery);

    function updatePreview() {
        previewSlot.innerHTML = '';
        const value = obj[field.key];
        const img = document.createElement('img');
        img.className = 'icon-preview';
        if (!value) {
            img.style.visibility = 'hidden';
        } else {
            config.loadAssets().then(({ assets }) => {
                const asset = config.findAsset(assets, value);
                img.src = asset ? asset.url : '';
                img.classList.toggle('missing', !asset);
                img.title = asset ? `${value} (${config.getGroup(asset)})` : `"${value}" ${config.notFoundHint}`;
            });
        }
        previewSlot.appendChild(img);
    }

    input.oninput = () => {
        obj[field.key] = input.value || undefined;
        onDirty();
        updatePreview();
    };

    function renderGallery(assets, filterText, folderFilter) {
        gallery.innerHTML = '';

        const controlsRow = document.createElement('div');
        controlsRow.className = 'icon-gallery-controls';

        const folders = [...new Set(assets.map(config.getGroup))].sort();
        const folderSelect = document.createElement('select');
        const allOption = document.createElement('option');
        allOption.value = '';
        allOption.textContent = `All ${config.groupLabel.toLowerCase()}s (${assets.length})`;
        folderSelect.appendChild(allOption);
        for (const folder of folders) {
            const option = document.createElement('option');
            option.value = folder;
            option.textContent = folder;
            folderSelect.appendChild(option);
        }
        folderSelect.value = folderFilter;
        folderSelect.title = config.groupLabel;
        folderSelect.onchange = () => renderGallery(assets, search.value, folderSelect.value);
        controlsRow.appendChild(folderSelect);

        const search = document.createElement('input');
        search.type = 'text';
        search.className = 'icon-gallery-search';
        search.placeholder = 'Filter…';
        search.value = filterText;
        search.oninput = () => renderGallery(assets, search.value, folderSelect.value);
        controlsRow.appendChild(search);

        gallery.appendChild(controlsRow);

        const grid = document.createElement('div');
        grid.className = 'icon-gallery-grid';
        let filtered = folderFilter ? assets.filter(a => config.getGroup(a) === folderFilter) : assets;
        if (filterText) {
            filtered = filtered.filter(a => config.getLabel(a).toLowerCase().includes(filterText.toLowerCase()));
        }
        for (const asset of filtered.slice(0, 300)) {
            const item = document.createElement('button');
            item.className = 'icon-gallery-item';
            item.title = `${config.getLabel(asset)} (${config.getGroup(asset)})`;
            const thumb = document.createElement('img');
            thumb.src = asset.url;
            thumb.loading = 'lazy';
            const label = document.createElement('span');
            label.textContent = config.getLabel(asset);
            item.append(thumb, label);
            item.onclick = () => {
                const value = config.getValue(asset);
                obj[field.key] = value;
                input.value = value;
                gallery.hidden = true;
                onDirty();
                updatePreview();
            };
            grid.appendChild(item);
        }
        if (filtered.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'hint';
            empty.textContent = 'No matching images.';
            grid.appendChild(empty);
        } else if (filtered.length > 300) {
            const hint = document.createElement('p');
            hint.className = 'hint';
            hint.textContent = `Showing first 300 of ${filtered.length} matches — refine the folder/filter.`;
            grid.appendChild(hint);
        }
        gallery.appendChild(grid);
        search.focus();
    }

    browseBtn.onclick = async () => {
        gallery.hidden = !gallery.hidden;
        if (!gallery.hidden) {
            gallery.innerHTML = '<p class="hint">Loading…</p>';
            const { assets, error } = await config.loadAssets();
            if (error) {
                gallery.innerHTML = `<p class="hint">Couldn't load images: ${error}</p>`;
                return;
            }
            renderGallery(assets, '', '');
        }
    };

    updatePreview();
    control.appendChild(wrap);
}

// ---------------------------------------------------------------------------
// Model list picker — see schemas.js's 'modelList' field type doc.
// ---------------------------------------------------------------------------

/** Splits a "Group.Key" dot-path into its parts — the JSON mirror's own storage form for a model reference (see schemas.js's 'modelList' doc). Falls back to the catalog's first group/item when `dotPath` is empty/unrecognized, so a freshly-added row always starts on something real rather than a blank, unusable selection. */
function splitModelRef(dotPath) {
    const [group, key] = (dotPath ?? '').split('.');
    if (group && modelsCatalog.groups.some(g => g.name === group)) {
        return { group, key };
    }
    const firstGroup = modelsCatalog.groups[0];
    return { group: firstGroup?.name, key: firstGroup?.items[0]?.key };
}

/**
 * One `ModelDefinition[]` field — a row per model reference, each a Group
 * dropdown cascading into a Name dropdown scoped to that group (the
 * "node" picker this was asked for: drill into a category instead of
 * scanning one flat list of 190+ models). Add/remove rows since some
 * entries hold more than one (a tree scattering between two variants).
 */
function renderModelListField(control, obj, field, onDirty) {
    obj[field.key] = obj[field.key] ?? [];
    const arr = obj[field.key];

    if (modelsCatalog.error) {
        const err = document.createElement('p');
        err.className = 'hint';
        err.textContent = `Couldn't load the models registry: ${modelsCatalog.error}`;
        control.appendChild(err);
        return;
    }

    function redraw() {
        control.innerHTML = '';

        arr.forEach((dotPath, index) => {
            const { group: currentGroup, key: currentKey } = splitModelRef(dotPath);

            const row = document.createElement('div');
            row.className = 'model-row';

            const groupSelect = document.createElement('select');
            for (const g of modelsCatalog.groups) {
                const opt = document.createElement('option');
                opt.value = g.name;
                opt.textContent = `${g.name} (${g.items.length})`;
                groupSelect.appendChild(opt);
            }
            groupSelect.value = currentGroup ?? '';

            const nameSelect = document.createElement('select');
            function populateNames(groupName, selectedKey) {
                nameSelect.innerHTML = '';
                const group = modelsCatalog.groups.find(g => g.name === groupName);
                for (const item of group?.items ?? []) {
                    const opt = document.createElement('option');
                    opt.value = item.key;
                    opt.textContent = item.key;
                    opt.title = `${item.format} — ${item.fullPath}`;
                    nameSelect.appendChild(opt);
                }
                if (selectedKey && group?.items.some(i => i.key === selectedKey)) {
                    nameSelect.value = selectedKey;
                }
            }
            populateNames(currentGroup, currentKey);

            function commit() {
                arr[index] = `${groupSelect.value}.${nameSelect.value}`;
                onDirty();
            }

            groupSelect.onchange = () => {
                populateNames(groupSelect.value, null);
                commit();
            };
            nameSelect.onchange = commit;

            const removeBtn = document.createElement('button');
            removeBtn.className = 'danger small';
            removeBtn.textContent = 'Remove';
            removeBtn.onclick = () => {
                arr.splice(index, 1);
                onDirty();
                redraw();
            };

            row.append(groupSelect, nameSelect, removeBtn);
            control.appendChild(row);

            // Only normalize (and mark dirty) if the stored value was actually empty/invalid
            // and splitModelRef() had to fall back to the catalog's first group/item — a
            // render pass over an already-valid row must never call onDirty() on its own,
            // or just opening this tab would mark it unsaved with nothing touched.
            const normalized = `${currentGroup ?? ''}.${currentKey ?? ''}`;
            if (dotPath !== normalized) {
                commit();
            }
        });

        const addBtn = document.createElement('button');
        addBtn.className = 'primary small';
        addBtn.textContent = '+ Add model';
        addBtn.onclick = () => {
            const firstGroup = modelsCatalog.groups[0];
            arr.push(firstGroup ? `${firstGroup.name}.${firstGroup.items[0]?.key}` : '');
            onDirty();
            redraw();
        };
        control.appendChild(addBtn);

        if (arr.length === 0) {
            const hint = document.createElement('p');
            hint.className = 'hint';
            hint.style.margin = '0';
            hint.textContent = 'No models set — falls back to a placeholder primitive in-game.';
            control.insertBefore(hint, addBtn);
        }
    }
    redraw();
}

// ---------------------------------------------------------------------------
// Number-range field — see schemas.js's 'numberRange' field type doc.
// ---------------------------------------------------------------------------

/**
 * A `NumberRange` (`number | [number, number]`) field — a "Random range"
 * checkbox toggles between a single fixed-value input and a min/max pair.
 * Stored exactly as NumberRange's own on-disk shape (a bare number or a
 * 2-element array), no encoding needed.
 */
function renderNumberRangeField(control, obj, field, onDirty) {
    function redraw() {
        control.innerHTML = '';
        const isRange = Array.isArray(obj[field.key]);

        const toggle = document.createElement('label');
        toggle.className = 'toggle-row';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = isRange;
        checkbox.onchange = () => {
            if (checkbox.checked) {
                const base = typeof obj[field.key] === 'number' ? obj[field.key] : 1;
                obj[field.key] = [base, base];
            } else {
                obj[field.key] = Array.isArray(obj[field.key]) ? obj[field.key][0] ?? 1 : 1;
            }
            onDirty();
            redraw();
        };
        toggle.append(checkbox, ' Random range');
        control.appendChild(toggle);

        const valuesRow = document.createElement('div');
        valuesRow.className = 'number-range-row';

        if (isRange) {
            const [min, max] = obj[field.key];
            const minInput = document.createElement('input');
            minInput.type = 'number';
            minInput.step = 'any';
            minInput.value = min;
            minInput.title = 'Minimum';
            minInput.oninput = () => {
                obj[field.key][0] = Number(minInput.value);
                onDirty();
            };
            const sep = document.createElement('span');
            sep.textContent = '–';
            const maxInput = document.createElement('input');
            maxInput.type = 'number';
            maxInput.step = 'any';
            maxInput.value = max;
            maxInput.title = 'Maximum';
            maxInput.oninput = () => {
                obj[field.key][1] = Number(maxInput.value);
                onDirty();
            };
            valuesRow.append(minInput, sep, maxInput);
        } else {
            const input = document.createElement('input');
            input.type = 'number';
            input.step = 'any';
            input.value = obj[field.key] ?? '';
            input.oninput = () => {
                obj[field.key] = Number(input.value);
                onDirty();
            };
            valuesRow.appendChild(input);
        }

        control.appendChild(valuesRow);
    }
    redraw();
}

/** A plain [x, y, z] tuple field (e.g. EntityViewConfig.offset) — three side-by-side number inputs, defaulting to [0, 0, 0] the first time this key is touched. */
function renderVector3Field(control, obj, field, onDirty) {
    if (!Array.isArray(obj[field.key])) {
        obj[field.key] = [0, 0, 0];
    }

    const row = document.createElement('div');
    row.className = 'number-range-row';

    ['x', 'y', 'z'].forEach((axisLabel, axisIndex) => {
        const input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.title = axisLabel;
        input.value = obj[field.key][axisIndex] ?? 0;
        input.oninput = () => {
            obj[field.key][axisIndex] = Number(input.value);
            onDirty();
        };
        row.appendChild(input);
    });

    control.appendChild(row);
}

// ---------------------------------------------------------------------------
// Consistency report — compares the editor's own JSON mirrors against
// what's really in the game's source .ts files (see checkConsistency.mjs,
// the server-side implementation). Opens a copyable text overlay so a
// report can be pasted straight into a chat/issue.
// ---------------------------------------------------------------------------

async function runCheckConsistency() {
    const btn = document.getElementById('check-consistency-btn');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
        const result = await fetchJson('/api/check-consistency');
        showConsistencyReport(result.report);
    } catch (err) {
        showConsistencyReport(`Check failed: ${err.message}`);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Check consistency';
    }
}

function showConsistencyReport(text) {
    const overlay = document.getElementById('consistency-report-overlay');
    const textarea = document.getElementById('consistency-report-text');
    textarea.value = text;
    overlay.classList.remove('hidden');
}

function setupConsistencyReportOverlay() {
    const overlay = document.getElementById('consistency-report-overlay');
    document.getElementById('consistency-report-close').onclick = () => overlay.classList.add('hidden');
    overlay.onclick = e => {
        if (e.target === overlay) overlay.classList.add('hidden');
    };
    document.getElementById('consistency-report-copy').onclick = async () => {
        const textarea = document.getElementById('consistency-report-text');
        const copyBtn = document.getElementById('consistency-report-copy');
        try {
            await navigator.clipboard.writeText(textarea.value);
            copyBtn.textContent = 'Copied!';
        } catch {
            // Clipboard API can be unavailable (non-HTTPS, permissions) — fall back to a
            // manual select so the user can still Ctrl+C it themselves.
            textarea.select();
            copyBtn.textContent = 'Select all below and copy manually';
        }
        setTimeout(() => { copyBtn.textContent = 'Copy to clipboard'; }, 2000);
    };
}

// ---------------------------------------------------------------------------
// Debug physics header toggles
// ---------------------------------------------------------------------------
//
// Two checkboxes that write ONE metadata cookie (`pizzaDebugPhysics`, JSON —
// { collider, trigger }) shared with the actual game (see games/pizza/game/
// utils/DebugPhysicsCookie.ts, the one reader). Cookies aren't port-scoped,
// only host-scoped, so this reaches the game's own dev server on a
// different localhost port for free. The game only ever reads this in DEV
// MODE (launched with ?dev in the URL) — see index.ts — so leaving these on
// has no effect on a real player build.

const DEBUG_PHYSICS_COOKIE_NAME = 'pizzaDebugPhysics';

function readDebugPhysicsCookie() {
    const match = document.cookie.split('; ').find(entry => entry.startsWith(`${DEBUG_PHYSICS_COOKIE_NAME}=`));
    if (!match) {
        return { collider: false, trigger: false };
    }
    try {
        const parsed = JSON.parse(decodeURIComponent(match.slice(DEBUG_PHYSICS_COOKIE_NAME.length + 1)));
        return { collider: !!parsed.collider, trigger: !!parsed.trigger };
    } catch {
        return { collider: false, trigger: false };
    }
}

function writeDebugPhysicsCookie(value) {
    // 1 year — same convention as any other "remember this until explicitly changed" cookie;
    // there's nothing session-scoped about a designer's debug-view preference.
    const maxAgeSec = 60 * 60 * 24 * 365;
    document.cookie = `${DEBUG_PHYSICS_COOKIE_NAME}=${encodeURIComponent(JSON.stringify(value))}; path=/; max-age=${maxAgeSec}`;
}

function setupDebugPhysicsToggles() {
    const colliderToggle = document.getElementById('debug-collider-toggle');
    const triggerToggle = document.getElementById('debug-trigger-toggle');
    const current = readDebugPhysicsCookie();
    colliderToggle.checked = current.collider;
    triggerToggle.checked = current.trigger;

    const onChange = () => {
        writeDebugPhysicsCookie({ collider: colliderToggle.checked, trigger: triggerToggle.checked });
    };
    colliderToggle.onchange = onChange;
    triggerToggle.onchange = onChange;
}

// ---------------------------------------------------------------------------
// Server restart button
// ---------------------------------------------------------------------------

function setupRestartButton() {
    const btn = document.getElementById('restart-btn');
    btn.onclick = async () => {
        if (dirtyTabs.size > 0 && !confirm('You have unsaved changes that will be lost. Restart anyway?')) {
            return;
        }
        btn.disabled = true;
        btn.classList.add('busy');
        btn.textContent = 'Restarting…';
        try {
            await fetch('/api/restart', { method: 'POST' });
        } catch {
            // The connection dropping out from under this request IS the
            // expected outcome of asking the server to kill itself — ignore.
        }
        await waitForServerAndReload(btn);
    };
}

async function waitForServerAndReload(btn) {
    for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise(r => setTimeout(r, 250));
        try {
            const res = await fetch('/api/manifest');
            if (res.ok) {
                btn.disabled = false;
                btn.classList.remove('busy');
                btn.textContent = 'Restart server';
                await init();
                return;
            }
        } catch {
            // Still down — keep polling.
        }
    }
    btn.textContent = 'Restart failed — check terminal';
}

setupRestartButton();
setupDebugPhysicsToggles();
setupConsistencyReportOverlay();
document.getElementById('check-map-btn').onclick = checkMap;
document.getElementById('check-consistency-btn').onclick = runCheckConsistency;
init();
