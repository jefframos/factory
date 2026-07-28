// PowerupConfig.ts

import { HUD_POWERUP_IDS, SKIP_PIECE_POWERUP_ID } from './PowerupStorage';

/**
 * Easy on/off switch per HUD powerup (the 3 real powerups + the skip-piece
 * pseudo-id) — flip an entry to `false` to pull it out of PowerupBelt
 * entirely (not just hide/grey its button) and stop it from ever being
 * granted on level-up (see getEnabledPowerupIds(), the single source both
 * of those read from). Keyed by the same ids as
 * PowerupStorage.HUD_POWERUP_IDS.
 */
export const POWERUP_ENABLED: Record<string, boolean> = {
    'lightning': true,
    'bomb': true,
    'shrink-ray': true,
    [SKIP_PIECE_POWERUP_ID]: false,
};

/**
 * HUD_POWERUP_IDS filtered down to only the currently-enabled ones — see
 * PowerupBelt (which buttons it actually builds) and IslandViewScene's
 * level-up grant (which id gets randomly picked). An id missing from
 * POWERUP_ENABLED defaults to enabled, so adding a new HUD_POWERUP_IDS
 * entry without also touching this file doesn't silently disable it.
 */
export function getEnabledPowerupIds(): readonly string[] {
    return HUD_POWERUP_IDS.filter(id => POWERUP_ENABLED[id] ?? true);
}
