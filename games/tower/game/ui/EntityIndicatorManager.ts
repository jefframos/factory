import * as PIXI from 'pixi.js';
import { Game } from 'core/Game';
import { EntityIndicator } from './EntityIndicator';
import type { EntityUiTarget } from '../scenes/IWorld3dScene';

/**
 * Owns one EntityIndicator (name tag + boost bar) per live entity — the
 * player plus every materialized NPC — keyed by EntityUiTarget.id. Parented
 * to game.overlayContainer, since it needs a raw-CSS-pixel -> overlay-local
 * conversion each frame (see BaseDemoScene), not Pixi's normal layout flow.
 *
 * The player is just another entry in the target list (see
 * IWorld3dScene.listEntityUiTargets) — this manager doesn't special-case it.
 * That's also why the player's HUD disappears the instant they're killed:
 * the scene stops including a 'player' target while a death is awaiting a
 * respawn choice, exactly like it stops including a bot's id once it's eaten.
 *
 * Each container's PIXI `.name` is set to the target's name (empty for the
 * player, a generated NPC name otherwise — see NpcNames.generateNpcName) so
 * it's identifiable while recycled or in a display-list dump.
 *
 * Indicators are recycled, not destroyed, when their target disappears —
 * pulled back out of the pool the next time a new target shows up, so heavy
 * entity churn over a long session doesn't keep allocating/destroying PIXI
 * display objects.
 */
export class EntityIndicatorManager {
    private readonly active = new Map<string, EntityIndicator>();
    private readonly pool: EntityIndicator[] = [];

    constructor(private readonly game: Game) {}

    update(targets: EntityUiTarget[]): void {
        const seen = new Set<string>();

        for (const target of targets) {
            seen.add(target.id);
            let indicator = this.active.get(target.id);
            if (!indicator) {
                indicator = this.pool.pop() ?? new EntityIndicator();
                this.game.overlayContainer.addChild(indicator);
                this.active.set(target.id, indicator);
            }
            indicator.name = target.name;
            indicator.update(target.name, target.boostT, this.toOverlayLocal(target.screenAnchor));
        }

        // Recycle any indicator whose target didn't show up this frame instead
        // of destroying it — e.g. the player mid-death, or an eaten/despawned
        // NPC. The next new target reuses it from the pool.
        for (const [id, indicator] of this.active) {
            if (seen.has(id)) continue;
            this.active.delete(id);
            indicator.visible = false;
            this.game.overlayContainer.removeChild(indicator);
            this.pool.push(indicator);
        }
    }

    /**
     * Raw CSS-pixel point (see ThreeScene.worldToScreen) -> overlayContainer's
     * own local space. No resolution division needed — Pixi's internal stage
     * space is sized in raw CSS pixels (see Game.onResize: renderer.resize()
     * is handed window.innerWidth/innerHeight directly, with `resolution`
     * only scaling the backing buffer for sharpness, not the stage's own
     * coordinate space).
     */
    private toOverlayLocal(screen: { x: number; y: number } | null): { x: number; y: number } | null {
        if (!screen) return null;
        return this.game.overlayContainer.toLocal(new PIXI.Point(screen.x, screen.y), this.game.app.stage);
    }

    destroy(): void {
        for (const indicator of this.active.values()) {
            this.game.overlayContainer.removeChild(indicator);
            indicator.destroy();
        }
        for (const indicator of this.pool) indicator.destroy();
        this.active.clear();
        this.pool.length = 0;
    }
}
