import ModelLoaderManager from '@core/three/ModelLoaderManager';
import * as THREE from 'three';
import { MaterialUtils } from '../../environment/MaterialUtils';
import { CarEntity, CarPart } from "../truck/CarEntity";

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
    // The chassis pivot is driven only by the chassis physics body
    private chassisPivot: THREE.Group | null = null;

    // Each wheel pivot is a ROOT-level scene object, NOT parented to chassisPivot.
    // This means the chassis tilting/bouncing has zero effect on wheel transforms.
    private wheelRefs: Map<string, { pivot: THREE.Group, type: CarPart }> = new Map();

    private settings: Required<TruckViewSettings> = {
        visualRotationY: Math.PI / 2,
        scale: 1,
        wheelScale: 1,
        nodes: { chassis: '', frontLeft: '', frontRight: '', backLeft: '', backRight: '' }
    };

    constructor(
        private truck: CarEntity,
        private threeScene: THREE.Scene
    ) { }

    public async buildStandardTruck(modelDef: any, customSettings: TruckViewSettings): Promise<void> {
        this.settings = { ...this.settings, ...customSettings };

        const fullModel = (await ModelLoaderManager.instance.loadModel(modelDef.fullPath, modelDef.id)).clone();
        MaterialUtils.applyToModel(fullModel, MaterialUtils.convertToUnlit);

        // Staging group — only used to read world positions, never kept in the scene
        const stagingGroup = new THREE.Group();
        stagingGroup.scale.setScalar(this.settings.scale);
        stagingGroup.rotation.y = this.settings.visualRotationY;
        this.threeScene.add(stagingGroup);
        stagingGroup.add(fullModel);
        stagingGroup.updateMatrixWorld(true);

        // ── Wheels FIRST ─────────────────────────────────────────────────────────
        // Wheels must be extracted BEFORE the chassis bounding box is measured,
        // otherwise the wheel geometry inflates the chassis bounds and the
        // bottom-alignment will be wrong.
        const wheelConfigs = [
            { name: this.settings.nodes.frontLeft, type: CarPart.FRONT_WHEEL },
            { name: this.settings.nodes.frontRight, type: CarPart.FRONT_WHEEL },
            { name: this.settings.nodes.backLeft, type: CarPart.BACK_WHEEL },
            { name: this.settings.nodes.backRight, type: CarPart.BACK_WHEEL },
        ];

        wheelConfigs.forEach(config => {
            const wheelMesh = ModelLoaderManager.instance.findNode(fullModel, config.name);
            if (!wheelMesh) return;

            // Read world position while still in staging (correct scale + rotation)
            const worldPos = wheelMesh.getWorldPosition(new THREE.Vector3());

            // Create an independent pivot at the scene root — NOT under chassisPivot
            const wheelPivot = new THREE.Group();
            this.threeScene.add(wheelPivot);

            // attach() re-parents while preserving world transform
            wheelPivot.attach(wheelMesh);

            // Zero X and Y (physics owns those via the pivot each frame),
            // but KEEP the original Z so left/right wheels stay separated.
            wheelMesh.position.set(0, 0, worldPos.z);
            wheelMesh.scale.setScalar(this.settings.wheelScale);
            wheelMesh.rotation.y = this.settings.visualRotationY;

            this.wheelRefs.set(config.name, { pivot: wheelPivot, type: config.type });
        });

        // ── Chassis AFTER wheels are gone ────────────────────────────────────────
        this.chassisPivot = new THREE.Group();
        this.threeScene.add(this.chassisPivot);

        const chassisMesh = ModelLoaderManager.instance.findNode(fullModel, this.settings.nodes.chassis) ?? fullModel;

        // At this point the wheel meshes are already detached, so this bounding
        // box reflects only the chassis body geometry.
        chassisMesh.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(chassisMesh);

        // We want the pivot to sit at the BOTTOM-CENTER of the chassis so that
        // the physics body position (which is also at the bottom/center) lines up
        // with the visual correctly.
        const bottomY = box.min.y;
        const centerX = (box.min.x + box.max.x) / 2;

        // Attach to the pivot (preserves world transform)
        this.chassisPivot.attach(chassisMesh);

        // Shift the mesh so its bottom-center sits at the pivot origin (0,0,0).
        // The pivot itself is then repositioned each frame by the physics body.
        chassisMesh.position.x -= centerX;
        chassisMesh.position.y -= bottomY * 3;

        // Clean up the now-empty staging group
        this.threeScene.remove(stagingGroup);
    }

    public update(): void {
        // ── Chassis ──────────────────────────────────────────────────────────────
        const chassisPart = this.truck.getPart(CarPart.CHASSIS);
        if (this.chassisPivot && chassisPart) {
            this.chassisPivot.position.set(
                chassisPart.transform.position.x,
                -chassisPart.transform.position.y,
                0
            );
            this.chassisPivot.rotation.z = -chassisPart.transform.rotation;
        }

        // ── Wheels ───────────────────────────────────────────────────────────────
        // Each wheel pivot is driven directly by its own physics body transform.
        // No inheritance from the chassis whatsoever.
        this.wheelRefs.forEach((ref) => {
            const physicsPart = this.truck.getPart(ref.type);
            if (!physicsPart) return;

            ref.pivot.position.set(
                physicsPart.transform.position.x,
                -physicsPart.transform.position.y,
                0
            );
            ref.pivot.rotation.z = -physicsPart.transform.rotation;
        });
    }

    public destroy(): void {
        if (this.chassisPivot) {
            this.threeScene.remove(this.chassisPivot);
        }

        this.wheelRefs.forEach((ref) => {
            this.threeScene.remove(ref.pivot);
        });
        this.wheelRefs.clear();
    }
}
