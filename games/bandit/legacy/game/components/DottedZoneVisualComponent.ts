// DottedZoneVisualComponent.ts
//
// Floor-flat dotted rounded-rect outline for a zone entity — same
// "static local offset set once in awake(), parented under entity.transform"
// shape as BoxVisualComponent, just tracing the trigger's own XZ footprint
// on the floor instead of covering it with a solid box.

import * as THREE from 'three';
import Component from '../ecs/Component';
import { DottedLineBuilder, DottedLineStyle } from '../builders/DottedLineBuilder';

export default class DottedZoneVisualComponent extends Component {
    private readonly width: number;
    private readonly depth: number;
    private readonly radius: number;
    private readonly centerOffset: THREE.Vector3;
    private readonly style: DottedLineStyle;
    private _mesh?: THREE.Mesh;

    public constructor(
        width: number,
        depth: number,
        radius: number,
        style: DottedLineStyle = {},
        centerOffset: THREE.Vector3 = new THREE.Vector3(),
    ) {
        super();
        this.width = width;
        this.depth = depth;
        this.radius = radius;
        this.style = style;
        this.centerOffset = centerOffset;
    }

    public get mesh(): THREE.Mesh {
        if (!this._mesh) {
            throw new Error('DottedZoneVisualComponent mesh accessed before awake()');
        }
        return this._mesh;
    }

    public awake(): void {
        this._mesh = DottedLineBuilder.buildRoundedRect(this.width, this.depth, this.radius, this.style);
        // Only X/Z track the trigger's own footprint — this is a FLOOR decal, so it always sits
        // near ground level (see DottedLineBuilder's own `y` style option) regardless of the
        // collider's vertical center (centerOffset.y is halfExtents.y, i.e. box-mid-height —
        // copying it wholesale is what was floating this outline up at the shop/building's
        // trigger height instead of on the ground).
        this._mesh.position.set(this.centerOffset.x, 0, this.centerOffset.z);
        this.entity.transform.add(this._mesh);
    }

    /** Hide/show the outline without tearing it down — same convention as BoxVisualComponent.setVisible(). */
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
