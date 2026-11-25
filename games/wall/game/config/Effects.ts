// Effects.ts
//
// How strong each effect is (ui/effects.json, 0: off), and the debug panel that tunes them: each has a switch and a strength,
// kept in this browser; COPY puts them on the clipboard as ui/effects.json wants them. The camera's movement is what makes
// people sick, so it has its own folder and is mostly off.

import * as THREE from 'three';
import { DebugOverlay } from 'core/debug/DebugOverlay';
import data from '../../ui/effects.json';

export type Effect = keyof typeof data.amounts;

const KEY = 'wall.debug.effects';
const FOLDERS: Record<string, Partial<Record<Effect, string>>> = {
    Camera: {
        quake: 'Shake as a wall falls',
        steps: 'Steps while walking on',
        tilt: 'Tilted view',
    },
    Screen: { flash: 'Flash as a wall falls', hitStop: 'Freeze on a big hit', numbers: 'Numbers', words: 'Big words', barJolt: 'Bar jolt', vibration: 'Vibration' },
    Look: { light: 'Light', color: 'Colour (the next wall)' },
    World: { impact: 'Impact light', tileFlash: 'Hit tiles flash', pieces: 'Pieces', piecesAtYou: 'Pieces fly at you', dust: 'Dust', tremble: 'Wall trembles', crewPieces: 'Crew pieces', crewFlips: 'Crew flips', handBob: 'Hands bob' },
};

const amounts: Record<Effect, number> = { ...data.amounts };
const on = Object.fromEntries(Object.keys(data.amounts).map((id) => [id, true])) as Record<Effect, boolean>;

/** How strong an effect is now (0: off). */
export function fx(effect: Effect): number {
    return on[effect] ? amounts[effect] : 0;
}

const hsl = { h: 0, s: 0, l: 0 };

/** A colour more or less vivid, by the effect. */
export function vivid(color: THREE.Color): THREE.Color {
    color.getHSL(hsl, THREE.SRGBColorSpace);
    return color.setHSL(hsl.h, Math.min(1, hsl.s * (0.8 + 0.3 * fx('color'))), hsl.l, THREE.SRGBColorSpace);
}

function store(): void {
    try {
        localStorage.setItem(KEY, JSON.stringify({ amounts, on }));
    } catch {
        // Not kept, then.
    }
}

function set(values: Record<Effect, number>, switched: boolean): void {
    Object.assign(amounts, values);
    (Object.keys(on) as Effect[]).forEach((id) => (on[id] = switched));
    store();
}

/** The panel (and what was tuned here before): only with ?debug=1. */
export function buildEffectsPanel(): void {
    if (!/[?&](debug|dev)\b/.test(window.location.search)) return;
    try {
        const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown;
        // (Only those there still are.)
        for (const id of Object.keys(amounts) as Effect[]) {
            const was = saved as { amounts?: Partial<Record<Effect, number>>; on?: Partial<Record<Effect, boolean>> } | null;
            amounts[id] = was?.amounts?.[id] ?? amounts[id];
            on[id] = was?.on?.[id] ?? on[id];
        }
    } catch {
        // The defaults.
    }
    const panel = DebugOverlay.instance.panel('Effects', { id: 'wall.effects', persist: false });
    panel.buttons([
        { label: 'ALL OFF', action: () => set(amounts, false) },
        { label: 'ALL ON', action: () => set(amounts, true) },
        { label: 'DEFAULTS', action: () => set(data.amounts, true) },
    ]);
    panel.button('COPY (for ui/effects.json)', () => {
        const values = Object.fromEntries((Object.keys(amounts) as Effect[]).map((id) => [id, fx(id)]));
        const text = JSON.stringify(values, null, 2);
        console.log('[Effects]', text);
        void navigator.clipboard?.writeText(text).catch(() => undefined);
    });
    for (const [name, effects] of Object.entries(FOLDERS)) {
        const folder = panel.folder(name);
        for (const [id, label] of Object.entries(effects) as [Effect, string][]) {
            folder.toggle(on, id, { label, listen: true, id: `${id}-on`, onChange: store });
            folder.number(amounts, id, { label: '    strength', min: 0, max: 2, step: 0.05, listen: true, onChange: store });
        }
    }
}
