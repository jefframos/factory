import { ThreeScene } from 'core/scene/ThreeScene';
import * as THREE from 'three';
import { CollectibleManager } from '../systems/CollectibleManager';
import { BoundlessChunkManager } from '../world/BoundlessChunkManager';
import { deriveWaterTones, getDefaultIsland, parseHexColor, resolveIslandImagePath } from '../world/IslandStorage';
import { TextureBuilder } from '../builders/TextureBuilder';
import { createWaterMaterial } from '../builders/WaterMaterial';
import { ROOM_GEOMETRY } from '../world/MeshConfig';
import type { PlayerEntity } from '../entities/PlayerEntity';

/**
 * A static preview scene: renders one island's terrain with no player,
 * NPCs, or UI. BoundlessChunkManager only reads position/collisionRadius
 * off the "player" it's given, so a plain stand-in origin point is enough
 * to stream in the chunks around (0, 0) — no PlayerEntity is ever spawned.
 */
const VIEW_ORIGIN = { position: new THREE.Vector3(0, 0, 0), collisionRadius: 1 } as PlayerEntity;

// ── Camera setup — tweak these to frame the shot ───────────────────────────
// yaw: degrees around Y, 0 = looking from +Z. pitch: degrees above the horizon
// (0 = level, 90 = straight down). distance: units from focusPoint to camera.
// Island terrain is only ~1 unit tall above the water line, so a shallow pitch
// and closer distance reads much better than a steep top-down view.
const CAMERA_YAW_DEG = 0;
const CAMERA_PITCH_DEG = 28;
const CAMERA_DISTANCE = 38;
const FOCUS_POINT = new THREE.Vector3(0, 0, 0);

export default class IslandViewScene extends ThreeScene {
    private collectibles!: CollectibleManager;
    private chunkManager!: BoundlessChunkManager;
    private waterMesh!: THREE.Mesh;
    private waterMat!: THREE.Material;

    public async build(): Promise<void> {
        const island = getDefaultIsland();
        await TextureBuilder.loadRealIsland(resolveIslandImagePath(island.texture));

        this.threeScene.background = new THREE.Color(parseHexColor(island.skyColor));
        this.threeScene.add(this.threeCamera);

        this.threeScene.add(new THREE.AmbientLight(parseHexColor(island.ambientColor), 0.9));
        const key = new THREE.DirectionalLight(0xfff4dd, 1.6);
        key.position.set(5, 10, 7.5);
        this.threeScene.add(key);
        const fill = new THREE.DirectionalLight(0x99ccff, 0.5);
        fill.position.set(-8, 3, -5);
        this.threeScene.add(fill);

        this.waterMesh = this.buildWater(island.waterColor);

        this.collectibles = new CollectibleManager();
        this.chunkManager = new BoundlessChunkManager(this.threeScene, this.collectibles);
        // BoundlessChunkManager caps builds at MAX_BUILDS_PER_FRAME per call (it
        // expects update() every frame during real gameplay, draining the queue
        // over time). This scene only builds once, so drive it enough times up
        // front to flush every chunk in the view radius immediately.
        for (let i = 0; i < 30; i++) this.chunkManager.update(VIEW_ORIGIN);

        // Centered on the origin chunk's island — that chunk always has land
        // (see BoundlessChunk's isOrigin check), so this framing is guaranteed
        // to show island + surrounding water regardless of seed.
        const yaw = CAMERA_YAW_DEG * Math.PI / 180;
        const pitch = CAMERA_PITCH_DEG * Math.PI / 180;
        const horizontal = CAMERA_DISTANCE * Math.cos(pitch);
        this.threeCamera.position.set(
            FOCUS_POINT.x + horizontal * Math.sin(yaw),
            FOCUS_POINT.y + CAMERA_DISTANCE * Math.sin(pitch),
            FOCUS_POINT.z + horizontal * Math.cos(yaw),
        );
        this.threeCamera.lookAt(FOCUS_POINT);
    }

    private buildWater(waterColor: string): THREE.Mesh {
        const SIZE = 400;
        const SEGMENTS = 128;
        const { opacity, elevation } = ROOM_GEOMETRY.floor;
        const waterColors = deriveWaterTones(parseHexColor(waterColor));
        this.waterMat = createWaterMaterial(opacity, elevation, waterColors);

        const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
        geo.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geo, this.waterMat);
        mesh.frustumCulled = false;

        const t0 = performance.now();
        mesh.onBeforeRender = () => {
            (this.waterMat as THREE.ShaderMaterial).uniforms.time.value = (performance.now() - t0) / 1000;
        };

        this.threeScene.add(mesh);
        return mesh;
    }

    public update(delta: number): void {
        super.update(delta);
    }

    public destroy(): void {
        this.chunkManager?.destroy();
        this.collectibles?.destroy();
        this.threeScene.remove(this.waterMesh);
        this.waterMesh?.geometry.dispose();
        this.waterMat?.dispose();
        super.destroy();
    }
}
