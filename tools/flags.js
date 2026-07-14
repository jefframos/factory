import fs from 'fs';
import path from 'path';
import https from 'https';

const flagsDir = path.join(
    process.cwd(),
    'games/clog/game/dom-ui/flags2'
);

if (!fs.existsSync(flagsDir)) {
    fs.mkdirSync(flagsDir, { recursive: true });
}

/**
 * Game flag code -> flag-icons code
 */
const flags = {
    eng: 'gb-eng',
    esp: 'es',
    ita: 'it',
    brz: 'br',
    fra: 'fr',
    deu: 'de',
    jpn: 'jp',
    kor: 'kr',
    chn: 'cn',
    rus: 'ru',
    ind: 'in',
    tur: 'tr',
    pol: 'pl',
    tha: 'th',
    ukr: 'ua',
    idn: 'id',
    vnm: 'vn',
    ara: 'sa',
    nld: 'nl',
    swe: 'se',
    dnk: 'dk',
    nor: 'no',
    rou: 'ro',
    cze: 'cz',
};

const VERSION = '6.11.0';

function downloadFlag(gameCode, flagCode) {
    return new Promise((resolve, reject) => {
        const url =
            `https://cdn.jsdelivr.net/npm/flag-icons@${VERSION}/flags/4x3/${flagCode}.svg`;

        const filePath = path.join(
            flagsDir,
            `Icon_Flag_${gameCode}.svg`
        );

        https.get(url, response => {
            if (response.statusCode !== 200) {
                reject(
                    new Error(
                        `${gameCode}: HTTP ${response.statusCode}`
                    )
                );
                return;
            }

            const file = fs.createWriteStream(filePath);

            response.pipe(file);

            file.on('finish', () => {
                file.close();
                console.log(`✓ ${gameCode}`);
                resolve();
            });

            file.on('error', reject);

        }).on('error', reject);
    });
}


async function main() {
    console.log('Downloading flags...\n');

    const tasks = Object.entries(flags).map(
        ([gameCode, flagCode]) =>
            downloadFlag(gameCode, flagCode)
                .catch(err =>
                    console.error(`✗ ${err.message}`)
                )
    );

    await Promise.all(tasks);

    console.log('\n✓ Finished downloading flags');
}

main();