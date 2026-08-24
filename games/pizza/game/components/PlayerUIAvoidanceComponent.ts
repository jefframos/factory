// PlayerUIAvoidanceComponent.ts
//
// Owns the single "keep UI off the player" region every 'simple' zone popup's
// avoidViewer option reads (see ScreenAnchorComponent.ts/PopupConfig.ts) —
// anchored at the player's HEAD (an offset above the entity's own
// transform.position, which sits at the feet) rather than the base point
// ScreenAnchorHost.getViewerPosition() uses for distance culling/scaling,
// since the head/shoulders is the actual on-screen silhouette a popup needs
// to dodge, not a point at ground level a popup would happily overlap.
//
// `radius` is a public, live-mutable field (overlay-space px, same units as
// every other ScreenAnchorComponent screen-space measurement) rather than a
// constructor-only value — a designer can retune it at runtime (e.g. from a
// dev-GUI slider) and every popup picks the new value up on its very next
// frame, since ScreenAnchorComponent re-reads ScreenAnchorHost.
// getUIAvoidancePoint() every update() rather than snapshotting it once.
//
// `showDebugPreview` draws a translucent circle at the live projected head
// position, sized to the CURRENT radius — turn it on while tuning to see
// exactly the region other UI is being kept out of, off for normal play.

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import Component from '../ecs/Component';
import { BendService } from '../services/BendService';
import { ScreenAnchorHost } from './ScreenAnchorComponent';

/** World-space offset from the player entity's own transform.position (feet) to its head — roughly a standing human's eye/shoulder height. */
const DEFAULT_HEAD_OFFSET = new THREE.Vector3(0, 1.6, 0);
/** Overlay-space px other UI keeps clear of the head point by default — same order of magnitude as the popup content it's meant to dodge (see PopupConfig.ts's own doc). */
const DEFAULT_RADIUS = 60;

const DEBUG_CIRCLE_COLOR = 0x33ccff;
const DEBUG_CIRCLE_FILL_ALPHA = 0.25;
const DEBUG_CIRCLE_LINE_WIDTH = 2;

/** The region every avoidViewer-enabled ScreenAnchorComponent reads — see ScreenAnchorHost.getUIAvoidancePoint(). */
export interface UIAvoidanceRegion {
    position: THREE.Vector3;
    radius: number;
}

export default class PlayerUIAvoidanceComponent extends Component {
    private readonly host: ScreenAnchorHost;
    /** World-space offset from this entity's own transform.position to its "head" — see this file's own doc. Public so a caller can retune per-character without subclassing. */
    public headOffset: THREE.Vector3;
    /** Overlay-space (px) radius other UI keeps clear of the head point — read live every frame by every popup using avoidViewer, so changing this takes effect immediately. */
    public radius: number;
    /** Toggle a live debug circle showing exactly what `radius` currently protects — see this file's own doc. */
    public showDebugPreview = false;

    private debugCircle?: PIXI.Graphics;
    private readonly scratchPosition = new THREE.Vector3();
    private readonly scratchPoint = new PIXI.Point();
    private readonly scratchLocalPoint = new PIXI.Point();

    public constructor(
        host: ScreenAnchorHost,
        headOffset: THREE.Vector3 = DEFAULT_HEAD_OFFSET.clone(),
        radius: number = DEFAULT_RADIUS,
    ) {
        super();
        this.host = host;
        this.headOffset = headOffset;
        this.radius = radius;
    }

    /** The live region other UI should avoid — see ScreenAnchorHost.getUIAvoidancePoint(), the one caller. */
    public getRegion(): UIAvoidanceRegion {
        return {
            position: this.scratchPosition.copy(this.entity.transform.position).add(this.headOffset),
            radius: this.radius,
        };
    }

    public update(): void {
        if (this.showDebugPreview) {
            this.updateDebugPreview();
        } else if (this.debugCircle) {
            this.debugCircle.visible = false;
        }
    }

    private updateDebugPreview(): void {
        if (!this.debugCircle) {
            this.debugCircle = new PIXI.Graphics();
            this.host.overlayContainer.addChild(this.debugCircle);
        }

        // getRegion() returns a scratch Vector3 it owns — clone isn't needed here since nothing
        // else reads scratchPosition between this call and applyToPosition() mutating it below.
        const head = this.getRegion().position;
        const bent = BendService.applyToPosition(head);
        const screen = this.host.worldToScreen(bent);
        if (!screen) {
            this.debugCircle.visible = false;
            return;
        }

        this.scratchPoint.set(screen.x, screen.y);
        // `from` omitted — screen is already global/stage space, see
        // ScreenAnchorComponent.update()'s own doc on this exact pattern.
        this.host.overlayContainer.toLocal(this.scratchPoint, undefined, this.scratchLocalPoint);

        this.debugCircle.visible = true;
        this.debugCircle.clear();
        this.debugCircle.lineStyle(DEBUG_CIRCLE_LINE_WIDTH, DEBUG_CIRCLE_COLOR, 1);
        this.debugCircle.beginFill(DEBUG_CIRCLE_COLOR, DEBUG_CIRCLE_FILL_ALPHA);
        this.debugCircle.drawCircle(0, 0, this.radius);
        this.debugCircle.endFill();
        this.debugCircle.position.set(this.scratchLocalPoint.x, this.scratchLocalPoint.y);
    }

    public destroy(): void {
        this.debugCircle?.destroy();
    }
}
