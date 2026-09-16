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
    private _mesh?: THREE.Mesh;

    public constructor(radiusTop: number, radiusBottom: number, height: number, color: number, centerOffset: THREE.Vector3 = new THREE.Vector3()) {
        super();
        this.radiusTop = radiusTop;
        this.radiusBottom = radiusBottom;
        this.height = height;
        this.color = color;
        this.centerOffset = centerOffset;
    }

    public get mesh(): THREE.Mesh {
        if (!this._mesh) {
            throw new Error('CylinderVisualComponent mesh accessed before awake()');
        }
        return this._mesh;
    }

    public awake(): void {
        const material = new THREE.MeshStandardMaterial({ color: this.color });
        BendService.applyBend(material);

        this._mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(this.radiusTop, this.radiusBottom, this.height, 12),
            material,
        );
        this._mesh.position.copy(this.centerOffset);
        this.entity.transform.add(this._mesh);
    }

    /** Hide/show the mesh without tearing it down — see ResourceNode.deplete()/respawn(). */
    public setVisible(visible: boolean): void {
        if (this._mesh) {
            this._mesh.visible = visible;
        }
    }

    public destroy(): void {
        this._mesh?.geometry.dispose();
        (this._mesh?.material as THREE.Material | undefined)?.dispose();
        this._mesh?.removeFromParent();
    }
}
