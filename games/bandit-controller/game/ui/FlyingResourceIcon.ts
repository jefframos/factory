// FlyingResourceIcon.ts
//
// Ported from games/bandit/legacy/game/components/FlyingResourceIcon.ts's
// spawnFlyingIconToOverlayPoint() (identical in games/pizza) — trimmed to
// just the one direction bandit-controller needs: a 3D world point flying
// to a live 2D point in the UI (Collectible -> GameUI's money icon, see
// ControllerScene.onCollectResource()).
//
// Re-projects `fromWorld` through the camera every frame (not once at
// spawn) so the arc stays correct if the camera moves mid-flight, and
// re-reads `getToLocalPoint()` every frame so it still lands correctly if
// the HUD repositions (e.g. on resize) mid-flight — same reasoning as
// bandit's own version.
//
// The curve itself is ArcSpline (shared with Collectible.ts's 3D player-
// homing) — screen space is +Y down, so ARC_HEIGHT_PX is passed NEGATIVE to
// get the same "rises above the straight line" visual a positive value
// gives in world space.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import * as THREE from 'three';
import { Game } from 'core/Game';
import { ThreeScene } from 'core/scene/ThreeScene';
import ArcSpline from '../utils/ArcSpline';

const ICON_SIZE = 40;
const FLIGHT_DURATION_SEC = 0.45;
const ARC_HEIGHT_PX = 90;

/**
 * Spawns a one-shot icon sprite that flies from a 3D world position to a
 * live point in `game.uiLayer`'s own local space, then calls `onArrive`.
 * Bandit's own convention — followed here too — is to mutate whatever
 * counter the icon represents ONLY inside `onArrive`, never at spawn, so the
 * HUD updates exactly when the icon visually lands, not when it departs.
 */
export function spawnFlyingIconToOverlayPoint(
    threeScene: ThreeScene,
    game: Game,
    fromWorld: THREE.Vector3,
    getToLocalPoint: () => PIXI.Point,
    texture: PIXI.Texture,
    onArrive?: () => void,
): void {
    const icon = new PIXI.Sprite(texture);
    icon.anchor.set(0.5);
    icon.width = ICON_SIZE;
    icon.height = ICON_SIZE;
    icon.visible = false;
    game.uiLayer.addChild(icon);

    // Screen space is +Y down — negative arcHeight rises above the straight line, matching
    // the visual a positive value gives ArcSpline's other caller (Collectible.ts, +Y up).
    const arc = new ArcSpline(-ARC_HEIGHT_PX);
    const scratchFrom = new THREE.Vector3();
    const scratchTo = new THREE.Vector3();
    const progress = { t: 0 };

    gsap.to(progress, {
        t: 1,
        duration: FLIGHT_DURATION_SEC,
        ease: 'power1.in',
        onUpdate: () => {
            const screen = threeScene.worldToScreen(fromWorld);
            if (!screen) {
                // Behind the camera this frame — hide rather than snap to a bogus position (same as WorldSpaceLabel.update()).
                icon.visible = false;
                return;
            }

            const from = game.uiLayer.toLocal(new PIXI.Point(screen.x, screen.y), game.app.stage);
            const to = getToLocalPoint();

            scratchFrom.set(from.x, from.y, 0);
            scratchTo.set(to.x, to.y, 0);
            const point = arc.evaluate(scratchFrom, scratchTo, progress.t);

            icon.visible = true;
            icon.position.set(point.x, point.y);
        },
        onComplete: () => {
            onArrive?.();
            icon.destroy();
        },
    });
}
