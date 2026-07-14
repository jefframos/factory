/**
 * Generates games/clog/game/i18n/locales/<code>.json from en.json.
 *
 * Modes:
 *
 * Full translation (default):
 *   npm run translate:i18n
 *
 * Only create missing locale files:
 *   npm run translate:i18n -- --missing
 *
 * Only translate new/changed English strings:
 *   npm run translate:i18n -- --update
 *
 * Cache:
 *   tools/i18n/translation-cache.json
 *
 * The cache stores the last processed en.json snapshot.
 * If the cache does not exist, it is created automatically from en.json.
 */

import dotenv from 'dotenv';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SUPPORTED_LOCALES = [
    'en',
    'es',
    'it',
    'pt-br',
    'fr',
    'de',
    'ja',
    'ko',
    'zh-cn',
    'ru',
    'hi',
    'tr',
    'pl',
    'th',
    'uk',
    'id',
    'vi',
    'ar',
    'nl',
    'sv',
    'da',
    'no',
    'ro',
    'cs',
];

const DEFAULT_LOCALE = 'en';

const EMAIL = process.env.MYMEMORY_EMAIL;
const KEY = process.env.MYMEMORY_KEY;

if (!EMAIL || !KEY) {
    console.error('❌ Missing MYMEMORY_EMAIL / MYMEMORY_KEY in .env');
    process.exit(1);
}

const LOCALES_DIR = resolve(__dirname, '../../games/clog/game/i18n/locales');
const CACHE_PATH = resolve(__dirname, 'translation-cache.json');

const REQUEST_DELAY_MS = 350;
const MAX_RETRIES = 2;

const MYMEMORY_CODE = {
    'pt-br': 'pt-BR',
    'zh-cn': 'zh-CN',
};

/* ---------------- Cache ---------------- */

function loadJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function saveJson(path, data) {
    writeFileSync(path, JSON.stringify(data, null, 4) + '\n', 'utf8');
}

function loadCache(en) {
    if (!existsSync(CACHE_PATH)) {
        console.log('ℹ️ No translation cache found. Creating from en.json');
        saveJson(CACHE_PATH, en);
        return en;
    }

    return loadJson(CACHE_PATH);
}

/* ---------------- Helpers ---------------- */

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const TOKEN_OPEN = 'qxk';
const TOKEN_CLOSE = 'vqj';

function protectPlaceholders(template) {
    const names = [];

    const protectedText = template.replace(/\{(\w+)\}/g, (_match, name) => {
        names.push(name);
        return `${TOKEN_OPEN}${names.length - 1}${TOKEN_CLOSE}`;
    });

    return { protectedText, names };
}

function restorePlaceholders(text, names) {
    const regex = new RegExp(`${TOKEN_OPEN}\\s*(\\d+)\\s*${TOKEN_CLOSE}`, 'gi');

    return text.replace(regex, (_match, index) => {
        const name = names[Number(index)];
        return name !== undefined ? `{${name}}` : _match;
    });
}

function hasAllPlaceholders(text, names) {
    const clean = !text.includes(TOKEN_OPEN) && !text.includes(TOKEN_CLOSE);

    return clean && names.every(name => text.split(`{${name}}`).length === 2);
}

/* ---------------- Translation ---------------- */

async function translateOne(text, locale) {
    const target = MYMEMORY_CODE[locale] ?? locale;

    const url =
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}` +
        `&langpair=en|${target}` +
        `&de=${encodeURIComponent(EMAIL)}` +
        `&key=${encodeURIComponent(KEY)}`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(url);
            const data = await response.json();

            if (
                data.responseStatus === 200 &&
                typeof data.responseData?.translatedText === 'string'
            ) {
                return data.responseData.translatedText;
            }

            console.warn(
                `Translation failed (${data.responseStatus})`,
                data.responseDetails
            );

        } catch (err) {
            console.warn(`Request failed attempt ${attempt + 1}`, err);
        }

        if (attempt < MAX_RETRIES) {
            await sleep(REQUEST_DELAY_MS * 2);
        }
    }

    return null;
}

async function translateTable(source, locale, onlyKeys = null) {
    const result = {};

    const entries = Object.entries(source)
        .filter(([key]) => !onlyKeys || onlyKeys.includes(key));

    for (const [key, value] of entries) {
        const { protectedText, names } = protectPlaceholders(value);

        const translated = await translateOne(protectedText, locale);

        await sleep(REQUEST_DELAY_MS);

        if (!translated) {
            console.warn(`[${locale}] ${key} failed, keeping English`);
            result[key] = value;
            continue;
        }

        const restored = restorePlaceholders(translated, names);

        if (!hasAllPlaceholders(restored, names)) {
            console.warn(`[${locale}] ${key} placeholder error`);
            result[key] = value;
            continue;
        }

        result[key] = restored;
    }

    return result;
}

/* ---------------- Modes ---------------- */

function getChangedKeys(previous, current) {
    const changed = [];

    for (const [key, value] of Object.entries(current)) {
        if (previous[key] !== value) {
            changed.push(key);
        }
    }

    return changed;
}

function mergeTranslations(existing, incoming) {
    return {
        ...existing,
        ...incoming,
    };
}

/* ---------------- Main ---------------- */

async function main() {
    const args = process.argv.slice(2);

    const mode =
        args.includes('--missing') ? 'missing' :
            args.includes('--update') ? 'update' :
                'full';

    const en = loadJson(resolve(LOCALES_DIR, 'en.json'));

    const cachedEnglish = loadCache(en);

    const targets = SUPPORTED_LOCALES.filter(
        locale => locale !== DEFAULT_LOCALE
    );

    console.log(`Mode: ${mode}`);

    if (mode === 'update') {
        console.log('Checking English changes...');

        const changedKeys = getChangedKeys(cachedEnglish, en);

        if (changedKeys.length === 0) {
            console.log('✅ No new or changed strings.');
            return;
        }

        console.log(
            `Found ${changedKeys.length} changed strings:`,
            changedKeys.join(', ')
        );

        for (const locale of targets) {
            const path = resolve(LOCALES_DIR, `${locale}.json`);

            if (!existsSync(path)) {
                console.log(
                    `Creating missing locale ${locale}...`
                );

                const full = await translateTable(
                    en,
                    locale
                );

                saveJson(path, full);
                continue;
            }

            const existing = loadJson(path);

            console.log(
                `Updating ${locale} (${changedKeys.length} strings)...`
            );

            const translated = await translateTable(
                Object.fromEntries(
                    changedKeys.map(key => [
                        key,
                        en[key],
                    ])
                ),
                locale
            );

            saveJson(
                path,
                mergeTranslations(existing, translated)
            );
        }

        saveJson(CACHE_PATH, en);

        console.log('✅ Cache updated.');
        return;
    }


    if (mode === 'missing') {
        for (const locale of targets) {
            const path = resolve(
                LOCALES_DIR,
                `${locale}.json`
            );

            if (existsSync(path)) {
                console.log(
                    `Skipping ${locale} (already exists)`
                );
                continue;
            }

            console.log(
                `Creating ${locale}...`
            );

            const translated = await translateTable(
                en,
                locale
            );

            saveJson(path, translated);

            console.log(
                `✅ Created ${path}`
            );
        }

        saveJson(CACHE_PATH, en);

        console.log('✅ Cache updated.');
        return;
    }


    // FULL MODE
    for (const locale of targets) {
        console.log(
            `Translating ${Object.keys(en).length} strings -> ${locale}`
        );

        const translated = await translateTable(
            en,
            locale
        );

        const path = resolve(
            LOCALES_DIR,
            `${locale}.json`
        );

        saveJson(path, translated);

        console.log(
            `✅ Wrote ${path}`
        );
    }

    saveJson(CACHE_PATH, en);

    console.log('✅ Cache updated.');
}


main().catch(err => {
    console.error(err);
    process.exit(1);
});