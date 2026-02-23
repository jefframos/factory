import { PhysicsBodyFactory } from '@core/phyisics/core/PhysicsBodyFactory';
import * as THREE from 'three';
import { MaterialUtils } from '../../environment/MaterialUtils';
import { LevelConfig, LevelObject } from '../level/LevelTypes';
import { CarEntity } from '../truck/CarEntity';
import { BendService } from './BendService';
import { GeometryFactory3D } from './GeometryFactory3D';
import { StyleService } from './StyleService';

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
    private createMesh(obj: LevelObject): THREE.Object3D | null {
        let rootObject: THREE.Object3D;
        const color = obj.debugColor || obj.color || 0x7CFF01;
        const isSensor = obj.type === 'sensor';

        // Use a property from LevelObject, or default to smooth
        const isSmooth = obj.isSmooth !== undefined ? obj.isSmooth : true;

        switch (obj.type) {
            case 'sensor':
            case 'box': {
                const geometry = GeometryFactory3D.createBox(obj.width || 100, obj.height || 100, this.DEPTH, isSmooth);
                const material = new THREE.MeshStandardMaterial({ color, transparent: isSensor, opacity: isSensor ? 0.3 : 1.0 });
                rootObject = new THREE.Mesh(geometry, material);
                break;
            }

            case 'circle': {
                const geometry = GeometryFactory3D.createCircle(obj.radius || 30, this.DEPTH, isSmooth);
                const material = new THREE.MeshStandardMaterial({ color, transparent: isSensor, opacity: isSensor ? 0.3 : 1.0 });
                rootObject = new THREE.Mesh(geometry, material);
                break;
            }

            case 'polygon': {
                if (!obj.vertices || obj.vertices.length < 3) return null;
                const physicsData = PhysicsBodyFactory.createPolygon(obj.x, obj.y, obj.vertices);
                const group = new THREE.Group();

                physicsData.decomposedParts.forEach(partVertices => {
                    const geometry = GeometryFactory3D.createPolygon(partVertices, this.DEPTH, isSmooth);
                    const material = new THREE.MeshStandardMaterial({ color, transparent: isSensor, opacity: isSensor ? 0.3 : 1.0 });
                    group.add(new THREE.Mesh(geometry, material));
                });
                rootObject = group;
                break;
            }
            default: return null;
        }

        // Apply Shaders
        MaterialUtils.applyToModel(rootObject, MaterialUtils.convertToUnlit);
        rootObject.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
                const mat = (child as THREE.Mesh).material as THREE.Material;
                StyleService.applyStyle(mat);
                BendService.applyBend(mat);
            }
        });

        return rootObject;
    }

    private createPolygonGeometry(vertices: { x: number, y: number }[], radius: number = 10): THREE.ExtrudeGeometry {
        const shape = new THREE.Shape();
        const len = vertices.length;

        // We use a helper to draw the path with rounded corners
        // Note: We flip Y to -Y to match your coordinate mapping
        for (let i = 0; i < len; i++) {
            const p1 = vertices[i];
            const p2 = vertices[(i + 1) % len];
            const p3 = vertices[(i + 2) % len];

            // 1. Calculate the vectors for the two edges meeting at p2
            const v1x = p1.x - p2.x;
            const v1y = -p1.y - (-p2.y);
            const v2x = p3.x - p2.x;
            const v2y = -p3.y - (-p2.y);

            // 2. Normalize and apply radius
            const d1 = Math.sqrt(v1x * v1x + v1y * v1y);
            const d2 = Math.sqrt(v2x * v2x + v2y * v2y);

            // Ensure radius isn't larger than half the edge length
            const r = Math.min(radius, d1 / 2, d2 / 2);

            const startX = p2.x + (v1x / d1) * r;
            const startY = -p2.y + (v1y / d1) * r;
            const endX = p2.x + (v2x / d2) * r;
            const endY = -p2.y + (v2y / d2) * r;

            // 3. Draw to the start of the curve, then curve to the end of the corner
            if (i === 0) shape.moveTo(startX, startY);
            else shape.lineTo(startX, startY);

            shape.quadraticCurveTo(p2.x, -p2.y, endX, endY);
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
        }).translate(0, 0, -this.DEPTH / 2);
    }
    private createPolygonGeometrySimple(vertices: { x: number, y: number }[]): THREE.ExtrudeGeometry {
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