import { Bodies, Vertices } from 'matter-js';
import * as THREE from 'three';
import { MaterialUtils } from '../../environment/MaterialUtils';
import { LevelConfig, LevelObject } from '../level/LevelTypes';
import { CarEntity } from '../truck/CarEntity';
import { BendService } from './BendService';

export class LevelViewService3D {
    private meshes: Set<THREE.Mesh> = new Set();
    private container: THREE.Group;
    private car?: CarEntity;
    private readonly DEPTH = 100; // How "thick" the 3D objects are
    private readonly SEGMENT_DENSITY = 50;

    private readonly SHOW_SENSORS = true; // Set to true so we can filter selectively
    private readonly INVISIBLE_LABELS = new Set(['deadzone', 'start_node']);

    constructor(private scene: THREE.Scene, car: CarEntity) {
        this.container = new THREE.Group();
        this.scene.add(this.container);
    }

    public buildLevel(config: LevelConfig, car: CarEntity): void {
        this.clear();

        this.car = car;
        config.objects.forEach(obj => {
            // 1. QUICK FILTER: Check if this specific object should be ignored by the view
            if (this.shouldSkipRendering(obj)) return;

            const mesh = this.createMesh(obj);
            if (mesh) {
                mesh.position.set(obj.x, -obj.y, 0);
                this.container.add(mesh);
                this.meshes.add(mesh);
            }
        });
    }
    private shouldSkipRendering(obj: LevelObject): boolean {
        // If it's a sensor type and global sensor rendering is off
        if (obj.type === 'sensor' && !this.SHOW_SENSORS) return true;

        // If the label is in our "do not render" list
        if (obj.label && this.INVISIBLE_LABELS.has(obj.label)) return true;

        return false;
    }
    private createMesh(obj: LevelObject): THREE.Mesh | null {
        let geometry: THREE.BufferGeometry;
        const color = obj.debugColor || obj.color || 0x7CFF01;

        // Determine if it's a sensor for material properties later
        const isSensor = obj.type === 'sensor';

        switch (obj.type) {
            case 'sensor':
            case 'box':
                const width = obj.width || 100;
                const height = obj.height || 100;
                const segmentsW = Math.max(1, Math.floor(width / this.SEGMENT_DENSITY));
                const segmentsH = Math.max(1, Math.floor(height / this.SEGMENT_DENSITY));

                geometry = new THREE.BoxGeometry(
                    width, height, this.DEPTH,
                    segmentsW, segmentsH, 1
                );
                break;

            case 'circle':
                const depthSegments = Math.max(1, Math.floor(this.DEPTH / this.SEGMENT_DENSITY));
                geometry = new THREE.CylinderGeometry(
                    obj.radius || 30,
                    obj.radius || 30,
                    this.DEPTH,
                    32,
                    depthSegments
                );
                // Bake the rotation into geometry vertices so the bend shader
                // sees them already oriented correctly in world space.
                geometry.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
                break;

            case 'polygon':
                if (!obj.vertices || obj.vertices.length < 3) return null;

                // 1. Create a dummy body to get the Matter-calculated vertices
                // Matter.js shifts vertices to center them around the mass center
                const tempBody = Bodies.fromVertices(0, 0, [obj.vertices]);

                // 2. Map those vertices to local coordinates relative to the body position
                const centroid = Vertices.centre(obj.vertices as any);

                const relativeVertices = tempBody.vertices.map(v => ({
                    x: v.x - tempBody.position.x + centroid.x,
                    y: v.y - tempBody.position.y + centroid.y
                }));



                // 3. Build geometry using these specific offsets
                geometry = this.createPolygonGeometry(relativeVertices);

                // CRITICAL: DO NOT use geometry.center() here anymore. 
                // The vertices are already centered by Matter-js logic.
                break;

            default:
                return null;
        }

        const material = new THREE.MeshStandardMaterial({
            color: color,
            transparent: isSensor,
            opacity: isSensor ? 0.3 : 1.0
        });

        const mesh = new THREE.Mesh(geometry, material);

        // 1. APPLY TOON FIRST (This creates a new material)
        MaterialUtils.applyToModel(mesh, MaterialUtils.convertToToon);

        // 2. APPLY BEND TO THE NEW MATERIAL(S)
        mesh.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
                const m = child as THREE.Mesh;
                if (Array.isArray(m.material)) {
                    m.material.forEach(mat => BendService.applyBend(mat));
                } else {
                    BendService.applyBend(m.material);
                }
            }
        });


        return mesh;
    }

    private createPolygonGeometry(vertices: { x: number, y: number }[]): THREE.ExtrudeGeometry {
        const shape = new THREE.Shape();

        // Vertices are already relative to the center of mass
        shape.moveTo(vertices[0].x, -vertices[0].y);
        for (let i = 1; i < vertices.length; i++) {
            shape.lineTo(vertices[i].x, -vertices[i].y);
        }
        shape.closePath();

        const extrudeSteps = Math.max(1, Math.floor(this.DEPTH / this.SEGMENT_DENSITY));
        return new THREE.ExtrudeGeometry(shape, {
            depth: this.DEPTH,
            steps: extrudeSteps,
            bevelEnabled: true,
            bevelThickness: 2,
            bevelSize: 2,
            bevelSegments: 3,
            // We set the depth to be centered on Z by moving the extrusion back
            // ExtrudeGeometry extrudes from 0 to DEPTH, so we offset by -DEPTH/2
        }).translate(0, 0, -this.DEPTH / 2);
    }
    // In your Main Game Loop / Update
    update(delta: number) {
        // 1. Get your truck's current position
        if (this.car) {
            const truckPos = this.car.body.position;
            // 2. Update the shader origin
            // Note: We map 2D physics (x, y) to 3D (x, -y, 0) just like your buildLevel does
            BendService.updateOrigin(new THREE.Vector3(truckPos.x, -truckPos.y, 0));
        }
    }

    public clear(): void {
        this.meshes.forEach(mesh => {
            mesh.geometry.dispose();
            (mesh.material as THREE.Material).dispose();
            this.container.remove(mesh);
        });
        this.meshes.clear();
    }
}