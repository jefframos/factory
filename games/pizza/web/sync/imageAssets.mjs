// imageAssets.mjs
//
// Scans games/pizza/raw-assets/images for every source image inside a
// "{tps}"-suffixed bundle folder (AssetPack's TexturePacker convention —
// see tools/image/build-image.mjs) and lists them by their BARE filename
// (no extension, no path) — that bare name is exactly the string a config
// file stores (`icon: 'mining-pickaxe'`) and what `PIXI.Texture.from(name)`
// resolves at runtime, since the packed spritesheet has already stripped
// the path/bundle by the time the game loads it. This module exists purely
// so the editor can show a picker + preview for any `icon`-typed field
// instead of a designer having to type a texture name blind.
//
// Read-only — nothing here writes to raw-assets. The editor's own preview
// route (see server.mjs) serves these PNGs directly from raw-assets rather
// than the built/packed spritesheet, since the individual source files are
// simpler to serve as-is and are guaranteed to exist even before a build.

import fs from 'node:fs';
import path from 'node:path';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function isBundleDir(dirName) {
    return dirName.includes('{tps}');
}

function bundleNameFrom(dirName) {
    return dirName.split('{')[0];
}

/**
 * Walks `imagesRoot` (games/pizza/raw-assets/images) and returns every image
 * found inside a "{tps}" bundle folder, at any depth under it (e.g. `ui{tps}/
 * icons/foo.png` — some bundles nest subfolders). Each entry:
 *   { name, bundle, relPath }
 * `name` is the bare id the game actually uses; `relPath` is relative to
 * `imagesRoot`, for building a preview URL. Silently skips a name collision
 * (two bundles shipping the same bare filename) by keeping the first one
 * found — same "whichever loads first wins" ambiguity PIXI's global texture
 * cache would have at runtime; not this tool's problem to resolve, just
 * worth not crashing over.
 */
export function scanImageAssets(imagesRoot) {
    const results = [];
    const seenNames = new Set();

    function walk(dir, bundle, relDir) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relPath = path.join(relDir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath, bundle, relPath);
                continue;
            }
            const ext = path.extname(entry.name).toLowerCase();
            if (!IMAGE_EXTENSIONS.has(ext)) {
                continue;
            }
            const name = path.basename(entry.name, ext);
            if (seenNames.has(name)) {
                continue;
            }
            seenNames.add(name);
            results.push({ name, bundle, relPath: relPath.replace(/\\/g, '/') });
        }
    }

    let topLevel;
    try {
        topLevel = fs.readdirSync(imagesRoot, { withFileTypes: true });
    } catch (err) {
        return { assets: [], error: `couldn't read images folder: ${err.message}` };
    }

    for (const entry of topLevel) {
        if (entry.isDirectory() && isBundleDir(entry.name)) {
            walk(path.join(imagesRoot, entry.name), bundleNameFrom(entry.name), entry.name);
        }
    }

    results.sort((a, b) => a.name.localeCompare(b.name));
    return { assets: results, error: null };
}
