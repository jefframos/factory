import { existsSync, readdirSync, renameSync, statSync } from 'fs';
import path from 'path';

function sanitizeBaseName(baseName) {
    const normalized = baseName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    const cleaned = normalized
        .replace(/\s+/g, '-')
        .replace(/[^a-zA-Z0-9._-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[-_.]+|[-_.]+$/g, '');

    return cleaned || 'asset';
}

function getUniquePath(dirPath, fileName) {
    const parsed = path.parse(fileName);
    const ext = parsed.ext.toLowerCase();
    const base = parsed.name;

    let candidate = `${base}${ext}`;
    let index = 1;

    while (existsSync(path.join(dirPath, candidate))) {
        index += 1;
        candidate = `${base}-${index}${ext}`;
    }

    return path.join(dirPath, candidate);
}

function sanitizeFileInDirectory(dirPath, fileName, logger) {
    const srcPath = path.join(dirPath, fileName);
    const parsed = path.parse(fileName);
    const safeName = sanitizeBaseName(parsed.name);
    const safeExt = parsed.ext.toLowerCase();
    const targetName = `${safeName}${safeExt}`;

    if (targetName === fileName) {
        return false;
    }

    const preferredDstPath = path.join(dirPath, targetName);
    const dstPath = existsSync(preferredDstPath)
        ? getUniquePath(dirPath, targetName)
        : preferredDstPath;

    renameSync(srcPath, dstPath);
    logger?.(`✏️ Renamed asset: ${fileName} -> ${path.basename(dstPath)}`);
    return true;
}

function walkAndSanitize(rootDir, logger) {
    let changes = 0;
    const entries = readdirSync(rootDir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(rootDir, entry.name);

        if (entry.isDirectory()) {
            changes += walkAndSanitize(fullPath, logger);
            continue;
        }

        if (!entry.isFile()) {
            continue;
        }

        if (sanitizeFileInDirectory(rootDir, entry.name, logger)) {
            changes += 1;
        }
    }

    return changes;
}

export function sanitizeAssetNames(rootDir, logger = console.log) {
    if (!existsSync(rootDir)) {
        return 0;
    }

    const stats = statSync(rootDir);
    if (!stats.isDirectory()) {
        return 0;
    }

    return walkAndSanitize(rootDir, logger);
}
