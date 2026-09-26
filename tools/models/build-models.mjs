import { NodeIO } from '@gltf-transform/core';
import dotenv from 'dotenv';
import fs from 'fs';
import path, { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { convertFbxAnimationToGlb } from './fbx-anim-to-glb.mjs';

dotenv.config();

const io = new NodeIO();
const game = process.env.GAME || process.env.GAME_NAME;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const gameRoot = resolve(__dirname, `../../games/${game}`);
const rawModels = resolve(gameRoot, `raw-assets/models`);
const outputRegistry = resolve(gameRoot, `registry/assetsRegistry/modelsRegistry.ts`);
const publicModelsDir = resolve(__dirname, `../../public/${game}/models`);

const cleanName = (name) => name.replace(/\{.*?\}/g, '').trim();

function toValidIdentifier(str) {
    return str
        .replace(/[^a-zA-Z0-9]+(.)/g, (m, chr) => chr.toUpperCase())
        .replace(/^[a-z]/, (c) => c.toUpperCase())
        .replace(/[^a-zA-Z0-9]/g, '');
}

/**
 * Deep recursive scan for nodes in groups within groups.
 */
async function getModelNodes(fullPath, ext) {
    if (ext !== '.glb' && ext !== '.gltf') return {};
    try {
        const document = await io.read(fullPath);
        const nodeMap = {};
        const traverse = (node) => {
            const rawName = node.getName();
            if (rawName) {
                const key = toValidIdentifier(rawName);
                nodeMap[key] = rawName;
            }
            node.listChildren().forEach(child => traverse(child));
        };
        document.getRoot().listScenes().forEach(scene => {
            scene.listChildren().forEach(node => traverse(node));
        });
        return nodeMap;
    } catch (e) {
        return {};
    }
}

/**
 * Helper to copy a folder and all its contents (textures, bins, etc.)
 */
function copyFolderSync(from, to) {
    if (!fs.existsSync(to)) fs.mkdirSync(to, { recursive: true });
    fs.readdirSync(from).forEach(element => {
        const stat = fs.lstatSync(path.join(from, element));
        if (stat.isFile()) {
            fs.copyFileSync(path.join(from, element), path.join(to, element));
        } else if (stat.isDirectory()) {
            copyFolderSync(path.join(from, element), path.join(to, element));
        }
    });
}

/**
 * Animation-only FBX files (no mesh) are re-packed into a much smaller
 * animation-only GLB next to where the FBX was copied, and the copied FBX is
 * removed — see fbx-anim-to-glb.mjs. Returns the published file name, which
 * is unchanged for anything that isn't an animation-only FBX.
 */
async function publishModelFile(sourcePath, destFolder, fileName) {
    const parsed = path.parse(fileName);
    if (parsed.ext.toLowerCase() !== '.fbx') return fileName;

    const glbName = `${parsed.name}.glb`;
    // A hand-made .glb of the same name in raw-assets wins.
    if (fs.existsSync(path.join(path.dirname(sourcePath), glbName))) return fileName;

    const glbPath = path.join(destFolder, glbName);
    const copiedFbxPath = path.join(destFolder, fileName);
    const isUpToDate = fs.existsSync(glbPath)
        && fs.statSync(glbPath).mtimeMs >= fs.statSync(sourcePath).mtimeMs;

    if (!isUpToDate) {
        let glb = null;
        try {
            glb = await convertFbxAnimationToGlb(fs.readFileSync(sourcePath));
        } catch (e) {
            console.warn(`⚠️  Could not convert ${fileName} to GLB, keeping FBX:`, e.message);
        }
        if (!glb) return fileName;
        fs.writeFileSync(glbPath, glb);
    }

    if (fs.existsSync(copiedFbxPath)) fs.unlinkSync(copiedFbxPath);
    return glbName;
}

/**
 * Scans models and ensures the entire containing folder is copied to public.
 *
 * `group` is fixed the FIRST time we descend into a subfolder of raw-assets/models (e.g.
 * "characters{m}" -> "Characters") and passed unchanged through every deeper level of
 * recursion — a model 3 folders deep still belongs to the same top-level group its
 * grandparent folder named. Models sitting directly in raw-assets/models with no
 * containing folder at all fall into the 'Root' group. This is what lets the registry
 * nest models as MODELS.Characters.Running instead of one flat, ever-growing MODELS.Running
 * namespace — see generateRegistryContent().
 */
async function scanModels(dir, relativeDir = '', group = null) {
    const extensions = ['.glb', '.gltf', '.fbx', '.obj'];
    let results = [];
    if (!fs.existsSync(dir)) return [];

    const items = fs.readdirSync(dir, { withFileTypes: true });

    // NEW: We track folders we've already copied to avoid redundant deep-copies
    const copiedFolders = new Set();

    for (const item of items) {
        const fullSourcePath = path.join(dir, item.name);

        if (item.isDirectory()) {
            const subDirClean = cleanName(item.name);
            const nextRelativeDir = relativeDir ? `${relativeDir}/${subDirClean}` : subDirClean;
            const nextGroup = group ?? toValidIdentifier(subDirClean);
            results = [...results, ...await scanModels(fullSourcePath, nextRelativeDir, nextGroup)];
        } else {
            const ext = path.extname(item.name).toLowerCase();
            if (extensions.includes(ext)) {
                const nameOnly = cleanName(path.parse(item.name).name);
                const nodes = await getModelNodes(fullSourcePath, ext);

                // --- FOLDER COPY LOGIC ---
                // We copy the CURRENT directory containing this model to the public folder
                const destFolder = path.join(publicModelsDir, relativeDir);
                if (!copiedFolders.has(destFolder)) {
                    copyFolderSync(dir, destFolder);
                    copiedFolders.add(destFolder);
                }
                // --------------------------

                const publishedName = await publishModelFile(fullSourcePath, destFolder, item.name);
                const relativeFilePath = relativeDir ? path.join(relativeDir, publishedName) : publishedName;

                results.push({
                    group: group ?? 'Root',
                    identifier: toValidIdentifier(nameOnly),
                    id: nameOnly,
                    path: relativeDir ? `${relativeDir}/${nameOnly}` : nameOnly,
                    fullPath: `${game}/models/${relativeFilePath.replace(/\\/g, '/')}`,
                    format: path.extname(publishedName).slice(1).toLowerCase(),
                    nodes
                });
            }
        }
    }
    return results;
}

function generateRegistryContent(models) {
    // Every module-scope `const` needs a name unique across the WHOLE file (not just within
    // its group), so it's qualified as e.g. CharactersRunning — but MODELS itself still
    // nests it as MODELS.Characters.Running, which is the part callers actually type.
    const modelEntries = models.map(model => {
        return `const ${model.group}${model.identifier} = {
  id: '${model.id}',
  path: '${model.path}',
  fullPath: '${model.fullPath}',
  format: '${model.format}',
  nodes: ${JSON.stringify(model.nodes, null, 2)}
} as const;`;
    }).join('\n\n');

    const groups = new Map();
    for (const model of models) {
        if (!groups.has(model.group)) groups.set(model.group, []);
        groups.get(model.group).push(model);
    }

    const registryMapping = [...groups.entries()].map(([group, groupModels]) => {
        const entries = groupModels.map(model => `    ${model.identifier}: ${model.group}${model.identifier}`).join(',\n');
        return `  ${group}: {\n${entries}\n  }`;
    }).join(',\n');

    return `// Auto-generated file - DO NOT EDIT
export type ModelFormat = 'glb' | 'gltf' | 'fbx' | 'obj';
export interface ModelDefinition {
  readonly id: string;
  readonly path: string;
  readonly fullPath: string;
  readonly format: ModelFormat;
  readonly nodes: Record<string, string>;
}

${modelEntries}

// Grouped by top-level raw-assets/models folder (the '{...}' tag stripped) — e.g.
// raw-assets/models/characters{m}/... becomes MODELS.Characters.<name>. Files with no
// containing folder land in MODELS.Root.
export const MODELS = {
${registryMapping}
} as const;

export type ModelGroup = keyof typeof MODELS;
export default MODELS;`;
}

async function main() {
    console.log(`🚀 Deep Syncing Models & Folders for: ${game}`);

    if (!fs.existsSync(publicModelsDir)) fs.mkdirSync(publicModelsDir, { recursive: true });

    const models = await scanModels(rawModels);
    const content = generateRegistryContent(models);

    const outDir = path.dirname(outputRegistry);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    fs.writeFileSync(outputRegistry, content, 'utf8');
    console.log(`✨ Success! Full folders copied and registry updated.`);
}

main().catch(err => {
    console.error('❌ Sync failed:', err);
});