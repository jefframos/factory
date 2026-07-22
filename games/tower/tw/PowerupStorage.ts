// PowerupStorage.ts

import * as PIXI from 'pixi.js';
import type { PieceDefinition } from './PieceStorage';

interface BasePowerupDefinition {
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
}

/** The lightning: freezes and greys every piece it touches on the way down, falling until it exits the bottom of the column. */
export interface FreezeDropPowerup extends BasePowerupDefinition {
    type: 'freeze-drop';
    /** Hex color a touched piece is tinted the moment its turn in the freeze queue comes up — see PowerupSystem.drainQueue. */
    greyColor: string;
    /** Seconds between processing each additional queued piece, so a pile of simultaneous touches cascades instead of snapping grey all at once. */
    greyStepDelay: number;
}

/** Bomb (maxTargets: 1, explodes on its first touch) or super bomb (omit maxTargets — destroys everything it touches, like the lightning but destructive, falling until it exits the bottom). */
export interface DestroyDropPowerup extends BasePowerupDefinition {
    type: 'destroy-drop';
    /** Seconds between destroying each additional queued piece. */
    destroyStepDelay: number;
    /** Max pieces this can destroy before it also removes itself right away instead of continuing to fall — 1 for the bomb, omit for the super bomb's unlimited "destroy everything" fall. */
    maxTargets?: number;
}

/** The shrink ray: shrinks (physics body included) every piece it touches on the way down, falling until it exits the bottom of the column — same "affects everything, falls through" shape as the lightning, just a different effect. */
export interface ShrinkDropPowerup extends BasePowerupDefinition {
    type: 'shrink-drop';
    /** Multiplies a touched piece's CURRENT size — see PowerupEffectConfig.shrinkFactor for the compounding/floor behavior. */
    shrinkFactor: number;
    /** Seconds between shrinking each additional queued piece. */
    shrinkStepDelay: number;
    /** Max pieces this can shrink before it also removes itself right away instead of continuing to fall. Omit for unlimited (shrinks everything it passes through, like the lightning). */
    maxTargets?: number;
}

export type PowerupDefinition = FreezeDropPowerup | DestroyDropPowerup | ShrinkDropPowerup;

function hexStringToNumber(hex: string): number {
    return parseInt(hex.replace('#', ''), 16);
}

export function powerupGreyColorNumber(powerup: FreezeDropPowerup): number {
    return hexStringToNumber(powerup.greyColor);
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
