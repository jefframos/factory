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
/** The categorized model catalog from /api/models (see modelsCatalog.mjs) — `{ groups: [{ name, items: [{ key, id, path, fullPath, format }] }] }`. Fetched once at init/restart, same pattern as spawnerTileTypes: small enough to prefetch eagerly rather than lazy-load per field. */
let modelsCatalog = { groups: [], error: null };
/** Cache-busting query value appended to every /tiled-asset/ image URL (see makeTileSwatch()) — the browser would otherwise keep serving a stale grounds.png/resources.png from cache after someone repaints the spritesheet on disk, since the URL itself never changes. Bumped on every init() (page load / server restart) and by the Map tab's own "Refresh images" button, so a designer who just re-exported the PNG can see it without a hard reload. */
let tileImageVersion = Date.now();

const tabsEl = document.getElementById('tabs');
const contentEl = document.getElementById('content');
const sourceHintEl = document.getElementById('source-hint');

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
        modelsCatalog = await fetchJson('/api/models');
    } catch (err) {
        modelsCatalog = { groups: [], error: err.message };
    }
    dirtyTabs.clear();
    if (!activeId || !manifest.some(e => e.id === activeId)) {
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
        btn.className = entry.id === activeId ? 'active' : '';

        const issues = mapValidation?.entities[entry.id];
        if (issues && (issues.missingOnMap.length > 0 || issues.missingInConfig.length > 0)) {
            const badge = document.createElement('span');
            badge.className = 'tab-badge';
            badge.textContent = issues.severity === 'error' ? '🔴' : issues.severity === 'warning' ? '🟠' : '🔵';
            btn.appendChild(badge);
        }

        btn.onclick = () => {
            activeId = entry.id;
            renderTabs();
            renderActiveTab();
        };
        tabsEl.appendChild(btn);
    }
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
            li.textContent = id;
            list.appendChild(li);
        }
        block.appendChild(list);
        banner.appendChild(block);
    }

    return banner;
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
    if (!activeId) return;

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

    if (manifestEntry.shape !== 'mapTiles') {
        // mapTiles has its own per-section "+ Add ground/resource tile" buttons (see
        // renderMapTilesTab()) since it holds two independent lists, not one — a single
        // toolbar-level "+ Add entry" wouldn't know which list to add to.
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
        contentEl.appendChild(sectionLabel('Default — used by any queue placed on the map with no id-specific override below'));
        contentEl.appendChild(renderEntryCard(null, 'default', data.default, schema, false, false, missingOnMap));
        contentEl.appendChild(sectionLabel('By queue id — only takes effect for a queue object on the Tiled map with a matching id'));
        for (const [id, value] of Object.entries(data.byId ?? {})) {
            contentEl.appendChild(renderEntryCard(data.byId, id, value, schema, true, true, missingOnMap));
        }
        return;
    }

    if (activeId === 'dynamicResourcePlacements') {
        renderDynamicResourcesByArea(data, schema);
        return;
    }

    if (manifestEntry.shape === 'mapTiles') {
        renderMapTilesTab(data);
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

    for (const area of areasToShow) {
        const items = groups.get(area);
        if (!items) continue;
        const resourceList = items.map(i => i.value.resourceType).filter(Boolean).join(', ') || '(no resource set)';
        contentEl.appendChild(sectionLabel(`${area} — ${items.length} placement${items.length === 1 ? '' : 's'}: ${resourceList}`));
        for (const { value, index } of items) {
            const entryLabel = value.resourceType ? `${value.resourceType} → ${area}` : undefined;
            contentEl.appendChild(renderEntryCard(data, index, value, schema, true, false, new Set(), entryLabel));
        }
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
        idInput.onchange = () => {
            const newId = idInput.value.trim();
            if (!newId || newId === key) {
                idInput.value = key;
                return;
            }
            if (container[newId] !== undefined) {
                alert('That id already exists.');
                idInput.value = key;
                return;
            }
            container[newId] = container[key];
            delete container[key];
            markDirty();
            renderActiveTab();
        };
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
            obj[field.key] = input.value === '' ? undefined : Number(input.value);
            onDirty();
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
        return { type: 'resource', resourceType: getOptions('resources')[0]?.value ?? '', amount: 1 };
    }

    function redraw() {
        body.innerHTML = '';
        if (obj[field.key] === undefined) return;

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
document.getElementById('check-map-btn').onclick = checkMap;
init();
