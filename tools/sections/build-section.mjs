import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Usage: node build-section.mjs [srcFolder] [id] [name] [type] [useThumb] [outFolder]
const [, , folder, id, name, type, useThumbStr, outFolder] = process.argv;

if (!folder || !id || !name) {
    console.error("Usage: node build-section.mjs <srcFolder> <id> <name> <type> <useThumb> <outFolder>");
    process.exit(1);
}

const typeInt = parseInt(type) || 0;
const useImageAsThumb = useThumbStr === 'true';
const outputDir = outFolder ? path.resolve(process.cwd(), outFolder) : process.cwd();

// Fixed costs array
const costArray = [0, 0, 20, 60, 100, 100, 200, 300, 500];

const buildJson = () => {
    const dirPath = path.resolve(process.cwd(), folder);

    // Extract JUST the immediate folder name (e.g., "cozy_girls")
    const immediateFolder = path.basename(dirPath);

    if (!fs.existsSync(dirPath)) {
        console.error(`Source folder not found: ${dirPath}`);
        process.exit(1);
    }

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // const files = fs.readdirSync(dirPath)
    //     .filter(file => /\.(png|jpg|jpeg|webp)$/i.test(file))
    //     .sort((a, b) => a.localeCompare(undefined, { numeric: true, sensitivity: 'base' }));

    const files = fs.readdirSync(dirPath)
        .filter(file => /\.(png|jpg|jpeg|webp)$/i.test(file))
        .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

    const levels = files.map((file, index) => {
        const ext = path.extname(file);
        const baseName = path.basename(file, ext);
        const levelId = `${id}_${String(index + 1).padStart(2, '0')}`;

        // Construct path using only the immediate parent folder
        const relativeImagePath = `${immediateFolder}/${file}`;

        return {
            id: levelId,
            name: `Puzzle ${index + 1}`,
            thumb: useImageAsThumb ? undefined : baseName,
            isSpecial: false,
            cost: costArray[index] ?? costArray[costArray.length - 1],
            image: relativeImagePath
        };
    });

    const output = {
        section: {
            id,
            name,
            coverLevelId: levels[0]?.id || "",
            type: typeInt,
            levels
        }
    };

    const finalPath = path.join(outputDir, `${id}.json`);
    fs.writeFileSync(finalPath, JSON.stringify(output, null, 4));
    console.log(`✅ Success! File saved to: ${finalPath}`);
    console.log(`📸 Image paths prefixed with: ${immediateFolder}/`);
};

buildJson();