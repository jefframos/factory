// PowerupStorage.ts

import * as PIXI from 'pixi.js';
import type { PieceDefinition } from './PieceStorage';

/**
 * How a powerup actually activates once tapped in the HUD — see
 * IslandViewScene.useHudPowerup(), which branches on this:
 *  - 'drop' (the default, matching every powerup authored before this
 *    field existed): swaps the held piece for this powerup's own piece
 *    (see `piece` below) — the existing bomb/super-bomb behavior, tracked
 *    by PowerupSystem once dropped.
 *  - 'instant': applies its effect immediately on tap, no held piece and
 *    no targeting involved (see 'trapdoor'/'clear-low-tier').
 *  - 'target': enters targeting mode (hides the HUD, shows a tappable
 *    marker over every live block plus a cancel button — see
 *    PieceTargetingOverlay) and applies its effect to whichever block the
 *    player taps (see 'destroy-piece'/'upgrade-piece').
 */
export type PowerupActivationType = 'drop' | 'instant' | 'target';

/**
 * Powerups are trimmed to just "destroy" (bomb/super bomb) plus 4 newer
 * ones (see PowerupActivationType) — no discriminated union, just one flat
 * shape with `type` picking out which fields actually matter.
 */
export interface PowerupDefinition {
    id: string;
    /** Defaults to 'drop' when omitted — every powerup authored before this field existed. */
    type?: PowerupActivationType;
    /**
     * This powerup's own shape/scale/color/face texture — same fields as a
     * PieceStorage.PieceDefinition (polygon, scale, color, texture,
     * faceOffset, etc.), just embedded directly here instead of pointing at
     * one of PieceStorage.PIECES, since a powerup's shape is unique to it
     * rather than a shared catalog entry. `id`/`level` are catalog-only
     * concepts that don't apply to a powerup's private shape, so they're
     * omitted — FaceTowerGameController.spawnPowerup synthesizes them when
     * it hands this off to spawnHeldBlock.
     */
    piece: Omit<PieceDefinition, 'id' | 'level'>;
    /** Overrides FaceTowerConfig.dropForceY for this powerup's release — e.g. a bigger downward kick so it falls noticeably faster than a normal piece. Omit to fall at the normal drop speed. */
    dropForceY?: number;
    /**
     * Bare frame name (e.g. "bomb-icon", NOT a path/extension) inside the
     * preloaded 'ui' atlas (see games/down/manifests/images.json →
     * ui.webp.json) for this powerup's HUD button icon — handed straight to
     * PIXI.Sprite.from() in PowerupBelt.buildPowerupIconFor(), same as every
     * other atlas-frame sprite in the game. Takes priority over the drawn
     * piece-shape icon PowerupButton falls back to when this is omitted.
     */
    icon?: string;
    /** Seconds between destroying each additional queued piece, so a pile of simultaneous touches cascades instead of vanishing all at once. Only meaningful for `type: 'drop'` — omit for 'instant'/'target'. */
    destroyStepDelay?: number;
    /** Max pieces this can destroy before it also removes itself right away instead of continuing to fall — 1 for the bomb, omit for the super bomb's unlimited "destroy everything" fall. */
    maxTargets?: number;
}

/**
 * Populated in place from the 'json' PIXI bundle (raw-assets/json/powerups-config.json)
 * once it finishes loading — see MyGame.loadAssets() in index.ts. Kept as a
 * mutated const array (rather than reassigned) so existing imports of
 * POWERUPS stay valid references — same convention as PieceStorage.PIECES.
 */
export const POWERUPS: PowerupDefinition[] = [];

/** Call once the 'json' PIXI.Assets bundle has loaded — see index.ts loadAssets(). */
export function loadPowerups(): void {
    const powerups = PIXI.Assets.get('powerups-config.json') as PowerupDefinition[];
    POWERUPS.splice(0, POWERUPS.length, ...powerups);
}

export function getPowerup(id: string): PowerupDefinition | undefined {
    return POWERUPS.find(powerup => powerup.id === id);
}

/** Pseudo-id for the skip-piece HUD button — swaps the held piece for the next one instead of dropping a powerup, so it isn't (and never will be) a real PowerupDefinition/POWERUPS entry, but shares the same "spend one from PowerupInventoryStorage to use it" shape as 'bomb' below — see GameHud/IslandViewScene. */
export const SKIP_PIECE_POWERUP_ID = 'skip-piece';

/** The two environment-wide ids (type: 'instant') — see TopPowerupSlots' left pair, IslandViewScene.applyInstantPowerup(). */
export const TRAPDOOR_POWERUP_ID = 'trapdoor';
export const CLEAR_LOW_TIER_POWERUP_ID = 'clear-low-tier';
/** The two single-piece-targeted ids (type: 'target') — see TopPowerupSlots' right pair, PieceTargetingOverlay. */
export const DESTROY_PIECE_POWERUP_ID = 'destroy-piece';
export const UPGRADE_PIECE_POWERUP_ID = 'upgrade-piece';

/**
 * Which ids get a HUD button (see GameHud.buildPowerupBar()) and which one
 * gets granted (randomly) each time the player reaches a new level (see
 * IslandViewScene's onLevelProgressed handler) — the 4 new powerups (2
 * instant, 2 targeted — see TopPowerupSlots) plus the skip-piece pseudo-id.
 * 'bomb'/'super-bomb' stay in powerups-config.json (still real, spawnable
 * PowerupDefinitions — see FaceTowerGameController.spawnPowerup()) but no
 * longer get a HUD button of their own now that these 4 have taken their
 * slots.
 */
export const HUD_POWERUP_IDS: readonly string[] = [
    TRAPDOOR_POWERUP_ID,
    CLEAR_LOW_TIER_POWERUP_ID,
    DESTROY_PIECE_POWERUP_ID,
    UPGRADE_PIECE_POWERUP_ID,
    SKIP_PIECE_POWERUP_ID,
];

/** "shrink-ray" → "Shrink Ray" — for the level-up notification's "+1 Shrink Ray" reward text (see LevelUpNotification). No dedicated display-name field on PowerupDefinition, so this just humanizes the id. */
export function formatPowerupName(id: string): string {
    return id
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}
