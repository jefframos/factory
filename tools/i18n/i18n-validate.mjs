// i18n-validate.mjs — `npm run i18n:validate`
//
// Step 4 of the LLM translation workflow (and safe to run any time, e.g. before a build). Checks every locale file of
// the game against en.json:
//
//   ERROR  invalid JSON, a value that isn't a string, empty, different {placeholders} from the English, unbalanced
//          braces, old machine-translation tokens — these would show broken text in the game
//   warn   a missing file or missing strings (the game falls back to English for those), strings whose English
//          changed since they were translated (outdated), keys en.json no longer has
//   info   strings identical to the English (fine for names like "ATM"; listed with --verbose)
//
// Exits 1 when there are errors, so it can gate a build.
//
//   npm run i18n:validate
//   npm run i18n:validate -- --verbose      list every key, not just the counts

import { existsSync } from 'fs';
import { resolve } from 'path';
import { GAME, LOCALES_DIR, SNAPSHOT_PATH, SOURCE, gameLocales, loadEnglish, loadJson, problems } from './i18n-shared.mjs';

const verbose = process.argv.includes('--verbose');
const english = loadEnglish();
const snapshot = existsSync(SNAPSHOT_PATH) ? loadJson(SNAPSHOT_PATH) : {};
const keys = Object.keys(english);
let errors = 0;
let warnings = 0;

// The source itself: every value a string with balanced braces.
for (const [key, value] of Object.entries(english)) {
    if (typeof value !== 'string') {
        console.error(`ERROR en.${key}: not a string`);
        errors++;
    } else if ((value.match(/\{/g) ?? []).length !== (value.match(/\}/g) ?? []).length) {
        console.error(`ERROR en.${key}: unbalanced { }`);
        errors++;
    }
}

const list = (label, items) => (verbose && items.length ? `\n      ${label}: ${items.join(', ')}` : '');

console.log(`Game: ${GAME} · ${keys.length} English strings\n`);
console.log('  locale  missing  outdated  same-as-en  extra  errors');
for (const locale of gameLocales().filter((l) => l !== SOURCE)) {
    const path = resolve(LOCALES_DIR, `${locale}.json`);
    if (!existsSync(path)) {
        console.log(`  ${locale.padEnd(6)}  NO FILE (all ${keys.length} strings fall back to English)`);
        warnings++;
        continue;
    }
    let table;
    try {
        table = loadJson(path);
    } catch (error) {
        console.error(`  ${locale.padEnd(6)}  ERROR invalid JSON: ${error.message}`);
        errors++;
        continue;
    }
    const made = snapshot[locale] ?? {};
    const missing = [];
    const outdated = [];
    const same = [];
    const broken = [];
    for (const key of keys) {
        if (!(key in table)) {
            missing.push(key);
            continue;
        }
        const issues = problems(english[key], table[key]);
        if (issues.length) broken.push(`${key} (${issues.join('; ')})`);
        else if (table[key] === english[key]) same.push(key);
        if (made[key] !== undefined && made[key] !== english[key]) outdated.push(key);
    }
    const extra = Object.keys(table).filter((key) => !(key in english));
    errors += broken.length;
    warnings += missing.length + outdated.length + extra.length;
    const cell = (n, width) => String(n || '·').padStart(width);
    console.log(`  ${locale.padEnd(6)}${cell(missing.length, 9)}${cell(outdated.length, 10)}${cell(same.length, 12)}${cell(extra.length, 7)}${cell(broken.length, 8)}`
        + list('missing', missing) + list('outdated', outdated) + list('same as English', same) + list('extra', extra));
    for (const item of broken) console.error(`      ERROR ${locale}.${item}`);
}

console.log(`\n${errors ? `${errors} error(s)` : 'No errors'} · ${warnings} warning(s)${warnings ? ' (missing strings fall back to English)' : ''}${verbose ? '' : ' · --verbose lists the keys'}`);
process.exit(errors ? 1 : 0);
