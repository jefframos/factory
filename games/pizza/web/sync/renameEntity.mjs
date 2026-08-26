// renameEntity.mjs
//
// A real RENAME for an id-keyed entity (a provider, a resource, a building,
// ...) — changes what id that row is stored/referenced under everywhere,
// instead of the old failure mode this file exists to replace: typing a
// different id in the browser and hitting Save just creates a BRAND NEW
// entry under the new id, silently orphaning the old one and leaving every
// OTHER file that referenced the old id string (AssetLibraryRegistry's
// matching key, map/tiles.json's providerType, a drop table's resourceType,
// ...) pointing at nothing — see this repo's own chat history for the
// stoneDeposit/crystalDeposit incidents that kept recurring because of
// this. renameEntity() does the whole thing atomically instead:
//
//   1. Renames the id in its OWN source file (ProviderTypes.ts, etc.) —
//      see renameOwnEntry()'s own doc for why a fixed-enum tab only ever
//      changes the enum member's underlying STRING VALUE, never its
//      declared NAME.
//   2. Renames the matching sibling key in whichever OTHER file this tab's
//      own `externalFields` routes into (AssetLibraryRegistry.ts, for
//      providers/resources).
//   3. Cascades the SAME id change into map/tiles.json's provider
//      placements (providers only).
//   4. Cascades into every OTHER tab's own JSON data wherever
//      CROSS_REFERENCES below says that tab holds a plain-string reference
//      into this id-space (drop tables, cost maps, recipe results,
//      requirement pickers, tool/view/loot-table fields, ...), re-running
//      the existing syncToSource() pipeline for each one so its own
//      source .ts file gets patched too — not just its JSON mirror.
//
// Deliberately does NOT try to be fully generic/schema-driven (there's no
// single machine-readable "field X on tab Y references id-space Z" table
// anywhere in this codebase — schemas.js's `source:` hints are close but
// browser-only, non-ESM, and don't cover the two special cases (externalFields,
// map/tiles.json) that aren't schema-driven at all) — CROSS_REFERENCES is a
// small, explicit, hand-maintained list instead. Add a new entry there
// whenever a new field starts referencing another tab's id by plain string.

import fs from 'node:fs/promises';
import { SyntaxKind } from 'ts-morph';
import { ENTITY_SOURCE_MAP } from './entityMap.mjs';
import { syncToSource, getSourceFile, getExportObjectLiteral, findProperty } from './syncToSource.mjs';

/** Renames `oldId` to `newId` as one property key of a plain (non-enum) object literal — remove + re-insert at the same index, carrying the initializer text over unchanged. Shared by both the enum-record "plain string key" case and every partialRecord/queues-byId case (which is ALWAYS plain-keyed, no enum involved at all). */
function renamePropertyKey(objLiteral, prop, newId) {
    const assignment = prop.asKindOrThrow(SyntaxKind.PropertyAssignment);
    const initText = assignment.getInitializerOrThrow().getText();
    const index = objLiteral.getProperties().indexOf(prop);
    prop.remove();
    objLiteral.insertPropertyAssignment(index, { name: JSON.stringify(newId), initializer: initText });
}

/**
 * Renames `oldId` to `newId` within ONE record-shaped source file/export — the id-keyed tab's
 * own primary config (ProviderTypes.ts's PROVIDER_CONFIG, AssetLibraryRegistry.ts's
 * ASSET_LIBRARY, ...). `exportName` lets callers target a specific export directly (needed for
 * `queues`, whose ids only live in QUEUE_CONFIG_BY_ID, a second export alongside the id-less
 * DEFAULT_QUEUE_CONFIG that `mapping.exportName` doesn't even name).
 *
 * For a FIXED-ENUM tab (kind: 'enumRecord'), this changes ONLY the enum member's underlying
 * string VALUE — its declared NAME is deliberately left untouched. Every other .ts file in the
 * codebase that references this id references it SYMBOLICALLY (`ProviderType.Stone`, never the
 * raw string `'stone'`), so leaving the name alone means a rename can NEVER dangle a reference
 * anywhere else in the game code, with no need to search the whole program for uses. The actual
 * "id" a designer types/sees in the editor has always been the enum's VALUE, not its member name
 * (see getPropertyKeyId()'s own doc in syncToSource.mjs) — that's the one piece of state that
 * needs to change, and it's exactly the piece nothing outside this file (and, after a rename,
 * this SAME record's own computed-key entry, which stays automatically correct since it
 * references the member by name — see below) ever looks at directly.
 *
 * If the record's own entry for this id is a PLAIN quoted-string key (`"stoneDeposit": {...}` —
 * how upsertEntryFields() always writes a brand-new entry, vs. the `[ProviderType.Stone]:`
 * computed-key style every hand-authored original entry uses) rather than a computed key, that
 * key text is ALSO renamed — a plain string key doesn't track the enum value change the way a
 * computed key automatically does, so leaving it alone would desync the record's own key from
 * the id it's actually supposed to represent.
 */
function renameOwnEntry(sourceFile, exportName, mapping, oldId, newId) {
    const recordLiteral = getExportObjectLiteral(sourceFile, exportName);
    const entryProp = findProperty(recordLiteral, oldId, sourceFile, mapping.enumName);
    if (!entryProp) {
        return { found: false };
    }

    if (mapping.kind === 'enumRecord') {
        const enumDecl = sourceFile.getEnumOrThrow(mapping.enumName);
        const member = enumDecl.getMembers().find(m => (m.getInitializer()?.getText() ?? '').replace(/^['"]|['"]$/g, '') === oldId);
        if (!member) {
            throw new Error(`enum "${mapping.enumName}" has no member valued "${oldId}"`);
        }
        member.setInitializer(JSON.stringify(newId));
    }

    const nameNode = entryProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getNameNode();
    if (nameNode.getKind() !== SyntaxKind.ComputedPropertyName) {
        renamePropertyKey(recordLiteral, entryProp, newId);
    }

    return { found: true };
}

/**
 * Renames the same key in a tab's own EDITOR JSON MIRROR (web/data/<tab>.json) — the AST-level
 * renameOwnEntry() above only ever touches the real source .ts file; without this, the file
 * would end up correctly renamed while the editor's OWN list still showed the old id (read
 * from the JSON mirror, not from the .ts file — see server.mjs's own doc on why the mirror
 * exists at all), and a later rename attempt could then fail with a confusing "already exists"
 * — the .ts file legitimately already has the new id, even though nothing in the browser's own
 * UI shows it yet. `mapping.kind === 'queues'` reads/writes the nested `byId` object, matching
 * QueueTypes.ts's own DEFAULT_QUEUE_CONFIG/QUEUE_CONFIG_BY_ID split (a queue id only ever lives
 * in `byId` — "default" has no id at all).
 */
function renameJsonKey(data, mapping, oldId, newId) {
    const container = mapping?.kind === 'queues' ? data?.byId : data;
    if (!container || container[oldId] === undefined) {
        return false;
    }
    container[newId] = container[oldId];
    delete container[oldId];
    return true;
}

/** True if `value === oldId`, replacing it with `newId` in place — the single-scalar-field case (a plain `tool`/`toolId`/`view`/`item` reference). Returns whether it actually matched. */
function renameScalar(obj, key, oldId, newId) {
    if (!obj || obj[key] !== oldId) {
        return false;
    }
    obj[key] = newId;
    return true;
}

/** A cost/requirements map's OWN KEYS are the referenced ids (`Partial<Record<ResourceType, number>>`) — rename the key, keep its amount. */
function renameCostMapKey(costMap, oldId, newId) {
    if (!costMap || !Object.prototype.hasOwnProperty.call(costMap, oldId)) {
        return false;
    }
    costMap[newId] = costMap[oldId];
    delete costMap[oldId];
    return true;
}

/** MilestoneRequirement is a `type`-discriminated union (see MilestoneRequirement.ts) — only the field matching its OWN current `type` is ever meaningful, so only that one needs checking. */
function renameRequirement(requirement, oldId, newId) {
    if (!requirement) {
        return false;
    }
    switch (requirement.type) {
        case 'building': return renameScalar(requirement, 'buildingId', oldId, newId);
        case 'item': return renameScalar(requirement, 'item', oldId, newId);
        case 'resource': return renameScalar(requirement, 'resourceType', oldId, newId);
        default: return false;
    }
}

/** Runs `fn` over every entry of a record-shaped tab's data (or every item of an array-shaped one) — a plain reduce-to-`changed` helper so every CROSS_REFERENCES entry below doesn't have to repeat this loop. */
function forEachEntry(data, fn) {
    let changed = false;
    const entries = Array.isArray(data) ? data : Object.values(data ?? {});
    for (const entry of entries) {
        if (fn(entry)) {
            changed = true;
        }
    }
    return changed;
}

/**
 * Which OTHER tabs hold a plain-string reference INTO a given tab's id-space, and how to
 * rename one in place — see this file's own doc for why this is a small hand-maintained list
 * rather than something derived from schemas.js. Each entry's `apply(data, oldId, newId)`
 * mutates that OTHER tab's already-loaded JSON data (the exact shape syncToSource() expects
 * back) and returns whether it actually changed anything — an unaffected tab is left
 * completely untouched (no wasted resync, no spurious warnings).
 *
 * NOT included: `tools`/`items` — a ToolId and an ItemType happen to share the same string
 * value for axe/pickaxe BY CONVENTION (see AutoGatherController's own doc on that cast), not
 * because either references the other's id-space. Renaming one independently of the other is
 * legitimate (they're two separately-keyed enums), so this deliberately does NOT auto-link
 * them — but it DOES mean renaming a tool used as a gather requirement needs its matching item
 * id updated by hand too, if you want them to keep matching.
 */
/**
 * Tabs whose OWN entries are keyed by the SAME id as another tab's entry — not a field
 * pointing at it (that's CROSS_REFERENCES below), the id itself IS the join, same shape as
 * providers'/resources' own `externalFields` link into assetLibrary except this one isn't
 * declared in entityMap.mjs at all (questGivers manages its own separate fields, never routes
 * a save THROUGH the queues tab the way externalFields does) — see manifest.json's own
 * sourceHint on `questGivers` ("OPTIONAL per queue id"). Renamed the same way as an
 * externalFields sibling: best-effort, silently skipped if this id never had a matching entry.
 */
const IDENTITY_SIBLINGS = {
    queues: ['questGivers'],
};

const CROSS_REFERENCES = {
    resources: [
        { tab: 'providers', apply: (data, oldId, newId) => forEachEntry(data, p => forEachEntry(p.drops, d => renameScalar(d, 'resourceType', oldId, newId))) },
        { tab: 'queues', apply: (data, oldId, newId) => {
            const inDefault = forEachEntry(data.default?.possibleTasks, t => renameScalar(t, 'resourceType', oldId, newId));
            const inById = forEachEntry(data.byId, q => forEachEntry(q.possibleTasks, t => renameScalar(t, 'resourceType', oldId, newId)));
            return inDefault || inById;
        } },
        { tab: 'lootTables', apply: (data, oldId, newId) => forEachEntry(data, t => forEachEntry(t.possibleTasks, task => renameScalar(task, 'resourceType', oldId, newId))) },
        { tab: 'buildings', apply: (data, oldId, newId) => forEachEntry(data, b => forEachEntry(b.levels, l => renameCostMapKey(l.requirements, oldId, newId)) || renameRequirement(b.appearRequirement, oldId, newId)) },
        { tab: 'crafting', apply: (data, oldId, newId) => forEachEntry(data, c => forEachEntry(c.recipes, r => renameCostMapKey(r.cost, oldId, newId)) || renameRequirement(c.appearRequirement, oldId, newId)) },
        { tab: 'shops', apply: (data, oldId, newId) => forEachEntry(data, s => renameRequirement(s.appearRequirement, oldId, newId)) },
        { tab: 'gates', apply: (data, oldId, newId) => forEachEntry(data, g => renameRequirement(g.requirement, oldId, newId)) },
    ],
    providers: [
        // No other TAB references a provider by id (nothing lets you pick one) — only
        // map/tiles.json's own resources[].providerType does, handled separately in
        // renameEntity() below since mapTiles isn't a syncToSource()-backed tab at all.
    ],
    items: [
        { tab: 'crafting', apply: (data, oldId, newId) => forEachEntry(data, c => forEachEntry(c.recipes, r => renameScalar(r.result, 'item', oldId, newId))) },
        { tab: 'buildings', apply: (data, oldId, newId) => forEachEntry(data, b => renameRequirement(b.appearRequirement, oldId, newId)) },
        { tab: 'crafting', apply: (data, oldId, newId) => forEachEntry(data, c => renameRequirement(c.appearRequirement, oldId, newId)) },
        { tab: 'shops', apply: (data, oldId, newId) => forEachEntry(data, s => renameRequirement(s.appearRequirement, oldId, newId)) },
        { tab: 'queues', apply: (data, oldId, newId) => renameRequirement(data.default?.appearRequirement, oldId, newId) || forEachEntry(data.byId, q => renameRequirement(q.appearRequirement, oldId, newId)) },
        { tab: 'gates', apply: (data, oldId, newId) => forEachEntry(data, g => renameRequirement(g.requirement, oldId, newId)) },
    ],
    buildings: [
        { tab: 'gates', apply: (data, oldId, newId) => forEachEntry(data, g => renameRequirement(g.requirement, oldId, newId)) },
        { tab: 'shops', apply: (data, oldId, newId) => forEachEntry(data, s => renameRequirement(s.appearRequirement, oldId, newId)) },
        { tab: 'crafting', apply: (data, oldId, newId) => forEachEntry(data, c => renameRequirement(c.appearRequirement, oldId, newId)) },
        { tab: 'queues', apply: (data, oldId, newId) => renameRequirement(data.default?.appearRequirement, oldId, newId) || forEachEntry(data.byId, q => renameRequirement(q.appearRequirement, oldId, newId)) },
    ],
    tools: [
        { tab: 'shops', apply: (data, oldId, newId) => forEachEntry(data, s => renameScalar(s, 'tool', oldId, newId)) },
        { tab: 'actions', apply: (data, oldId, newId) => forEachEntry(data, a => renameScalar(a, 'tool', oldId, newId)) },
        { tab: 'crafting', apply: (data, oldId, newId) => forEachEntry(data, c => renameScalar(c, 'toolId', oldId, newId)) },
    ],
    entityViews: [
        { tab: 'gates', apply: (data, oldId, newId) => forEachEntry(data, g => renameScalar(g, 'view', oldId, newId)) },
        { tab: 'buildings', apply: (data, oldId, newId) => forEachEntry(data, b => renameScalar(b, 'baseView', oldId, newId) || forEachEntry(b.levels, l => renameScalar(l, 'view', oldId, newId))) },
        { tab: 'shops', apply: (data, oldId, newId) => forEachEntry(data, s => renameScalar(s, 'baseView', oldId, newId) || forEachEntry(s.levels, l => renameScalar(l, 'view', oldId, newId))) },
        { tab: 'queues', apply: (data, oldId, newId) => renameScalar(data.default, 'view', oldId, newId) || forEachEntry(data.byId, q => renameScalar(q, 'view', oldId, newId)) },
    ],
    lootTables: [
        { tab: 'questGivers', apply: (data, oldId, newId) => forEachEntry(data, q => forEachEntry(q.variants, v => renameScalar(v, 'lootTable', oldId, newId))) },
    ],
};

/**
 * Entry point — renames `oldId` to `newId` everywhere this codebase's editor tooling knows
 * that id can appear: this tab's own source file, its externalFields sibling (if any),
 * map/tiles.json (providers only), and every OTHER tab CROSS_REFERENCES lists for this one.
 * Returns `{ warnings }`; throws if `entityId`/`oldId` don't resolve to a real, renameable
 * entry, or if `newId` already names an existing entry (renaming onto an occupied id would
 * silently merge/overwrite two unrelated rows, which is never what a rename means).
 */
export async function renameEntity(entityId, oldId, newId, { loadAllData, writeTabData, tilesFile, webTilesFile }) {
    const mapping = ENTITY_SOURCE_MAP[entityId];
    if (!mapping) {
        throw new Error(`"${entityId}" has no ENTITY_SOURCE_MAP entry — nothing to rename`);
    }
    if (!newId || !/^[A-Za-z][A-Za-z0-9_]*$/.test(newId)) {
        throw new Error(`"${newId}" isn't a valid id — must start with a letter, letters/digits/underscore only`);
    }
    if (oldId === newId) {
        throw new Error('new id is the same as the current one');
    }

    const warnings = [];
    const refreshedThisSync = new Set();
    // Loaded ONCE and reused for every step below (own tab, externalFields sibling, identity
    // sibling, cross-reference cascade) — every one of those needs the editor's own JSON
    // mirror kept in sync alongside the real .ts source file (see renameJsonKey()'s own doc
    // for why skipping this desyncs the browser's UI from what's actually on disk), and a
    // `touchedTabs` Set (not a write-as-you-go pattern) means a tab touched by more than one
    // step (unlikely today, but e.g. a future CROSS_REFERENCES entry sharing a tab with an
    // IDENTITY_SIBLINGS one) still only gets written once, with every change applied.
    const allData = await loadAllData();
    const touchedTabs = new Set();

    // 1. This tab's own source file + its own JSON mirror.
    const sourceFile = getSourceFile(mapping.file, refreshedThisSync);
    const ownExportName = mapping.kind === 'queues' ? mapping.byIdExportName : mapping.exportName;
    const existingNewEntry = findProperty(getExportObjectLiteral(sourceFile, ownExportName), newId, sourceFile, mapping.enumName);
    if (existingNewEntry) {
        throw new Error(`"${newId}" already exists on this tab — pick a different id`);
    }
    const { found } = renameOwnEntry(sourceFile, ownExportName, mapping, oldId, newId);
    if (!found) {
        // `notFound: true` (not just message text) lets the client tell this apart from every
        // other failure — e.g. a brand-new, not-yet-Saved duplicate/added entry that only
        // exists in the browser's own local draft has nothing here to rename YET, which isn't
        // a real error at all, just a "do it locally instead" signal (see app.js's own
        // renameEntry(), the one reader).
        const err = new Error(`no "${oldId}" entry found to rename — it may not be saved yet`);
        err.notFound = true;
        throw err;
    }
    await sourceFile.save();
    if (renameJsonKey(allData[entityId], mapping, oldId, newId)) {
        touchedTabs.add(entityId);
    }

    // 2. externalFields sibling (providers/resources -> assetLibrary, same id).
    for (const targetMappingId of new Set(Object.values(mapping.externalFields ?? {}))) {
        const targetMapping = ENTITY_SOURCE_MAP[targetMappingId];
        if (!targetMapping) {
            continue;
        }
        const targetSourceFile = getSourceFile(targetMapping.file, refreshedThisSync);
        const { found: siblingFound } = renameOwnEntry(targetSourceFile, targetMapping.exportName, targetMapping, oldId, newId);
        if (siblingFound) {
            await targetSourceFile.save();
            if (renameJsonKey(allData[targetMappingId], targetMapping, oldId, newId)) {
                touchedTabs.add(targetMappingId);
            }
        }
    }

    // 2b. IDENTITY_SIBLINGS (questGivers keyed by the same queue id — see its own doc).
    for (const siblingId of IDENTITY_SIBLINGS[entityId] ?? []) {
        const siblingMapping = ENTITY_SOURCE_MAP[siblingId];
        if (!siblingMapping) {
            continue;
        }
        const siblingSourceFile = getSourceFile(siblingMapping.file, refreshedThisSync);
        const { found: siblingFound } = renameOwnEntry(siblingSourceFile, siblingMapping.exportName, siblingMapping, oldId, newId);
        if (siblingFound) {
            await siblingSourceFile.save();
            if (renameJsonKey(allData[siblingId], siblingMapping, oldId, newId)) {
                touchedTabs.add(siblingId);
            }
        }
    }

    // 3. map/tiles.json's provider placements — providers only, since mapTiles isn't a
    // syncToSource()-backed tab (its real runtime source IS the JSON itself — see
    // server.mjs's own doc on the mapTiles PUT path).
    if (entityId === 'providers' && tilesFile && webTilesFile) {
        for (const file of [tilesFile, webTilesFile]) {
            const raw = JSON.parse(await fs.readFile(file, 'utf-8'));
            const changed = forEachEntry(raw.resources, r => renameScalar(r, 'providerType', oldId, newId));
            if (changed) {
                await fs.writeFile(file, JSON.stringify(raw, null, 4) + '\n', 'utf-8');
            }
        }
    }

    // 4. Every other tab CROSS_REFERENCES lists for this id-space.
    for (const { tab, apply } of CROSS_REFERENCES[entityId] ?? []) {
        if (apply(allData[tab], oldId, newId)) {
            touchedTabs.add(tab);
        }
    }

    // Persist every touched tab's JSON mirror, then re-sync each one's real source .ts file
    // from that same updated data — steps 1/2/2b already patched their OWN source files
    // directly via ts-morph (a plain syncToSource() re-run would just be a no-op confirming
    // the same id again), but a CROSS_REFERENCES tab's source file has never been touched yet
    // at this point, so it still needs the ordinary sync path to actually receive its change.
    for (const tab of touchedTabs) {
        await writeTabData(tab, allData[tab]);
        if (tab === entityId || Object.values(mapping.externalFields ?? {}).includes(tab) || (IDENTITY_SIBLINGS[entityId] ?? []).includes(tab)) {
            continue;
        }
        try {
            const result = await syncToSource(tab, allData[tab]);
            if (result.warnings?.length) {
                warnings.push(...result.warnings.map(w => `[${tab}] ${w}`));
            }
        } catch (err) {
            warnings.push(`"${tab}" was updated in the editor's own data file, but writing the cascade into its source .ts file failed: ${err.message}`);
        }
    }

    return { warnings };
}
