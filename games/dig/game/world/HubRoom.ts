// HubRoom.ts
//
// Builds the miner's hub from levels/hub.json with pizza's room builders, the same way
// bandit-controller builds its levels: checker floor, walls with their openings (the doorways out into
// the rock) and static colliders, decor props, and the stations — a glowing pad in front of the
// station's model (the ATM, the artifact totem, the wardrobe closet) with a floating icon, so they're easy
// to spot from anywhere in the hub, and a bouncing "!" when there's something new to check there.

import * as THREE from 'three';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import type World from '../ecs/World';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import { BendService } from '../services/BendService';
import { PolyWallBuilder } from '../builders/PolyWallBuilder';
import { CheckerFloorBuilder } from '../builders/CheckerFloorBuilder';
import type { StoreWallPlacement, WallSetupConfig, WallStyleConfig, FloorCheckerConfig } from './RoomTypes';
import { HUB, HubStation, StationKind, hubRects } from '../data/HubData';

const ORIGIN = new THREE.Vector3();
const WALL_SETUP: WallSetupConfig = { height: 2.2, thickness: 0.3, doorHeight: 2, tallDoorHeight: 2.2, windowHeight: 1 };
const WALL_STYLE: WallStyleConfig = { bottomColor: '#5d4030', topColor: '#c49a6c', bottomHeight: 0.8 };
const FLOOR: FloorCheckerConfig = { colorA: '#d9c29b', colorB: '#c9ae84', scale: 1 };
const MODEL_BASE = './dig/models/';

/** Each station: pad colour, icon, and its model (path under models/, height, raised on a pedestal). */
export const STATION_LOOK: Record<StationKind, { color: number; icon: string; label: string; model: string; height: number; pedestal: number }> = {
    atm: { color: 0x3fd16b, icon: '$', label: 'ATM', model: 'mine/atm-01.glb', height: 2.1, pedestal: 0 },
    collection: { color: 0xf4b400, icon: '★', label: 'COLLECTION', model: 'mine/idol-a.glb', height: 1.4, pedestal: 0.8 },
    wardrobe: { color: 0xe266c8, icon: '♥', label: 'WARDROBE', model: 'mine/closet-01.glb', height: 2.2, pedestal: 0 },
};

/** Station pads are this wide; standing on one uses the station. */
export const STATION_RADIUS = 1.3;
/** The station's model stands this far north of the pad's centre. */
const STATION_MODEL_OFFSET = STATION_RADIUS + 0.25;

interface StationParts {
    ring: THREE.Mesh;
    pad: THREE.MeshStandardMaterial;
    pulse: number;
    icon: THREE.Sprite;
    iconY: number;
    attention: THREE.Sprite;
    /** Where things handed to the station (sold items) fly to. */
    target: THREE.Vector3;
}

function iconTexture(text: string, color: number): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const g = canvas.getContext('2d')!;
    g.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    g.beginPath();
    g.arc(64, 64, 58, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = '#ffffff';
    g.stroke();
    g.fillStyle = '#ffffff';
    g.font = 'bold 72px Arial';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 64, 70);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

export class HubRoom {
    private readonly objects: THREE.Object3D[] = [];
    private readonly stations = new Map<StationKind, StationParts>();
    private time = 0;

    public constructor(private readonly threeScene: THREE.Scene, private readonly world: World) {
        for (const rect of hubRects()) {
            this.add(CheckerFloorBuilder.build({ ...rect, rotationY: 0, tileSize: 1 }, ORIGIN, FLOOR));
        }
        for (const levelWall of HUB.walls) {
            const wall: StoreWallPlacement = {
                closed: levelWall.closed,
                points: levelWall.points.map((p) => ({ x: p.x, z: p.z })),
                openings: levelWall.openings.map((o) => ({ kind: o.kind, rect: { minX: o.minX, maxX: o.maxX, minZ: o.minZ, maxZ: o.maxZ } })),
            };
            this.add(PolyWallBuilder.build(wall, ORIGIN, WALL_SETUP, WALL_STYLE));
            for (const box of PolyWallBuilder.colliderBoxes(wall, WALL_SETUP)) {
                this.collider(box.x, box.z, box.halfX, WALL_SETUP.height / 2, box.halfZ);
            }
        }
        for (const prop of HUB.props) {
            void this.placeProp(prop.model, prop.x, prop.z, prop.rotationY, prop.height, prop.elevation ?? 0);
            if (prop.collider) {
                this.collider(prop.x, prop.z, prop.collider.halfX, prop.collider.halfY, prop.collider.halfZ);
            }
        }
        for (const station of HUB.stations) {
            this.buildStation(station);
        }
    }

    private add<T extends THREE.Object3D>(object: T): T {
        this.threeScene.add(object);
        this.objects.push(object);
        return object;
    }

    private collider(x: number, z: number, halfX: number, halfY: number, halfZ: number): void {
        const entity = this.world.spawn();
        entity.transform.position.set(x, 0, z);
        entity.addComponent(new RigidBody({
            halfExtents: new THREE.Vector3(halfX, halfY, halfZ),
            centerOffset: new THREE.Vector3(0, halfY, 0),
            isStatic: true,
            layer: Layers.Environment,
        }));
    }

    private material(color: number, emissive = 0): THREE.MeshStandardMaterial {
        const material = new THREE.MeshStandardMaterial({ color, emissive, roughness: 0.6 });
        BendService.applyBend(material);
        return material;
    }

    private buildStation(station: HubStation): void {
        const look = STATION_LOOK[station.kind];
        const pad = this.add(new THREE.Mesh(new THREE.CylinderGeometry(STATION_RADIUS, STATION_RADIUS, 0.06, 40), this.material(look.color, look.color)));
        (pad.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.35;
        pad.position.set(station.x, 0.03, station.z);
        const ring = this.add(new THREE.Mesh(new THREE.TorusGeometry(STATION_RADIUS, 0.07, 8, 48), this.material(0xffffff, 0xffffff)));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(station.x, 0.08, station.z);
        const modelX = station.x;
        const modelZ = station.z - STATION_MODEL_OFFSET;
        if (look.pedestal > 0) {
            const pedestal = this.add(new THREE.Mesh(new THREE.BoxGeometry(0.9, look.pedestal, 0.9), this.material(0x4a3a30)));
            pedestal.position.set(modelX, look.pedestal / 2, modelZ);
        }
        void this.placeProp(look.model, modelX, modelZ, 0, look.height, look.pedestal);
        this.collider(modelX, modelZ, 0.5, (look.pedestal + look.height) / 2, 0.45);
        const top = look.pedestal + look.height;
        const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture(look.icon, look.color), depthWrite: false }));
        icon.scale.setScalar(1.1);
        icon.position.set(modelX, top + 0.7, modelZ);
        this.add(icon);
        const attention = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture('!', 0xff3b30), depthWrite: false, depthTest: false }));
        attention.scale.setScalar(0.9);
        attention.renderOrder = 5;
        attention.visible = false;
        this.add(attention);
        this.stations.set(station.kind, {
            ring, pad: pad.material as THREE.MeshStandardMaterial, pulse: 0, icon, iconY: top + 0.7, attention,
            target: new THREE.Vector3(modelX, Math.min(top - 0.3, 1.3), modelZ + 0.35),
        });
    }

    /** Flashes a station's pad (an item landed on the ATM). */
    public pulse(kind: StationKind): void {
        const station = this.stations.get(kind);
        if (station) station.pulse = 1;
    }

    /** Shows/hides the bouncing "!" over a station: something new to check there. */
    public setAttention(kind: StationKind, on: boolean): void {
        const station = this.stations.get(kind);
        if (station) station.attention.visible = on;
    }

    /** Where items handed to a station fly (the ATM's slot). */
    public stationTarget(kind: StationKind): THREE.Vector3 | undefined {
        return this.stations.get(kind)?.target.clone();
    }

    private async placeProp(model: string, x: number, z: number, rotationY: number, height: number, elevation: number): Promise<void> {
        try {
            const object = await ModelLoaderManager.instance.loadModel(`${MODEL_BASE}${model}`);
            object.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    child.material = Array.isArray(child.material) ? child.material.map((m) => m.clone()) : child.material.clone();
                    (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => BendService.applyBend(m));
                }
            });
            object.updateMatrixWorld(true);
            const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
            if (size.y > 1e-4) object.scale.multiplyScalar(height / size.y);
            object.rotation.y = rotationY;
            object.updateMatrixWorld(true);
            const bounds = new THREE.Box3().setFromObject(object);
            object.position.set(x, elevation - bounds.min.y, z);
            this.add(object);
        } catch (error) {
            console.warn(`[HubRoom] could not load prop ${model}`, error);
        }
    }

    /** Bobs the station icons, bounces the "!" marks and settles pad flashes. */
    public update(delta: number): void {
        this.time += delta;
        let i = 0;
        for (const station of this.stations.values()) {
            station.icon.position.y = station.iconY + Math.sin(this.time * 2.4 + i++) * 0.12;
            if (station.attention.visible) {
                // A quick hop every second, so it reads as "come here" rather than idle bobbing.
                const hop = Math.abs(Math.sin(this.time * Math.PI));
                station.attention.position.set(station.icon.position.x + 0.75, station.iconY + 0.55 + hop * 0.4, station.icon.position.z);
                station.attention.scale.set(0.9, 0.9 * (0.9 + hop * 0.15), 1);
            }
            station.pulse = Math.max(0, station.pulse - delta * 5);
            station.ring.scale.setScalar(1 + station.pulse * 0.12);
            // The pad glows along with the "!", so the station reads as "use me" from across the hub.
            station.pad.emissiveIntensity = 0.35 + station.pulse * 0.9 + (station.attention.visible ? Math.abs(Math.sin(this.time * Math.PI)) * 0.35 : 0);
        }
    }

    public destroy(): void {
        for (const object of this.objects) {
            object.removeFromParent();
        }
    }
}
