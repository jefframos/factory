import * as THREE from 'three';
import { TruckEntity, TruckPart } from "../truck/TruckEntity";

export class TruckView3DService {
    private meshMap: Map<string, THREE.Object3D> = new Map();
    // Tuning constant: how far apart are the wheels on the Z axis?
    private axleWidth: number = 2;

    constructor(
        private truck: TruckEntity,
        private threeScene: THREE.Scene
    ) { }

    /**
     * Initializes the 3D parts.
     * We create 1 Chassis and 4 Wheels (2 per physics wheel body).
     */
    public buildStandardTruck(): void {
        // 1. Create Chassis (A simple block)
        const chassisGeom = new THREE.BoxGeometry(140, 20, 40);
        const chassisMat = new THREE.MeshPhongMaterial({ color: 0x3366ff });
        const chassisMesh = new THREE.Mesh(chassisGeom, chassisMat);
        this.addPart(TruckPart.CHASSIS, chassisMesh);

        // 2. Create Wheels (Cylinders rotated to face sideways)
        // Parameters: radiusTop, radiusBottom, height, radialSegments
        const wheelGeom = new THREE.CylinderGeometry(18, 18, 10, 32);
        wheelGeom.rotateX(Math.PI / 2); // Rotate cylinder to roll on the ground
        const wheelMat = new THREE.MeshPhongMaterial({ color: 0x333333 });

        // We create TWO 3D wheels for every ONE physics wheel
        const wheelTypes = [TruckPart.FRONT_WHEEL, TruckPart.BACK_WHEEL];

        wheelTypes.forEach(type => {
            const leftWheel = new THREE.Mesh(wheelGeom, wheelMat);
            const rightWheel = new THREE.Mesh(wheelGeom, wheelMat);

            this.addPart(`${type}_left`, leftWheel);
            this.addPart(`${type}_right`, rightWheel);
        });
    }

    private addPart(id: string, object: THREE.Object3D): void {
        this.threeScene.add(object);
        this.meshMap.set(id, object);
    }

    public update(): void {
        this.meshMap.forEach((mesh, id) => {
            // Determine which physics part to follow
            let partKey = id;
            let zOffset = 0;

            if (id.includes('wheel')) {
                const side = id.split('_')[2]; // 'left' or 'right'
                partKey = id.replace(`_${side}`, '') as TruckPart;
                zOffset = side === 'left' ? -this.axleWidth : this.axleWidth;
            }

            const part = this.truck.getPart(partKey as TruckPart);

            if (part) {
                // Map 2D Physics to 3D Space
                mesh.position.x = part.transform.position.x;
                // Note: If your 3D camera is top-down, y is y. 
                // If it's side-view, Matter Y (down) usually maps to 3D -Y
                mesh.position.y = -part.transform.position.y;
                mesh.position.z = zOffset;

                // Apply the 2D rotation to the 3D Z-axis
                mesh.rotation.z = -part.transform.rotation;
            }
        });
    }

    public destroy(): void {
        this.meshMap.forEach(mesh => {
            this.threeScene.remove(mesh);
            // Cleanup geometries and materials
            if (mesh instanceof THREE.Mesh) {
                mesh.geometry.dispose();
                mesh.material.dispose();
            }
        });
        this.meshMap.clear();
    }
}