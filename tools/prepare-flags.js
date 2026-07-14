import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const INPUT_DIR = path.resolve(
    process.cwd(),
    'games/clog/game/dom-ui/flags2'
);

const OUTPUT_DIR = path.resolve(
    process.cwd(),
    'games/clog/game/dom-ui/flags/prepared'
);

// Output size
const WIDTH = 84;
const HEIGHT = 69;

// Rounded corner radius
const RADIUS = 10;

// Black border thickness
const STROKE = 4;

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}


function createMask(width, height, radius, stroke) {
    return `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect
        x="${stroke / 2}"
        y="${stroke / 2}"
        width="${width - stroke}"
        height="${height - stroke}"
        rx="${radius}"
        ry="${radius}"
        fill="white"
    />
</svg>
`;
}


function createBorder(width, height, radius, stroke) {
    return `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect
        x="${stroke / 2}"
        y="${stroke / 2}"
        width="${width - stroke}"
        height="${height - stroke}"
        rx="${radius}"
        ry="${radius}"
        fill="none"
        stroke="black"
        stroke-width="${stroke}"
    />
</svg>
`;
}


async function processFlag(filename) {
    const input = path.join(INPUT_DIR, filename);
    const output = path.join(
        OUTPUT_DIR,
        filename.replace('.svg', '.png')
    );

    const mask = Buffer.from(
        createMask(
            WIDTH,
            HEIGHT,
            RADIUS,
            STROKE
        )
    );

    const border = Buffer.from(
        createBorder(
            WIDTH,
            HEIGHT,
            RADIUS,
            STROKE
        )
    );


    const flag = await sharp(input)
        .resize(
            WIDTH,
            HEIGHT,
            {
                fit: 'cover',
                position: 'center'
            }
        )
        .png()
        .toBuffer();


    await sharp(flag)
        // rounded clipping mask
        .composite([
            {
                input: mask,
                blend: 'dest-in'
            },
            {
                input: border,
                blend: 'over'
            }
        ])
        .png()
        .toFile(output);


    console.log(`✓ ${filename}`);
}


async function main() {
    const files = fs.readdirSync(INPUT_DIR)
        .filter(file => file.endsWith('.svg'));

    console.log(`Preparing ${files.length} flags...`);

    for (const file of files) {
        await processFlag(file);
    }

    console.log('🎉 Flags prepared');
}


main().catch(err => {
    console.error(err);
    process.exit(1);
});