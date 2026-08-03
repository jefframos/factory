// BoxVisualComponent.ts
//
// Plain colored box mesh for a static (or dynamic) entity that doesn't
// need a full character rig — e.g. the test obstacle in PizzaScene.
// Unlike CharacterVisualComponent, this one IS parented under
// entity.transform (a static local offset set once in awake(), same
// pattern as RigidBody's own debug wireframe), since there's no
// world-position override fighting it every frame.

import * as THREE from 'three';
import Component from '../ecs/Component';
import { BendService } from '../services/BendService';

export default class BoxVisualComponent extends Component {
    private readonly size: THREE.Vector3;
    private readonly centerOffset: THREE.Vector3;
    private readonly color: number;
    private mesh?: THREE.Mesh;

    public constructor(size: THREE.Vector3, color: number, centerOffset: THREE.Vector3 = new THREE.Vector3()) {
        super();
        this.size = size;
        this.color = color;
        this.centerOffset = centerOffset;
    }

    public awake(): void {
        const material = new THREE.MeshStandardMaterial({ color: this.color });
        BendService.applyBend(material);

        this.mesh = new THREE.Mesh(new THREE.BoxGeometry(this.size.x, this.size.y, this.size.z), material);
        this.mesh.position.copy(this.centerOffset);
        this.entity.transform.add(this.mesh);
    }

    public destroy(): void {
        this.mesh?.geometry.dispose();
        (this.mesh?.material as THREE.Material | undefined)?.dispose();
        this.mesh?.removeFromParent();
    }
}
