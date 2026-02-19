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

const cleanName = (name) => name.replace(/\{.*?\}/g, '').trim();

/** Normalizes node names for JS object keys (e.g. "Wheel-Front.L" -> "WheelFrontL") */
function toValidIdentifier(str) {
    return str
        .replace(/[^a-zA-Z0-9]+(.)/g, (m, chr) => chr.toUpperCase())
        .replace(/^[a-z]/, (c) => c.toUpperCase())
        .replace(/[^a-zA-Z0-9]/g, '');
}

async function getModelNodes(fullPath, ext) {
    if (ext !== '.glb' && ext !== '.gltf') return {};
    try {
        const document = await io.read(fullPath);
        const nodes = document.getRoot().listNodes();
        const nodeMap = {};

        nodes.forEach(n => {
            const rawName = n.getName();
            if (rawName) {
                const key = toValidIdentifier(rawName);
                nodeMap[key] = rawName; // Maps the valid JS key to the actual Three.js string name
            }
        });
        return nodeMap;
    } catch (e) {
        return {};
    }
}

async function scanModels(dir, relativeDir = '') {
    const extensions = ['.glb', '.gltf', '.fbx', '.obj'];
    let results = [];
    if (!fs.existsSync(dir)) return [];

    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
        const fullPath = path.join(dir, item.name);
        const ext = path.extname(item.name).toLowerCase();

        if (item.isDirectory()) {
            const subDirClean = cleanName(item.name);
            const nextRelativeDir = relativeDir ? `${relativeDir}/${subDirClean}` : subDirClean;
            results = [...results, ...await scanModels(fullPath, nextRelativeDir)];
        } else if (extensions.includes(ext)) {
            const nameOnly = cleanName(path.parse(item.name).name);
            const nodes = await getModelNodes(fullPath, ext);

            results.push({
                identifier: toValidIdentifier(nameOnly),
                id: nameOnly,
                path: relativeDir ? `${relativeDir}/${nameOnly}` : nameOnly,
                fullPath: relativeDir ? `${relativeDir}/${item.name}` : item.name,
                format: ext.replace('.', ''),
                nodes
            });
        }
    }
    return results;
}

function generateRegistryContent(models) {
    const modelEntries = models.map(model => {
        // Note: No explicit ": ModelDefinition" here! 
        // We let the "as const" at the end do the heavy lifting for intellisense.
        return `const ${model.identifier} = {
  id: '${model.id}',
  path: '${model.path}',
  fullPath: '${game}/models/${model.fullPath}',
  format: '${model.format}',
  nodes: ${JSON.stringify(model.nodes, null, 2)}
} as const;`;
    }).join('\n\n');

    const registryMapping = models.map(model => `  ${model.identifier}`).join(',\n');

    return `// Auto-generated file - DO NOT EDIT

export type ModelFormat = 'glb' | 'gltf' | 'fbx' | 'obj';

/** * This interface remains for documentation or manual typing, 
 * but we rely on 'as const' for the actual registry autocomplete.
 */
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
    console.log('🚀 Deep Scanning Models for hierarchy autocomplete...');
    const models = await scanModels(rawModels);
    const content = generateRegistryContent(models);
    const outDir = path.dirname(outputRegistry);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outputRegistry, content, 'utf8');
    console.log(`✨ Success! Registry written to: ${outputRegistry}`);
}

main();