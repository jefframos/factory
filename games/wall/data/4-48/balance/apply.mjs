// apply.mjs — put the 4:48 build's balance (commit 2b44640e, the snapshot beside this file) back into games/wall/ui,
// section by section, leaving everything that came after it (shop, relics, rarity, hold, ranks...) as it is.
// The whole story: ../BALANCE.md.
//
//   node games/wall/data/4-48/balance/apply.mjs all              every section
//   node games/wall/data/4-48/balance/apply.mjs hp punch          only these
//   node games/wall/data/4-48/balance/apply.mjs                   the list of sections
//
// It edits the files in place, keeping their layout (only the values change), and says what it changed. `git diff
// games/wall/ui` shows it; `git checkout games/wall/ui` undoes it.

import fs from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const ui = resolve(here, '../../../ui');
const old = JSON.parse(fs.readFileSync(resolve(here, 'wall.json'), 'utf8'));
const oldLooks = JSON.parse(fs.readFileSync(resolve(here, 'looks.json'), 'utf8'));

const SECTIONS = {
    hp: 'wall HP (wallHp, hpGrowth 1.7)',
    punch: 'free PUNCH HARDER levels (one a wall, 3 to 16) and their prices',
    crew: 'the animals: walls, prices, damage, the free ones (auto.crew), unlocked by the best wall ever (crewPerRun false)',
    extras: 'when things first come: floating cash / chests / frenzy, nudges, boosts, wardrobe, weak spot, TWO HANDS, AUTO HIT',
    tools: 'the tool ladder (a new tool every level from 13)',
    rewind: 'rewind: PUNCH HARDER back to level 1 (keep 0), its popup at wall 20',
    looks: 'the wardrobe: each look\'s wall (all by 26), offers from wall 5',
};

const asked = process.argv.slice(2);
if (!asked.length) {
    console.log('Sections (or "all"):');
    for (const [name, what] of Object.entries(SECTIONS)) console.log(`  ${name.padEnd(7)} ${what}`);
    process.exit(0);
}
const chosen = asked.includes('all') ? Object.keys(SECTIONS) : asked;
const unknown = chosen.filter((name) => !SECTIONS[name]);
if (unknown.length) {
    console.error(`Not a section: ${unknown.join(', ')}. Run with no arguments for the list.`);
    process.exit(1);
}

/** A value as the files write it: on one line, a space after each colon and comma. */
const inline = (v) => (Array.isArray(v) ? `[${v.map(inline).join(', ')}]` : v && typeof v === 'object' ? `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }` : JSON.stringify(v));

/** Where a value starting at `from` ends (brackets matched, strings skipped). */
function valueEnd(text, from) {
    const open = text[from];
    if (open !== '[' && open !== '{') {
        // (A number, string, true / false: up to the comma, the closing bracket or the line's end; a string whole.)
        if (open === '"') return text.indexOf('"', from + 1) + 1;
        const end = text.slice(from).search(/\s*[,}\]\n]/);
        return end < 0 ? text.length : from + end;
    }
    let depth = 0;
    for (let i = from; i < text.length; i++) {
        const c = text[i];
        if (c === '"') { i++; while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1; continue; }
        if (c === '[' || c === '{') depth++;
        if (c === ']' || c === '}') depth--;
        if (depth === 0) return i + 1;
    }
    throw new Error('unbalanced');
}

/** A top-level key's value: where it starts and ends. */
function topSpan(text, key) {
    const m = new RegExp(`\\n  ${JSON.stringify(key)}: `).exec(text);
    if (!m) throw new Error(`no top-level "${key}"`);
    const start = m.index + m[0].length;
    return [start, valueEnd(text, start)];
}

let wall = fs.readFileSync(resolve(ui, 'wall.json'), 'utf8');
let looks = fs.readFileSync(resolve(ui, 'looks.json'), 'utf8');
const said = [];

/** A top-level key's whole value, written on one line. */
function setTop(key, value) {
    const [a, b] = topSpan(wall, key);
    wall = wall.slice(0, a) + inline(value) + wall.slice(b);
    said.push(`${key} = ${inline(value).slice(0, 100)}`);
}

/** A field somewhere inside a top-level key's value: `path` from it ("given", "chest.fromWall"), the first match in order. */
function setIn(key, path, value) {
    const [a, b] = topSpan(wall, key);
    let block = wall.slice(a, b);
    let at = 0;
    const parts = path.split('.');
    for (const [i, part] of parts.entries()) {
        // (On the way down only an object will do: "chest": { …, not "chest": 13 in another one.)
        const m = new RegExp(`${JSON.stringify(part)}: ${i < parts.length - 1 ? '(?=\\{)' : ''}`).exec(block.slice(at));
        if (!m) throw new Error(`no ${key}.${path}`);
        at += m.index + m[0].length;
    }
    const end = valueEnd(block, at);
    block = block.slice(0, at) + inline(value) + block.slice(end);
    wall = wall.slice(0, a) + block + wall.slice(b);
    said.push(`${key}.${path} = ${inline(value).slice(0, 100)}`);
}

/** In a list of entries with ids (crew, powers), fields of the one with this id. */
function setEntry(key, id, fields) {
    for (const [field, value] of Object.entries(fields)) {
        const [a, b] = topSpan(wall, key);
        const block = wall.slice(a, b);
        const re = new RegExp(`("id": "${id}"[^\\n]*?"${field}": )[^,}\\n]+`);
        if (!re.test(block)) throw new Error(`no ${key} ${id}.${field}`);
        wall = wall.slice(0, a) + block.replace(re, `$1${inline(value)}`) + wall.slice(b);
    }
    said.push(`${key} ${id}: ${inline(fields)}`);
}

const apply = {
    hp() {
        setTop('wallHp', old.wallHp);
        setTop('hpGrowth', old.hpGrowth);
    },
    punch() {
        setIn('punch', 'given', old.punch.given);
        setIn('punch', 'costs', old.punch.costs);
        setIn('punch', 'costGrowth', old.punch.costGrowth);
    },
    crew() {
        for (const def of old.crew) setEntry('crew', def.id, { wall: def.wall, cost: def.cost, dps: def.dps });
        setIn('auto', 'crew', old.auto.crew);
        setTop('crewPerRun', false);
    },
    extras() {
        setIn('floating', 'fromWall', old.floating.fromWall);
        setIn('floating', 'chest.fromWall', old.floating.chest.fromWall);
        setIn('floating', 'frenzy.fromWall', old.floating.frenzy.fromWall);
        setIn('nudge', 'wall', old.nudge.wall);
        setIn('shows', 'boosts', old.shows.boosts);
        setIn('shows', 'wardrobe', old.shows.wardrobe);
        setIn('weak', 'wall', old.weak.wall);
        setIn('auto', 'slow', old.auto.slow);
        for (const power of old.powers) setEntry('powers', power.id, { wall: power.wall });
    },
    tools() {
        setIn('tools', 'levels', old.tools.levels);
        // (4:48 had no levelsAfter: past the list, a new tool every level, which is levelsAfter 1.)
        setIn('tools', 'levelsAfter', 1);
    },
    rewind() {
        // (4:48 put PUNCH HARDER back to level 1: today's `keep` of 0 does the same, Math.max(1, …).)
        setIn('rewind', 'keep', 0);
        setIn('rewind', 'popup', old.rewind.popup);
    },
    looks() {
        // Each look's wall (`wall`, `buy` or `video`), tab by tab (some ids are in more than one tab).
        const starts = [...looks.matchAll(/\n    \{ "id": "([^"]+)", "name": "[^"]*", "items": \[/g)].map((m) => ({ id: m[1], at: m.index }));
        let changed = 0;
        for (let t = starts.length - 1; t >= 0; t--) {
            const tab = oldLooks.tabs.find((x) => x.id === starts[t].id);
            if (!tab) continue;
            const a = starts[t].at;
            const b = t + 1 < starts.length ? starts[t + 1].at : looks.length;
            let block = looks.slice(a, b);
            for (const item of tab.items) {
                for (const field of ['wall', 'buy', 'video']) {
                    if (item[field] === undefined) continue;
                    const re = new RegExp(`(\\{ "id": "${item.id}"[^\\n]*?"${field}": )\\d+`);
                    if (re.test(block)) { block = block.replace(re, `$1${item[field]}`); changed++; }
                }
            }
            looks = looks.slice(0, a) + block + looks.slice(b);
        }
        const [, offers] = /\n  "offers": (\{[^\n]*?)"fromWall": \d+/.exec(looks) ?? [];
        if (offers !== undefined) looks = looks.replace(/(\n  "offers": \{[^\n]*?"fromWall": )\d+/, `$1${oldLooks.offers.fromWall}`);
        said.push(`looks: ${changed} walls set back; offers.fromWall = ${oldLooks.offers.fromWall}`);
    },
};

for (const name of chosen) apply[name]();
JSON.parse(wall);
JSON.parse(looks);
fs.writeFileSync(resolve(ui, 'wall.json'), wall);
fs.writeFileSync(resolve(ui, 'looks.json'), looks);
console.log(`4:48 balance applied (${chosen.join(', ')}):`);
for (const line of said) console.log(`  ${line}`);
console.log('See: git diff games/wall/ui   Undo: git checkout games/wall/ui');
