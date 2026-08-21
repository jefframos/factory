// entityMap.mjs
//
// Maps each editor tab id to the REAL source-of-truth TS file/export it
// mirrors, and lists exactly which properties the editor is allowed to
// touch on each entry ("managed keys" — the same fields GameDataBaker.ts
// strips down to, i.e. everything except view/presentation data). syncToSource.mjs
// reads this to know which AST node to patch and which properties on an
// entry object literal to leave alone (mesh, color, models, position,
// toolId, ...) versus upsert/remove.
//
// `optionalKeys` (a subset of `managedKeys`) lists which managed fields are
// ACTUALLY optional on the real TS interface (`field?: T`) — only THOSE are
// deleted from the source when a posted entry omits them; every other
// managed key missing from posted data is left untouched instead of wiped.
// This distinction matters: a key can be absent from posted data either
// because a designer genuinely cleared an optional field, OR because the
// editor's own JSON mirror simply predates that field being added to the
// schema (exactly what happened to `tools.icon` — a stale mirror with no
// `icon` key at all got POSTed back and silently deleted a REQUIRED
// property from ToolRegistry.ts before this distinction existed). Treating
// "missing" as "skip, don't touch" by default is the safe direction to err
// in — a required field project should never lose data to a stale mirror.
//
// `tools` manages `label` and `icon` — every OTHER field on TOOL_LIBRARY
// (color, hand offset/rotation, THREE.Vector3 instances, the 3D `models`
// list) is purely visual/3D-specific and deliberately untouched. `icon` is
// the one visual-ish field that IS safe to manage here: it's just a bare
// texture-name string (same "icon" field shape used across this codebase —
// AssetLibraryRegistry, ItemConfig-via-toolId), not a 3D asset reference,
// and the editor's icon picker (see app.js's renderIconField()) previews it
// directly from the matching source PNG. `label` didn't originally exist on
// ToolVisualEntry at all (TOOL_LIBRARY was visual-only) — it was added
// specifically so the Tools tab's "Label" field has something real to write
// to instead of silently going nowhere.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAME_DIR = path.resolve(__dirname, '..', '..', 'game');

export const ENTITY_SOURCE_MAP = {
    gates: {
        file: path.join(GAME_DIR, 'data', 'GateTypes.ts'),
        exportName: 'GATE_CONFIG',
        kind: 'enumRecord',
        enumName: 'GateId',
        managedKeys: ['name', 'requirement'],
    },
    buildings: {
        file: path.join(GAME_DIR, 'data', 'BuildingTypes.ts'),
        exportName: 'BUILDING_CONFIG',
        kind: 'enumRecord',
        enumName: 'BuildingId',
        managedKeys: ['name', 'appearRequirement', 'levels'],
        optionalKeys: ['appearRequirement'],
        // BuildingLevelConfig also carries a `mesh` field (per-level placeholder art) that
        // this editor doesn't manage — a plain wholesale replacement of the `levels` array
        // (what every OTHER list field in this map gets, since none of their items have
        // unmanaged siblings) would silently delete every level's mesh. listMerge tells
        // syncToSource.mjs to instead merge each array item by index, touching only the
        // named sub-fields on each existing item and leaving `mesh` alone — see
        // syncToSource.mjs's upsertArrayByIndex() for the actual merge.
        listMerge: { levels: ['level', 'requirements', 'effect'] },
    },
    shops: {
        file: path.join(GAME_DIR, 'shop', 'ShopTypes.ts'),
        exportName: 'SHOP_CONFIG_BY_ID',
        kind: 'partialRecord',
        managedKeys: ['name', 'tool', 'action', 'appearRequirement', 'levels'],
        optionalKeys: ['appearRequirement'],
    },
    crafting: {
        file: path.join(GAME_DIR, 'crafting', 'CraftTypes.ts'),
        exportName: 'CRAFT_CONFIG_BY_ID',
        kind: 'partialRecord',
        managedKeys: ['name', 'recipes', 'destroyOnComplete', 'appearRequirement'],
        optionalKeys: ['appearRequirement'],
    },
    resources: {
        file: path.join(GAME_DIR, 'actions', 'ResourceTypes.ts'),
        exportName: 'RESOURCE_CONFIG',
        kind: 'enumRecord',
        enumName: 'ResourceType',
        managedKeys: ['action', 'maxLife', 'amountPerGather', 'respawnSec', 'label'],
        // The Resources tab ALSO has an 'icon' field in its schema, but ResourceConfig
        // itself has no `icon` property at all — a resource's icon actually lives in a
        // DIFFERENT file/export entirely (AssetLibraryRegistry.ts's ASSET_LIBRARY, keyed by
        // the same id). `externalFields` tells syncToSource.mjs to route that one field to
        // another mapping in this same file instead of writing it here — see
        // syncToSource.mjs's syncExternalField() for how. This is what lets a NEW resource's
        // icon be set right on the Resources tab (the actual ask this was built for) while
        // the real storage — and the Asset Library tab's own full add/remove/overview — stays
        // exactly where it already was.
        externalFields: { icon: 'assetLibrary', models: 'assetLibrary', scale: 'assetLibrary', rotationDeg: 'assetLibrary' },
    },
    actions: {
        file: path.join(GAME_DIR, 'actions', 'ActionTypes.ts'),
        exportName: 'ACTION_CONFIG',
        kind: 'enumRecord',
        enumName: 'ActionType',
        managedKeys: ['hitIntervalSec', 'hitScale', 'resourcePerHit', 'cancelOnLeaveRange', 'tool'],
        optionalKeys: ['tool'],
    },
    items: {
        file: path.join(GAME_DIR, 'crafting', 'ItemTypes.ts'),
        exportName: 'ITEM_CONFIG',
        kind: 'enumRecord',
        enumName: 'ItemType',
        managedKeys: ['label'],
    },
    dynamicResourcePlacements: {
        file: path.join(GAME_DIR, 'world', 'DynamicResourceTypes.ts'),
        exportName: 'DYNAMIC_RESOURCE_PLACEMENTS',
        kind: 'array',
        managedKeys: ['resourceType', 'spawnerTileType', 'density', 'minDistance', 'checkIntervalSec'],
    },
    queues: {
        file: path.join(GAME_DIR, 'data', 'QueueTypes.ts'),
        kind: 'queues',
        defaultExportName: 'DEFAULT_QUEUE_CONFIG',
        byIdExportName: 'QUEUE_CONFIG_BY_ID',
        managedKeys: ['cooldownSec', 'possibleTasks', 'appearRequirement'],
        optionalKeys: ['appearRequirement'],
    },
    tools: {
        file: path.join(GAME_DIR, 'actions', 'ToolRegistry.ts'),
        exportName: 'TOOL_LIBRARY',
        // Plain object literal keyed by whatever tool ids exist (`satisfies Record<string,
        // ToolVisualEntry>`, not a Record<SomeEnum, ...>) — open-ended like shops/crafting,
        // not enum-backed like gates/buildings, so no enum-member bookkeeping applies here.
        kind: 'partialRecord',
        // `models` is required (ToolVisualEntry.models: ModelDefinition[], never optional) —
        // NOT in optionalKeys, so a mirror that predates this field just leaves the existing
        // value alone (see optionalKeys' own doc) rather than risking wiping it. No
        // protectEntries here: deleting a tool ENTIRELY via this tab's own Delete button is a
        // deliberate, whole-entry action the tab itself fully owns — protectEntries only ever
        // needs to matter for a DIFFERENT tab's cross-sync into a shared file (see
        // syncExternalField()'s own doc — it never deletes anything on its own regardless).
        managedKeys: ['label', 'icon', 'models'],
    },
    assetLibrary: {
        file: path.join(GAME_DIR, 'world', 'AssetLibraryRegistry.ts'),
        exportName: 'ASSET_LIBRARY',
        // Also a plain `satisfies Record<string, AssetLibraryEntry>` object literal, same as
        // TOOL_LIBRARY — open-ended by key, not enum-backed.
        kind: 'partialRecord',
        // Every field on AssetLibraryEntry is managed now (icon/models/scale/rotationDeg) —
        // same reasoning as tools for skipping protectEntries: this tab's own Delete button
        // is meant to actually delete.
        managedKeys: ['icon', 'models', 'scale', 'rotationDeg'],
        optionalKeys: ['icon'],
    },
};
