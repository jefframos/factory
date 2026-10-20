// PlaytestAnalysis.ts
//
// Turns a PlaytestData recording into numbers and FINDINGS — plain-language "this felt bad here"
// statements with the evidence behind them, ranked by severity. Pure function of the data (no game
// imports), so a downloaded .json can be re-analyzed later the same way.
//
// What it looks for:
//   - clients walking out, and which item (empty shelf) or the cashier was to blame;
//   - shelves empty while clients wait on them, per item;
//   - garbage: clients dumping items, the store too dirty to get clients, how long until a cleaner;
//   - the cashier: clients standing at an unattended register, unhappy payers;
//   - pacing: time per store level and per tutorial step, unusually slow/fast ones;
//   - dead time: stretches with nothing worth doing ("saving for X");
//   - juggling: how often serving interrupted something else (the "overwhelmed" feeling);
//   - interruptions: tap-to-continue notifications and camera trips;
//   - things the bot couldn't do: unreachable spots, missing tools, no source for an item.

import type { PlaytestData, PlaytestClient, PlaytestActivity } from './PlaytestRecorder';

export type Severity = 'high' | 'medium' | 'low' | 'info';

export interface Finding {
    severity: Severity;
    area: string;
    title: string;
    detail: string;
    /** Game time (sec) it's about, when it's about one moment. */
    t?: number;
}

export interface ProductStats {
    type: string;
    /** Clients whose list included it. */
    wantedBy: number;
    unitsWanted: number;
    /** Lost clients that waited longest on this item. */
    lostOver: number;
    /** Client-seconds spent waiting on an empty shelf of it. */
    waitOnEmptySec: number;
    /** Share of samples (after it first appeared) with someone waiting on an empty shelf of it. */
    emptyWithWaitersPct: number;
}

export interface LevelStep {
    storeId: string;
    level: number;
    t: number;
    tookSec: number;
}

export interface Analysis {
    findings: Finding[];
    summary: {
        durationSec: number;
        endReason: string;
        clients: number;
        paid: number;
        lost: number;
        lostByReason: Record<string, number>;
        paidByMood: Record<string, number>;
        income: number;
        incomePerMin: number;
        finalLevels: Record<string, number>;
        purchases: number;
        hires: number;
        notifications: number;
    };
    products: ProductStats[];
    levels: LevelStep[];
    tutorial: { step: string; t: number; tookSec: number }[];
    activity: { kind: string; sec: number; pct: number }[];
    idleSpans: { start: number; end: number; reason: string }[];
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };

export function analyzePlaytest(data: PlaytestData): Analysis {
    const findings: Finding[] = [];
    const duration = Math.max(1, data.durationSec);
    const minutes = duration / 60;

    // ---- Clients
    const finished = data.clients.filter(c => c.outcome !== undefined && c.outcome !== 'unknown');
    const paid = finished.filter(c => c.outcome === 'paid');
    const lost = finished.filter(c => c.outcome !== 'paid');
    const lostByReason = countBy(lost, c => c.outcome ?? 'unknown');
    const paidByMood = countBy(paid, c => c.mood ?? '?');
    const lossRate = finished.length > 0 ? lost.length / finished.length : 0;

    if (lost.length > 0) {
        const reasons = Object.entries(lostByReason).map(([reason, n]) => `${n} ${reason}`).join(', ');
        findings.push({
            severity: lossRate > 0.15 ? 'high' : lossRate > 0.05 ? 'medium' : 'low',
            area: 'Clients',
            title: `${lost.length} of ${finished.length} clients (${pct(lossRate)}) walked out without paying`,
            detail: `Reasons: ${reasons}. ${blameSummary(lost)}`,
        });
    }

    // ---- Products
    const products = productStats(data, lost);
    for (const product of products) {
        const share = product.wantedBy > 0 ? product.lostOver / product.wantedBy : 0;
        if (product.lostOver >= 3 || (product.lostOver >= 2 && share >= 0.2)) {
            findings.push({
                severity: share >= 0.25 || product.lostOver >= 6 ? 'high' : 'medium',
                area: 'Supply',
                title: `${cap(product.type)}: ${product.lostOver} of ${product.wantedBy} clients who wanted it walked out`,
                detail: `They waited ${Math.round(product.waitOnEmptySec)} client-seconds in total on an empty ${product.type} shelf; someone was waiting on an empty ${product.type} shelf ${product.emptyWithWaitersPct.toFixed(0)}% of the time after it appeared. `
                    + 'Supply can\'t keep up with how often clients ask for it — slower production, a farther source, or too high a store demand weight (ResourceConfig.storeDemand / storeMaxPerOrder).',
            });
        } else if (product.emptyWithWaitersPct >= 30) {
            findings.push({
                severity: 'medium',
                area: 'Supply',
                title: `${cap(product.type)} shelf was empty with clients waiting ${product.emptyWithWaitersPct.toFixed(0)}% of the time`,
                detail: `Nobody walked out over it yet (${Math.round(product.waitOnEmptySec)} client-seconds of waiting), but it's a constant bottleneck — mood drops while they wait.`,
            });
        }
    }

    // ---- Garbage
    const storeSamples = data.samples.flatMap(sample => Object.entries(sample.stores).map(([id, store]) => ({ t: sample.t, id, store })));
    const dirty = storeSamples.filter(s => s.store.tooDirty);
    const maxGarbage = Math.max(0, ...storeSamples.map(s => s.store.garbage));
    const dumped = lost.filter(c => c.outcome === 'angry-dumped');
    if (dumped.length > 0) {
        const units = dumped.reduce((sum, c) => sum + c.held, 0);
        const firstDump = Math.min(...dumped.map(c => c.endedAt ?? Infinity));
        const cleanerAt = firstEvent(data, 'workerHired', args => args[0] === 'cleaner');
        findings.push({
            severity: dumped.length >= 5 ? 'high' : 'medium',
            area: 'Garbage',
            title: `${dumped.length} angry clients dumped ${units} items on the floor`,
            detail: `First dump at ${clock(firstDump)}; peak ${maxGarbage} pieces on the floor. `
                + (cleanerAt !== undefined ? `A cleaner was hired at ${clock(cleanerAt)}.` : 'No cleaner was ever hired.')
                + ' Each dump is also stock the player paid for in time and lost.',
            t: firstDump,
        });
    }
    if (dirty.length > 0) {
        findings.push({
            severity: dirty.length >= 60 ? 'high' : 'medium',
            area: 'Garbage',
            title: `Store too dirty to get new clients for ${clock(dirty.length)}`,
            detail: `${pct(dirty.length / Math.max(1, storeSamples.length))} of the session the floor held maxGarbage pieces, so no clients spawned until it was cleaned — a quiet store with no explanation can read as "the game stopped".`,
            t: dirty[0].t,
        });
    }

    // ---- Cashier
    const cashierWait = paid.reduce((sum, c) => sum + c.waitedAtCashier, 0);
    const lostAtCashier = lost.filter(c => c.waitedAtCashier > totalWait(c));
    if (paid.length > 0) {
        const avg = cashierWait / paid.length;
        const unhappy = paid.filter(c => c.mood && c.mood !== 'happy').length;
        if (avg >= 8 || lostAtCashier.length >= 2) {
            findings.push({
                severity: avg >= 15 || lostAtCashier.length >= 4 ? 'high' : 'medium',
                area: 'Cashier',
                title: `Clients waited ${avg.toFixed(1)} s on average at an unattended cashier`,
                detail: `${lostAtCashier.length} walked out mostly because of the register; ${unhappy} of ${paid.length} paid below "happy" mood (less money). The player is pulled between restocking and serving — `
                    + `consider a cheaper/earlier cashier hire or a longer payment patience.`,
            });
        }
    }
    const firstCashier = firstEvent(data, 'workerHired', args => args[0] === 'cashier');
    if (firstCashier !== undefined) {
        const before = finished.filter(c => (c.endedAt ?? 0) < firstCashier);
        const after = finished.filter(c => (c.endedAt ?? 0) >= firstCashier);
        const rate = (list: PlaytestClient[]): number => (list.length > 0 ? list.filter(c => c.outcome !== 'paid').length / list.length : 0);
        findings.push({
            severity: 'info',
            area: 'Staff',
            title: `Cashier hired at ${clock(firstCashier)}`,
            detail: `Walk-outs: ${pct(rate(before))} before (${before.length} clients), ${pct(rate(after))} after (${after.length} clients).`,
            t: firstCashier,
        });
    }

    // ---- Pacing: store levels
    const levels = levelSteps(data);
    const tooks = levels.map(l => l.tookSec).filter(s => s > 0);
    const median = tooks.length > 0 ? [...tooks].sort((a, b) => a - b)[Math.floor(tooks.length / 2)] : 0;
    for (const step of levels) {
        if (step.level <= 1) {
            continue;
        }
        if (step.tookSec >= Math.max(300, median * 2)) {
            findings.push({
                severity: step.tookSec >= 600 ? 'high' : 'medium',
                area: 'Pacing',
                title: `${step.storeId} Lv ${step.level - 1} → ${step.level} took ${clock(step.tookSec)}`,
                detail: `The median level took ${clock(median)}. ${incomeNote(data, step)}`,
                t: step.t,
            });
        } else if (step.tookSec > 0 && step.tookSec < 30) {
            findings.push({
                severity: 'low',
                area: 'Pacing',
                title: `${step.storeId} Lv ${step.level - 1} → ${step.level} took only ${Math.round(step.tookSec)} s`,
                detail: 'Barely time to notice the previous level\'s unlock — new things may pile up faster than the player can take them in.',
                t: step.t,
            });
        }
    }
    const lastLevel = levels[levels.length - 1];
    if (lastLevel && duration - lastLevel.t > 600) {
        findings.push({
            severity: 'high',
            area: 'Pacing',
            title: `No level-up for the last ${clock(duration - lastLevel.t)}`,
            detail: `Last level reached at ${clock(lastLevel.t)} (${lastLevel.storeId} Lv ${lastLevel.level}). Either the next requirement is too steep for the income at that point or something blocks progress.`,
            t: lastLevel.t,
        });
    }

    // ---- Tutorial
    const tutorial = tutorialSteps(data);
    for (const step of tutorial) {
        if (step.tookSec >= 120) {
            findings.push({
                severity: step.tookSec >= 300 ? 'medium' : 'low',
                area: 'Tutorial',
                title: `Tutorial step ${step.step} took ${clock(step.tookSec)}`,
                detail: 'A long tutorial step usually means the player has to earn/gather a lot before the arrow\'s goal can be done, with little guidance meanwhile.',
                t: step.t,
            });
        }
    }

    // ---- Activity / dead time / juggling
    const activity = activityBreakdown(data.activities, duration);
    const idleSpans = data.activities
        .filter(a => (a.kind === 'idle') && a.end !== undefined)
        .reduce<{ start: number; end: number; reason: string }[]>((spans, a) => {
            const last = spans[spans.length - 1];
            if (last && a.start - last.end < 3) {
                last.end = a.end!;
                last.reason = a.detail;
            } else {
                spans.push({ start: a.start, end: a.end!, reason: a.detail });
            }
            return spans;
        }, [])
        .filter(span => span.end - span.start >= 45);
    const idleTotal = activity.find(a => a.kind === 'idle')?.sec ?? 0;
    if (data.mode === 'bot' && idleTotal / duration >= 0.1) {
        const longest = [...idleSpans].sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
        findings.push({
            severity: idleTotal / duration >= 0.25 ? 'high' : 'medium',
            area: 'Dead time',
            title: `${pct(idleTotal / duration)} of the session had nothing worth doing`,
            detail: longest
                ? `Longest stretch: ${clock(longest.end - longest.start)} from ${clock(longest.start)} — ${longest.reason}. Shelves full, no purchase affordable: the player just waits for clients.`
                : 'Shelves full and nothing affordable — the player just waits for clients.',
            t: longest?.start,
        });
    }
    const serveInterrupts = data.activities.filter(a => a.outcome?.startsWith('interrupted by serve')).length;
    if (data.mode === 'bot' && serveInterrupts / minutes >= 1.5) {
        findings.push({
            severity: serveInterrupts / minutes >= 3 ? 'medium' : 'low',
            area: 'Juggling',
            title: `Serving pulled the player off other work ${serveInterrupts} times (${(serveInterrupts / minutes).toFixed(1)}/min)`,
            detail: 'Restocking and the cashier compete constantly — this is where "overwhelming" comes from. A cashier hire changes it completely; check how early that is affordable.',
        });
    }

    // ---- Interruptions
    if (data.notifications.length > 0) {
        const perTen = data.notifications.length / minutes * 10;
        const titles = countBy(data.notifications, n => n.title);
        findings.push({
            severity: perTen >= 8 ? 'medium' : 'info',
            area: 'Interruptions',
            title: `${data.notifications.length} tap-to-continue notifications (${perTen.toFixed(1)} per 10 min)`,
            detail: `${Object.entries(titles).map(([title, n]) => `${n}× ${title}`).join(', ')}. Each pauses the game until tapped${data.notificationPauseRealMs > 0 ? ` (${(data.notificationPauseRealMs / 1000).toFixed(0)} s real time in total, bot taps after 1 s)` : ''}.`
                + ` Movement was frozen ${clock(data.frozenSec)} of game time (camera trips, reveals).`,
        });
    }

    // ---- Supply falling behind: paying clients' time in the store, per 2-minute window
    const windows = new Map<number, number[]>();
    for (const client of paid) {
        if (client.endedAt !== undefined) {
            const w = Math.floor(client.arrivedAt / 120);
            (windows.get(w) ?? windows.set(w, []).get(w)!).push(client.endedAt - client.arrivedAt);
        }
    }
    const stay = [...windows].filter(([, list]) => list.length >= 3).map(([w, list]) => ({ t: w * 120, avg: list.reduce((a, b) => a + b, 0) / list.length })).sort((a, b) => a.t - b.t);
    if (stay.length >= 3) {
        const baseline = Math.min(...stay.slice(0, 3).map(s => s.avg));
        const worst = stay.reduce((a, b) => (b.avg > a.avg ? b : a));
        if (worst.avg >= baseline * 2) {
            const items = (data.samples.find(s => s.t >= worst.t)?.stores ?? {});
            const offered = Object.values(items).reduce((n, s) => Math.max(n, Object.keys(s.stock).length + Object.keys(s.demand).length > 0 ? new Set([...Object.keys(s.stock), ...Object.keys(s.demand)]).size : 0), 0);
            findings.push({
                severity: worst.avg >= baseline * 3 ? 'high' : 'medium',
                area: 'Pacing',
                title: `Clients spent ${Math.round(worst.avg)} s in the store around ${clock(worst.t)} — ${(worst.avg / baseline).toFixed(1)}× the early game`,
                detail: `Early on a paying client was in and out in ~${Math.round(baseline)} s. By ${clock(worst.t)} the store offered ${offered} items, but sales per minute didn't grow — supply fell behind demand. `
                    + 'Look at what the player was doing then (activity log): building/gathering for unlocks competes with restocking exactly when the item count grows.',
                t: worst.t,
            });
        }
    }

    // ---- Crops picked up by walking over a field on the way somewhere else
    const stray = Object.entries(data.strayPickups ?? {}).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]);
    const strayTotal = stray.reduce((sum, [, n]) => sum + n, 0);
    const harvestedTotal = data.events.filter(e => e.name === 'cropHarvested').length;
    if (strayTotal >= 5) {
        findings.push({
            severity: harvestedTotal > 0 && strayTotal / harvestedTotal >= 0.2 ? 'high' : 'medium',
            area: 'Layout',
            title: `${strayTotal} crops picked up by walking over a field on the way to another one`,
            detail: `${stray.map(([type, n]) => `${n} ${type}`).join(', ')}${harvestedTotal > 0 ? ` — ${pct(strayTotal / harvestedTotal)} of all harvests` : ''}. `
                + 'Fields sit on each other\'s walking routes and a ripe cell is harvested the instant the player touches it, so a 3-slot crate fills with the wrong crop.',
        });
    }

    // ---- Money piling up with nothing to spend it on
    const richSamples = data.samples.filter(sample => sample.money >= 300);
    if (richSamples.length >= 180) {
        findings.push({
            severity: richSamples.length >= 360 ? 'medium' : 'low',
            area: 'Economy',
            title: `300+ money sat in the wallet for ${clock(richSamples.length)}`,
            detail: `Peak ${Math.max(...data.samples.map(s => s.money))}. Money isn't what gates progress here (wood / time is) — prices in money are cheap next to the other costs, or there's nothing worth buying with it.`,
            t: richSamples[0].t,
        });
    }

    // ---- Purchases left waiting
    const forSale = forSaleWaits(data);
    for (const item of forSale) {
        if (item.waitedSec < 180) {
            continue;
        }
        findings.push({
            severity: item.waitedSec >= 600 ? 'high' : 'medium',
            area: 'Progression',
            title: item.bought
                ? `${item.label} was for sale ${clock(item.waitedSec)} before it was bought`
                : `${item.label} was for sale for ${clock(item.waitedSec)} and never bought`,
            detail: item.blocker
                ? `Short most of that time: ${item.blocker}. A long wait on an unlock reads as "stuck" — cheaper cost, more income, or a clearer pointer to the source.`
                : 'It was affordable but the player was always busy elsewhere — the store keeps them too occupied to expand.',
            t: item.firstSeen,
        });
    }

    // ---- Bot problems
    const issuesByKind = groupBy(data.issues, issue => issue.kind);
    const issueTitles: Record<string, string> = {
        stuck: 'The bot got stuck walking somewhere',
        timeout: 'Some goals took too long and were abandoned',
        stalled: 'Standing in a zone did nothing',
        'missing-tool': 'Needed a tool it didn\'t have',
        'no-source': 'No source for a needed resource',
        wasted: 'Carried items nothing wanted',
        'hire-failed': 'Hiring failed',
        'idle-while-short': 'Stood still while clients waited on an empty shelf',
        'no-path': 'No path to a target on the bot map',
    };
    for (const [kind, issues] of Object.entries(issuesByKind)) {
        findings.push({
            severity: kind === 'idle-while-short' ? (issues.length >= 5 ? 'high' : 'medium') : kind === 'stuck' || kind === 'no-source' || kind === 'no-path' ? 'medium' : 'low',
            area: 'Reachability',
            title: `${issueTitles[kind] ?? kind} (${issues.length})`,
            detail: issues.slice(0, 6).map(issue => `${clock(issue.t)} ${issue.detail}`).join(' · ') + (issues.length > 6 ? ` · +${issues.length - 6} more` : ''),
            t: issues[0].t,
        });
    }
    if (/stuck/.test(data.endReason)) {
        findings.push({
            severity: 'high',
            area: 'Progress',
            title: 'Progress stopped completely',
            detail: `${data.endReason}. Check the activity log at the end for what the bot kept trying.`,
        });
    }

    findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

    const income = Object.values(data.income).reduce((sum, n) => sum + n, 0);
    const finalSample = data.samples[data.samples.length - 1];
    return {
        findings,
        summary: {
            durationSec: duration,
            endReason: data.endReason,
            clients: data.clients.length,
            paid: paid.length,
            lost: lost.length,
            lostByReason,
            paidByMood,
            income,
            incomePerMin: income / minutes,
            finalLevels: Object.fromEntries(Object.entries(finalSample?.stores ?? {}).map(([id, s]) => [id, s.level])),
            purchases: data.events.filter(e => ['storageBought', 'farmBought', 'built'].includes(e.name)).length,
            hires: data.events.filter(e => e.name === 'workerHired').length,
            notifications: data.notifications.length,
        },
        products,
        levels,
        tutorial,
        activity,
        idleSpans,
    };
}

// ---- Helpers

export interface ForSaleWait {
    key: string;
    label: string;
    firstSeen: number;
    waitedSec: number;
    bought: boolean;
    /** The most common "still short" reason while it waited. */
    blocker: string;
}

/** Per item ever for sale: how long it sat there, and what it was short of most of that time. */
export function forSaleWaits(data: PlaytestData): ForSaleWait[] {
    const items = new Map<string, { label: string; first: number; last: number; reasons: Record<string, number> }>();
    for (const entry of data.forSale ?? []) {
        for (const item of entry.items) {
            const record = items.get(item.key) ?? { label: item.label, first: entry.t, last: entry.t, reasons: {} };
            record.last = entry.t;
            if (item.missing) {
                // Strip the amounts so "40 money" and "35 money" count as the same blocker.
                const kind = item.missing.replace(/\d+\s*/g, '').trim();
                record.reasons[kind] = (record.reasons[kind] ?? 0) + 1;
            }
            items.set(item.key, record);
        }
    }
    const lastLogT = data.forSale?.length ? data.forSale[data.forSale.length - 1].t : 0;
    return [...items].map(([key, record]) => {
        const blocker = Object.entries(record.reasons).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
        const bought = record.last < lastLogT;
        return { key, label: record.label, firstSeen: record.first, waitedSec: (bought ? record.last : data.durationSec) - record.first, bought, blocker };
    }).sort((a, b) => b.waitedSec - a.waitedSec);
}

function productStats(data: PlaytestData, lost: PlaytestClient[]): ProductStats[] {
    const stats = new Map<string, ProductStats>();
    const get = (type: string): ProductStats => {
        let entry = stats.get(type);
        if (!entry) {
            entry = { type, wantedBy: 0, unitsWanted: 0, lostOver: 0, waitOnEmptySec: 0, emptyWithWaitersPct: 0 };
            stats.set(type, entry);
        }
        return entry;
    };
    for (const client of data.clients) {
        for (const want of client.wants) {
            const entry = get(want.type);
            entry.wantedBy++;
            entry.unitsWanted += want.amount;
        }
        for (const [type, sec] of Object.entries(client.waitedOnEmpty)) {
            get(type).waitOnEmptySec += sec ?? 0;
        }
    }
    for (const client of lost) {
        const blamed = blamedItem(client);
        if (blamed) {
            get(blamed).lostOver++;
        }
    }
    // Empty-with-waiters share, counted from the first sample the item showed up in a store's stock/demand.
    for (const entry of stats.values()) {
        let seen = 0;
        let empty = 0;
        for (const sample of data.samples) {
            for (const store of Object.values(sample.stores)) {
                const present = (store.stock as Record<string, number>)[entry.type] !== undefined || (store.demand as Record<string, number>)[entry.type] !== undefined;
                if (!present && seen === 0) {
                    continue;
                }
                seen++;
                if (((store.waitingOnEmpty as Record<string, number>)[entry.type] ?? 0) > 0) {
                    empty++;
                }
            }
        }
        entry.emptyWithWaitersPct = seen > 0 ? (empty / seen) * 100 : 0;
    }
    return [...stats.values()].sort((a, b) => b.lostOver - a.lostOver || b.waitOnEmptySec - a.waitOnEmptySec);
}

/** The item a lost client waited longest on an empty shelf for (or 'cashier' when the register was worse). */
function blamedItem(client: PlaytestClient): string | undefined {
    let best: string | undefined;
    let bestSec = 0;
    for (const [type, sec] of Object.entries(client.waitedOnEmpty)) {
        if ((sec ?? 0) > bestSec) {
            bestSec = sec ?? 0;
            best = type;
        }
    }
    return client.waitedAtCashier > bestSec ? undefined : best;
}

function blameSummary(lost: PlaytestClient[]): string {
    const blame = countBy(lost, c => blamedItem(c) ?? (c.waitedAtCashier > 0 ? 'the cashier' : 'nothing obvious'));
    return 'Waited longest on: ' + Object.entries(blame).sort((a, b) => b[1] - a[1]).map(([what, n]) => `${what} (${n})`).join(', ') + '.';
}

function totalWait(client: PlaytestClient): number {
    return Object.values(client.waitedOnEmpty).reduce<number>((sum, sec) => sum + (sec ?? 0), 0);
}

function levelSteps(data: PlaytestData): LevelStep[] {
    const steps: LevelStep[] = [];
    const lastByStore = new Map<string, number>();
    for (const event of data.events) {
        if (event.name !== 'storeLevelReached') {
            continue;
        }
        const storeId = String(event.args[0]);
        const level = Number(event.args[1]);
        const previous = lastByStore.get(storeId) ?? 0;
        steps.push({ storeId, level, t: event.t, tookSec: event.t - previous });
        lastByStore.set(storeId, event.t);
    }
    return steps;
}

function incomeNote(data: PlaytestData, step: LevelStep): string {
    const from = step.t - step.tookSec;
    const samples = data.samples.filter(s => s.t >= from && s.t <= step.t);
    if (samples.length < 2) {
        return '';
    }
    const config = data.storeLevels[step.storeId]?.find(l => l.level === step.level);
    const store = (s: typeof samples[number]) => s.stores[step.storeId];
    const clients = samples.reduce((sum, s) => sum + (store(s)?.clients ?? 0), 0) / samples.length;
    return config
        ? `Needed ${config.amount} ${config.requirementType}; about ${clients.toFixed(1)} clients in the store on average meanwhile.`
        : `About ${clients.toFixed(1)} clients in the store on average meanwhile.`;
}

function tutorialSteps(data: PlaytestData): { step: string; t: number; tookSec: number }[] {
    const started = new Map<string, number>();
    const result: { step: string; t: number; tookSec: number }[] = [];
    for (const event of data.events) {
        if (event.name === 'tutorialStepStart') {
            started.set(`${event.args[0]}-${event.args[1]}`, event.t);
        } else if (event.name === 'tutorialStepComplete') {
            const key = `${event.args[0]}-${event.args[1]}`;
            const start = started.get(key) ?? event.t;
            result.push({ step: `zone ${event.args[0]} #${event.args[1]} (${event.args[2]})`, t: start, tookSec: event.t - start });
        }
    }
    return result;
}

function activityBreakdown(activities: PlaytestActivity[], duration: number): { kind: string; sec: number; pct: number }[] {
    const totals = new Map<string, number>();
    for (const a of activities) {
        const end = a.end ?? duration;
        totals.set(a.kind, (totals.get(a.kind) ?? 0) + Math.max(0, end - a.start));
    }
    return [...totals].map(([kind, sec]) => ({ kind, sec, pct: (sec / duration) * 100 })).sort((a, b) => b.sec - a.sec);
}

function firstEvent(data: PlaytestData, name: string, match: (args: unknown[]) => boolean = () => true): number | undefined {
    return data.events.find(e => e.name === name && match(e.args))?.t;
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
    const result: Record<string, number> = {};
    for (const item of items) {
        const k = key(item);
        result[k] = (result[k] ?? 0) + 1;
    }
    return result;
}

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
    const result: Record<string, T[]> = {};
    for (const item of items) {
        (result[key(item)] ??= []).push(item);
    }
    return result;
}

function pct(ratio: number): string {
    return `${Math.round(ratio * 100)}%`;
}

function cap(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Game seconds as m:ss. */
export function clock(sec: number): string {
    if (!Number.isFinite(sec)) {
        return '—';
    }
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}
