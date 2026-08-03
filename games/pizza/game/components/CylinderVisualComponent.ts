// CylinderVisualComponent.ts
//
// Plain colored cylinder mesh — same pattern as BoxVisualComponent, just a
// different primitive. Used for the tree placeholder (ResourceNode.ts)
// until real tree art exists; anything else wanting a simple cylinder
// (a pillar, a trunk, a barrel) can reuse this as-is.

import * as THREE from 'three';
import Component from '../ecs/Component';
import { BendService } from '../services/BendService';

export default class CylinderVisualComponent extends Component {
    private readonly radiusTop: number;
    private readonly radiusBottom: number;
    private readonly height: number;
    private readonly centerOffset: THREE.Vector3;
    private readonly color: number;
    private mesh?: THREE.Mesh;

    public constructor(radiusTop: number, radiusBottom: number, height: number, color: number, centerOffset: THREE.Vector3 = new THREE.Vector3()) {
        super();
        this.radiusTop = radiusTop;
        this.radiusBottom = radiusBottom;
        this.height = height;
        this.color = color;
        this.centerOffset = centerOffset;
    }

    public awake(): void {
        const material = new THREE.MeshStandardMaterial({ color: this.color });
        BendService.applyBend(material);

        this.mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(this.radiusTop, this.radiusBottom, this.height, 12),
            material,
        );
        this.mesh.position.copy(this.centerOffset);
        this.entity.transform.add(this.mesh);
    }

    /** Hide/show the mesh without tearing it down — see ResourceNode.deplete()/respawn(). */
    public setVisible(visible: boolean): void {
        if (this.mesh) {
            this.mesh.visible = visible;
        }
    }

    public destroy(): void {
        this.mesh?.geometry.dispose();
        (this.mesh?.material as THREE.Material | undefined)?.dispose();
        this.mesh?.removeFromParent();
    }
}
