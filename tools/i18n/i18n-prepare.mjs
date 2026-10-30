// i18n-prepare.mjs — `npm run i18n:prepare`
//
// Step 1 of the LLM translation workflow (prepare -> translate -> apply -> validate). Translates nothing: for each
// of the game's locales it works out which strings need (re)translating and writes them, still in English, to
// tools/i18n/pending/<GAME>/<locale>.json — ready to hand to an LLM (or a person) together with the README written
// next to them (the style guide, the glossary and the rules). Translate the VALUES in place, keep the keys, then run
// `npm run i18n:apply`.
//
// A string is pending for a locale when it's missing there, when its English changed since that locale's translation
// was made (snapshots/<GAME>.json), or when the current translation is broken (placeholders, empty, old tokens).
//
//   npm run i18n:prepare                      what's missing / changed / broken, every locale
//   npm run i18n:prepare -- --all             every string, every locale (a full re-translation)
//   npm run i18n:prepare -- --only=pt-br,es   just these locales
//   npm run i18n:prepare -- --force           overwrite pending files not applied yet

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { GAME, PENDING_DIR, GUIDE_PATH, SOURCE, gameLocales, loadEnglish, loadLocale, loadSnapshot, problems, saveJson, ordered } from './i18n-shared.mjs';

const args = process.argv.slice(2);
const all = args.includes('--all');
const force = args.includes('--force');
const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean);

const english = loadEnglish();
const locales = gameLocales().filter((l) => l !== SOURCE && (!only || only.includes(l)));
const snapshot = loadSnapshot(gameLocales());
console.log(`Game: ${GAME} · ${Object.keys(english).length} English strings · ${locales.length} locales${all ? ' · ALL strings' : ''}`);

const summary = [];
for (const locale of locales) {
    const path = resolve(PENDING_DIR, `${locale}.json`);
    if (existsSync(path) && !force) {
        summary.push([locale, 'skipped: pending file not applied yet (run i18n:apply, or --force)']);
        continue;
    }
    const table = loadLocale(locale);
    const made = snapshot[locale] ?? {};
    const pending = {};
    for (const [key, value] of Object.entries(english)) {
        const missing = !(key in table);
        const changed = made[key] !== undefined && made[key] !== value;
        const broken = !missing && problems(value, table[key]).length > 0;
        if (all || missing || changed || broken) pending[key] = value;
    }
    const count = Object.keys(pending).length;
    if (count === 0) {
        // A work file from an earlier run is stale now: with --force it goes, so nothing re-applies it.
        if (existsSync(path)) unlinkSync(path);
        summary.push([locale, 'up to date']);
        continue;
    }
    saveJson(path, ordered(english, pending));
    summary.push([locale, `${count} to translate`]);
}

// The README beside the work files: the guide, then how to use them.
mkdirSync(PENDING_DIR, { recursive: true });
const guide = existsSync(GUIDE_PATH) ? readFileSync(GUIDE_PATH, 'utf8') : '';
writeFileSync(resolve(PENDING_DIR, 'README.md'), `${guide}

---

## These files (${GAME})

Each \`<locale>.json\` here holds English strings waiting to be translated into that locale.
Translate the **values** in place; keep every **key** exactly as it is. Leave a file out (or a key in it) to skip it.
Then run \`npm run i18n:apply\` (it checks every string before merging) and \`npm run i18n:validate\`.
`, 'utf8');

for (const [locale, status] of summary) console.log(`  ${locale.padEnd(6)} ${status}`);
console.log(`\nWork files: ${PENDING_DIR}`);
