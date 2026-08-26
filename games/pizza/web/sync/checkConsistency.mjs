// checkConsistency.mjs
//
// Compares the editor's own JSON mirrors (web/data/*.json — what the
// browser UI actually shows) against what's REALLY sitting in the game's
// source .ts files right now, and reports every place they've drifted
// apart: an id present in one but not the other, or a managed field whose
// value differs between the two. This is exactly the failure mode this
// tool's own history kept re-discovering by hand — a stale sync, a rename
// that didn't fully cascade, an editor server still running old code — so
// this makes it checkable in one click (the header's "Check consistency"
// button, see app.js) instead of hunting file-by-file.
//
// Read-only: never writes anything, anywhere. Where syncToSource.mjs turns
// posted JSON INTO source text, this does the reverse — reads existing
// source AST nodes back OUT into plain JSON-shaped values — so the two
// naturally use the exact same id/enum resolution helpers
// (getPropertyKeyId/resolveEnumMemberValue) to stay in agreement about
// what a given piece of source syntax actually MEANS.

import { SyntaxKind } from 'ts-morph';
import { ENTITY_SOURCE_MAP } from './entityMap.mjs';
import { getSourceFile, getExportObjectLiteral, getPropertyKeyId, resolveEnumMemberValue } from './syncToSource.mjs';

/** Same "MODELS.Group.Key -> bare dot-path" reversal isModelRefArray()/serializeField() use on the way IN — see syncToSource.mjs's own doc on why `models` gets this special treatment instead of being read as a generic property-access reference. */
function isModelsField(key) {
    return key === 'models';
}

/** Reads one AST value node back into a plain JSON-shaped value — the inverse of serializeValue()/serializeField() in syncToSource.mjs. `key` (the field name this node is the value OF, if any) is only needed to disambiguate a PropertyAccessExpression: `MODELS.Group.Key` (only ever appears as a `models` array element) vs `EnumName.Member` (every other enum-typed field). */
function deserializeNode(node, sourceFile, refreshedThisSync, key) {
    if (!node) {
        return undefined;
    }

    const kind = node.getKind();
    if (kind === SyntaxKind.StringLiteral || kind === SyntaxKind.NoSubstitutionTemplateLiteral) {
        return node.getLiteralText();
    }
    if (kind === SyntaxKind.NumericLiteral) {
        return Number(node.getText());
    }
    if (kind === SyntaxKind.TrueKeyword) {
        return true;
    }
    if (kind === SyntaxKind.FalseKeyword) {
        return false;
    }
    if (kind === SyntaxKind.PrefixUnaryExpression) {
        // A negative numeric literal (-1, ...) parses as a unary expression wrapping the
        // literal, not a NumericLiteral itself — Number() on the whole node's own text still
        // parses correctly either way.
        return Number(node.getText());
    }
    if (kind === SyntaxKind.ArrayLiteralExpression) {
        return node.getElements().map(el => deserializeNode(el, sourceFile, refreshedThisSync, key));
    }
    if (kind === SyntaxKind.ObjectLiteralExpression) {
        const obj = {};
        for (const prop of node.getProperties()) {
            const assignment = prop.asKind(SyntaxKind.PropertyAssignment);
            if (!assignment) {
                continue;
            }
            const propKey = getPropertyKeyId(prop, sourceFile);
            obj[propKey] = deserializeNode(assignment.getInitializer(), sourceFile, refreshedThisSync, propKey);
        }
        return obj;
    }
    if (kind === SyntaxKind.PropertyAccessExpression) {
        const parts = node.getText().split('.');
        if (isModelsField(key) && parts[0] === 'MODELS') {
            return parts.slice(1).join('.');
        }
        if (parts.length === 2) {
            const [enumName, memberName] = parts;
            const value = resolveEnumMemberValue(sourceFile, enumName, memberName, refreshedThisSync);
            if (value !== undefined) {
                return value;
            }
        }
        return node.getText();
    }

    return node.getText();
}

/** Reads every entry of a record-shaped export back into `{ [id]: { [managedKey]: value } }` — only `mapping.managedKeys` are read (this tool has no opinion on unmanaged fields, same as the write side). */
function readRecord(recordLiteral, sourceFile, mapping, refreshedThisSync) {
    const result = {};
    for (const prop of recordLiteral.getProperties()) {
        const assignment = prop.asKind(SyntaxKind.PropertyAssignment);
        if (!assignment) {
            continue;
        }
        const id = getPropertyKeyId(prop, sourceFile, mapping.enumName);
        if (!id) {
            continue;
        }
        const entryLiteral = assignment.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
        const entry = {};
        for (const key of mapping.managedKeys ?? []) {
            const fieldProp = entryLiteral?.getProperties().find(p => getPropertyKeyId(p, sourceFile) === key);
            const fieldAssignment = fieldProp?.asKind(SyntaxKind.PropertyAssignment);
            let value = fieldAssignment ? deserializeNode(fieldAssignment.getInitializer(), sourceFile, refreshedThisSync, key) : undefined;

            // listMerge fields (BuildingLevelConfig.levels, ShopUpgradeLevel.levels, ...) carry
            // UNMANAGED sibling sub-fields the editor never sees at all (a level's own `mesh`,
            // e.g.) — see entityMap.mjs's own doc on listMerge. Comparing the whole item object
            // would flag those as a permanent, meaningless "difference" on every single level of
            // every building/shop, since the editor's own JSON never had `mesh` to begin with.
            // Only the sub-keys THIS field's listMerge actually manages are ever comparable.
            const listItemKeys = mapping.listMerge?.[key];
            if (listItemKeys && Array.isArray(value)) {
                value = value.map(item => Object.fromEntries(listItemKeys.map(k => [k, item?.[k]])));
            }

            entry[key] = value;
        }
        result[id] = entry;
    }
    return result;
}

/** Plain recursive deep-equal — good enough for a comparison report, not a hot path. undefined and a missing key are treated as equal (both "not set"), matching how the editor's own optional fields behave. */
function deepEqual(a, b) {
    if (a === b) {
        return true;
    }
    if (a === undefined || b === undefined || a === null || b === null) {
        return a === b;
    }
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
            return false;
        }
        return a.every((v, i) => deepEqual(v, b[i]));
    }
    if (typeof a === 'object' && typeof b === 'object') {
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        return [...keys].every(k => deepEqual(a[k], b[k]));
    }
    return false;
}

function formatValue(value) {
    return value === undefined ? '(not set)' : JSON.stringify(value);
}

/** Compares one tab's editor-vs-game records, appending human-readable lines to `report`. `skipKeys` (fields routed elsewhere via externalFields) are checked by checkExternalFields() instead, not here — comparing them against THIS file would always mismatch, since they were never written here in the first place. */
function compareRecords(entityId, editorRecord, gameRecord, mapping, report) {
    const editorIds = Object.keys(editorRecord ?? {});
    const gameIds = Object.keys(gameRecord);
    const skipKeys = new Set(Object.keys(mapping.externalFields ?? {}));

    for (const id of editorIds) {
        if (!gameIds.includes(id)) {
            report.push(`[${entityId}] "${id}" — in the editor, MISSING from the game source`);
        }
    }
    for (const id of gameIds) {
        if (!editorIds.includes(id)) {
            report.push(`[${entityId}] "${id}" — in the game source, MISSING from the editor`);
        }
    }

    for (const id of editorIds) {
        if (!gameIds.includes(id)) {
            continue;
        }
        for (const key of mapping.managedKeys ?? []) {
            if (skipKeys.has(key)) {
                continue;
            }
            let editorValue = editorRecord[id]?.[key];
            const gameValue = gameRecord[id]?.[key];

            // Same listMerge sub-field scoping readRecord() applies to the GAME side (see its
            // own doc) — the editor's own posted array items should already only ever carry
            // these keys, but scoping both sides identically keeps this comparison symmetric
            // regardless of what a stale JSON mirror might still have lying around on one.
            const listItemKeys = mapping.listMerge?.[key];
            if (listItemKeys && Array.isArray(editorValue)) {
                editorValue = editorValue.map(item => Object.fromEntries(listItemKeys.map(k => [k, item?.[k]])));
            }

            if (!deepEqual(editorValue, gameValue)) {
                report.push(`[${entityId}.${id}.${key}] editor=${formatValue(editorValue)}  game=${formatValue(gameValue)}`);
            }
        }
    }
}

/** externalFields (providers'/resources' icon/models/scale/rotationDeg -> assetLibrary, same id) live in a DIFFERENT file than the tab's own — checked against that target's own game-read record instead of the tab's own. */
function checkExternalFields(entityId, editorRecord, mapping, allGameRecords, report) {
    for (const [fieldKey, targetMappingId] of Object.entries(mapping.externalFields ?? {})) {
        const targetGameRecord = allGameRecords[targetMappingId];
        if (!targetGameRecord) {
            continue;
        }
        for (const [id, entry] of Object.entries(editorRecord ?? {})) {
            const editorValue = entry?.[fieldKey];
            if (editorValue === undefined) {
                continue;
            }
            const gameValue = targetGameRecord[id]?.[fieldKey];
            if (!deepEqual(editorValue, gameValue)) {
                report.push(`[${entityId}.${id}.${fieldKey}] editor=${formatValue(editorValue)}  game(${targetMappingId})=${formatValue(gameValue)}`);
            }
        }
    }
}

/**
 * Entry point — returns a plain-text report (one line per drift found, empty string if none).
 * `loadAllData` is injected the same way renameEntity.mjs takes it, so this stays server.mjs-
 * agnostic about how the editor's own JSON mirrors are actually stored/read.
 */
export async function checkConsistency({ loadAllData }) {
    const allData = await loadAllData();
    const refreshedThisSync = new Set();
    const report = [];

    // Every record/queues-shaped tab's real game data, read ONCE up front — both the main
    // per-tab comparison AND checkExternalFields() (which needs OTHER tabs' already-read game
    // records, e.g. providers' check needs assetLibrary's) read from this same map, so a
    // shared tab is never re-parsed twice in one run.
    const gameRecordsByTab = {};
    for (const [entityId, mapping] of Object.entries(ENTITY_SOURCE_MAP)) {
        if (mapping.kind === 'array') {
            continue;
        }
        try {
            const sourceFile = getSourceFile(mapping.file, refreshedThisSync);
            const ownExportName = mapping.kind === 'queues' ? mapping.byIdExportName : mapping.exportName;
            const recordLiteral = getExportObjectLiteral(sourceFile, ownExportName);
            gameRecordsByTab[entityId] = readRecord(recordLiteral, sourceFile, mapping, refreshedThisSync);
        } catch (err) {
            report.push(`[${entityId}] couldn't read its source file — ${err.message}`);
        }
    }

    for (const [entityId, mapping] of Object.entries(ENTITY_SOURCE_MAP)) {
        const gameRecord = gameRecordsByTab[entityId];
        if (!gameRecord) {
            continue;
        }
        const editorData = allData[entityId];
        const editorRecord = mapping.kind === 'queues' ? (editorData?.byId ?? {}) : (editorData ?? {});

        compareRecords(entityId, editorRecord, gameRecord, mapping, report);
        checkExternalFields(entityId, editorRecord, mapping, gameRecordsByTab, report);
    }

    if (report.length === 0) {
        return 'No differences found — the editor and the game source agree on every managed field.';
    }
    return `${report.length} difference${report.length === 1 ? '' : 's'} found:\n\n${report.join('\n')}`;
}

// Exported for one-off repair scripts (see this repo's own chat history) that need to pull a
// tab's real, current data straight off its source .ts file — e.g. to regenerate a JSON mirror
// that's drifted out of sync (missing entries, stale field values) rather than hand-editing it.
export { readRecord };
