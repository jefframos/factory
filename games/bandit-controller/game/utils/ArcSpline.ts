// ArcSpline.ts
//
// Quadratic-bezier arc between two points, sampled by progress (0..1).
// Shared by FlyingResourceIcon.ts (2D, screen-space, HUD-bound) and
// Collectible.ts (3D, world-space, player-bound homing) so both curved-
// flight effects use the same math instead of two hand-rolled copies of it.
//
// Deliberately stateless about time/easing — `from`/`to`/`t` are all passed
// in fresh on every call, so a moving endpoint (a running player, a
// per-frame-reprojected screen point) is simply whatever the caller passes
// THIS call. The curve re-aims itself every sample; nothing here resets or
// remembers where it "started."
//
// `arcHeight` is added directly to the midpoint's Y — it isn't assumed to
// mean "up." In world space (+Y up) a positive value lifts the apex; in
// screen space (+Y down) a caller wanting the same visual "rises above the
// straight line" effect passes a negative value (see FlyingResourceIcon.ts).

import * as THREE from 'three';

export default class ArcSpline {
    private readonly arcHeight: number;

    private readonly apex = new THREE.Vector3();
    private readonly legA = new THREE.Vector3();
    private readonly legB = new THREE.Vector3();
    private readonly result = new THREE.Vector3();

    public constructor(arcHeight: number) {
        this.arcHeight = arcHeight;
    }

    /**
     * Evaluates the arc at `t` (0..1, caller-owned — a fixed-duration timer,
     * a gsap-eased tween, whatever) between the CURRENT `from`/`to`. Returns
     * a reused internal Vector3 — copy it if you need the value to outlive
     * the current call (same convention as RigidBody.getCenter()).
     */
    public evaluate(from: THREE.Vector3, to: THREE.Vector3, t: number): THREE.Vector3 {
        this.apex.addVectors(from, to).multiplyScalar(0.5);
        this.apex.y += this.arcHeight;

        // Two lerped legs (from->apex, apex->to), then lerp between those —
        // the classic De Casteljau construction of a quadratic bezier.
        this.legA.lerpVectors(from, this.apex, t);
        this.legB.lerpVectors(this.apex, to, t);

        return this.result.lerpVectors(this.legA, this.legB, t);
    }
}
