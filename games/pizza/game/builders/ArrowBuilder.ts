// ArrowBuilder.ts
//
// Builds a solid 3D arrow shape — a flat arrow-head-and-shaft polygon (THREE.Shape) extruded
// into a thin prism (THREE.ExtrudeGeometry) — the real-3D counterpart to ZoneTutorialArrow.ts's
// flat screen-space sprite, used by ZoneTutorial3dArrow.ts wherever a zone tutorial's
// `use3dArrow` flag is set (see ZoneTutorialTypes.ts's own doc).
//
// The polygon is authored tail-at-local-origin, tip at local -Z after the extrude's own
// rotateX() below — i.e. the SAME "forward = local -Z" convention THREE.Object3D.lookAt()
// assumes, so a caller can just do `mesh.lookAt(target)` to point this at anything, with no
// extra axis bookkeeping of its own. See buildShape()'s own doc for the exact coordinate
// mapping this relies on.
//
// One shared BufferGeometry (the shape never varies, only scale/material do) — every build()
// call gets its OWN Mesh + own Material (never cached/shared), since callers mutate a live
// arrow's own material.opacity every frame for the fade-near-target effect (see
// ZoneTutorial3dArrow.ts) and a shared material would leak that mutation across instances.

import * as THREE from 'three';
import { BendService } from '../services/BendService';

export interface ArrowStyle {
    color?: number;
    opacity?: number;
}

const DEFAULT_STYLE: Required<ArrowStyle> = {
    color: 0xffffff,
    opacity: 1,
};

/** Arrow's own local footprint before scaling — unitless, callers scale the whole mesh via `mesh.scale`, not by rebuilding geometry per size. */
const ARROW_LENGTH = 1;
const ARROW_WIDTH = 0.55;
/** Shaft width as a fraction of the head's own full width. */
const SHAFT_WIDTH_RATIO = 0.4;
/** How much of ARROW_LENGTH the head (the wide triangular part) occupies, measured from the tip backward. */
const HEAD_LENGTH_RATIO = 0.45;
const EXTRUDE_DEPTH = 0.3;

export class ArrowBuilder {
    private static geometry: THREE.ExtrudeGeometry | null = null;

    /** Builds one arrow mesh, ready to position/rotate/scale — see this file's own doc on why geometry is shared but the material never is. */
    public static build(style: ArrowStyle = {}): THREE.Mesh {
        const resolved = { ...DEFAULT_STYLE, ...style };
        const geometry = ArrowBuilder.getGeometry();

        const material = new THREE.MeshBasicMaterial({
            color: resolved.color,
            transparent: true,
            opacity: resolved.opacity,
            depthWrite: false,
            // Whether buildShape()'s hand-authored contour winds CW or CCW determines which cap
            // ends up facing "up" after getGeometry()'s own rotateX() — rather than depend on
            // getting that exactly right (and it wasn't: the arrow was invisible from the
            // normal above-the-ground camera angle, its front face silently backface-culled),
            // DoubleSide makes it render correctly regardless of winding.
            side: THREE.DoubleSide,
        });
        BendService.applyBend(material);

        return new THREE.Mesh(geometry, material);
    }

    private static getGeometry(): THREE.ExtrudeGeometry {
        if (ArrowBuilder.geometry) {
            return ArrowBuilder.geometry;
        }

        const geometry = new THREE.ExtrudeGeometry(ArrowBuilder.buildShape(), {
            depth: EXTRUDE_DEPTH,
            bevelEnabled: false,
        });

        // ExtrudeGeometry extrudes the shape's own (x, y) plane along +Z, giving local
        // (x, y, z) = (shapeX, shapeY, [0, depth]). Rotating -90° about X remaps that to local
        // (x, y, z) = (shapeX, extrudeFraction, -shapeY) — i.e. the shape's own Y axis (where
        // the tip sits at +ARROW_LENGTH, see buildShape()) becomes local -Z, matching
        // Object3D.lookAt()'s default forward axis (see this file's own top-of-file doc), and
        // the extrude's own thin thickness becomes local Y (vertical, sitting on the ground).
        geometry.rotateX(-Math.PI / 2);
        // Only the vertical (extrude-depth) axis needs centering — X/Z stay authored so the
        // tail (shapeY = 0) sits exactly at local origin, which is what a caller's
        // `mesh.position` is actually placing.
        geometry.translate(0, -EXTRUDE_DEPTH / 2, 0);

        ArrowBuilder.geometry = geometry;
        return geometry;
    }

    /**
     * The arrow's flat outline before extrusion — tail at (0, 0), tip at (0, ARROW_LENGTH), an
     * arrowhead triangle sitting on top of a narrower rectangular shaft, drawn as one closed
     * clockwise loop. See getGeometry()'s own doc for how this 2D (x, y) plane maps to the
     * final mesh's local axes.
     */
    private static buildShape(): THREE.Shape {
        const halfShaft = (ARROW_WIDTH * SHAFT_WIDTH_RATIO) / 2;
        const halfHead = ARROW_WIDTH / 2;
        const headStartY = ARROW_LENGTH * (1 - HEAD_LENGTH_RATIO);

        const shape = new THREE.Shape();
        shape.moveTo(-halfShaft, 0);
        shape.lineTo(-halfShaft, headStartY);
        shape.lineTo(-halfHead, headStartY);
        shape.lineTo(0, ARROW_LENGTH);
        shape.lineTo(halfHead, headStartY);
        shape.lineTo(halfShaft, headStartY);
        shape.lineTo(halfShaft, 0);
        shape.closePath();
        return shape;
    }
}
