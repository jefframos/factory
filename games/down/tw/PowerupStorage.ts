// PowerupStorage.ts

import * as PIXI from 'pixi.js';
import type { PieceDefinition } from './PieceStorage';

/**
 * Powerups are trimmed to just "destroy" (bomb/super bomb) — freeze/shrink
 * were removed entirely, so there's no discriminated union any more, just
 * one flat shape.
 */
export interface PowerupDefinition {
    id: string;
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
     * Relative path under images/non-preload/ (e.g. "icons/bomb-icon.webp")
     * for this powerup's HUD button icon — resolved via
     * resolvePieceImagePath(), same convention as PieceDefinition.texture.
     * Takes priority over the drawn piece-shape icon PowerupButton falls
     * back to when this is omitted (see PowerupBelt.buildPowerupIconFor()).
     */
    icon?: string;
    /** Seconds between destroying each additional queued piece, so a pile of simultaneous touches cascades instead of vanishing all at once. */
    destroyStepDelay: number;
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

/**
 * Which ids get a HUD button (see GameHud.buildPowerupBar()) and which one
 * gets granted (randomly) each time the player reaches a new level (see
 * IslandViewScene's onLevelProgressed handler) — 'bomb' out of
 * powerups-config.json's 2 entries (deliberately excluding 'super-bomb',
 * which has no dedicated button) plus the skip-piece pseudo-id.
 */
export const HUD_POWERUP_IDS: readonly string[] = ['bomb', SKIP_PIECE_POWERUP_ID];

/** "shrink-ray" → "Shrink Ray" — for the level-up notification's "+1 Shrink Ray" reward text (see LevelUpNotification). No dedicated display-name field on PowerupDefinition, so this just humanizes the id. */
export function formatPowerupName(id: string): string {
    return id
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}
