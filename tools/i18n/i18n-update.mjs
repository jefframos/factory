// i18n-update.mjs — `npm run i18n:update`
//
// The whole LLM translation workflow in one go, with Claude doing the translating (ANTHROPIC_API_KEY in .env):
//
//   1. prepare   — works out what each locale needs (missing / changed English / broken) into pending work files
//   2. translate — each work file goes to Claude in chunks, with translation-guide.md as the instructions; the reply
//                  is constrained to a JSON schema of exactly the chunk's keys, so it can't drop or invent keys
//   3. apply     — every translation checked ({placeholders}, not empty) and merged into the locale files
//   4. validate  — the whole set checked against en.json
//
// Strings Claude gets wrong stay in their work file (apply prints why) and are retried on the next run. Nothing is
// translated twice: the snapshot remembers what each translation was made from.
//
//   npm run i18n:update                       what's missing / changed / broken, every locale
//   npm run i18n:update -- --all              re-translate everything (e.g. to replace the old MyMemory output)
//   npm run i18n:update -- --only=pt-br,es    just these locales
//
// Model: claude-opus-5-5 (I18N_MODEL in .env to override). Requests opt into the server-side refusal fallback, so a
// declined request is re-run on another model instead of failing.

import { execFileSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { GAME, PENDING_DIR, GUIDE_PATH, loadEnglish, loadJson, saveJson } from './i18n-shared.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODEL = process.env.I18N_MODEL || 'claude-opus-5-5';
/** Keys per request: small enough that every reply is quick and well inside the output limit. */
const CHUNK = 60;
/** Locales translated at the same time. */
const PARALLEL = 4;

const LANGUAGE = {
    es: 'Spanish', it: 'Italian', 'pt-br': 'Brazilian Portuguese', fr: 'French', de: 'German', ja: 'Japanese',
    ko: 'Korean', 'zh-cn': 'Simplified Chinese', ru: 'Russian', hi: 'Hindi', tr: 'Turkish', pl: 'Polish', th: 'Thai',
    uk: 'Ukrainian', id: 'Indonesian', vi: 'Vietnamese', ar: 'Arabic', nl: 'Dutch', sv: 'Swedish', da: 'Danish',
    no: 'Norwegian (Bokmål)', ro: 'Romanian', cs: 'Czech',
};

const args = process.argv.slice(2);
const passOn = args.filter((a) => a === '--all' || a.startsWith('--only='));
const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean);

if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Missing ANTHROPIC_API_KEY in .env — create a key at https://console.anthropic.com/settings/keys');
    process.exit(1);
}

// One run at a time: two runs share the work files, and one's apply step deletes files the other is still translating.
// A lock left by a crashed run (its process gone) is taken over.
const LOCK = resolve(PENDING_DIR, '.lock');
if (existsSync(LOCK)) {
    const pid = Number(readFileSync(LOCK, 'utf8'));
    let alive = false;
    try {
        process.kill(pid, 0);
        alive = true;
    } catch {
        // No such process: a stale lock.
    }
    if (alive && pid !== process.pid) {
        console.error(`Another i18n:update is already running (process ${pid}) — wait for it to finish.`);
        process.exit(1);
    }
}
mkdirSync(PENDING_DIR, { recursive: true });
writeFileSync(LOCK, String(process.pid));
process.on('exit', () => {
    try {
        unlinkSync(LOCK);
    } catch {
        // Already gone.
    }
});

const step = (script, extra = []) => execFileSync(process.execPath, [resolve(HERE, script), ...extra], { stdio: 'inherit' });

// 1. prepare (--force: a work file left from a failed run is rebuilt from what's needed now)
console.log('\n— prepare —');
step('i18n-prepare.mjs', [...passOn, '--force']);

// 2. translate
const english = loadEnglish();
const guide = readFileSync(GUIDE_PATH, 'utf8');
const client = new Anthropic();

/** One chunk of keys into `locale`: the English in, a JSON object with exactly those keys out. */
async function translateChunk(locale, keys) {
    const source = Object.fromEntries(keys.map((key) => [key, english[key]]));
    const schema = {
        type: 'object',
        properties: Object.fromEntries(keys.map((key) => [key, { type: 'string' }])),
        required: keys,
        additionalProperties: false,
    };
    const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        // The guide is the same for every request: cached after the first one.
        system: [{ type: 'text', text: guide, cache_control: { type: 'ephemeral' } }],
        output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
        messages: [{
            role: 'user',
            content: `Translate the values of this JSON object from English into ${LANGUAGE[locale] ?? locale} (locale "${locale}"), following the guide. Return the same keys.\n\n${JSON.stringify(source, null, 2)}`,
        }],
    });
    if (response.stop_reason === 'refusal') throw new Error(`refused (${response.stop_details?.category ?? 'no category'})`);
    if (response.stop_reason === 'max_tokens') throw new Error('reply cut off (max_tokens)');
    const text = response.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
    return JSON.parse(text);
}

async function translateLocale(locale) {
    const path = resolve(PENDING_DIR, `${locale}.json`);
    if (!existsSync(path)) {
        console.warn(`  ${locale.padEnd(6)} work file gone (applied or removed elsewhere) — skipped`);
        return;
    }
    const keys = Object.keys(loadJson(path)).filter((key) => key in english);
    const translated = {};
    let failed = 0;
    for (let i = 0; i < keys.length; i += CHUNK) {
        const chunk = keys.slice(i, i + CHUNK);
        try {
            Object.assign(translated, await translateChunk(locale, chunk));
        } catch (error) {
            failed += chunk.length;
            console.warn(`  ${locale.padEnd(6)} ${chunk.length} strings not translated: ${error instanceof Anthropic.APIError ? `API ${error.status} ${error.message}` : error.message}`);
        }
    }
    // Only what came back goes on to apply; failed keys leave the work file (still English, they'd be applied as-is)
    // and the next run's prepare picks them up again, since their locale still lacks them.
    const work = Object.fromEntries(keys.filter((key) => key in translated).map((key) => [key, translated[key]]));
    saveJson(path, work);
    console.log(`  ${locale.padEnd(6)} ${Object.keys(work).length} translated${failed ? `, ${failed} failed (retried next run)` : ''}`);
}

console.log(`\n— translate (${MODEL}) —`);
const locales = existsSync(PENDING_DIR)
    ? readdirSync(PENDING_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).filter((l) => !only || only.includes(l))
    : [];
if (locales.length === 0) {
    console.log('  nothing to translate');
} else {
    const queue = [...locales];
    await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
        while (queue.length) await translateLocale(queue.shift());
    }));
}

// 3. apply, 4. validate (both report their own problems; a failure here doesn't hide the other's report)
console.log('\n— apply —');
try {
    step('i18n-apply.mjs', only ? [`--only=${only.join(',')}`] : []);
} catch {
    // Rejected strings were listed above and stay in their work files.
}
console.log('\n— validate —');
try {
    step('i18n-validate.mjs');
} catch {
    process.exitCode = 1;
}
console.log(`\n${GAME}: done`);
