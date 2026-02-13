const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

async function processIcons() {
    const configPath = path.join(__dirname, 'icons.json');
    const inputDir = path.join(__dirname, 'input');
    const outputRootDir = path.join(__dirname, 'output');

    // 1. Load the JSON config
    if (!fs.existsSync(configPath)) {
        console.error("Error: icons.json not found!");
        return;
    }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    // 2. Ensure output directory exists
    if (!fs.existsSync(outputRootDir)) fs.mkdirSync(outputRootDir);

    // 3. Read input images
    const files = fs.readdirSync(inputDir).filter(file =>
        ['.png', '.jpg', '.jpeg'].includes(path.extname(file).toLowerCase())
    );

    for (const file of files) {
        const fileNameNoExt = path.parse(file).name;
        const imagePath = path.join(inputDir, file);
        const imageOutputDir = path.join(outputRootDir, fileNameNoExt);

        // Create a subfolder for this specific image
        if (!fs.existsSync(imageOutputDir)) fs.mkdirSync(imageOutputDir);

        console.log(`🚀 Processing: ${file}...`);

        // 4. Iterate through platforms and assets
        for (const [platform, assets] of Object.entries(config)) {
            for (const [assetKey, details] of Object.entries(assets)) {

                // Skip non-image assets like video_trailer
                if (assetKey.includes('video')) continue;

                const targetWidth = details.width;
                const targetHeight = details.height;
                const format = details.formats[0]; // Take the first preferred format

                // Construct the descriptive filename
                // format: cat-icon-crazygames-main_icon-628x628.png
                const outputFileName = `${fileNameNoExt}-${platform}-${assetKey.replace(/_/g, '-')}-${targetWidth}x${targetHeight}.${format}`;
                const outputPath = path.join(imageOutputDir, outputFileName);

                try {
                    await sharp(imagePath)
                        .resize({
                            width: targetWidth,
                            height: targetHeight,
                            fit: sharp.fit.cover, // Fills the dimensions
                            position: sharp.gravity.center // Mathematical center anchor
                        })
                        // If output is JPEG, ensure high quality to prevent "crunchy" icons
                        .jpeg({ quality: 90, progressive: true })
                        .png({ compressionLevel: 9 })
                        .toFormat(format)
                        .toFile(outputPath);

                    console.log(`   ✅ Generated: ${outputFileName}`);
                } catch (err) {
                    console.error(`   ❌ Failed ${assetKey}: ${err.message}`);
                }
            }
        }
    }
    console.log('\n✨ All assets generated in the /output folder!');
}

processIcons();