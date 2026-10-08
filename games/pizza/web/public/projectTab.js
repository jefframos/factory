// projectTab.js
//
// The Project tab — project upkeep, not game data. One section for now, Models
// (server side: web/sync/modelAudit.mjs):
//   - every model in raw-assets/models with what uses it (the Tiled map, game code, editor data)
//     and a toggle: green = used (always kept, can't be turned off), orange = unused but FORCED
//     on (kept anyway), grey = unused -> in raw-assets/models-ignore.json, so `npm run models`
//     skips it (not registered, not copied to public). Toggling saves the ignore list right away.
//   - Refresh re-scans everything (after editing the map/code/data).
//   - "Move unused to legacy" moves every grey model to raw-assets/legacy/models (listed in
//     raw-assets/legacy/legacy.json) — the Legacy list below shows them; tick some and "Move back"
//     returns them to raw-assets/models (forced, so they're kept).
//   - "Rebuild models" runs the real models build so the registry/public folder follow.
// Loaded before app.js; renderProjectTab() is called from its renderActiveTab().

const projectState = {
    audit: null,
    error: null,
    busy: false,
    message: '',
    query: '',
    filter: 'all',
    group: '',
    legacySelected: new Set(),
};

function formatBytes(bytes) {
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
}

async function projectRequest(url, body) {
    projectState.busy = true;
    renderProjectContent();
    try {
        const result = await fetchJson(url, body === undefined
            ? undefined
            : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        projectState.error = null;
        return result;
    } catch (err) {
        projectState.error = String(err.message ?? err);
        return undefined;
    } finally {
        projectState.busy = false;
    }
}

async function refreshModelAudit() {
    const audit = await projectRequest('/api/model-audit');
    if (audit) {
        projectState.audit = audit;
        projectState.message = `Scanned ${audit.models.length} models.`;
    }
    renderProjectContent();
}

async function setForced(path, forced) {
    const current = projectState.audit.models.filter(m => m.forced).map(m => m.path);
    const next = forced ? [...current, path] : current.filter(p => p !== path);
    const audit = await projectRequest('/api/model-audit/forced', { forced: next });
    if (audit) {
        projectState.audit = audit;
        projectState.message = `${forced ? 'Kept' : 'Ignoring'} ${path} — saved to ${audit.paths.ignoreFile}. Rebuild models to apply.`;
    }
    renderProjectContent();
}

async function moveUnusedModels() {
    const unused = projectState.audit.models.filter(m => !m.used && !m.forced);
    if (unused.length === 0) {
        projectState.message = 'Nothing to move — every model is used or forced.';
        renderProjectContent();
        return;
    }
    const size = formatBytes(unused.reduce((sum, m) => sum + m.size, 0));
    if (!window.confirm(`Move ${unused.length} unused model file(s) (${size}) from raw-assets/models to raw-assets/legacy/models?\n\nThey're listed in raw-assets/legacy/legacy.json and can be moved back from this tab.`)) {
        return;
    }
    const result = await projectRequest('/api/model-audit/move-unused', {});
    if (result) {
        projectState.audit = result.audit;
        projectState.message = `Moved ${result.moved} model(s) (${formatBytes(result.bytes)}) to the legacy folder. Rebuild models to update the registry.`;
    }
    renderProjectContent();
}

async function restoreLegacyModels() {
    const paths = [...projectState.legacySelected];
    if (paths.length === 0) {
        return;
    }
    const result = await projectRequest('/api/model-audit/restore', { paths });
    if (result) {
        projectState.audit = result.audit;
        projectState.legacySelected.clear();
        projectState.message = `Moved ${result.restored} model(s) back to raw-assets/models (kept as forced). Rebuild models to register them.`;
    }
    renderProjectContent();
}

async function rebuildModels() {
    projectState.message = 'Running the models build…';
    const result = await projectRequest('/api/model-audit/build', {});
    if (result) {
        projectState.message = `Models rebuilt.\n${result.output ?? ''}`;
    }
    renderProjectContent();
}

let projectContainer = null;

function renderProjectTab(container) {
    projectContainer = container;
    if (!projectState.audit && !projectState.busy) {
        void refreshModelAudit();
    }
    renderProjectContent();
}

function renderProjectContent() {
    const container = projectContainer;
    if (!container || activeId !== PROJECT_TAB_ID) {
        return;
    }
    container.innerHTML = '';

    const title = document.createElement('h2');
    title.className = 'project-title';
    title.textContent = 'Models';
    container.appendChild(title);

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.gap = '8px';
    const button = (label, onClick, primary = false) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        if (primary) btn.className = 'primary';
        btn.disabled = projectState.busy;
        btn.onclick = onClick;
        left.appendChild(btn);
        return btn;
    };
    button('Refresh', () => void refreshModelAudit(), true);
    button('Move unused to legacy', () => void moveUnusedModels());
    button('Rebuild models (npm run models)', () => void rebuildModels());
    toolbar.appendChild(left);
    const status = document.createElement('span');
    status.className = 'status';
    status.textContent = projectState.busy ? 'Working…' : '';
    toolbar.appendChild(status);
    container.appendChild(toolbar);

    if (projectState.error) {
        const err = document.createElement('div');
        err.className = 'map-check-banner error';
        err.textContent = projectState.error;
        container.appendChild(err);
    }
    if (projectState.message) {
        const msg = document.createElement('pre');
        msg.className = 'project-message';
        msg.textContent = projectState.message;
        container.appendChild(msg);
    }

    const audit = projectState.audit;
    if (!audit) {
        return;
    }

    // Summary
    const models = audit.models;
    const used = models.filter(m => m.used);
    const forced = models.filter(m => m.forced);
    const ignored = models.filter(m => !m.used && !m.forced);
    const sum = list => formatBytes(list.reduce((total, m) => total + m.size, 0));
    const summary = document.createElement('div');
    summary.className = 'project-summary';
    summary.innerHTML = `
        <span><b>${models.length}</b> models</span>
        <span class="model-chip used">${used.length} used · ${sum(used)}</span>
        <span class="model-chip forced">${forced.length} forced · ${sum(forced)}</span>
        <span class="model-chip off">${ignored.length} ignored · ${sum(ignored)}</span>
        <span class="model-chip legacy">${audit.legacy.length} in legacy</span>
        <span class="muted">${audit.paths.ignoreFile} ${audit.ignoreFileExists ? '' : '(not written yet — toggle something or Move unused)'}</span>`;
    container.appendChild(summary);

    // Filters
    const filters = document.createElement('div');
    filters.className = 'project-filters';
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search name / path / used by…';
    search.value = projectState.query;
    search.oninput = () => {
        projectState.query = search.value;
        renderModelRows(table, models);
    };
    const filterSelect = document.createElement('select');
    for (const [value, label] of [['all', 'All'], ['used', 'Used'], ['forced', 'Forced (orange)'], ['ignored', 'Ignored (off)']]) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        filterSelect.appendChild(opt);
    }
    filterSelect.value = projectState.filter;
    filterSelect.onchange = () => {
        projectState.filter = filterSelect.value;
        renderModelRows(table, models);
    };
    const groupSelect = document.createElement('select');
    const allGroups = document.createElement('option');
    allGroups.value = '';
    allGroups.textContent = 'All groups';
    groupSelect.appendChild(allGroups);
    for (const group of [...new Set(models.map(m => m.group))].sort()) {
        const opt = document.createElement('option');
        opt.value = group;
        opt.textContent = group;
        groupSelect.appendChild(opt);
    }
    groupSelect.value = projectState.group;
    groupSelect.onchange = () => {
        projectState.group = groupSelect.value;
        renderModelRows(table, models);
    };
    filters.append(search, filterSelect, groupSelect);
    container.appendChild(filters);

    const table = document.createElement('table');
    table.className = 'project-table';
    container.appendChild(table);
    renderModelRows(table, models);

    // Legacy
    const legacyTitle = document.createElement('h2');
    legacyTitle.className = 'project-title';
    legacyTitle.textContent = `Legacy folder (${audit.paths.legacyList})`;
    container.appendChild(legacyTitle);
    if (audit.legacy.length === 0) {
        container.appendChild(Object.assign(document.createElement('p'), { className: 'muted', textContent: 'Empty — "Move unused to legacy" puts every ignored model here.' }));
        return;
    }
    const legacyBar = document.createElement('div');
    legacyBar.className = 'toolbar';
    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'primary';
    restoreBtn.textContent = `Move back selected (${projectState.legacySelected.size})`;
    restoreBtn.disabled = projectState.busy || projectState.legacySelected.size === 0;
    restoreBtn.onclick = () => void restoreLegacyModels();
    legacyBar.appendChild(restoreBtn);
    container.appendChild(legacyBar);

    const legacyTable = document.createElement('table');
    legacyTable.className = 'project-table';
    legacyTable.innerHTML = '<colgroup><col class="col-toggle"><col class="col-model"><col><col class="col-size"><col class="col-moved"></colgroup>'
        + '<thead><tr><th>Move back</th><th>Model</th><th>Path</th><th>Size</th><th>Moved</th></tr></thead>';
    const body = document.createElement('tbody');
    for (const entry of audit.legacy) {
        const row = document.createElement('tr');
        const toggleCell = document.createElement('td');
        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.checked = projectState.legacySelected.has(entry.path);
        toggle.onchange = () => {
            if (toggle.checked) projectState.legacySelected.add(entry.path);
            else projectState.legacySelected.delete(entry.path);
            restoreBtn.textContent = `Move back selected (${projectState.legacySelected.size})`;
            restoreBtn.disabled = projectState.busy || projectState.legacySelected.size === 0;
        };
        toggleCell.appendChild(toggle);
        row.appendChild(toggleCell);
        for (const text of [entry.ref, entry.path, formatBytes(entry.size ?? 0), (entry.movedAt ?? '').slice(0, 10)]) {
            row.appendChild(textCell(text));
        }
        body.appendChild(row);
    }
    legacyTable.appendChild(body);
    container.appendChild(legacyTable);
}

/** One-line cell — overflow is cut with "…", the full text is the hover tooltip. */
function textCell(text, extraClass = '') {
    return Object.assign(document.createElement('td'), { textContent: text, title: text, className: `cell-text ${extraClass}`.trim() });
}

/** "Used by": one source as plain text; several collapse to "N sources · first…", click to expand the full list. */
function sourcesCell(sources) {
    const cell = document.createElement('td');
    cell.className = 'model-sources';
    if (sources.length <= 1) {
        cell.classList.add('cell-text');
        cell.textContent = sources[0] ?? '—';
        cell.title = sources[0] ?? '';
        return cell;
    }
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `${sources.length} sources · ${sources[0]}`;
    const list = document.createElement('ul');
    for (const source of sources) {
        list.appendChild(Object.assign(document.createElement('li'), { textContent: source }));
    }
    details.append(summary, list);
    cell.appendChild(details);
    return cell;
}

function renderModelRows(table, models) {
    const query = projectState.query.trim().toLowerCase();
    const rows = models.filter(m => {
        if (projectState.group && m.group !== projectState.group) return false;
        if (projectState.filter === 'used' && !m.used) return false;
        if (projectState.filter === 'forced' && !m.forced) return false;
        if (projectState.filter === 'ignored' && (m.used || m.forced)) return false;
        if (!query) return true;
        return m.ref.toLowerCase().includes(query) || m.path.toLowerCase().includes(query) || m.sources.some(s => s.toLowerCase().includes(query));
    });

    table.innerHTML = '<colgroup><col class="col-toggle"><col class="col-model"><col class="col-path"><col class="col-size"><col></colgroup>'
        + '<thead><tr><th>In project</th><th>Model</th><th>Path</th><th>Size</th><th>Used by</th></tr></thead>';
    const body = document.createElement('tbody');
    for (const model of rows) {
        const row = document.createElement('tr');
        const toggleCell = document.createElement('td');
        const toggle = document.createElement('button');
        const state = model.used ? 'used' : model.forced ? 'forced' : 'off';
        toggle.className = `model-toggle ${state}`;
        toggle.textContent = model.used ? 'Used' : model.forced ? 'Forced' : 'Off';
        toggle.title = model.used
            ? 'Used by the game — always kept'
            : model.forced ? 'Unused, but kept anyway — click to ignore it' : 'Unused — ignored by the models build. Click to force it in';
        toggle.disabled = model.used || projectState.busy;
        if (!model.used) {
            toggle.onclick = () => void setForced(model.path, !model.forced);
        }
        toggleCell.appendChild(toggle);
        row.appendChild(toggleCell);
        row.appendChild(textCell(model.ref));
        row.appendChild(textCell(model.path, 'muted'));
        row.appendChild(textCell(formatBytes(model.size)));
        row.appendChild(sourcesCell(model.sources));
        body.appendChild(row);
    }
    table.appendChild(body);
    const caption = document.createElement('caption');
    caption.textContent = `${rows.length} of ${models.length} shown`;
    table.prepend(caption);
}
