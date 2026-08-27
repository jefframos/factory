// CaptureZoneVisualComponent.ts
//
// Floor-flat dashed CIRCLE decal marking a wild AnimalNode's own catch
// radius — same "static baked-canvas texture on a floor plane, parented
// under entity.transform" shape DottedZoneVisualComponent uses for
// buildings/shops/queues, just circular (DottedLineBuilder.buildCircle())
// instead of a rounded rect, and with ONE extra trick: setState() swaps the
// SAME mesh's material.map between three pre-baked textures (a neutral
// color, a "ready" highlight color, and a "blocked" color, all baked once
// via DottedLineBuilder.getCircleTexture() — see that method's own doc)
// instead of touching geometry or rebuilding anything, so switching color
// every time the player crosses the trigger boundary (or their eligibility
// changes) is a single reference swap, not a redraw.
//
// AnimalNode is the one caller — a WILD animal only (see that file's own
// doc): the ring shows exactly where the player needs to stand to attempt a
// capture. It turns green ('ready', see READY_COLOR) while they're standing
// in it AND actually able to catch this animal right now, or orange
// ('blocked', see BLOCKED_COLOR) if they're in range but can't — missing the
// requirement item, or the follower list is full (AnimalCatchController.ts
// drives setState() off the same onTriggerEnter/Exit pair it already tracks
// `overlapping` with, picking whichever state applies). A follower never has
// one — see AnimalNode.startFollowing(), which hides this instead of
// building a fresh one, mirroring how it also unregisters the wild-only
// catch trigger this circle is tracing.

import * as THREE from 'three';
import Component from '../ecs/Component';
import { DottedLineBuilder, DottedLineStyle } from '../builders/DottedLineBuilder';

/** Default ring color — a neutral white/grey reads as "informational," distinct from both READY_COLOR and BLOCKED_COLOR so a color change itself is what communicates the player's own eligibility, not just a re-draw. */
const NEUTRAL_COLOR = 0xffffff;
/** Same green ResourceNode's own gain-popup text/DottedLineBuilder-adjacent UI already uses for "good/positive" — see ZoneTitle in TextStyleRegistry.ts. */
const READY_COLOR = 0x33cc66;
/** "You're close enough, but can't catch this one right now" — missing the requirement item, or AnimalFollowStorage.hasRoom() is false. Orange rather than the red TextStyleRegistry.Damage/ResourceDamage use for "actively wrong/harmful" — this isn't an error, just not doable yet. */
const BLOCKED_COLOR = 0xff8800;

export type CaptureZoneState = 'neutral' | 'ready' | 'blocked';

export default class CaptureZoneVisualComponent extends Component {
    private readonly radius: number;
    private readonly baseStyle: DottedLineStyle;
    private _mesh?: THREE.Mesh;
    private neutralTexture?: THREE.CanvasTexture;
    private readyTexture?: THREE.CanvasTexture;
    private blockedTexture?: THREE.CanvasTexture;
    private state: CaptureZoneState = 'neutral';

    public constructor(radius: number, style: DottedLineStyle = {}) {
        super();
        this.radius = radius;
        this.baseStyle = style;
    }

    public get mesh(): THREE.Mesh {
        if (!this._mesh) {
            throw new Error('CaptureZoneVisualComponent mesh accessed before awake()');
        }
        return this._mesh;
    }

    public awake(): void {
        this.neutralTexture = DottedLineBuilder.getCircleTexture(this.radius, { ...this.baseStyle, color: NEUTRAL_COLOR });
        this.readyTexture = DottedLineBuilder.getCircleTexture(this.radius, { ...this.baseStyle, color: READY_COLOR });
        this.blockedTexture = DottedLineBuilder.getCircleTexture(this.radius, { ...this.baseStyle, color: BLOCKED_COLOR });

        // Starts on the neutral texture — buildCircle() bakes+applies the SAME neutral style,
        // so this is just reusing that mesh rather than building a second one for the identical
        // starting look.
        this._mesh = DottedLineBuilder.buildCircle(this.radius, { ...this.baseStyle, color: NEUTRAL_COLOR });
        this.entity.transform.add(this._mesh);
    }

    /** Swaps this ring's own color to match `state` — see this file's own doc for what each one means. No-ops if already in that state (avoids reassigning material.map every frame for no reason if a caller ever calls this unconditionally). */
    public setState(state: CaptureZoneState): void {
        if (this.state === state || !this._mesh) {
            return;
        }
        this.state = state;
        const textureByState: Record<CaptureZoneState, THREE.CanvasTexture | undefined> = {
            neutral: this.neutralTexture,
            ready: this.readyTexture,
            blocked: this.blockedTexture,
        };
        (this._mesh.material as THREE.MeshBasicMaterial).map = textureByState[state]!;
        (this._mesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
    }

    /** Hide/show the ring without tearing it down — same convention as DottedZoneVisualComponent.setVisible()/BoxVisualComponent.setVisible(). Used by AnimalNode.startFollowing() the instant a wild animal is caught — a follower never shows this again. */
    public setVisible(visible: boolean): void {
        if (this._mesh) {
            this._mesh.visible = visible;
        }
    }

    public destroy(): void {
        // Deliberately does NOT dispose neutralTexture/readyTexture/blockedTexture — all come from
        // DottedLineBuilder's own shared, never-evicted circleCache (see that file's own doc),
        // reused by every OTHER wild animal with the same radius/style; disposing them here
        // would break rendering for all of them. The material itself is this instance's own
        // (built fresh per buildCircle() call), so that's still safe to dispose.
        this._mesh?.geometry.dispose();
        (this._mesh?.material as THREE.Material | undefined)?.dispose();
        this._mesh?.removeFromParent();
    }
}
