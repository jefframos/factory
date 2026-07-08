/**
 * Generates games/clog/game/i18n/locales/<code>.json for every locale listed
 * below (except 'en', the hand-authored source of truth) by machine-
 * translating en.json through the MyMemory API
 * (https://mymemory.translated.net/doc/spec.php).
 *
 * Run: npm run translate:i18n            (all configured locales)
 *      npm run translate:i18n -- es fr   (only these locales)
 *
 * Needs MYMEMORY_EMAIL / MYMEMORY_KEY in .env — MyMemory ties the higher
 * daily quota to that account instead of the calling IP.
 *
 * SUPPORTED_LOCALES here must stay in sync with
 * games/clog/game/i18n/config.ts — duplicated rather than imported since
 * this is a plain Node/ESM build tool (see tools/*.mjs) and that file is
 * TypeScript consumed by the Vite/game build instead.
 */
import dotenv from 'dotenv';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SUPPORTED_LOCALES = ['en', 'es', 'it', 'pt-br', 'fr', 'de', 'ja', 'ko', 'zh-cn', 'ru'];
const DEFAULT_LOCALE = 'en';

const EMAIL = process.env.MYMEMORY_EMAIL;
const KEY = process.env.MYMEMORY_KEY;
if (!EMAIL || !KEY) {
    console.error('❌ Missing MYMEMORY_EMAIL / MYMEMORY_KEY in .env');
    process.exit(1);
}

const LOCALES_DIR = resolve(__dirname, '../../games/clog/game/i18n/locales');
const REQUEST_DELAY_MS = 350; // MyMemory asks callers not to hammer the endpoint
const MAX_RETRIES = 2;

/** MyMemory's own langpair codes, where they differ from our locale codes. */
const MYMEMORY_CODE = {
    'pt-br': 'pt-BR',
    'zh-cn': 'zh-CN',
};

function sleep(ms) {
    return new Promise(res => setTimeout(res, ms));
}

// Open/close markers for a protected placeholder — deliberately non-repeating
// letters (no run of the same character) so a translation engine that drops
// or duplicates one character of a run (observed with a "zzz" token on CJK
// output — see git history) can't silently leave a stray leftover character
// behind that the placeholder-count check wouldn't catch.
const TOKEN_OPEN = 'qxk';
const TOKEN_CLOSE = 'vqj';

/**
 * Swaps every `{varName}` in `template` for an opaque `qxkNvqj` token before
 * translation (MT engines reliably leave alphanumeric "words" like that
 * alone, unlike `{curly braces}`, which some engines mangle or drop) and
 * hands back the list of names in order, so the caller can restore them
 * afterward and verify none went missing.
 */
function protectPlaceholders(template) {
    const names = [];
    const protectedText = template.replace(/\{(\w+)\}/g, (_match, name) => {
        names.push(name);
        return `${TOKEN_OPEN}${names.length - 1}${TOKEN_CLOSE}`;
    });
    return { protectedText, names };
}

/** Restores `qxkNvqj` tokens back to `{varName}` — case-insensitive and whitespace-tolerant, since MT engines sometimes capitalize or re-space them. */
function restorePlaceholders(translated, names) {
    const pattern = new RegExp(`${TOKEN_OPEN}\\s*(\\d+)\\s*${TOKEN_CLOSE}`, 'gi');
    return translated.replace(pattern, (match, indexStr) => {
        const name = names[Number(indexStr)];
        return name !== undefined ? `{${name}}` : match;
    });
}

/**
 * True only if `text` contains each of `names` exactly once as a clean
 * `{name}` placeholder AND no fragment of the raw token markers survived
 * restoration (the tell for a partial/overrun match — see restorePlaceholders
 * doc comment) — a translated string that passes this has zero leftover MT
 * artifacts, not just "the right variable names somewhere in it".
 */
function hasAllPlaceholders(text, names) {
    const noStrayMarkers = !new RegExp(TOKEN_OPEN, 'i').test(text) && !new RegExp(TOKEN_CLOSE, 'i').test(text);
    return noStrayMarkers && names.every(name => text.split(`{${name}}`).length === 2);
}

async function translateOne(text, targetCode) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${targetCode}&de=${encodeURIComponent(EMAIL)}&key=${encodeURIComponent(KEY)}`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const res = await fetch(url);
            const data = await res.json();
            if (data.responseStatus === 200 && typeof data.responseData?.translatedText === 'string') {
                return data.responseData.translatedText;
            }
            console.warn(`  ! MyMemory returned status ${data.responseStatus} for "${text}" — ${data.responseDetails ?? 'no detail'}`);
        } catch (err) {
            console.warn(`  ! request failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}) for "${text}":`, err);
        }
        if (attempt < MAX_RETRIES) await sleep(REQUEST_DELAY_MS * 2);
    }
    return null;
}

async function translateTable(source, locale) {
    const targetCode = MYMEMORY_CODE[locale] ?? locale;
    const result = {};

    for (const [key, template] of Object.entries(source)) {
        const { protectedText, names } = protectPlaceholders(template);
        const translatedProtected = await translateOne(protectedText, targetCode);
        await sleep(REQUEST_DELAY_MS);

        if (translatedProtected === null) {
            console.warn(`  ! [${locale}] "${key}" — translation request failed, keeping English`);
            result[key] = template;
            continue;
        }

        const restored = restorePlaceholders(translatedProtected, names);
        if (!hasAllPlaceholders(restored, names)) {
            console.warn(`  ! [${locale}] "${key}" — lost a placeholder in translation ("${restored}"), keeping English`);
            result[key] = template;
            continue;
        }

        result[key] = restored;
    }

    return result;
}

async function main() {
    const requested = process.argv.slice(2);
    const targets = requested.length ? requested : SUPPORTED_LOCALES.filter(l => l !== DEFAULT_LOCALE);

    for (const locale of targets) {
        if (!SUPPORTED_LOCALES.includes(locale)) {
            console.error(`❌ Unknown locale "${locale}" — must be one of ${SUPPORTED_LOCALES.join(', ')}`);
            process.exit(1);
        }
    }

    const en = JSON.parse(readFileSync(resolve(LOCALES_DIR, 'en.json'), 'utf-8'));

    for (const locale of targets) {
        console.log(`Translating ${Object.keys(en).length} strings -> ${locale}...`);
        const table = await translateTable(en, locale);
        const outPath = resolve(LOCALES_DIR, `${locale}.json`);
        writeFileSync(outPath, JSON.stringify(table, null, 4) + '\n', 'utf-8');
        console.log(`  ✅ wrote ${outPath}`);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
