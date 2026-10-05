// StoreDoor.ts
//
// A swinging door hung in a "polyDoor" wall opening (see PolyWallBuilder.doorFrames()) — one
// leaf hinged on the opening's start side, or with "isDouble" two half-width leaves hinged on
// both sides, meeting in the middle. With "isSliding" the leaves slide along the wall line into
// the wall (a pocket door) instead of swinging, and always clear the WHOLE doorway without ever
// poking past the straight wall beside it (DoorFrame.roomBefore/roomAfter — past it is a corner):
//   - a single sliding door that fits that wall slides into it as one panel, toward the side
//     with more wall;
//   - one that's too big becomes an automatic door: two halves parting sideways, one each way
//     (same as "isDouble" + "isSliding");
//   - a half still wider than its wall splits into telescoping panels at slightly different
//     depths inside the wall's thickness, which stack on top of each other as they open.
// While anyone that opens doors (an entity with
// `opensDoors` set — the player, store clients, store workers) stands within reach on either
// side, it swings open AWAY from them, and swings back shut once the doorway has been clear for
// a moment. The swing direction is picked when it starts opening and kept until it has closed
// again, so walking through doesn't flip it back in your face halfway.
//
// Look: a DoorStyleConfig (StoreViewTypes.ts — the building's/store's door style): a model
// stretched over each leaf (× its `scale`), or a plain panel in `color` at `opacity` (below 1 =
// see-through glass, which skips the camera-occlusion fade — you already see through it).
// setStyle() swaps it in place.
//
// Visual only: the doorway itself has no collider (see PolyWallBuilder.colliderBoxes()), and
// the leaf has none either — it never blocks anyone, it just gets out of the way.
//
// Not a Component (an Entity can't drop a component once added): its owner — BuildingZone —
// builds it with the walls, calls update() every frame and dispose() with the walls.

import * as THREE from 'three';
import type World from '../ecs/World';
import { BendService, STRUCTURE_OCCLUSION_FADE } from '../services/BendService';
import type { DoorFrame } from '../builders/PolyWallBuilder';
import type { DoorStyleConfig } from './StoreViewTypes';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { ModelSnapshotTool } from '../debug/ModelSnapshotTool';

/** How far either side of the doorway (world units, across the wall) someone opens the door from. */
const OPEN_REACH = 2;
/** How far past either end of the opening (along the wall) still counts as "at the door". */
const OPEN_SIDE_MARGIN = 0.4;
/** Fully open swing, radians. */
const OPEN_ANGLE = THREE.MathUtils.degToRad(95);
/** Seconds the doorway must stay clear before the door starts closing. */
const CLOSE_DELAY_SEC = 0.35;
/** Swing smoothing rates (higher = snappier) — opening is quicker than closing. */
const OPEN_RATE = 10;
const CLOSE_RATE = 5;
/** Leaf thickness, and the gap kept to the frame so it doesn't clip the jambs/floor/lintel. */
const LEAF_THICKNESS = 0.08;
const LEAF_GAP = 0.03;
/** Most telescoping panels one sliding leaf splits into, and the spacing between their depths (must fit the wall's thickness). */
const MAX_SLIDE_PANELS = 3;
const SLIDE_PANEL_SPACING = LEAF_THICKNESS + 0.01;
/** How much neighbouring telescoping panels overlap when shut, so there's no see-through seam. */
const SLIDE_PANEL_OVERLAP = 0.05;

/**
 * One leaf: its pivot (at the hinge, `hingeX` along the doorway), and its `direction` — +1 for a
 * leaf hinged at the start, -1 at the far side. Swinging, the far leaf turns the other way so
 * both reach the same side; sliding, each slides back toward its own hinge side, up to `travel`.
 */
interface Leaf {
    pivot: THREE.Group;
    hingeX: number;
    direction: 1 | -1;
    travel: number;
    /** The leaf's box, in its pivot's frame: center X (from the hinge), depth Z, width/height. */
    centerX: number;
    depth: number;
    width: number;
    height: number;
    /** What's currently drawn for it (a panel mesh or a model) — see buildLeafContent(). */
    content?: THREE.Object3D;
}

/** Same `./` + repo-relative model URL convention as GlbVisualComponent. */
const modelUrl = (fullPath: string): string => `./${fullPath}`;

/** An entity flagged as opening doors — see this file's own doc. */
interface DoorOpener {
    opensDoors?: boolean;
    transform: THREE.Object3D;
}

export default class StoreDoor {
    /** At the hinge, local +X along the doorway, +Z across it (see the constructor). */
    public readonly object = new THREE.Group();
    private readonly leaves: Leaf[] = [];
    private readonly width: number;
    /** World hinge position and frame axes — for the "who's at the door" test. */
    private readonly hinge: THREE.Vector3;
    private readonly along: THREE.Vector3;
    private readonly across: THREE.Vector3;

    private readonly sliding: boolean;
    /** 0 = shut, 1 = fully open. */
    private amount = 0;
    /** +1 / -1 while open (the side a swinging door swings to), 0 once fully shut. */
    private openSide = 0;
    private clearSec = 0;
    private readonly scratch = new THREE.Vector3();
    private style: DoorStyleConfig;
    /** Bumped by every setStyle()/dispose() — a model load finishing for an older style is dropped. */
    private styleVersion = 0;
    /** Two leaves meeting in the middle ("isDouble", or a sliding door too wide to slide as one) — picks DoorStyleConfig.doubleModels over `models`. */
    private readonly double: boolean;

    /**
     * `frame` is world-space; `origin` is where the owner's transform rests (the door's object
     * goes under that transform) and `baseY` the floor's world Y.
     */
    public constructor(frame: DoorFrame, origin: THREE.Vector3, baseY: number, style: DoorStyleConfig) {
        this.style = style;
        const dx = frame.end.x - frame.hinge.x;
        const dz = frame.end.z - frame.hinge.z;
        this.width = Math.hypot(dx, dz);
        this.hinge = new THREE.Vector3(frame.hinge.x, baseY, frame.hinge.z);
        this.along = new THREE.Vector3(dx, 0, dz).normalize();
        // Rotating local +X by rotation.y = θ gives (cos θ, 0, -sin θ) — so θ = atan2(-dz, dx)
        // lines +X up with the doorway; local +Z then points across it.
        const yaw = Math.atan2(-dz, dx);
        this.across = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));

        this.sliding = frame.sliding;
        const leafHeight = Math.max(0.1, frame.height - LEAF_GAP);
        // A single sliding leaf too wide for the wall on either side parts in two instead.
        const singleLeafWidth = Math.max(0.1, this.width - LEAF_GAP * 2);
        const biParting = frame.sliding && !frame.double && singleLeafWidth + LEAF_GAP > Math.max(frame.roomBefore, frame.roomAfter);
        this.double = frame.double || biParting;
        if (this.double) {
            // Two halves, gaps at both jambs and in the middle.
            const leafWidth = Math.max(0.1, (this.width - LEAF_GAP * 3) / 2);
            this.addSide(0, 1, leafWidth, leafHeight, frame.roomBefore);
            this.addSide(this.width, -1, leafWidth, leafHeight, frame.roomAfter);
        } else {
            const leafWidth = singleLeafWidth;
            if (frame.sliding && frame.roomAfter > frame.roomBefore) {
                // Slides toward the far side — hang it there.
                this.addSide(this.width, -1, leafWidth, leafHeight, frame.roomAfter);
            } else {
                this.addSide(0, 1, leafWidth, leafHeight, frame.roomBefore);
            }
        }
        this.object.position.set(frame.hinge.x - origin.x, baseY - origin.y, frame.hinge.z - origin.z);
        this.object.rotation.y = yaw;
        this.leaves.forEach(leaf => this.buildLeafContent(leaf));
    }

    /**
     * One side's leaf, hung at `hingeX` (`direction` +1 = the start side, -1 = the far side),
     * covering `leafWidth` from the jamb. Swinging: one leaf. Sliding: as few panels as fit the
     * `room` (straight wall) beside it once stacked — panel k (counting from the jamb) shuts over
     * its own share of the doorway and slides back (k + 1) panel widths, so when open every panel
     * sits in the wall right beside the jamb, each at its own depth.
     */
    private addSide(hingeX: number, direction: 1 | -1, leafWidth: number, height: number, room: number): void {
        if (!this.sliding) {
            this.addLeaf(hingeX, direction * (LEAF_GAP + leafWidth / 2), leafWidth, height, direction, 0, 0);
            return;
        }
        let panels = 1;
        while (panels < MAX_SLIDE_PANELS && leafWidth / panels + LEAF_GAP > room) {
            panels++;
        }
        const share = leafWidth / panels;
        const panelWidth = share + (panels > 1 ? SLIDE_PANEL_OVERLAP : 0);
        for (let k = 0; k < panels; k++) {
            const center = LEAF_GAP + share * (k + 0.5);
            const depth = (k - (panels - 1) / 2) * SLIDE_PANEL_SPACING;
            this.addLeaf(hingeX, direction * center, panelWidth, height, direction, LEAF_GAP + share * (k + 1), depth);
        }
    }

    /**
     * A leaf hinged at `hingeX` along the doorway, its center `centerX` from the hinge (negative
     * = it extends back toward the start, i.e. hinged at the far side). `direction` makes both
     * leaves of a double door swing to the SAME side: turning local -X by +θ moves it toward +Z,
     * the opposite of local +X — so the far leaf turns the other way.
     */
    private addLeaf(hingeX: number, centerX: number, width: number, height: number, direction: 1 | -1, travel: number, depth: number): void {
        const pivot = new THREE.Group();
        pivot.position.x = hingeX;
        this.object.add(pivot);
        this.leaves.push({ pivot, hingeX, direction, travel, centerX, depth, width, height });
    }

    /** Swaps every leaf's look to `style` (e.g. the store's door style changed). */
    public setStyle(style: DoorStyleConfig): void {
        this.style = style;
        this.styleVersion++;
        this.leaves.forEach(leaf => this.buildLeafContent(leaf));
    }

    /**
     * Draws `leaf` in the current style, replacing what was there: the style's model if it has
     * one (loaded async — the plain panel shows until it's in), else the plain panel.
     */
    private buildLeafContent(leaf: Leaf): void {
        this.setLeafContent(leaf, this.buildPanel(leaf));
        // A double door's leaves use doubleModels when set; a single door (or no doubleModels) uses models.
        const doubleRefs = this.double ? this.style.doubleModels : undefined;
        const ref = (doubleRefs && doubleRefs.length > 0 ? doubleRefs : this.style.models)?.[0];
        const model = ModelSnapshotTool.resolveModelRef(ref);
        if (!model) {
            if (ref) {
                console.warn(`[StoreDoor] door model ${typeof ref === 'string' ? ref : ref.id} isn't in MODELS — keeping the plain panel`);
            }
            return;
        }
        const version = this.styleVersion;
        ModelLoaderManager.instance.loadModel(modelUrl(model.fullPath), model.id)
            .then(object => {
                if (version === this.styleVersion) {
                    this.setLeafContent(leaf, this.fitModel(leaf, object));
                }
            })
            .catch(error => console.warn(`[StoreDoor] failed to load door model ${model.id} — keeping the plain panel`, error));
    }

    private setLeafContent(leaf: Leaf, content: THREE.Object3D): void {
        if (leaf.content) {
            StoreDoor.disposeContent(leaf.content);
        }
        leaf.content = content;
        leaf.pivot.add(content);
    }

    /** The plain panel: a box in `color` at `opacity`. */
    private buildPanel(leaf: Leaf): THREE.Mesh {
        const { width, height, centerX, depth } = leaf;
        const opacity = THREE.MathUtils.clamp(this.style.opacity ?? 1, 0, 1);
        const geometry = new THREE.BoxGeometry(width, height, LEAF_THICKNESS, Math.max(1, BendService.segmentsForSpan(width)), 1, 1);
        // Baked in (not mesh.position) — applyOcclusionFadeToObject() wants an untransformed root.
        geometry.translate(centerX, height / 2, depth);
        const material = new THREE.MeshStandardMaterial({
            color: this.style.color,
            roughness: opacity < 1 ? 0.15 : 0.7,
            metalness: 0,
            transparent: opacity < 1,
            opacity,
            // See-through: don't hide what's behind it from later draws (the room inside).
            depthWrite: opacity >= 1,
        });
        BendService.applyBend(material);
        const mesh = new THREE.Mesh(geometry, material);
        if (opacity >= 1) {
            // The dithered occlusion fade forces the material opaque — only for solid doors.
            BendService.applyOcclusionFadeToObject(mesh, STRUCTURE_OCCLUSION_FADE);
        }
        return mesh;
    }

    /**
     * The style's model, stretched over the leaf: its native box scaled to the leaf's width
     * (X) and height (Y), depth by the average of the two, all × `scale` — then centered on
     * the leaf and stood on the floor. Wrapped in an untransformed group so the occlusion fade
     * can measure it (see BendService.applyOcclusionFadeToObject()).
     */
    private fitModel(leaf: Leaf, object: THREE.Object3D): THREE.Object3D {
        // Own materials (the loader shares one parsed scene per id — see GlbVisualComponent).
        object.traverse(child => {
            if (child instanceof THREE.Mesh) {
                child.material = Array.isArray(child.material) ? child.material.map(material => material.clone()) : child.material.clone();
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(material => BendService.applyBend(material));
            }
        });
        object.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const multiplier = this.style.scale ?? 1;
        const scaleX = (size.x > 1e-4 ? leaf.width / size.x : 1) * multiplier;
        const scaleY = (size.y > 1e-4 ? leaf.height / size.y : 1) * multiplier;
        const scaleZ = ((scaleX + scaleY) / 2);
        // A leaf hung on the FAR jamb (direction -1 — the second leaf of a double door) is the
        // mirror image of one hung on the start jamb: flip the model across its width so its
        // hinge edge sits at that leaf's own jamb and the two leaves meet handle-to-handle in the
        // middle. three.js flips face winding for a negative-determinant matrix, so it still lights.
        const mirrorX = leaf.direction === -1 ? -1 : 1;
        object.scale.multiply(new THREE.Vector3(scaleX * mirrorX, scaleY, scaleZ));
        object.updateMatrixWorld(true);
        const fitted = new THREE.Box3().setFromObject(object);
        const center = fitted.getCenter(new THREE.Vector3());
        object.position.x += leaf.centerX - center.x;
        object.position.y += -fitted.min.y;
        object.position.z += leaf.depth - center.z;

        const root = new THREE.Group();
        root.add(object);
        BendService.applyOcclusionFadeToObject(root, STRUCTURE_OCCLUSION_FADE);
        return root;
    }

    /** Disposes a leaf content's materials (and a panel's own geometry — model geometry is shared by the loader's cache). */
    private static disposeContent(content: THREE.Object3D): void {
        content.removeFromParent();
        const ownsGeometry = content instanceof THREE.Mesh;
        content.traverse(child => {
            if (child instanceof THREE.Mesh) {
                if (ownsGeometry) {
                    child.geometry.dispose();
                }
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(material => material.dispose());
            }
        });
    }

    public update(delta: number, world: World | undefined): void {
        // Who's at the door, and on which side (the nearest one decides the swing direction).
        let nearestSide = 0;
        let nearestDistance = Infinity;
        world?.forEachEntity(entity => {
            const opener = entity as unknown as DoorOpener;
            if (!opener.opensDoors) {
                return;
            }
            this.scratch.copy(opener.transform.position).sub(this.hinge);
            const along = this.scratch.dot(this.along);
            const across = this.scratch.dot(this.across);
            if (along < -OPEN_SIDE_MARGIN || along > this.width + OPEN_SIDE_MARGIN || Math.abs(across) > OPEN_REACH) {
                return;
            }
            if (Math.abs(across) < nearestDistance) {
                nearestDistance = Math.abs(across);
                nearestSide = across >= 0 ? 1 : -1;
            }
        });

        if (nearestDistance < Infinity) {
            this.clearSec = 0;
            if (this.openSide === 0) {
                // (A sliding door ignores the side — it only needs to know it's open.)
                // Swing AWAY from whoever is opening it: someone on the +Z side pushes it toward
                // -Z, which is a positive rotation (local +X turns toward -Z).
                this.openSide = nearestSide > 0 ? 1 : -1;
            }
        } else {
            this.clearSec += delta;
        }

        const opening = this.openSide !== 0 && this.clearSec < CLOSE_DELAY_SEC;
        const rate = opening ? OPEN_RATE : CLOSE_RATE;
        this.amount += ((opening ? 1 : 0) - this.amount) * (1 - Math.exp(-rate * delta));
        if (!opening && this.amount < 1e-3) {
            this.amount = 0;
            this.openSide = 0;
        }
        for (const leaf of this.leaves) {
            if (this.sliding) {
                leaf.pivot.position.x = leaf.hingeX - leaf.direction * leaf.travel * this.amount;
            } else {
                leaf.pivot.rotation.y = this.openSide * OPEN_ANGLE * this.amount * leaf.direction;
            }
        }
    }

    public dispose(): void {
        this.object.removeFromParent();
        this.styleVersion++;
        for (const leaf of this.leaves) {
            if (leaf.content) {
                StoreDoor.disposeContent(leaf.content);
            }
        }
    }
}
