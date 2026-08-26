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
};

let cy;
/** The full per-tab data fetched by the most recent refreshGraph() — kept around so showNodeDetail() can look a clicked node's own raw entry back up without a second fetch. */
let lastGraphData = null;
/** Cached across Refresh clicks within one page session — same "fetch once, reuse" convention app.js's own imageAssetsPromise uses. */
let graphImageAssetsPromise = null;
function loadGraphImageAssets() {
    if (!graphImageAssetsPromise) {
        graphImageAssetsPromise = fetch('/api/images').then(r => r.json()).catch(() => ({ assets: [] }));
    }
    return graphImageAssetsPromise;
}

/** Fetches every tab this graph draws from, in parallel — a subset of what init() fetches for the whole editor, since not every tab (actions, entityViews, lootTables, characterViews, dynamicResourcePlacements, mapTiles) contributes a node or edge here. */
async function loadGraphData() {
    const ids = ['resources', 'items', 'tools', 'providers', 'buildings', 'shops', 'crafting', 'gates', 'queues'];
    const entries = await Promise.all(ids.map(async id => [id, await fetch(`/api/data/${id}`).then(r => r.json())]));
    return Object.fromEntries(entries);
}

/** True if `req` (a MilestoneRequirement — see MilestoneRequirement.ts) names a real source node this graph already has, given its own `type` discriminant. Returns the node id it points at, or undefined for a requirement that isn't fully filled in yet. */
function requirementSourceNodeId(req) {
    if (!req) return undefined;
    if (req.type === 'building' && req.buildingId) return `building:${req.buildingId}`;
    if (req.type === 'item' && req.item) return `item:${req.item}`;
    if (req.type === 'resource' && req.resourceType) return `resource:${req.resourceType}`;
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

    function addEdge(source, target, label) {
        if (!source || !target) return;
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

    return { nodes: [...nodes.values()], edges };
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

/** (Re)fetches every source tab and rebuilds the graph from scratch — the Refresh button's whole job, also called once when the tab first opens. Destroys any previous Cytoscape instance first; Cytoscape doesn't like being re-initialized onto the same container without that. */
async function refreshGraph(canvas, statusEl, panel) {
    statusEl.textContent = 'Loading…';
    try {
        const [data, { assets }] = await Promise.all([loadGraphData(), loadGraphImageAssets()]);
        lastGraphData = data;
        const iconByName = new Map(assets.map(a => [a.name, a.url]));
        const { nodes, edges } = buildGraphElements(data, iconByName);

        cy?.destroy();
        cy = cytoscape({
            container: canvas,
            elements: [...nodes, ...edges],
            style: graphStylesheet(),
            layout: { name: 'dagre', rankDir: 'LR', nodeSep: 30, rankSep: 90, animate: false },
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

        statusEl.textContent = `${nodes.length} nodes, ${edges.length} edges — click a node to highlight its own inputs/outputs and see its setup, click empty space to clear.`;
    } catch (err) {
        statusEl.textContent = `Failed to build graph: ${err.message}`;
    }
}

/** Entry point — called by app.js's renderActiveTab() whenever the Graph tab is active. Rebuilds its own DOM into `container` every time (cheap enough, and simplest way to guarantee no stale event handlers/detached Cytoscape instance survive a tab switch away and back). */
function renderGraphTab(container) {
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'primary';
    refreshBtn.textContent = 'Refresh';
    toolbar.appendChild(refreshBtn);

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

    refreshBtn.onclick = () => refreshGraph(canvas, status, panel);
    refreshGraph(canvas, status, panel);
}
