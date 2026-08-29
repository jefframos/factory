// ZoneTutorialArrow.ts
//
// Screen-space marker hovering directly over whatever ZoneTutorialController's current step
// needs next — built on ScreenAnchorComponent (same component every other world-anchored UI in
// this game already uses — Gate.ts's own lock/requirement panel, DropZone's nameplate,
// ResourceNode's damage popups) rather than a bespoke worldToScreen() call, specifically so it
// inherits that component's already-correct, already-tested behavior for free: the
// BendService.applyToPosition() ground-bend correction (skipping this made the marker visibly
// drift away from where a target actually renders, worse the farther it sits from the player —
// see this file's own git history), the isOnScreen() viewport check (an earlier from-scratch
// version's off-screen handling was the "sometimes it disappears and I don't know why" bug
// report), and smoothed position/alpha so it doesn't jitter or pop.
//
// Deliberately NOT a compass/radar — it never rotates and never clamps to the screen edge when
// its target is off-screen; ScreenAnchorComponent just hides it in that case, same as every
// other anchored popup. Pointing a direction for an off-screen objective is the future 3D
// arrow's job (see ZoneTutorialConfig.use3dArrow's own doc) — this one is a "look, it's right
// there" marker, not a "it's somewhere that way" indicator.
//
// Owns a dedicated pooled Entity (world.spawn()/despawn()) purely to host the
// ScreenAnchorComponent — spawned lazily on the first update() call (or the first one after
// hide()), torn down by hide()/destroy(). update()/hide() are safe to call every frame from
// ZoneTutorialController regardless of whether the entity currently exists.

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import World from '../ecs/World';
import Entity from '../ecs/Entity';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';

const ARROW_SIZE = 40;
/** Default world units above the target's own position the marker hovers, when update() isn't given its own heightOffset — tuned for a ground-level gather target (a resource node/loose pickup sitting right at the ground). */
const DEFAULT_TARGET_HEIGHT_OFFSET = 1.6;
/** update()'s heightOffset for a deliver target (a gate/craft table) — these are real, much taller placed props (see Gate.ts's own `height + LABEL_CLEARANCE_ABOVE_MESH` for its label anchor), so the default ground-level offset above left the marker sitting inside/just above their base instead of clear of the whole prop. WorldObjectRegistry's placements carry no actual mesh height to read (Tiled objects are 2D footprints, x/z only) — this is a flat, hand-tuned guess rather than a per-object real height, revisit if a much taller/shorter gate or craft table ever makes it look off again. */
export const DELIVER_TARGET_HEIGHT_OFFSET = 3.2;
/** World units the idle bob swings above/below TARGET_HEIGHT_OFFSET — a deliberate "look here" cue, not an artifact (an earlier bug made the marker LOOK like it was bobbing/drifting for the wrong reason — see this file's own doc). */
const BOB_AMPLITUDE = 0.15;
/** Bob cycles per second. */
const BOB_FREQUENCY_HZ = 1.2;

export default class ZoneTutorialArrow {
    private readonly world: World;
    private readonly host: ScreenAnchorHost;
    private textureId: string;

    private entity?: Entity;
    private sprite?: PIXI.Sprite;

    /** The TRUE (un-bent, un-bobbed) target — ScreenAnchorComponent's getTargetPosition callback reads getBobbedTarget() below, which derives from this every call, so the bob animates smoothly even though update() itself only runs once per ZoneTutorialController tick (not every render frame). */
    private readonly targetPosition = new THREE.Vector3();
    private readonly bobbedPosition = new THREE.Vector3();
    /** See update()'s own doc for why this varies per call instead of being a single constant. */
    private heightOffset = DEFAULT_TARGET_HEIGHT_OFFSET;

    public constructor(world: World, host: ScreenAnchorHost, arrowTextureId: string) {
        this.world = world;
        this.host = host;
        this.textureId = arrowTextureId;
    }

    public setTexture(arrowTextureId: string): void {
        this.textureId = arrowTextureId;
        if (this.sprite) {
            this.sprite.texture = PIXI.Texture.from(arrowTextureId);
        }
    }

    /**
     * Repoints the marker at `targetWorldPosition` — spawns the underlying entity lazily if
     * hide() tore it down (or this is the first call ever). `heightOffset` lets a caller hover
     * higher above a real placed prop (see DELIVER_TARGET_HEIGHT_OFFSET's own doc) than the
     * ground-level default suits.
     */
    public update(targetWorldPosition: THREE.Vector3, heightOffset: number = DEFAULT_TARGET_HEIGHT_OFFSET): void {
        this.targetPosition.copy(targetWorldPosition);
        this.heightOffset = heightOffset;
        if (!this.entity) {
            this.spawn();
        }
    }

    /** Tears down the underlying entity — safe to call even if nothing is currently spawned. ScreenAnchorComponent has no notion of "hidden but still tracking," so despawning is how this both frees the sprite and guarantees nothing renders while there's no sane target to point at (see ZoneTutorialController's own callers). */
    public hide(): void {
        if (this.entity) {
            this.world.despawn(this.entity);
            this.entity = undefined;
            this.sprite = undefined;
        }
    }

    public destroy(): void {
        this.hide();
    }

    private spawn(): void {
        this.sprite = new PIXI.Sprite(PIXI.Texture.from(this.textureId));
        // Bottom-center anchor — the marker's own tip sits AT the bobbed point above the
        // target, rather than the point sitting at the sprite's center (which would put half
        // the arrow below the target it's supposed to be pointing down at).
        this.sprite.anchor.set(0.5, 1);
        this.sprite.width = ARROW_SIZE;
        this.sprite.height = ARROW_SIZE;

        this.entity = this.world.spawn();
        this.entity.addComponent(new ScreenAnchorComponent(
            this.host,
            this.sprite,
            () => this.getBobbedTarget(),
        ));
    }

    private getBobbedTarget(): THREE.Vector3 {
        const bob = this.heightOffset + Math.sin(performance.now() / 1000 * BOB_FREQUENCY_HZ * Math.PI * 2) * BOB_AMPLITUDE;
        return this.bobbedPosition.copy(this.targetPosition).setY(this.targetPosition.y + bob);
    }
}
