// FlyingResourceIcon.ts
//
// 2D counterpart to FlyingResourceEffect's 3D chip — same "something just
// moved into the backpack/into a building" visual beat, but rendered as a
// Pixi icon sprite arcing across the SCREEN instead of a THREE cube arcing
// through the world. Same two callers/direction as the chip version:
//   - BuildingZone/DropZone: backpack -> zone, once per unit as a deposit
//     drains out (see each file's flyInResource()/flyOutResource()).
//
// `fromWorld`/`toWorld` are 3D world positions (e.g. the backpack cube, the
// zone's landing spot) — projected to screen space fresh EVERY FRAME via
// `host.worldToScreen()` (same BendService.applyToPosition() correction
// ScreenAnchorComponent.update() applies, for the same reason: the world
// visually bends away from the player, and worldToScreen has no idea that
// happened) rather than once at spawn. Re-projecting continuously means the
// arc still tracks correctly if the camera moves mid-flight, matching how
// the 3D chip reacts to camera motion for free.
//
// Purely decorative, same as the chip: BackpackStorage/BuildingStorage's
// counts are the source of truth, not this — an icon interrupted mid-flight
// (its scene torn down) costs nothing but its own visual.

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { BendService } from '../services/BendService';
import { ScreenAnchorHost } from './ScreenAnchorComponent';
import ViewUtils from 'core/utils/ViewUtils';

const ICON_SIZE = 40;
const FLIGHT_DURATION_SEC = 0.45;
/** How high (in screen pixels) the icon arcs above a straight line to its destination — the 2D analog of FlyingResourceEffect's ARC_HEIGHT. */
const ARC_HEIGHT_PX = 90;

/**
 * Scratch — avoids allocating a new THREE.Vector3/PIXI.Point every frame this icon is in
 * flight. `from` and `to` each need their OWN set: projectToOverlay() is called twice per
 * frame (once per endpoint) and returns its output point by reference — sharing one buffer
 * between the two calls meant the second call (`to`) silently overwrote the exact object the
 * first call's caller (`from`) was still holding, collapsing both endpoints onto the same
 * value every frame (the icon rendered as if it started AND ended at the destination).
 */
const scratchFromWorld = new THREE.Vector3();
const scratchToWorld = new THREE.Vector3();
const scratchFromScreenPoint = new PIXI.Point();
const scratchToScreenPoint = new PIXI.Point();
const scratchFromLocalPoint = new PIXI.Point();
const scratchToLocalPoint = new PIXI.Point();

/**
 * `host` is whatever the caller already tracks a ScreenAnchorHost for (BuildingZone/
 * DropZone both keep one for their own nameplate) — this needs its worldToScreen()
 * and overlayContainer, nothing else. `onArrive` fires once, right as the icon reaches
 * `toWorld` (before it's torn down) — e.g. a zone decrementing BackpackStorage by one
 * per icon, same contract as spawnFlyingResourceChip().
 */
export function spawnFlyingResourceIcon(
    host: ScreenAnchorHost,
    fromWorld: THREE.Vector3,
    toWorld: THREE.Vector3,
    texture: PIXI.Texture,
    onArrive?: () => void,
): void {
    const icon = new PIXI.Sprite(texture);
    icon.anchor.set(0.5);
    icon.scale.set(ViewUtils.elementScaler(icon, ICON_SIZE));
    icon.visible = false;
    host.overlayContainer.addChild(icon);

    const progress = { t: 0 };

    /** Projects a world position through the same bend-correction + worldToScreen() + overlayContainer.toLocal() pipeline ScreenAnchorComponent.update() uses. Returns null if the point is behind the camera (worldToScreen's only check) — the caller treats that as "hide this frame," not "snap somewhere." Writes into the caller-supplied scratch buffers so the `from` and `to` calls each frame never share state — see this file's own doc on scratchFromLocalPoint/scratchToLocalPoint. */
    const projectToOverlay = (world: THREE.Vector3, scratchWorld: THREE.Vector3, scratchScreen: PIXI.Point, scratchLocal: PIXI.Point): PIXI.Point | null => {
        scratchWorld.copy(world);
        const bent = BendService.applyToPosition(scratchWorld);
        const screen = host.worldToScreen(bent);
        if (!screen) {
            return null;
        }

        scratchScreen.set(screen.x, screen.y);
        return host.overlayContainer.toLocal(scratchScreen, host.overlayContainer.parent ?? undefined, scratchLocal);
    };

    gsap.to(progress, {
        t: 1,
        duration: FLIGHT_DURATION_SEC,
        ease: 'power1.in',
        onUpdate: () => {
            const from = projectToOverlay(fromWorld, scratchFromWorld, scratchFromScreenPoint, scratchFromLocalPoint);
            const to = projectToOverlay(toWorld, scratchToWorld, scratchToScreenPoint, scratchToLocalPoint);
            if (!from || !to) {
                icon.visible = false;
                return;
            }

            // Quadratic Bezier in screen-space pixels: from -> apex (arc peak) -> to — same
            // shape as FlyingResourceEffect's world-space version, just projected instead of
            // parented directly into the 3D scene.
            const apexX = (from.x + to.x) / 2;
            const apexY = (from.y + to.y) / 2 - ARC_HEIGHT_PX;

            const legAx = from.x + (apexX - from.x) * progress.t;
            const legAy = from.y + (apexY - from.y) * progress.t;
            const legBx = apexX + (to.x - apexX) * progress.t;
            const legBy = apexY + (to.y - apexY) * progress.t;

            icon.visible = true;
            icon.position.set(
                legAx + (legBx - legAx) * progress.t,
                legAy + (legBy - legAy) * progress.t,
            );
        },
        onComplete: () => {
            onArrive?.();
            icon.destroy();
        },
    });
}
