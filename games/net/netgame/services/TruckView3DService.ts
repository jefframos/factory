import ModelLoaderManager from '@core/three/ModelLoaderManager';
import * as THREE from 'three';
import { MaterialUtils } from '../../environment/MaterialUtils';
import { TruckEntity, TruckPart } from "../truck/TruckEntity";

export interface TruckViewSettings {
    visualRotationY?: number;
    scale?: number;
    wheelScale?: number;
    nodes: {
        chassis: string;
        frontLeft: string;
        frontRight: string;
        backLeft: string;
        backRight: string;
    };
}

export class TruckView3DService {
    private carPivot: THREE.Group | null = null;
    private chassisContainer: THREE.Group = new THREE.Group();
    private wheelsContainer: THREE.Group = new THREE.Group();

    private wheelRefs: Map<string, { mesh: THREE.Object3D, type: TruckPart }> = new Map();

    private settings: Required<TruckViewSettings> = {
        visualRotationY: Math.PI / 2, // Default side-view correction
        scale: 1,
        wheelScale: 1,
        nodes: { chassis: '', frontLeft: '', frontRight: '', backLeft: '', backRight: '' }
    };

    constructor(
        private truck: TruckEntity,
        private threeScene: THREE.Scene
    ) { }


    public async buildStandardTruck(modelDef: any, customSettings: TruckViewSettings): Promise<void> {
        this.settings = { ...this.settings, ...customSettings };
        const fullModel = (await ModelLoaderManager.instance.loadModel(modelDef.fullPath, modelDef.id)).clone();

        MaterialUtils.applyToModel(fullModel, MaterialUtils.convertToToon);

        // 1. Create the Master Pivot
        this.carPivot = new THREE.Group();
        this.threeScene.add(this.carPivot);

        // 2. Create and setup the Visual Wrapper (The original model)
        const visualWrapper = fullModel.clone();
        visualWrapper.scale.setScalar(this.settings.scale);
        visualWrapper.rotation.y = this.settings.visualRotationY;

        // We add it to the scene temporarily to calculate world matrices
        this.carPivot.add(visualWrapper);
        visualWrapper.updateMatrixWorld(true);

        // 3. Setup Containers
        this.carPivot.add(this.chassisContainer);
        this.carPivot.add(this.wheelsContainer);

        // 4. Move the Wheels to the Wheels Container
        const wheelConfigs = [
            { name: this.settings.nodes.frontLeft, type: TruckPart.FRONT_WHEEL },
            { name: this.settings.nodes.frontRight, type: TruckPart.FRONT_WHEEL },
            { name: this.settings.nodes.backLeft, type: TruckPart.BACK_WHEEL },
            { name: this.settings.nodes.backRight, type: TruckPart.BACK_WHEEL },
        ];

        wheelConfigs.forEach(config => {
            const wheelMesh = ModelLoaderManager.instance.findNode(visualWrapper, config.name);
            if (wheelMesh) {
                // 1. Create a neutral pivot at the wheel's world position
                const wheelPivot = new THREE.Group();
                this.wheelsContainer.attach(wheelPivot); // Move pivot to wheel's world position

                // 2. Align pivot position to the mesh, then reset mesh local position
                wheelPivot.position.copy(wheelMesh.getWorldPosition(new THREE.Vector3()));

                // 3. Attach the mesh to the pivot
                wheelPivot.add(wheelMesh);
                wheelMesh.scale.setScalar(this.settings.wheelScale);
                wheelMesh.rotation.y = this.settings.visualRotationY;
                wheelMesh.position.set(0, 0, 0); // Center the mesh inside the pivot

                // 4. Store the PIVOT, not the mesh, for rotation
                this.wheelRefs.set(config.name, { mesh: wheelPivot, type: config.type });
            }
        });

        // 5. Move the Chassis to the Chassis Container
        const chassisMesh = ModelLoaderManager.instance.findNode(visualWrapper, this.settings.nodes.chassis);
        if (chassisMesh) {
            this.chassisContainer.attach(chassisMesh);
        } else {
            // If no specific chassis node is found, move the remaining wrapper parts
            this.chassisContainer.add(visualWrapper);
        }
    }

    public update(): void {
        const chassisPart = this.truck.getPart(TruckPart.CHASSIS);

        // 1. Update the Main Pivot (Position and Tilt)
        if (this.carPivot && chassisPart) {
            this.carPivot.position.set(
                chassisPart.transform.position.x,
                -chassisPart.transform.position.y,
                0
            );
            this.carPivot.rotation.z = -chassisPart.transform.rotation;
        }

        // 2. Update Wheel Rotations
        this.wheelRefs.forEach((ref) => {
            const physicsPart = this.truck.getPart(ref.type);
            if (physicsPart) {
                ref.mesh.rotation.z = -physicsPart.transform.rotation;
            }
        });
    }

    public destroy(): void {
        if (this.carPivot) {
            this.threeScene.remove(this.carPivot);
            // Dispose geometries/materials here as you did before
        }
        this.wheelRefs.clear();
    }
}