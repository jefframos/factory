import { NodeIO } from '@gltf-transform/core';
import dotenv from 'dotenv';
import fs from 'fs';
import path, { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

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
 * Scans models and ensures the entire containing folder is copied to public.
 */
async function scanModels(dir, relativeDir = '') {
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
            results = [...results, ...await scanModels(fullSourcePath, nextRelativeDir)];
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

                const relativeFilePath = relativeDir ? path.join(relativeDir, item.name) : item.name;

                results.push({
                    identifier: toValidIdentifier(nameOnly),
                    id: nameOnly,
                    path: relativeDir ? `${relativeDir}/${nameOnly}` : nameOnly,
                    fullPath: `${game}/models/${relativeFilePath.replace(/\\/g, '/')}`,
                    format: ext.replace('.', ''),
                    nodes
                });
            }
        }
    }
    return results;
}

function generateRegistryContent(models) {
    const modelEntries = models.map(model => {
        return `const ${model.identifier} = {
  id: '${model.id}',
  path: '${model.path}',
  fullPath: '${model.fullPath}',
  format: '${model.format}',
  nodes: ${JSON.stringify(model.nodes, null, 2)}
} as const;`;
    }).join('\n\n');

    const registryMapping = models.map(model => `  ${model.identifier}`).join(',\n');

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

export const MODELS = {
${registryMapping}
} as const;

export type ModelKey = keyof typeof MODELS;
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