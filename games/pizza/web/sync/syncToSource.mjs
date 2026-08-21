// syncToSource.mjs
//
// Patches the REAL *Types.ts config file behind an editor tab so an edit
// made in the browser actually reaches the running game (previously this
// editor only wrote its own JSON mirror under web/data/ — see the
// conversation this was built from: a crafting-table requirement change
// wasn't showing up in-game because nothing ever wrote back to
// CraftTypes.ts). Uses ts-morph to surgically update just the properties
// this editor manages (see entityMap.mjs's managedKeys) on each entry's
// object literal — every other property already on that literal (mesh,
// color, models, position, toolId, ...) is left completely untouched, so a
// designer editing a gate's requirement here can't accidentally clobber
// its hand-placed mesh/position data that lives in the same object.
//
// Deliberately conservative about structural changes:
//  - New entry on an OPEN-id type (shops/crafting/queues.byId) → property
//    added, no problem, the type is `Partial<Record<string, ...>>`.
//  - New entry on a FIXED-ENUM type (gates/buildings/resources/actions/
//    items) → also needs a new enum member (GateId/BuildingId/...) or the
//    entry would be unreachable through the enum-typed id everything else
//    uses; ensureEnumMember() adds one, guessing a PascalCase member name
//    from the id.
//  - Deleted entry on a fixed-enum type is NOT deleted from the source —
//    removing an enum member could break any code still referencing it
//    elsewhere (BuildingId.Camp, etc.), which this tool has no visibility
//    into. It's logged as skipped instead; removing a fixed-enum entity is
//    a manual code change, not something this editor attempts.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Project, SyntaxKind } from 'ts-morph';
import { ENTITY_SOURCE_MAP } from './entityMap.mjs';

const project = new Project({
    skipAddingFilesFromTsConfig: true,
    manipulationSettings: { indentationText: '    ' },
});

/**
 * These property names hold a value typed as a real TS (string) enum rather
 * than a plain string — `item: ItemType`, `resourceType: ResourceType`,
 * `buildingId: BuildingId`, `action: ActionType`. A plain JSON string
 * literal there (`item: "pickaxe"`) type-checks as WRONG (string enums
 * aren't structurally assignable from a bare literal, unlike e.g. `tool`,
 * which is a plain string-literal union and needs no special handling) —
 * confirmed by actually running tsc against a first pass of this file that
 * used plain JSON.stringify() everywhere. serializeValue() below emits
 * `EnumName.Member` for exactly these keys instead.
 *
 * NOT used for object literal PROPERTY NAMES like a cost map's `{tree: 5}`
 * — `Partial<Record<ResourceType, number>>` accepts a plain string key
 * literal fine (confirmed by the same tsc run reporting no error there),
 * so only VALUES at these specific keys need enum-reference treatment.
 */
const ENUM_VALUE_FIELDS = {
    item: 'ItemType',
    resourceType: 'ResourceType',
    buildingId: 'BuildingId',
    action: 'ActionType',
};

/** Where each enum in ENUM_VALUE_FIELDS is actually declared — used to auto-add a named import to a target file that references the enum but doesn't yet import it (e.g. ShopTypes.ts has no reason to import ResourceType until an appearRequirement of type 'resource' needs one). */
const ENUM_SOURCE_FILES = {
    ItemType: p => path.join(p, 'crafting', 'ItemTypes.ts'),
    ResourceType: p => path.join(p, 'actions', 'ResourceTypes.ts'),
    BuildingId: p => path.join(p, 'data', 'BuildingTypes.ts'),
    ActionType: p => path.join(p, 'actions', 'ActionTypes.ts'),
};
const GAME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'game');
/** games/pizza/registry — one level up from GAME_DIR (games/pizza/game), not under it. */
const REGISTRY_DIR = path.resolve(GAME_DIR, '..', 'registry');
const MODELS_REGISTRY_FILE = path.join(REGISTRY_DIR, 'assetsRegistry', 'modelsRegistry.ts');

/**
 * A `models` field is a `ModelDefinition[]`, but each element in SOURCE is
 * a property-access EXPRESSION (`MODELS.Props.Tree`), not a string — same
 * "real code reference, not a JSON-safe literal" problem ENUM_VALUE_FIELDS
 * solves for `item: ItemType.Axe`. The editor's own JSON mirror stores each
 * one as the bare "Group.Key" dot-path (e.g. `"Props.Tree"` — see
 * modelsCatalog.mjs, which reads the SAME registry to build the picker's
 * option list); serializeField() below turns that back into `MODELS.
 * Group.Key` text and makes sure the file imports `MODELS` as a default
 * import first.
 */
function isModelRefArray(key, value) {
    return key === 'models' && Array.isArray(value);
}

/** Adds `import MODELS from '<relative path>';` to `sourceFile` if it doesn't already have a default import bound to the models registry — every current caller (ToolRegistry.ts, AssetLibraryRegistry.ts) already does, so this is a no-op guard in practice, kept for whichever FUTURE entity manages `models` without already importing it. */
function ensureModelsDefaultImport(sourceFile) {
    const alreadyImported = sourceFile.getImportDeclarations().some(d => d.getDefaultImport()?.getText() === 'MODELS');
    if (alreadyImported) {
        return;
    }

    let specifier = path.relative(path.dirname(sourceFile.getFilePath()), MODELS_REGISTRY_FILE)
        .replace(/\.ts$/, '')
        .replace(/\\/g, '/');
    if (!specifier.startsWith('.')) {
        specifier = './' + specifier;
    }

    const existingDecl = sourceFile.getImportDeclarations().find(d => d.getModuleSpecifierValue() === specifier);
    if (existingDecl && !existingDecl.getDefaultImport()) {
        existingDecl.setDefaultImport('MODELS');
    } else if (!existingDecl) {
        sourceFile.addImportDeclaration({ moduleSpecifier: specifier, defaultImport: 'MODELS' });
    }
}

/** Filters `value` down to only the keys in `managedKeys` that are actually present (skips undefined) — used both for object entries and for reading posted array items. */
function pick(value, managedKeys) {
    const result = {};
    for (const key of managedKeys) {
        if (value[key] !== undefined) {
            result[key] = value[key];
        }
    }
    return result;
}

/** Matches ensureEnumMember()'s own naming convention (id → PascalCase-first-letter member name) — must stay consistent with it, since a value serialized here has to name a member that's actually guaranteed to exist on the enum (ensureEnumMember() runs before any entry using that id is serialized). */
function enumMemberName(id) {
    return id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * Recursively renders a plain JSON-compatible value as TS source text,
 * substituting `EnumName.Member` for any value sitting at a key listed in
 * ENUM_VALUE_FIELDS (see that constant's own doc). `enumsUsed` collects
 * every enum name actually referenced so the caller can ensure each one is
 * imported before this text is spliced into the file.
 */
function serializeValue(value, indent, enumsUsed) {
    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        const items = value.map(v => `${indent}    ${serializeValue(v, indent + '    ', enumsUsed)}`);
        return `[\n${items.join(',\n')}\n${indent}]`;
    }
    if (value !== null && typeof value === 'object') {
        const keys = Object.keys(value);
        if (keys.length === 0) return '{}';
        const entries = keys.map(key => {
            const enumName = ENUM_VALUE_FIELDS[key];
            const rendered = enumName && typeof value[key] === 'string'
                ? (enumsUsed.add(enumName), `${enumName}.${enumMemberName(value[key])}`)
                : serializeValue(value[key], indent + '    ', enumsUsed);
            return `${indent}    ${JSON.stringify(key)}: ${rendered}`;
        });
        return `{\n${entries.join(',\n')}\n${indent}}`;
    }
    return JSON.stringify(value);
}

/** Top-level entry point for turning a value into initializer text — always starts at zero indent since every call site sets a whole property/variable initializer, never a mid-line fragment. */
function toSourceText(value) {
    const enumsUsed = new Set();
    const text = serializeValue(value, '', enumsUsed);
    return { text, enumsUsed };
}

/** Adds a named import for `enumName` to `sourceFile` if it isn't already imported from anywhere — safe to call unconditionally before splicing in text that references it. */
function ensureNamedImport(sourceFile, enumName) {
    const alreadyImported = sourceFile.getImportDeclarations()
        .some(d => d.getNamedImports().some(ni => ni.getName() === enumName));
    if (alreadyImported) {
        return;
    }

    const targetFile = ENUM_SOURCE_FILES[enumName]?.(GAME_DIR);
    if (!targetFile || path.resolve(targetFile) === path.resolve(sourceFile.getFilePath())) {
        // Either an unknown enum name, or it's declared in this very file (no import needed).
        return;
    }

    let specifier = path.relative(path.dirname(sourceFile.getFilePath()), targetFile)
        .replace(/\.ts$/, '')
        .replace(/\\/g, '/');
    if (!specifier.startsWith('.')) {
        specifier = './' + specifier;
    }

    const existingDecl = sourceFile.getImportDeclarations().find(d => d.getModuleSpecifierValue() === specifier);
    if (existingDecl) {
        existingDecl.addNamedImport(enumName);
    } else {
        sourceFile.addImportDeclaration({ moduleSpecifier: specifier, namedImports: [enumName] });
    }
}

function getSourceFile(filePath) {
    return project.getSourceFile(filePath) ?? project.addSourceFileAtPath(filePath);
}

/** Unwraps a `satisfies` expression (`{...} satisfies Record<string, X>`, TOOL_LIBRARY's own style) down to the object literal it wraps — every other *_CONFIG in this codebase is annotated via `: Record<...> = {...}` instead, where the initializer already IS the object literal directly. */
function getExportObjectLiteral(sourceFile, exportName) {
    const decl = sourceFile.getVariableDeclarationOrThrow(exportName);
    const initializer = decl.getInitializerOrThrow();
    const satisfies = initializer.asKind(SyntaxKind.SatisfiesExpression);
    const target = satisfies ? satisfies.getExpression() : initializer;
    return target.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
}

/**
 * Resolves a property's key back to the plain string id it represents,
 * whatever form the source wrote it in — `foo:`, `"foo":`, or (the actual
 * style every hand-authored *_CONFIG record in this codebase uses for its
 * enum-keyed top level, e.g. `[GateId.Gate1]:`) a COMPUTED key referencing
 * an enum member. For that last form there's no enum VALUE available
 * without resolving the enum declaration, so this inverts
 * enumMemberName()'s own convention instead (PascalCase member name →
 * lowercase-first-letter id) — cheap, and correct for every id in this
 * codebase since enumMemberName() only ever changes the first character.
 * Getting this wrong would mean findProperty() below fails to recognize an
 * existing computed-key entry and duplicate it with a second, differently-
 * styled property for the same id — exactly the bug this function exists
 * to avoid (caught by testing against GateTypes.ts's actual `[GateId.
 * Gate1]:` style, not just crafting's plain-identifier style).
 */
function getPropertyKeyId(prop) {
    const assignment = prop.asKind(SyntaxKind.PropertyAssignment);
    if (!assignment) return null;

    const nameNode = assignment.getNameNode();
    if (nameNode.getKind() === SyntaxKind.ComputedPropertyName) {
        const exprText = nameNode.getExpression().getText();
        const memberName = exprText.split('.').pop();
        return memberName.charAt(0).toLowerCase() + memberName.slice(1);
    }

    return assignment.getName().replace(/^['"]|['"]$/g, '');
}

/** Finds a property on an object literal by the plain string id it represents — see getPropertyKeyId()'s own doc for why that's not just a matter of comparing name text. */
function findProperty(objLiteral, id) {
    return objLiteral.getProperties().find(p => getPropertyKeyId(p) === id);
}

/** Adds a new member to `enumName` for `id` if one doesn't already exist (matched by its string value, e.g. `'gate2'`) — see this file's own doc for why fixed-enum types need this on a brand-new id. */
function ensureEnumMember(sourceFile, enumName, id) {
    const enumDecl = sourceFile.getEnum(enumName);
    if (!enumDecl) {
        throw new Error(`enum "${enumName}" not found in ${sourceFile.getFilePath()}`);
    }
    const alreadyExists = enumDecl.getMembers().some(m => {
        const text = m.getInitializer()?.getText() ?? '';
        return text.replace(/^['"]|['"]$/g, '') === id;
    });
    if (alreadyExists) {
        return;
    }
    const memberName = id.charAt(0).toUpperCase() + id.slice(1);
    enumDecl.addMember({ name: memberName, initializer: JSON.stringify(id) });
}

/** Serializes `value` and makes sure the file it's about to be spliced into actually imports every enum it references, then returns the text alone — the one place enum-import bookkeeping happens, so every call site below just gets plain insertable text. */
function serialize(sourceFile, value) {
    const { text, enumsUsed } = toSourceText(value);
    for (const enumName of enumsUsed) {
        ensureNamedImport(sourceFile, enumName);
    }
    return text;
}

/**
 * Same as serialize(), but ALSO applies the ENUM_VALUE_FIELDS substitution
 * when `value` itself sits directly at a known enum-typed key — needed
 * because serializeValue()'s enum check only fires while recursing INTO an
 * object's own properties (e.g. a gate's `requirement: { buildingId: ... }`
 * gets checked correctly since `buildingId` is a nested key). A managed
 * field set directly on an entry (a shop's `action: ActionType`, a
 * resource's `action: ActionType`) is a bare scalar with no wrapping object
 * for that check to fire on, so it needs this explicit companion — caught
 * by actually running tsc against a first pass that only had serialize(),
 * which shipped `action: "chop"` (a plain string, not assignable to
 * ActionType) for exactly this reason.
 */
function serializeField(sourceFile, key, value) {
    const enumName = ENUM_VALUE_FIELDS[key];
    if (enumName && typeof value === 'string') {
        ensureNamedImport(sourceFile, enumName);
        return `${enumName}.${enumMemberName(value)}`;
    }
    if (isModelRefArray(key, value)) {
        ensureModelsDefaultImport(sourceFile);
        const refs = value.map(dotPath => {
            const [group, itemKey] = String(dotPath).split('.');
            return `MODELS.${group}.${itemKey}`;
        });
        return refs.length === 0 ? '[]' : `[${refs.join(', ')}]`;
    }
    return serialize(sourceFile, value);
}

/**
 * Merges `postedItems` into an existing array literal BY INDEX rather than
 * replacing it wholesale — see entityMap.mjs's `listMerge` doc for why:
 * some array-of-object fields (BuildingLevelConfig.levels) have per-item
 * properties (`mesh`) this editor doesn't manage, and a plain wholesale
 * replacement would delete them. Existing indices get their `itemManagedKeys`
 * upserted in place (untouched properties survive); extra posted items
 * beyond the existing length are appended with ONLY their managed fields
 * (there's no prior object to preserve unmanaged fields from); existing
 * items beyond the posted length are removed outright (deleting an item
 * necessarily deletes everything on it, managed or not).
 */
function upsertArrayByIndex(sourceFile, arrayLiteral, itemManagedKeys, postedItems, warnings) {
    const existing = arrayLiteral.getElements();
    // Used as a template for any BRAND NEW item appended below (see that branch) — a new
    // item has no prior object of its own to preserve unmanaged fields from, so it borrows
    // the last existing item's as a starting point rather than producing a value missing a
    // required property (e.g. BuildingLevelConfig.mesh) that would fail to compile.
    const lastExisting = existing[existing.length - 1]?.asKind(SyntaxKind.ObjectLiteralExpression);

    postedItems.forEach((item, index) => {
        if (index < existing.length) {
            const itemLiteral = existing[index].asKind(SyntaxKind.ObjectLiteralExpression);
            if (itemLiteral) {
                upsertObjectFields(sourceFile, itemLiteral, itemManagedKeys, [], item, warnings);
                return;
            }
            // Existing element isn't an object literal (unexpected hand-authored shape) —
            // fall through to a full replacement for just this one index.
            arrayLiteral.removeElement(index);
            arrayLiteral.insertElement(index, serialize(sourceFile, pick(item, itemManagedKeys)));
            return;
        }

        arrayLiteral.addElement('{}');
        const newItemLiteral = arrayLiteral.getElements()[index].asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
        upsertObjectFields(sourceFile, newItemLiteral, itemManagedKeys, [], item, warnings);

        if (lastExisting) {
            const unmanagedProps = lastExisting.getProperties()
                .filter(p => !itemManagedKeys.includes(getPropertyKeyId(p)));
            for (const prop of unmanagedProps) {
                newItemLiteral.addPropertyAssignment({
                    name: prop.asKindOrThrow(SyntaxKind.PropertyAssignment).getName(),
                    initializer: prop.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializerOrThrow().getText(),
                });
            }
            if (unmanagedProps.length > 0) {
                warnings?.push(`a new item was added with ${unmanagedProps.map(p => getPropertyKeyId(p)).join(', ')} copied from the previous item as a placeholder — review it in ${sourceFile.getFilePath()}`);
            }
        }
    });

    for (let index = existing.length - 1; index >= postedItems.length; index--) {
        arrayLiteral.removeElement(index);
    }
}

/**
 * The shared "upsert named fields on an object literal, leave everything
 * else alone" logic — used both for a whole entry's own object literal
 * (upsertEntryFields) and for one item inside a listMerge array
 * (upsertArrayByIndex). `optionalKeys` (a subset of `managedKeys`) is the
 * ONLY set of fields ever deleted when posted data omits them — every
 * other managed key missing from `data` is left completely untouched
 * (existing value kept, warned about) rather than removed. Without this
 * distinction, a JSON mirror that simply predates a field being added to
 * the schema would delete that REQUIRED property from source the next time
 * anything on that entry got saved — exactly what happened to a tool's
 * `icon` before this existed (see entityMap.mjs's `optionalKeys` doc).
 */
function upsertObjectFields(sourceFile, objLiteral, managedKeys, optionalKeys, data, warnings) {
    for (const key of managedKeys) {
        const existing = findProperty(objLiteral, key);

        if (data[key] === undefined) {
            if (optionalKeys.includes(key)) {
                existing?.remove();
            } else if (existing) {
                warnings?.push(`"${key}" was missing from the saved data and left UNCHANGED in source (it's required, not optional, so this editor won't delete it) — in ${sourceFile.getFilePath()}`);
            }
            // If it's required AND already absent from source, there's nothing to warn about
            // or do — that's just an entry this editor hasn't ever set that field on yet.
            continue;
        }

        const text = serializeField(sourceFile, key, data[key]);
        if (existing) {
            existing.asKindOrThrow(SyntaxKind.PropertyAssignment).setInitializer(text);
        } else {
            objLiteral.addPropertyAssignment({ name: JSON.stringify(key), initializer: text });
        }
    }
}

/** Upserts just the managed fields of one entry (`id`) inside a record object literal — every unmanaged property already on that entry's own object literal (mesh, color, position, ...) is left as-is; only `mapping.managedKeys` are added/replaced/removed, and any key listed in `mapping.listMerge` gets a by-index array merge instead of a wholesale replacement (see upsertArrayByIndex's own doc). */
function upsertEntryFields(sourceFile, recordLiteral, id, mapping, data, warnings) {
    let entryProp = findProperty(recordLiteral, id);
    const isNewEntry = !entryProp;
    if (isNewEntry) {
        // Template to clone UNMANAGED fields from — same reasoning as upsertArrayByIndex's
        // `lastExisting`: a brand-new entry (e.g. a new tool with only `label` set) would
        // otherwise be missing whatever required fields this editor doesn't manage
        // (models/icon/color/... for a tool), which wouldn't compile. Cloning an existing
        // sibling's unmanaged fields at least produces something valid to hand-tune, rather
        // than a value some OTHER required property away from type-checking.
        const template = recordLiteral.getProperties()
            .map(p => p.asKind(SyntaxKind.PropertyAssignment)?.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression))
            .find(Boolean);

        recordLiteral.addPropertyAssignment({ name: JSON.stringify(id), initializer: '{}' });
        entryProp = findProperty(recordLiteral, id);
        const newEntryLiteral = entryProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);

        if (template) {
            const unmanagedProps = template.getProperties()
                .filter(p => !mapping.managedKeys.includes(getPropertyKeyId(p)));
            for (const prop of unmanagedProps) {
                newEntryLiteral.addPropertyAssignment({
                    name: prop.asKindOrThrow(SyntaxKind.PropertyAssignment).getName(),
                    initializer: prop.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializerOrThrow().getText(),
                });
            }
            if (unmanagedProps.length > 0) {
                warnings?.push(`new entry "${id}" was added with ${unmanagedProps.map(p => getPropertyKeyId(p)).join(', ')} copied from an existing entry as a placeholder — review it in ${sourceFile.getFilePath()}`);
            }
        }
    }

    const assignment = entryProp.asKindOrThrow(SyntaxKind.PropertyAssignment);
    let entryLiteral = assignment.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
    if (!entryLiteral) {
        assignment.setInitializer('{}');
        entryLiteral = assignment.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);
    }

    for (const key of mapping.managedKeys) {
        const listItemKeys = mapping.listMerge?.[key];
        if (listItemKeys && Array.isArray(data[key])) {
            let existingArrayProp = findProperty(entryLiteral, key);
            if (!existingArrayProp) {
                entryLiteral.addPropertyAssignment({ name: JSON.stringify(key), initializer: '[]' });
                existingArrayProp = findProperty(entryLiteral, key);
            }
            const arrayAssignment = existingArrayProp.asKindOrThrow(SyntaxKind.PropertyAssignment);
            let arrayLiteral = arrayAssignment.getInitializerIfKind(SyntaxKind.ArrayLiteralExpression);
            if (!arrayLiteral) {
                arrayAssignment.setInitializer('[]');
                arrayLiteral = arrayAssignment.getInitializerIfKindOrThrow(SyntaxKind.ArrayLiteralExpression);
            }
            upsertArrayByIndex(sourceFile, arrayLiteral, listItemKeys, data[key], warnings);
            continue;
        }

        const existing = findProperty(entryLiteral, key);
        if (data[key] === undefined) {
            if (mapping.optionalKeys?.includes(key)) {
                existing?.remove();
            } else if (existing) {
                warnings?.push(`"${key}" was missing from the saved data and left UNCHANGED in source (it's required, not optional, so this editor won't delete it) — in ${sourceFile.getFilePath()}`);
            }
            continue;
        }

        const text = serializeField(sourceFile, key, data[key]);
        if (existing) {
            existing.asKindOrThrow(SyntaxKind.PropertyAssignment).setInitializer(text);
        } else {
            entryLiteral.addPropertyAssignment({ name: JSON.stringify(key), initializer: text });
        }
    }
}

/** Upserts every id in `postedRecord` into the exported record at `mapping.exportName`, then (for open-id types only — see this file's own doc) removes any entry present in the source but absent from `postedRecord`. */
function syncRecord(sourceFile, mapping, postedRecord, warnings) {
    const recordLiteral = getExportObjectLiteral(sourceFile, mapping.exportName);
    const existingIds = recordLiteral.getProperties().map(getPropertyKeyId).filter(Boolean);
    const postedIds = Object.keys(postedRecord);

    for (const id of postedIds) {
        if (mapping.kind === 'enumRecord') {
            ensureEnumMember(sourceFile, mapping.enumName, id);
        }
        upsertEntryFields(sourceFile, recordLiteral, id, mapping, postedRecord[id], warnings);
    }

    // partialRecord types default to "the whole entity is disposable" (a shop/craft table/
    // queue that no longer exists in the editor really shouldn't exist in source either).
    // `protectEntries: true` opts a partialRecord OUT of that — TOOL_LIBRARY is also
    // open-id, but each entry carries visual fields (models/color/offset/...) this editor
    // never sees, so removing a tool from the Tools tab must NOT delete the whole entry —
    // only the managed `label` field would ever be intentionally removed, which the
    // per-field loop above already handles.
    if (mapping.kind === 'partialRecord' && !mapping.protectEntries) {
        for (const id of existingIds) {
            if (!postedIds.includes(id)) {
                findProperty(recordLiteral, id)?.remove();
            }
        }
    } else {
        const skipped = existingIds.filter(id => !postedIds.includes(id));
        if (skipped.length > 0) {
            const message = `"${mapping.exportName}" entries removed in the editor but left untouched in source (protected/fixed-enum types are add/edit only): ${skipped.join(', ')}`;
            console.warn(`[sync] ${message}`);
            warnings?.push(message);
        }
    }
}

/** Replaces the entire array literal at `mapping.exportName` with `postedArray`, wholesale — dynamicResourcePlacements isn't id-keyed, so there's no per-entry upsert to do, and every item is fully editor-owned (no unmanaged fields to preserve). */
function syncArray(sourceFile, mapping, postedArray) {
    const decl = sourceFile.getVariableDeclarationOrThrow(mapping.exportName);
    const items = postedArray.map(item => pick(item, mapping.managedKeys));
    decl.setInitializer(serialize(sourceFile, items));
}

/** Queues are two separate exports in one file — DEFAULT_QUEUE_CONFIG (a single object, replaced wholesale — it carries no unmanaged fields) and QUEUE_CONFIG_BY_ID (an open-id record, synced like any other partialRecord). */
function syncQueues(sourceFile, mapping, postedQueues, warnings) {
    const defaultDecl = sourceFile.getVariableDeclarationOrThrow(mapping.defaultExportName);
    defaultDecl.setInitializer(serialize(sourceFile, pick(postedQueues.default ?? {}, mapping.managedKeys)));

    syncRecord(sourceFile, { ...mapping, exportName: mapping.byIdExportName, kind: 'partialRecord' }, postedQueues.byId ?? {}, warnings);
}

/**
 * Routes ONE field (`fieldKey`) out of this tab's OWN per-id data into a
 * DIFFERENT mapping's file/export, upserting per id — see entityMap.mjs's
 * `externalFields` doc for why (a resource's `icon` lives in
 * AssetLibraryRegistry.ts, not ResourceTypes.ts, despite being edited right
 * on the Resources tab). Deliberately upsert-only and one-directional: an
 * id present in `postedData` with a real value gets upserted into the
 * target file (creating a brand-new target entry, with the same
 * placeholder-cloning as any other new entry, if one doesn't exist yet);
 * an id in the TARGET file that ISN'T in `postedData` at all (e.g.
 * AssetLibraryRegistry's "money" — a currency with no matching
 * ResourceType, so it never appears in the Resources tab's own ids) is
 * never touched, since that id belongs entirely to the target mapping's
 * own tab to manage. Returns the target SourceFile so the caller can save it.
 */
function syncExternalField(fieldKey, targetMapping, postedData, warnings) {
    const targetSourceFile = getSourceFile(targetMapping.file);
    const recordLiteral = getExportObjectLiteral(targetSourceFile, targetMapping.exportName);
    const fieldMapping = {
        ...targetMapping,
        managedKeys: [fieldKey],
        optionalKeys: targetMapping.optionalKeys?.includes(fieldKey) ? [fieldKey] : [],
    };

    for (const [id, entry] of Object.entries(postedData)) {
        const hasValue = entry?.[fieldKey] !== undefined;
        // Don't manufacture a brand-new (placeholder-cloned) target entry just because a
        // resource exists with no icon ever set — only upsert when there's either a real
        // value to write, or the target entry already exists (so clearing an existing value
        // still works).
        if (!hasValue && !findProperty(recordLiteral, id)) {
            continue;
        }
        if (targetMapping.kind === 'enumRecord') {
            ensureEnumMember(targetSourceFile, targetMapping.enumName, id);
        }
        upsertEntryFields(targetSourceFile, recordLiteral, id, fieldMapping, { [fieldKey]: entry?.[fieldKey] }, warnings);
    }

    return targetSourceFile;
}

/**
 * Entry point — patches the real TS source file behind `entityId` (see
 * ENTITY_SOURCE_MAP) to match `postedData`, and saves it to disk. Also
 * applies any `externalFields` routing (see that constant's own doc) and
 * saves whichever OTHER files that touched, so a single "Save changes" on
 * the Resources tab correctly writes both ResourceTypes.ts and
 * AssetLibraryRegistry.ts. Returns `{ skipped: true }` for an entity type
 * with no source mapping at all (none currently — every tab is mapped).
 */
export async function syncToSource(entityId, postedData) {
    const mapping = ENTITY_SOURCE_MAP[entityId];
    if (!mapping) {
        return { skipped: true };
    }

    const sourceFile = getSourceFile(mapping.file);
    const warnings = [];

    if (mapping.kind === 'array') {
        syncArray(sourceFile, mapping, postedData);
    } else if (mapping.kind === 'queues') {
        syncQueues(sourceFile, mapping, postedData, warnings);
    } else {
        syncRecord(sourceFile, mapping, postedData, warnings);
    }

    const touchedFiles = new Map([[sourceFile.getFilePath(), sourceFile]]);
    for (const [fieldKey, targetMappingId] of Object.entries(mapping.externalFields ?? {})) {
        const targetMapping = ENTITY_SOURCE_MAP[targetMappingId];
        if (!targetMapping) {
            continue;
        }
        const targetSourceFile = syncExternalField(fieldKey, targetMapping, postedData, warnings);
        touchedFiles.set(targetSourceFile.getFilePath(), targetSourceFile);
    }

    for (const file of touchedFiles.values()) {
        file.formatText();
        await file.save();
    }

    return { skipped: false, file: mapping.file, warnings };
}
