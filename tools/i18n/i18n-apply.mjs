// i18n-apply.mjs — `npm run i18n:apply`
//
// Step 3 of the LLM translation workflow (prepare -> translate -> apply -> validate). Merges the translated work files
// in tools/i18n/pending/<GAME>/ into the game's locale files — every string checked first (same {placeholders} as the
// English, not empty, a string, a key en.json has). Good strings go in (in English key order) and are recorded in
// snapshots/<GAME>.json as made from the current English; rejected ones stay in their work file with the reason
// printed, to fix and apply again. A work file left with nothing in it is removed.
//
//   npm run i18n:apply                       every work file
//   npm run i18n:apply -- --only=pt-br       just these locales
//   npm run i18n:apply -- --dry-run          check and report, write nothing

import { existsSync, readdirSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { GAME, PENDING_DIR, SNAPSHOT_PATH, LOCALES_DIR, SOURCE, gameLocales, loadEnglish, loadJson, loadLocale, loadSnapshot, problems, saveJson, ordered } from './i18n-shared.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean);

if (!existsSync(PENDING_DIR)) {
    console.log(`Nothing to apply: no ${PENDING_DIR} (run i18n:prepare first).`);
    process.exit(0);
}

const english = loadEnglish();
const known = new Set(gameLocales());
const snapshot = loadSnapshot(gameLocales());
let rejectedTotal = 0;

const files = readdirSync(PENDING_DIR).filter((f) => f.endsWith('.json'));
for (const file of files) {
    const locale = file.replace(/\.json$/, '');
    if (only && !only.includes(locale)) continue;
    if (locale === SOURCE || !known.has(locale)) {
        console.warn(`  ${locale.padEnd(6)} skipped: not one of the game's locales`);
        continue;
    }
    const path = resolve(PENDING_DIR, file);
    let work;
    try {
        work = loadJson(path);
    } catch (error) {
        console.error(`  ${locale.padEnd(6)} INVALID JSON: ${error.message}`);
        rejectedTotal++;
        continue;
    }
    const accepted = {};
    const rejected = {};
    let unchanged = 0;
    for (const [key, value] of Object.entries(work)) {
        if (!(key in english)) {
            console.warn(`  ${locale.padEnd(6)} ${key}: not a key in en.json (dropped)`);
            continue;
        }
        const issues = problems(english[key], value);
        if (issues.length) {
            rejected[key] = value;
            console.warn(`  ${locale.padEnd(6)} ${key}: ${issues.join('; ')}`);
            continue;
        }
        if (value === english[key]) unchanged++;
        accepted[key] = value;
    }
    const applied = Object.keys(accepted).length;
    rejectedTotal += Object.keys(rejected).length;
    console.log(`  ${locale.padEnd(6)} ${applied} applied${Object.keys(rejected).length ? `, ${Object.keys(rejected).length} rejected (kept in the work file)` : ''}${unchanged ? `, ${unchanged} same as English` : ''}`);
    if (dryRun) continue;

    saveJson(resolve(LOCALES_DIR, `${locale}.json`), ordered(english, { ...loadLocale(locale), ...accepted }));
    snapshot[locale] ??= {};
    for (const key of Object.keys(accepted)) snapshot[locale][key] = english[key];
    if (Object.keys(rejected).length) saveJson(path, ordered(english, rejected));
    else unlinkSync(path);
}

if (!dryRun) saveJson(SNAPSHOT_PATH, snapshot);
console.log(`\n${GAME}: ${dryRun ? 'dry run, nothing written' : 'applied'}${rejectedTotal ? ` · ${rejectedTotal} rejected — fix them in ${PENDING_DIR} and apply again` : ''}`);
process.exit(rejectedTotal ? 1 : 0);
