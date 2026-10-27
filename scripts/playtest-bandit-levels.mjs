// Bandit Controller playtest bot: plays every campaign level in a real (headless) browser against the
// running dev server, through PathLevelScene's own route/follow code, guards and timing included. Each
// segment follows the NavGrid route; when busted it retries with longer waits before segments.
//
//   npm run dev                                  # GAME=bandit-controller, in another terminal
//   npm run playtest:bandit [-- w5-07 w7-08]     # all levels, or only the given ids
//
// BOT_WAIT=5 pauses that many seconds before every trace (a player planning; sensors keep moving),
// BOT_SPEED=4 runs game time faster, BOT_FROM=w6-01 resumes, BOT_URL overrides http://localhost:9001/,
// PLAYTEST_CHROME points at a Chrome/Chromium binary. Exits 1 if any level can't be completed.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const URL = process.env.BOT_URL ?? 'http://localhost:9001/';
const ONLY = process.argv.slice(2);
const SPEED = Number(process.env.BOT_SPEED ?? 3);

function findChrome() {
    const candidates = [
        process.env.PLAYTEST_CHROME,
        (() => { try { return chromium.executablePath(); } catch { return undefined; } })(),
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
    ];
    const found = candidates.find((exe) => exe && fs.existsSync(exe));
    if (!found) {
        throw new Error('No Chrome/Chromium found: set PLAYTEST_CHROME or run `npx playwright install chromium`.');
    }
    return found;
}

const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--use-angle=metal', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(URL);
await page.waitForFunction(() => performance.getEntriesByType('resource').some((r) => r.name.includes('LevelCatalog')), null, { timeout: 120000 });
await page.waitForTimeout(4000);

await page.evaluate((w) => { window.__botWait = w; }, Number(process.env.BOT_WAIT ?? 0));
await page.evaluate(async (speed) => {
    const urls = performance.getEntriesByType('resource').map((r) => r.name);
    const find = (re) => urls.find((u) => re.test(u));
    const { Game } = await import(find(/\/core\/Game\.ts/));
    const { LevelCatalog } = await import(find(/LevelCatalog\.ts/));
    const gsapUrl = find(/\/deps\/gsap\.js/);
    const gsap = gsapUrl ? (await import(gsapUrl)).default : undefined;
    Game.timeScale = speed;
    gsap?.globalTimeline.timeScale(speed);
    const findScene = (pred) => {
        const stack = [Game.APP.stage];
        while (stack.length) {
            const o = stack.pop();
            if (pred(o)) return o;
            stack.push(...(o.children ?? []));
        }
        return undefined;
    };
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const BASE_WAIT = window.__botWait || 0;
    window.__bot = {
        ids: () => LevelCatalog.all().map((l) => l.id),
        async run(index, delays, timeoutSec = 240) {
            const home = findScene((o) => o.onPlayLevel);
            LevelCatalog.select(index);
            const id = LevelCatalog.all()[index].id;
            if (home && home.parent) home.onPlayLevel.dispatch();
            else findScene((o) => o.level && o.env)?.onRestart.dispatch();
            let scene;
            const t0 = performance.now();
            while (!(scene = findScene((o) => o.level?.id === id && o.env && o.navGrid && o.members?.length && !o.destroyed))) {
                await frame();
                if (performance.now() - t0 > 30000) return { result: 'load-timeout' };
            }
            await scene.env.playerReady;
            for (let i = 0; i < 30; i++) await frame();
            let segment = 0;
            let waitUntil = -1;
            const tStart = performance.now();
            while (true) {
                await frame();
                const s = scene.state;
                if (s === 'celebrating' || s === 'payout' || s === 'complete') return { result: 'ok', segment };
                if (s === 'busted') return { result: 'busted', segment, at: (({ x, z }) => ({ x: +x.toFixed(1), z: +z.toFixed(1) }))(scene.focused.player.transform.position), guard: scene.bustGuard?.constructor?.name };
                if ((performance.now() - tStart) / 1000 * speed > timeoutSec) return { result: 'timeout', segment, state: s };
                if (s !== 'waiting' || !scene.focused) continue;
                if (waitUntil < 0) {
                    waitUntil = performance.now() + ((delays[segment] ?? 0) + BASE_WAIT) * 1000 / speed;
                    continue;
                }
                if (performance.now() < waitUntil) continue;
                const player = scene.focused.player.transform.position;
                const goal = scene.waypoints[scene.nextWaypointIndex];
                const start = scene.routeStart(player);
                const from = start[start.length - 1];
                const pathPts = scene.navGrid.findPath({ x: from.x, z: from.z }, { x: goal.x, z: goal.z });
                if (!pathPts) return { result: 'nopath', segment, from: { x: from.x, z: from.z }, goal: { x: goal.x, z: goal.z } };
                const V = player.constructor;
                scene.route = [...start, ...pathPts.slice(1).map((p) => new V(p.x, 0.08, p.z))];
                scene.routeBlocked = false;
                scene.drawRoute();
                scene.startFollowing(scene.route[scene.route.length - 1].clone());
                segment++;
                waitUntil = -1;
            }
        },
    };
}, SPEED);

const ids = await page.evaluate(() => window.__bot.ids());
const DELAYS = [0, 1.5, 3, 4.5, 6, 8, 10];
const summary = [];
const FROM = process.env.BOT_FROM ? ids.indexOf(process.env.BOT_FROM) : 0;
for (let index = Math.max(0, FROM); index < ids.length; index++) {
    if (ONLY.length && !ONLY.includes(ids[index])) continue;
    const delays = [];
    let outcome;
    let attempts = 0;
    const tried = new Map();
    while (attempts < 14) {
        attempts++;
        outcome = await page.evaluate(([i, d]) => window.__bot.run(i, d), [index, delays]);
        if (outcome.result !== 'busted' && outcome.result !== 'timeout') break;
        // Busted on the segment just started: wait longer before it (or before the previous one).
        const seg = Math.max(0, outcome.segment - 1);
        const k = (tried.get(seg) ?? 0) + 1;
        tried.set(seg, k);
        if (k >= DELAYS.length) break;
        while (delays.length <= seg) delays.push(0);
        delays[seg] = DELAYS[k];
    }
    const line = `${ids[index]}: ${outcome.result} after ${attempts} attempt(s) delays=[${delays.join(',')}] ${outcome.result === 'ok' ? '' : JSON.stringify(outcome)}`;
    console.log(line);
    summary.push({ id: ids[index], ...outcome, attempts });
}
await browser.close();
const failed = summary.filter((entry) => entry.result !== 'ok');
console.log(failed.length ? `${failed.length} level(s) failed: ${failed.map((entry) => entry.id).join(', ')}` : `${summary.length} level(s) completed`);
process.exitCode = failed.length ? 1 : 0;
