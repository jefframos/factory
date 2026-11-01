// GameMode.ts
//
// Which game this is, on the same town and loop: 'calm' (the ASMR cut — just mowing: stripes, milestones, a big
// moment when a section is done, nothing that pushes back) or 'rush' (the same, with arcade layers on top: the combo
// meter for now, game/mowing/Combo.ts). The URL's ?mode=calm|rush wins (to test both side by side), else ui/mow.json
// `mode`, else calm. Read once at boot.

import { MOW } from './MowConfig';

export type MowMode = 'calm' | 'rush';

function readMode(): MowMode {
    const asked = new URLSearchParams(window.location.search).get('mode');
    if (asked === 'calm' || asked === 'rush') return asked;
    return MOW.mode === 'rush' ? 'rush' : 'calm';
}

export const MODE: MowMode = readMode();
export const isRush = MODE === 'rush';
