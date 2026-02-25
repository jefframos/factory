import { BasePhysicsEntity } from '@core/phyisics/entities/BaseEntity';
import * as THREE from 'three';
import { ThreeEntityWrapper } from '../input/ThreeEntityWrapper';
import { LevelConfig, LevelObject } from '../level/LevelTypes';
import { CarEntity } from '../truck/CarEntity';
import { BendService } from './BendService';
import { ColorPaletteService } from './ColorPaletteService';
import { GeometryFactory3D } from './GeometryFactory3D';
import { InteractionService3D } from './InteractionService3D';
import { StyleService } from './StyleService';


export class LevelViewService3D {
    private wrappers: Map<number, ThreeEntityWrapper> = new Map();
    private container: THREE.Group;
    private car?: CarEntity;

    private readonly DEPTH = 100;
    private readonly SHOW_SENSORS = true;
    private readonly INVISIBLE_LABELS = new Set(['deadzone', 'start_node']);

    private readonly COIN_DEPTH = 20; // Fixed depth for coins
    private readonly CARGO_DEPTH = 40; // Fixed depth for cargo pickups

    constructor(private scene: THREE.Scene) {
        this.container = new THREE.Group();
        this.scene.add(this.container);
    }

    /**
     * Builds the 3D world by mapping physics entities to 3D meshes.
     * @param config The level data (colors, smoothness, interaction defs)
     * @param physicsEntities The live physics objects created by LevelService
     */
    public buildLevel(config: LevelConfig, car: CarEntity, physicsEntities: BasePhysicsEntity[]): void {
        this.clear();
        this.car = car;

        // Reset Interaction Service registry
        InteractionService3D.clear();

        // We iterate through objects. Logic: physicsEntities[i] corresponds to config.objects[i]
        config.objects.forEach((obj, index) => {
            if (this.shouldSkipRendering(obj)) return;

            // Find the matching physics entity
            const entity = physicsEntities[index];
            if (!entity) return;

            const mesh = this.createMesh(obj);
            if (mesh) {
                // 1. Create the sync wrapper
                const wrapper = new ThreeEntityWrapper(entity.body, mesh);
                this.container.add(mesh);
                this.wrappers.set(entity.body.id, wrapper);

                // 2. Link for Visual Animations (Bounces/Flashes)
                InteractionService3D.link(entity.body.id, mesh);

                // 3. Register Interaction trigger logic
                if (obj.interaction) {
                    InteractionService3D.register(entity.body, obj.interaction);
                }
            }
        });
    }

    private shouldSkipRendering(obj: LevelObject): boolean {
        if (obj.type === 'sensor' && !this.SHOW_SENSORS) return true;
        if (obj.label && this.INVISIBLE_LABELS.has(obj.label)) return true;
        return false;
    }

    private createMesh(obj: LevelObject): THREE.Object3D | null {
        let rootObject: THREE.Object3D;

        // Use View3DDefinition if available, else fallback to standard properties
        const view = obj.view3d || {};
        const color = ColorPaletteService.resolveViewColor(view, obj.color || 0x7CFF01);
        const isSmooth = view.isSmooth ?? true;
        const isSensor = obj.type === 'sensor';

        if (obj.collectible) {
            if (obj.collectible.type === 'coin') {
                const geometry = GeometryFactory3D.createCircle(obj.radius || 20, this.COIN_DEPTH, isSmooth);
                const material = new THREE.MeshStandardMaterial({ color, metalness: 0.8, roughness: 0.2 });
                rootObject = new THREE.Mesh(geometry, material);
                // Mark for rotation in update loop
                rootObject.userData.isCoin = true;
                return this.applyShaders(rootObject);
            }

            if (obj.collectible.type === 'cargo') {
                const geometry = GeometryFactory3D.createBox(obj.width || 40, obj.height || 40, this.CARGO_DEPTH, isSmooth);
                const material = new THREE.MeshStandardMaterial({ color });
                rootObject = new THREE.Mesh(geometry, material);
                return this.applyShaders(rootObject);
            }
        }

        switch (obj.type) {
            case 'sensor':
            case 'box': {
                const geometry = GeometryFactory3D.createBox(obj.width || 100, obj.height || 100, this.DEPTH, isSmooth);
                const material = new THREE.MeshStandardMaterial({
                    color,
                    transparent: isSensor || view.opacity !== undefined,
                    opacity: view.opacity ?? (isSensor ? 0.3 : 1.0)
                });
                rootObject = new THREE.Mesh(geometry, material);
                break;
            }

            case 'circle': {
                const geometry = GeometryFactory3D.createCircle(obj.radius || 30, this.DEPTH, isSmooth);
                const material = new THREE.MeshStandardMaterial({
                    color,
                    transparent: isSensor || view.opacity !== undefined,
                    opacity: view.opacity ?? (isSensor ? 0.3 : 1.0)
                });
                rootObject = new THREE.Mesh(geometry, material);
                break;
            }

            case 'polygon': {
                if (!obj.vertices || obj.vertices.length < 3) return null;
                const group = new THREE.Group();

                // We assume physics provides decomposed parts for concave shapes
                // For simplicity here, we create one geometry from the vertices
                const geometry = GeometryFactory3D.createPolygon(obj.vertices, this.DEPTH, isSmooth);
                const material = new THREE.MeshStandardMaterial({
                    color,
                    transparent: isSensor || view.opacity !== undefined,
                    opacity: view.opacity ?? (isSensor ? 0.3 : 1.0)
                });
                group.add(new THREE.Mesh(geometry, material));
                rootObject = group;
                break;
            }
            default: return null;
        }

        // Apply Shaders & Post-processing
        //wMaterialUtils.applyToModel(rootObject, MaterialUtils.convertToToon);
        rootObject.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
                const mat = (child as THREE.Mesh).material as THREE.Material;
                StyleService.applyStyle(mat);
                BendService.applyBend(mat);
            }
        });



        return rootObject;
    }

    private applyShaders(rootObject: THREE.Object3D): THREE.Object3D {
        rootObject.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
                const mat = (child as THREE.Mesh).material as THREE.Material;
                StyleService.applyStyle(mat);
                BendService.applyBend(mat);
            }
        });
        return rootObject;
    }

    /**
     * Call this in your main game loop
     */
    public update(delta: number): void {
        const toRemove: number[] = [];

        this.wrappers.forEach((wrapper, bodyId) => {
            // Matter.js safety check: 
            // If the body exists but parts are momentarily empty during a build, don't kill it.
            // We only kill it if the body specifically lacks the 'id' or has been destroyed.
            if (!wrapper.isAlive) {
                toRemove.push(bodyId);
                return;
            }

            wrapper.sync();

            if (wrapper.mesh.userData.isCoin) {
                // Standard spinning (delta is usually in ms, so adjust speed)
                wrapper.mesh.rotation.y += delta * 0.002;
            }
        });

        // Remove dead meshes
        for (const id of toRemove) {
            this.removeWrapper(id);
        }

        if (this.car) {
            const truckPos = this.car.body.position;
            BendService.updateOrigin(new THREE.Vector3(truckPos.x, -truckPos.y, 0));
        }
    }

    private removeWrapper(bodyId: number): void {
        const wrapper = this.wrappers.get(bodyId);
        if (wrapper) {
            wrapper.dispose(); // This handles Three.js cleanup
            this.wrappers.delete(bodyId);
            console.log(`[3D] Cleaned up mesh for destroyed body ${bodyId}`);
        }
    }

    public clear(): void {
        this.wrappers.forEach(wrapper => {
            wrapper.dispose();
            this.container.remove(wrapper.mesh);
        });
        this.wrappers.clear();
    }
}