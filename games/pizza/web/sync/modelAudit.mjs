// modelAudit.mjs
//
// The editor's Project tab -> Models: which raw-assets/models files the game actually uses, an
// ignore list the models build honors, and a "legacy" folder unused models can be parked in.
//
// USED = referenced anywhere the game can reach it:
//   - the Tiled map (tiled/testMap1.tmx): a placed object whose tile (the "models" tileset's
//     snapshot image, e.g. "pizza-model-snapshots_Props--Fence__35x8.png") decodes to "Props.Fence"
//     — same decoding as ModelSnapshotTool.decodeModelRef(). A tile that's in the tileset but
//     never placed doesn't count.
//   - game code: `MODELS.Group.Key`, or a WHOLE group (`MODELS.Characters[anim]`,
//     `typeof MODELS.Food`, ...) — every model in that group then counts as used, since the key
//     is only known at runtime (e.g. the player's animation clips).
//   - data: a "Group.Key" string in the editor's data (web/data/*.json) or in game code (the
//     .ts mirrors keep refs as strings in their `default` entries).
// A model's ref (Group.Key) is derived from its file exactly like tools/models/build-models.mjs
// derives the registry: top folder ('{...}' tags stripped) -> Group, file name -> Key.
//
// Files (all under games/pizza/raw-assets):
//   models-ignore.json   { ignore: [...], forced: [...] } — paths relative to raw-assets/models,
//                        as on disk ('{m}' tags kept). `ignore` = every unused, not-forced model:
//                        tools/models/build-models.mjs neither registers nor copies those (and
//                        removes stale published copies). `forced` = unused models kept anyway
//                        (orange in the editor). Rewritten by saveForced().
//   legacy/models/...    unused models moved out of raw-assets/models (moveUnused()) — same
//                        relative paths, so restore() puts each one back where it was.
//   legacy/legacy.json   { models: [{ path, ref, size, movedAt }] } — what's in there.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = path.resolve(__dirname, '..', '..');
const GAME_NAME = path.basename(GAME_ROOT);
const RAW_ASSETS = path.join(GAME_ROOT, 'raw-assets');
const RAW_MODELS = path.join(RAW_ASSETS, 'models');
const IGNORE_FILE = path.join(RAW_ASSETS, 'models-ignore.json');
const LEGACY_DIR = path.join(RAW_ASSETS, 'legacy');
const LEGACY_MODELS = path.join(LEGACY_DIR, 'models');
const LEGACY_LIST = path.join(LEGACY_DIR, 'legacy.json');
const PUBLIC_MODELS = path.resolve(GAME_ROOT, '..', '..', 'public', GAME_NAME, 'models');
const TMX_FILE = path.join(GAME_ROOT, 'tiled', 'testMap1.tmx');
const DATA_DIR = path.join(GAME_ROOT, 'web', 'data');
const CODE_DIRS = [path.join(GAME_ROOT, 'game')];
const CODE_ROOT_FILES = ['index.ts', 'Assets.ts', 'loader.config.ts'].map(f => path.join(GAME_ROOT, f));

const MODEL_EXTENSIONS = new Set(['.glb', '.gltf', '.fbx', '.obj']);
/** ModelSnapshotTool.DOWNLOAD_FOLDER / REF_SEPARATOR — the map tiles' snapshot naming. */
const SNAPSHOT_PREFIX = 'pizza-model-snapshots';
const REF_SEPARATOR = '--';
/** Tiled stores tile flips in a gid's top bits. */
const GID_MASK = 0x1fffffff;

// ---- Naming (mirrors tools/models/build-models.mjs)

const cleanName = name => name.replace(/\{.*?\}/g, '').trim();
function toValidIdentifier(str) {
    return str
        .replace(/[^a-zA-Z0-9]+(.)/g, (m, chr) => chr.toUpperCase())
        .replace(/^[a-z]/, c => c.toUpperCase())
        .replace(/[^a-zA-Z0-9]/g, '');
}
const toPosix = p => p.split(path.sep).join('/');

/** Every model file under `root`, as { path (relative, posix, tags kept), group, key, ref, size }. */
function listModelFiles(root) {
    const results = [];
    const walk = (dir, rel, group) => {
        if (!fs.existsSync(dir)) {
            return;
        }
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, item.name);
            const itemRel = rel ? `${rel}/${item.name}` : item.name;
            if (item.isDirectory()) {
                walk(full, itemRel, group ?? toValidIdentifier(cleanName(item.name)));
            } else if (MODEL_EXTENSIONS.has(path.extname(item.name).toLowerCase())) {
                const g = group ?? 'Root';
                const key = toValidIdentifier(cleanName(path.parse(item.name).name));
                results.push({ path: itemRel, group: g, key, ref: `${g}.${key}`, size: fs.statSync(full).size });
            }
        }
    };
    walk(root, '', null);
    return results.sort((a, b) => a.path.localeCompare(b.path));
}

// ---- Usage

function decodeSnapshotRef(imageSource) {
    const base = imageSource.split('/').pop() ?? imageSource;
    const name = base.replace(/\.[a-z0-9]+$/i, '').replace(/__\d+x\d+$/, '').replace(new RegExp(`^${SNAPSHOT_PREFIX}[_-]`), '');
    const sep = name.indexOf(REF_SEPARATOR);
    if (sep === -1) {
        return undefined;
    }
    const group = name.slice(0, sep);
    const key = name.slice(sep + REF_SEPARATOR.length);
    return group && key ? `${group}.${key}` : undefined;
}

/** ref -> how many objects on the map place it. */
function scanMap() {
    const counts = new Map();
    if (!fs.existsSync(TMX_FILE)) {
        return counts;
    }
    const tmx = fs.readFileSync(TMX_FILE, 'utf-8');
    // gid -> ref, from every tileset's <tile id><image source/> (embedded or an external .tsx).
    const gidRefs = new Map();
    const tilesetRe = /<tileset\b([^>]*?)(\/>|>([\s\S]*?)<\/tileset>)/g;
    for (const match of tmx.matchAll(tilesetRe)) {
        const attrs = match[1];
        const firstgid = Number(/firstgid="(\d+)"/.exec(attrs)?.[1]);
        let body = match[3] ?? '';
        const source = /source="([^"]+)"/.exec(attrs)?.[1];
        if (source) {
            const tsx = path.join(path.dirname(TMX_FILE), source);
            body = fs.existsSync(tsx) ? fs.readFileSync(tsx, 'utf-8') : '';
        }
        for (const tile of body.matchAll(/<tile id="(\d+)"[^>]*>([\s\S]*?)<\/tile>/g)) {
            const image = /<image [^>]*source="([^"]+)"/.exec(tile[2])?.[1];
            const ref = image ? decodeSnapshotRef(image) : undefined;
            if (ref) {
                gidRefs.set(firstgid + Number(tile[1]), ref);
            }
        }
    }
    for (const match of tmx.matchAll(/<object\b[^>]*\bgid="(\d+)"/g)) {
        const ref = gidRefs.get(Number(match[1]) & GID_MASK);
        if (ref) {
            counts.set(ref, (counts.get(ref) ?? 0) + 1);
        }
    }
    return counts;
}

function listFiles(dir, ext) {
    const out = [];
    if (!fs.existsSync(dir)) {
        return out;
    }
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) {
            out.push(...listFiles(full, ext));
        } else if (item.name.endsWith(ext)) {
            out.push(full);
        }
    }
    return out;
}

/** Code + data references: exact refs, whole groups, each with the files they're in. */
function scanSources(knownRefs, knownGroups) {
    const exact = new Map(); // ref -> Set(file)
    const groups = new Map(); // group -> Set(file)
    const add = (map, key, file) => {
        if (!map.has(key)) {
            map.set(key, new Set());
        }
        map.get(key).add(file);
    };
    const codeFiles = [...CODE_DIRS.flatMap(dir => listFiles(dir, '.ts')), ...CODE_ROOT_FILES.filter(f => fs.existsSync(f))];
    for (const file of codeFiles) {
        const text = fs.readFileSync(file, 'utf-8');
        const rel = toPosix(path.relative(GAME_ROOT, file));
        for (const m of text.matchAll(/\bMODELS\s*\.\s*([A-Za-z0-9_]+)(\s*\.\s*([A-Za-z0-9_]+))?/g)) {
            if (m[3]) {
                add(exact, `${m[1]}.${m[3]}`, rel);
            } else if (knownGroups.has(m[1])) {
                add(groups, m[1], rel);
            }
        }
        for (const m of text.matchAll(/["'`]([A-Z][A-Za-z0-9]*)\.([A-Za-z0-9]+)["'`]/g)) {
            const ref = `${m[1]}.${m[2]}`;
            if (knownRefs.has(ref)) {
                add(exact, ref, rel);
            }
        }
    }
    for (const file of listFiles(DATA_DIR, '.json')) {
        const text = fs.readFileSync(file, 'utf-8');
        const rel = toPosix(path.relative(GAME_ROOT, file));
        for (const m of text.matchAll(/"([A-Z][A-Za-z0-9]*)\.([A-Za-z0-9]+)"/g)) {
            const ref = `${m[1]}.${m[2]}`;
            if (knownRefs.has(ref)) {
                add(exact, ref, rel);
            }
        }
    }
    return { exact, groups };
}

// ---- Files

function readIgnoreFile() {
    if (!fs.existsSync(IGNORE_FILE)) {
        return { exists: false, ignore: [], forced: [] };
    }
    const parsed = JSON.parse(fs.readFileSync(IGNORE_FILE, 'utf-8'));
    return { exists: true, ignore: parsed.ignore ?? [], forced: parsed.forced ?? [] };
}

function writeIgnoreFile(ignore, forced) {
    const body = {
        _doc: 'Written by the editor (Project tab -> Models). ignore = unused models tools/models/build-models.mjs skips (not registered, not copied to public). forced = unused models kept anyway. Paths relative to raw-assets/models.',
        ignore: [...ignore].sort(),
        forced: [...forced].sort(),
    };
    fs.writeFileSync(IGNORE_FILE, JSON.stringify(body, null, 4) + '\n', 'utf-8');
}

function readLegacyList() {
    if (!fs.existsSync(LEGACY_LIST)) {
        return [];
    }
    return JSON.parse(fs.readFileSync(LEGACY_LIST, 'utf-8')).models ?? [];
}

function writeLegacyList(models) {
    fs.mkdirSync(LEGACY_DIR, { recursive: true });
    const body = {
        _doc: 'Written by the editor (Project tab -> Models -> Move unused). Models moved out of raw-assets/models; each one sits at legacy/models/<path>. Move one back from the editor.',
        models: [...models].sort((a, b) => a.path.localeCompare(b.path)),
    };
    fs.writeFileSync(LEGACY_LIST, JSON.stringify(body, null, 4) + '\n', 'utf-8');
}

/** Removes `relPath`'s published copy (public/<game>/models, folder tags stripped) — and the .glb an animation FBX gets converted to. */
function removePublishedCopy(relPath) {
    const parts = relPath.split('/');
    const file = parts.pop();
    const dir = path.join(PUBLIC_MODELS, ...parts.map(cleanName));
    const candidates = [file];
    if (path.extname(file).toLowerCase() === '.fbx') {
        candidates.push(`${path.parse(file).name}.glb`);
    }
    for (const name of candidates) {
        const target = path.join(dir, name);
        if (fs.existsSync(target)) {
            fs.unlinkSync(target);
        }
    }
}

function moveFile(from, to) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try {
        fs.renameSync(from, to);
    } catch {
        // Across devices / locked — copy then delete.
        fs.copyFileSync(from, to);
        fs.unlinkSync(from);
    }
}

// ---- API

/** The whole picture — every model in raw-assets/models with its usage and toggle state, plus the legacy list. */
export function auditModels() {
    const models = listModelFiles(RAW_MODELS);
    const knownRefs = new Set(models.map(m => m.ref));
    const knownGroups = new Set(models.map(m => m.group));
    const mapCounts = scanMap();
    const { exact, groups } = scanSources(knownRefs, knownGroups);
    const ignoreFile = readIgnoreFile();
    const forced = new Set(ignoreFile.forced);
    const ignored = new Set(ignoreFile.ignore);

    const rows = models.map(model => {
        const sources = [];
        const onMap = mapCounts.get(model.ref) ?? 0;
        if (onMap > 0) {
            sources.push(`map ×${onMap}`);
        }
        for (const file of exact.get(model.ref) ?? []) {
            sources.push(file);
        }
        for (const file of groups.get(model.group) ?? []) {
            sources.push(`${file} (whole ${model.group} group)`);
        }
        const used = sources.length > 0;
        return {
            ...model,
            used,
            sources,
            forced: !used && forced.has(model.path),
            /** In models-ignore.json right now (what the last build skipped / the next one will). */
            ignored: ignored.has(model.path),
        };
    });
    return {
        ignoreFileExists: ignoreFile.exists,
        models: rows,
        legacy: readLegacyList(),
        paths: {
            ignoreFile: toPosix(path.relative(GAME_ROOT, IGNORE_FILE)),
            legacyList: toPosix(path.relative(GAME_ROOT, LEGACY_LIST)),
        },
    };
}

/** Rewrites models-ignore.json from a fresh audit: forced = `forcedPaths` (unused ones only), ignore = every other unused model. */
export function saveForced(forcedPaths) {
    const audit = auditModels();
    const wanted = new Set(forcedPaths);
    const forced = audit.models.filter(m => !m.used && wanted.has(m.path)).map(m => m.path);
    const forcedSet = new Set(forced);
    const ignore = audit.models.filter(m => !m.used && !forcedSet.has(m.path)).map(m => m.path);
    writeIgnoreFile(ignore, forced);
    return auditModels();
}

/** Moves every ignored model (unused, not forced) into raw-assets/legacy/models, records it in legacy.json and removes its published copy. */
export function moveUnused() {
    const audit = saveForced(readIgnoreFile().forced);
    const toMove = audit.models.filter(m => !m.used && !m.forced);
    const legacy = readLegacyList().filter(entry => !toMove.some(m => m.path === entry.path));
    const movedAt = new Date().toISOString();
    for (const model of toMove) {
        moveFile(path.join(RAW_MODELS, model.path), path.join(LEGACY_MODELS, model.path));
        removePublishedCopy(model.path);
        legacy.push({ path: model.path, ref: model.ref, size: model.size, movedAt });
    }
    writeLegacyList(legacy);
    // They're gone from raw-assets/models — drop them from the ignore list.
    const ignoreFile = readIgnoreFile();
    const moved = new Set(toMove.map(m => m.path));
    writeIgnoreFile(ignoreFile.ignore.filter(p => !moved.has(p)), ignoreFile.forced);
    return { moved: toMove.length, bytes: toMove.reduce((sum, m) => sum + m.size, 0), audit: auditModels() };
}

/** Moves `paths` from the legacy folder back to raw-assets/models — kept as forced, so the next build includes them even if nothing uses them yet. */
export function restoreFromLegacy(paths) {
    const wanted = new Set(paths);
    const legacy = readLegacyList();
    const restored = [];
    for (const entry of legacy) {
        if (!wanted.has(entry.path)) {
            continue;
        }
        const from = path.join(LEGACY_MODELS, entry.path);
        if (fs.existsSync(from)) {
            moveFile(from, path.join(RAW_MODELS, entry.path));
        }
        restored.push(entry.path);
    }
    writeLegacyList(legacy.filter(entry => !restored.includes(entry.path)));
    const ignoreFile = readIgnoreFile();
    saveForced([...ignoreFile.forced, ...restored]);
    return { restored: restored.length, audit: auditModels() };
}
