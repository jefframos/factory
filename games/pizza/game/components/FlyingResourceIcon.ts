// FlyingResourceIcon.ts
//
// 2D counterpart to FlyingResourceEffect's 3D chip — same "something just
// moved into the backpack/into a building" visual beat, but rendered as a
// Pixi icon sprite arcing across the SCREEN instead of a THREE cube arcing
// through the world. Two shapes:
//   - spawnFlyingResourceIcon(): world -> world, e.g. BuildingZone/DropZone/
//     QueueZone flying a unit from the backpack to their own on-map panel
//     (see each file's flyInResource()/flyOutResource()).
//   - spawnFlyingIconToOverlayPoint(): world -> a live 2D HUD point, e.g.
//     QueueZone flying a completed task's reward from the queue to
//     EconomyUI's wallet icon — the destination is already in
//     `overlayContainer`'s own local space (wherever a HUD panel actually
//     renders), so it needs no worldToScreen() projection at all, just a
//     getter re-read every frame in case the HUD element itself moves
//     (window resize, UIService repositioning it, ...).
//
// A world endpoint is projected to screen space fresh EVERY FRAME via
// `host.worldToScreen()` (same BendService.applyToPosition() correction
// ScreenAnchorComponent.update() applies, for the same reason: the world
// visually bends away from the player, and worldToScreen has no idea that
// happened) rather than once at spawn. Re-projecting continuously means the
// arc still tracks correctly if the camera moves mid-flight, matching how
// the 3D chip reacts to camera motion for free.
//
// Purely decorative, same as the chip: BackpackStorage/BuildingStorage/
// EconomyStorage's counts are the source of truth, not this — an icon
// interrupted mid-flight (its scene torn down) costs nothing but its own
// visual.

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

/** Projects a world position through the same bend-correction + worldToScreen() + overlayContainer.toLocal() pipeline ScreenAnchorComponent.update() uses. Returns null if the point is behind the camera (worldToScreen's only check) — the caller treats that as "hide this frame," not "snap somewhere." Writes into the caller-supplied scratch buffers so two endpoints projected in the same frame never share state — see this file's own doc on scratchFromLocalPoint/scratchToLocalPoint. */
function projectWorldToOverlay(host: ScreenAnchorHost, world: THREE.Vector3, scratchWorld: THREE.Vector3, scratchScreen: PIXI.Point, scratchLocal: PIXI.Point): PIXI.Point | null {
    scratchWorld.copy(world);
    const bent = BendService.applyToPosition(scratchWorld);
    const screen = host.worldToScreen(bent);
    if (!screen) {
        return null;
    }

    scratchScreen.set(screen.x, screen.y);
    return host.overlayContainer.toLocal(scratchScreen, host.overlayContainer.parent ?? undefined, scratchLocal);
}

/**
 * Shared flight driver — builds the icon sprite, tweens `progress` 0->1, and on every frame
 * asks `getFrom()`/`getTo()` for this frame's overlay-local endpoints (either one returning
 * null hides the icon that frame rather than snapping it somewhere wrong), drawing a
 * quadratic Bezier (from -> arc apex -> to) between them — same shape
 * FlyingResourceEffect's 3D version uses, just in screen-space pixels. Both
 * spawnFlyingResourceIcon() and spawnFlyingIconToOverlayPoint() are thin wrappers supplying
 * different `getTo()` implementations (project a second world point, vs. read a HUD element's
 * live position directly) around this one animation.
 */
function flyIcon(
    host: ScreenAnchorHost,
    getFrom: () => PIXI.Point | null,
    getTo: () => PIXI.Point | null,
    texture: PIXI.Texture,
    onArrive?: () => void,
): void {
    const icon = new PIXI.Sprite(texture);
    icon.anchor.set(0.5);
    icon.scale.set(ViewUtils.elementScaler(icon, ICON_SIZE));
    icon.visible = false;
    host.overlayContainer.addChild(icon);

    const progress = { t: 0 };

    gsap.to(progress, {
        t: 1,
        duration: FLIGHT_DURATION_SEC,
        ease: 'power1.in',
        onUpdate: () => {
            const from = getFrom();
            const to = getTo();
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

/**
 * `host` is whatever the caller already tracks a ScreenAnchorHost for (BuildingZone/
 * DropZone/QueueZone all keep one for their own nameplate) — this needs its worldToScreen()
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
    flyIcon(
        host,
        () => projectWorldToOverlay(host, fromWorld, scratchFromWorld, scratchFromScreenPoint, scratchFromLocalPoint),
        () => projectWorldToOverlay(host, toWorld, scratchToWorld, scratchToScreenPoint, scratchToLocalPoint),
        texture,
        onArrive,
    );
}

/**
 * Same arc/flight as spawnFlyingResourceIcon(), but the destination is a HUD element's own
 * LIVE position instead of a second world point — e.g. QueueZone flying a task's reward from
 * the queue's 3D position to wherever EconomyUI's money icon actually sits on screen right
 * now. `getToOverlayPoint` is called fresh every frame (not read once at spawn) so the flight
 * still lands correctly even if the HUD element itself moves mid-flight (a window resize,
 * UIService repositioning it, ...) — already in `host.overlayContainer`'s own local space, so
 * unlike `fromWorld` it needs no bend-correction/worldToScreen() projection at all.
 */
export function spawnFlyingIconToOverlayPoint(
    host: ScreenAnchorHost,
    fromWorld: THREE.Vector3,
    getToOverlayPoint: () => { x: number; y: number },
    texture: PIXI.Texture,
    onArrive?: () => void,
): void {
    flyIcon(
        host,
        () => projectWorldToOverlay(host, fromWorld, scratchFromWorld, scratchFromScreenPoint, scratchFromLocalPoint),
        () => scratchToLocalPoint.copyFrom(getToOverlayPoint()),
        texture,
        onArrive,
    );
}
