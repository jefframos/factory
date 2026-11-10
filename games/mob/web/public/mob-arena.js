// The Mob editor's Arena tab, beside the Levels tab's own editing (mob-editor.js shows the same field, tools and preview
// for the arenas in games/mob/arenas/): an arena is the player's half of the field (game/data/ArenaConfig.ts), and the
// enemy's half is drawn faded, mirrored. This file has what's the Arena tab's own:
//   - the mirror (as the game builds it), and both sides' cannons and towers on the field;
//   - the arena's panel: its name, theme, match length, buildings' life;
//   - a test match in the preview: against the ladder's opponent at a rating, or a chosen robot; or watching a robot
//     play your side (test matches aren't counted on the save's arena record);
//   - the simulator: robots against robots on the arena as it is (tools/duel-run.mjs), and a ladder climb — a robot
//     "player" from a new record, match after match, to see where each kind of player ends up;
//   - the arena ladder (ui/arena-ladder.json, game/data/ArenaLadder.ts): its tiers (who the opponent is at each rating:
//     its skill, its cards, how close its cards' and cannon's levels come to the player's own), points and streaks.

/** As ArenaConfig.ts ARENA_RULES. */
export const ARENA_RULES = { width: 10, length: 30, seconds: 90, towerHp: 150, cannonHp: 300, tower: { width: 2, inset: 1 }, towerZ: -0.4, cannonZ: -2.4, cannonWidth: 1.8, cannonMargin: 0.8, cannonFront: 0.6, mostGates: 4 };
const SKILLS = ['newbie', 'casual', 'average', 'pro'];
const fieldHalf = (data) => (data.width ?? ARENA_RULES.width) / 2;
const CARDS = ['giant', 'truck', 'car', 'saucer'];

/** A new arena. */
export function newArena(name) {
    return {
        name, width: ARENA_RULES.width, length: ARENA_RULES.length, seconds: ARENA_RULES.seconds, towerHp: ARENA_RULES.towerHp, cannonHp: ARENA_RULES.cannonHp,
        cannonZ: ARENA_RULES.cannonZ, cannonRange: ARENA_RULES.width / 2 - ARENA_RULES.cannonMargin, cannonWidth: ARENA_RULES.cannonWidth,
        targets: defaultTowers(ARENA_RULES.width),
        gates: [{ x: -2.4, z: -7, width: 3, value: 2 }, { x: 2.4, z: -10, width: 3, value: 3 }],
    };
}

/** The enemy's half: the arena's pieces mirrored across the middle (z' = -length - z), as the game makes it. */
export function mirrorArena(data, length) {
    const m = (z) => -length - z;
    // 'both': left for right too (turned half a turn).
    const mx = (x) => (data.mirror === 'both' ? -x : x);
    const z = (item) => ({ ...item, x: mx(item.x ?? 0), z: m(item.z ?? 0) });
    return {
        gates: (data.gates ?? []).map(z),
        obstacles: (data.obstacles ?? []).map((o) => (o.points ? { ...o, points: o.points.map(([x, pz]) => [mx(x), m(pz)]) } : z(o))),
        spinners: (data.spinners ?? []).map(z),
        pushers: (data.pushers ?? []).map(z),
        pads: (data.pads ?? []).map(z),
        helmets: (data.helmets ?? []).map(z),
        pipes: (data.pipes ?? []).map((p) => ({ ...p, x: mx(p.x), toX: mx(p.toX), z: m(p.z), toZ: m(p.toZ), team: (p.team ?? 'blue') === 'both' ? 'both' : p.team === 'red' ? 'blue' : 'red' })),
        grinders: (data.grinders ?? []).map(z),
    };
}

/** A new arena's towers: one each side, at the back. */
export function defaultTowers(width) {
    const x = width / 2 - ARENA_RULES.tower.inset;
    return [{ x: -x, z: ARENA_RULES.towerZ, width: ARENA_RULES.tower.width }, { x, z: ARENA_RULES.towerZ, width: ARENA_RULES.tower.width }];
}

/** The player's cannon, as the game has it (ArenaConfig arenaCannon): its row, its slide either way, its width. */
export function arenaCannon(data, width) {
    return {
        z: data.cannonZ ?? ARENA_RULES.cannonZ,
        range: Math.max(0, Math.min(width / 2 - 0.5, data.cannonRange ?? width / 2 - ARENA_RULES.cannonMargin)),
        width: data.cannonWidth ?? ARENA_RULES.cannonWidth,
    };
}

/** The player's towers, as the game has them: [{ x, z, width, hp }] (z: the front). */
export function arenaTowers(data, width) {
    return (data.targets ?? defaultTowers(width)).map((t) => ({ x: t.x, z: t.z ?? ARENA_RULES.towerZ, width: t.width ?? ARENA_RULES.tower.width, hp: t.hp ?? data.towerHp ?? ARENA_RULES.towerHp }));
}

/**
 * The Arena tab's helpers, given the editor's: { el, api, toast, state, numberField, textField, fieldSizeFields,
 * sendPreview, changed, checkpoint }.
 */
export function createArenaTab(editor) {
    const { el, api, toast, state } = editor;
    /** The test match's choices (kept while the editor's open), the simulator's, the ladder (loaded once). */
    const test = { ai: '', rating: '', watch: '' };
    const sim = { blue: 'average', red: 'all', matches: 20, cardLevel: 1, cannon: 1, cards: [...CARDS] };
    let ladder = null;
    let ladderDirty = false;
    let busy = false;
    let results = null;
    let climb = null;

    const select = (value, options, onChange) => el('select', { onchange: (e) => onChange(e.target.value) }, ...options.map(([v, label]) => el('option', { value: v, selected: v === value }, label)));
    const row = (label, input, title) => el('div', { class: 'field' }, el('label', { title: title ?? '' }, label), input);
    const number = (object, key, step, onChange) => {
        const input = el('input', { type: 'number', step, value: object[key] ?? '' });
        input.addEventListener('change', () => onChange(input.value === '' ? '' : Number(input.value)));
        return input;
    };

    async function loadLadder() {
        if (ladder) return;
        try {
            ladder = await api('/api/mob/arena-ladder');
        } catch (error) {
            toast(`Could not load the ladder: ${error.message}`, 'error');
        }
    }

    /** What the test sends with the arena to the preview. */
    function testMessage() {
        return { ai: test.ai || undefined, rating: test.rating === '' ? undefined : Number(test.rating), watch: test.watch || undefined };
    }

    function side(skill) {
        const cards = Object.fromEntries(sim.cards.map((kind) => [kind, sim.cardLevel]));
        return { skill, cards, fire: sim.cannon, capacity: sim.cannon, recharge: sim.cannon };
    }

    async function simulate(data, redraw) {
        if (busy) return;
        busy = true;
        results = null;
        redraw();
        try {
            const job = { arena: data, blue: side(sim.blue), matches: sim.matches };
            if (sim.red === 'all') job.against = SKILLS;
            else job.red = side(sim.red);
            results = (await api('/api/mob/duel-sim', { method: 'POST', body: job })).runs;
        } catch (error) {
            toast(error.message, 'error');
        }
        busy = false;
        redraw();
    }

    async function climbLadder(data, redraw) {
        if (busy || !ladder) return;
        busy = true;
        climb = null;
        redraw();
        try {
            climb = [];
            for (const skill of SKILLS) {
                const out = await api('/api/mob/duel-sim', { method: 'POST', body: { arena: data, ladder, player: side(skill), matches: sim.matches } });
                climb.push({ skill, ...out });
            }
        } catch (error) {
            toast(error.message, 'error');
        }
        busy = false;
        redraw();
    }

    async function saveLadder(redraw) {
        try {
            await api('/api/mob/arena-ladder', { method: 'PUT', body: ladder });
            ladderDirty = false;
            toast('Saved ui/arena-ladder.json', 'ok');
        } catch (error) {
            toast(error.message, 'error');
        }
        redraw();
    }

    /** The ladder's table: a row per tier, its points and streaks. */
    function ladderPanel(redraw) {
        if (!ladder) return el('p', { class: 'hint' }, 'Loading the ladder…');
        const touch = () => { ladderDirty = true; };
        const box = el('div', {});
        box.append(el('p', { class: 'hint' }, 'Who the player meets: their arena rating picks a tier (a win adds points, a loss takes some off). Its robot plays with its skill and only the cards ticked (and only those the player has); its cards\' and cannon\'s levels go from 1 (0) to the player\'s own (1), never above. A streak of wins (or losses) moves it a tier up (or down).'));
        for (const [i, tier] of ladder.tiers.entries()) {
            const cards = el('span', {}, ...CARDS.map((kind) => {
                const box = el('input', { type: 'checkbox', checked: tier.cards.includes(kind), title: kind });
                box.addEventListener('change', () => {
                    tier.cards = CARDS.filter((k) => (k === kind ? box.checked : tier.cards.includes(k)));
                    touch();
                });
                return el('label', { style: { marginRight: '4px' } }, box, kind.slice(0, 3));
            }));
            box.append(el('div', { style: { borderTop: '1px solid #23284a', padding: '6px 0' } },
                row('tier', el('span', {},
                    (() => { const name = el('input', { type: 'text', value: tier.name, style: { width: '90px' } }); name.addEventListener('change', () => { tier.name = name.value; touch(); }); return name; })(),
                    el('button', { class: 'danger', title: 'Remove this tier', style: { marginLeft: '4px' }, onclick: () => { if (ladder.tiers.length > 1) { ladder.tiers.splice(i, 1); touch(); redraw(); } } }, '×'))),
                row('from ★', number(tier, 'from', 10, (v) => { tier.from = Number(v) || 0; touch(); }), 'The rating it starts at'),
                row('skill', select(tier.skill, SKILLS.map((s) => [s, s]), (v) => { tier.skill = v; touch(); })),
                row('cards', cards),
                row('card level', number(tier, 'cardLevel', 0.05, (v) => { tier.cardLevel = Math.max(0, Math.min(1, Number(v) || 0)); touch(); }), '0: level 1 … 1: the player\'s own'),
                row('cannon', number(tier, 'cannon', 0.05, (v) => { tier.cannon = Math.max(0, Math.min(1, Number(v) || 0)); touch(); }), 'Its upgrades: 0 level 1 … 1 the player\'s own'),
            ));
        }
        box.append(el('button', { onclick: () => { const last = ladder.tiers[ladder.tiers.length - 1]; ladder.tiers.push({ ...last, cards: [...last.cards], from: last.from + 150, name: 'New tier' }); touch(); redraw(); } }, '+ Tier'));
        box.append(el('h3', { style: { marginTop: '10px' } }, 'Points and streaks'));
        for (const key of ['win', 'loss', 'draw']) box.append(row(key, number(ladder.points, key, 1, (v) => { ladder.points[key] = Number(v) || 0; touch(); }), key === 'loss' ? 'Taken off' : 'Added'));
        box.append(row('streak after', number(ladder.streak, 'after', 1, (v) => { ladder.streak.after = Math.max(1, Math.round(Number(v) || 1)); touch(); }), 'Wins (or losses) in a row before the opponent moves'));
        box.append(row('streak tiers', number(ladder.streak, 'tiers', 1, (v) => { ladder.streak.tiers = Math.max(0, Math.round(Number(v) || 0)); touch(); }), 'How many tiers it moves'));
        box.append(el('div', { class: 'field' }, el('button', { class: 'primary', onclick: () => saveLadder(redraw) }, ladderDirty ? 'Save ladder •' : 'Save ladder')));
        return box;
    }

    function resultsTable() {
        if (busy) return el('p', { class: 'hint' }, 'Playing…');
        const box = el('div', {});
        if (results) {
            for (const run of results) {
                const share = (n) => `${Math.round((n / Math.max(1, run.won + run.lost + run.draw)) * 100)}%`;
                box.append(el('div', { style: { padding: '3px 0', borderBottom: '1px solid #23284a' } },
                    el('b', {}, `${run.blue} vs ${run.red}`), el('br'),
                    el('small', {}, `won ${run.won} (${share(run.won)}) · lost ${run.lost} · draw ${run.draw} · ${run.time}s · life ${run.blueHp} vs ${run.redHp} of ${run.blueMax}`)));
            }
        }
        if (climb) {
            for (const c of climb) {
                const path = c.climb.map((m) => `${m.tier[0]}${m.result === 'won' ? '+' : m.result === 'lost' ? '-' : '='}`).join(' ');
                box.append(el('div', { style: { padding: '3px 0', borderBottom: '1px solid #23284a' } },
                    el('b', {}, `${c.skill}: ★ ${c.record.rating}`), el('small', {}, ` ${c.record.won}W ${c.record.lost}L`), el('br'),
                    el('small', { title: 'Each match: the tier met (its first letter) and + won, - lost, = draw' }, path)));
            }
        }
        return box;
    }

    /** The arena's panel (nothing selected on the field). */
    function panel(data, redraw) {
        void loadLadder().then(() => { if (ladder && !panel.loaded) { panel.loaded = true; redraw(); } });
        const box = el('div', {});
        box.append(el('h3', {}, `Arena · ${state.id}`));
        box.append(editor.textField(data, 'name'));
        box.append(row('theme', select(data.theme ?? 'beach', state.themes.map((t) => [t.id, t.name]), (v) => { editor.checkpoint(); data.theme = v; editor.changed(); })));
        box.append(editor.fieldSizeFields(data));
        box.append(row('mirror', select(data.mirror ?? 'vertical', [['vertical', 'across the middle'], ['both', 'and left for right (turned)']], (v) => {
            editor.checkpoint();
            if (v === 'both') data.mirror = 'both'; else delete data.mirror;
            editor.changed();
        }), "How the enemy's half is made from yours: straight across the middle (a gate in front of its copy), or turned half a turn (your left is their right: a big gate on one side faces the other side's)"));
        box.append(el('h3', { style: { marginTop: '10px' } }, 'Cannon'));
        for (const [key, hint, fallback] of [
            ['cannonZ', 'its row: how far up the field (negative: up, in front of the towers)', ARENA_RULES.cannonZ],
            ['cannonRange', 'how far it slides either way from the middle (its length)', fieldHalf(data) - ARENA_RULES.cannonMargin],
            ['cannonWidth', 'how wide it is to the reds (its life is hit there)', ARENA_RULES.cannonWidth],
        ]) {
            if (data[key] === undefined) data[key] = fallback;
            box.append(editor.numberField(data, key, null, { step: 0.1, hint }));
        }
        box.append(el('h3', { style: { marginTop: '10px' } }, 'Comeback boost'));
        if (data.boostRate === undefined) data.boostRate = 1.6;
        for (const key of ['boostSeconds', 'boostCooldown', 'boostBehind']) delete data[key];
        box.append(editor.numberField(data, 'boostRate', null, { step: 0.1, hint: 'once a side\'s towers are all down, its cannon fires this many times faster (by itself, till the end)' }));
        box.append(el('p', { class: 'hint' }, 'Towers: the Tower tool adds one; drag them on the field (z is a tower\'s front, the line the reds hit). A tower\'s hp empty: towerHp.'));
        for (const [key, hint] of [['unlockAt', 'it opens when the player reaches this story level (the first arena: empty for the rest)'], ['trophies', 'and once the player has this many trophies (the later arenas)'], ['seconds', 'the match\'s length'], ['towerHp', 'each tower\'s life'], ['cannonHp', 'the cannon\'s life (it falling loses at once)']]) {
            box.append(editor.numberField(data, key, null, { step: 1, hint }));
        }
        if ((data.gates ?? []).length > ARENA_RULES.mostGates) box.append(el('p', { class: 'hint', style: { color: '#ff8a8a' } }, `At most ${ARENA_RULES.mostGates} gates on your half (a mob remembers 8 on the field): the rest are left out.`));
        box.append(el('p', { class: 'hint' }, 'Edit your half (the bottom, from your cannon to the middle line). The enemy\'s half is its mirror (faded): its gates, houses and barriers work for the reds. Each side: its cannon (its life) between two towers.'));

        box.append(el('h3', { style: { marginTop: '14px' } }, 'Test match (preview)'));
        box.append(row('opponent', select(test.ai, [['', 'from the ladder'], ...SKILLS.map((s) => [s, `${s} robot`])], (v) => { test.ai = v; }), 'The robot\'s hands; its cards and cannon still come from the ladder'));
        box.append(row('at rating', number(test, 'rating', 10, (v) => { test.rating = v; }), 'Meet the opponent of this rating (empty: the save\'s own)'));
        box.append(row('your side', select(test.watch, [['', 'you play'], ...SKILLS.map((s) => [s, `${s} robot (watch)`])], (v) => { test.watch = v; }), 'A robot plays your side too: watch them'));
        box.append(el('div', { class: 'field' }, el('button', { class: 'primary', onclick: () => editor.sendPreview() }, '▶ Play test')));
        box.append(el('p', { class: 'hint' }, 'Tap the field to start. Your side has the dev save\'s cards and upgrades. Test matches don\'t count on the save\'s arena record (the debug panel\'s ARENA plays a counted one).'));

        box.append(el('h3', { style: { marginTop: '14px' } }, 'Simulator'));
        box.append(row('blue', select(sim.blue, SKILLS.map((s) => [s, s]), (v) => { sim.blue = v; })));
        box.append(row('red', select(sim.red, [['all', 'each of the four'], ...SKILLS.map((s) => [s, s])], (v) => { sim.red = v; })));
        box.append(row('matches', number(sim, 'matches', 1, (v) => { sim.matches = Math.max(1, Math.min(200, Math.round(Number(v) || 1))); }), 'Each pairing (and each ladder climb\'s length)'));
        box.append(row('card level', number(sim, 'cardLevel', 1, (v) => { sim.cardLevel = Math.max(1, Math.round(Number(v) || 1)); }), 'Both sides\' cards (a climb: the player\'s)'));
        box.append(row('cannon', number(sim, 'cannon', 1, (v) => { sim.cannon = Math.max(1, Math.round(Number(v) || 1)); }), 'Both sides\' cannon upgrades (a climb: the player\'s)'));
        box.append(row('cards', el('span', {}, ...CARDS.map((kind) => {
            const tick = el('input', { type: 'checkbox', checked: sim.cards.includes(kind) });
            tick.addEventListener('change', () => { sim.cards = CARDS.filter((k) => (k === kind ? tick.checked : sim.cards.includes(k))); });
            return el('label', { style: { marginRight: '4px' } }, tick, kind.slice(0, 3));
        }))));
        box.append(el('div', { class: 'field' },
            el('button', { disabled: busy, onclick: () => simulate(data, redraw), title: 'Robot against robot on the arena as it is now' }, 'Simulate'),
            el('button', { disabled: busy || !ladder, onclick: () => climbLadder(data, redraw), title: 'Each kind of player (with the cards and cannon above) from a new record, the matches in a row, against the ladder\'s opponents' }, 'Climb the ladder')));
        box.append(resultsTable());

        box.append(el('h3', { style: { marginTop: '14px' } }, 'Arena ladder'));
        box.append(ladderPanel(redraw));
        return box;
    }

    return { panel, testMessage, get dirty() { return ladderDirty; } };
}
