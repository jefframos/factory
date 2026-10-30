// i18n-shared.mjs
//
// Shared by the LLM translation workflow (i18n-prepare / i18n-apply / i18n-validate): the game's paths (GAME from
// .env), its locale list (read from the game's own i18n/config.ts, so the tools never drift from what the game ships),
// JSON helpers and the string checks (placeholders, empties, leftover machine-translation tokens).
//
//   games/<GAME>/game/i18n/locales/<code>.json   the game's string tables (en.json = the source of truth)
//   tools/i18n/pending/<GAME>/<code>.json        work files: English strings waiting to be translated
//   tools/i18n/snapshots/<GAME>.json             per locale, the English each translation was made from

import dotenv from 'dotenv';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const HERE = dirname(fileURLToPath(import.meta.url));

export const GAME = process.env.GAME || 'clog';
export const GAME_I18N = resolve(HERE, `../../games/${GAME}/game/i18n`);
export const LOCALES_DIR = resolve(GAME_I18N, 'locales');
export const PENDING_DIR = resolve(HERE, 'pending', GAME);
export const SNAPSHOT_PATH = resolve(HERE, 'snapshots', `${GAME}.json`);
/** The old MyMemory script's snapshot (the English it last processed): seeds the new one the first time. */
export const LEGACY_CACHE_PATH = resolve(HERE, GAME === 'clog' ? 'translation-cache.json' : `translation-cache.${GAME}.json`);
export const GUIDE_PATH = resolve(HERE, 'translation-guide.md');
export const SOURCE = 'en';

export function loadJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

export function saveJson(path, data) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 4) + '\n', 'utf8');
}

/** The game's locales (its i18n/config.ts SUPPORTED_LOCALES), English first. */
export function gameLocales() {
    const config = readFileSync(resolve(GAME_I18N, 'config.ts'), 'utf8');
    const list = config.match(/SUPPORTED_LOCALES\s*=\s*\[([\s\S]*?)\]/);
    if (!list) throw new Error(`No SUPPORTED_LOCALES in ${resolve(GAME_I18N, 'config.ts')}`);
    return [...list[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2]);
}

export function loadEnglish() {
    return loadJson(resolve(LOCALES_DIR, `${SOURCE}.json`));
}

/** A locale's table, or {} when the file doesn't exist yet. */
export function loadLocale(locale) {
    const path = resolve(LOCALES_DIR, `${locale}.json`);
    return existsSync(path) ? loadJson(path) : {};
}

/** Per locale, the English each of its translations was made from (seeded from the legacy cache the first time). */
export function loadSnapshot(locales) {
    if (existsSync(SNAPSHOT_PATH)) return loadJson(SNAPSHOT_PATH);
    const legacy = existsSync(LEGACY_CACHE_PATH) ? loadJson(LEGACY_CACHE_PATH) : {};
    return Object.fromEntries(locales.filter((l) => l !== SOURCE).map((l) => [l, { ...legacy }]));
}

/** `{name}` placeholders in a string, sorted (a multiset: the same name twice counts twice). */
export function placeholders(text) {
    return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

/**
 * Problems with a translation of `english` (empty list = fine): not a string, empty, different placeholders,
 * unbalanced braces, or the old MyMemory script's protection tokens left in.
 */
export function problems(english, translated) {
    if (typeof translated !== 'string') return ['not a string'];
    const issues = [];
    if (translated.trim() === '' && english.trim() !== '') issues.push('empty');
    const want = placeholders(english);
    const got = placeholders(translated);
    if (want.join(',') !== got.join(',')) issues.push(`placeholders {${want.join('}, {')}} vs {${got.join('}, {')}}`.replace(/\{\}/g, 'none'));
    const opens = (translated.match(/\{/g) ?? []).length;
    const closes = (translated.match(/\}/g) ?? []).length;
    if (opens !== closes) issues.push('unbalanced { }');
    if (/qxk\s*\d+\s*vqj/i.test(translated)) issues.push('leftover qxk..vqj token');
    return issues;
}

/** Keys in English order (so every table reads the same top to bottom). */
export function ordered(english, table) {
    const out = {};
    for (const key of Object.keys(english)) if (key in table) out[key] = table[key];
    return out;
}
