import * as THREE from 'three';
import { DIG } from '../data/DigConfig';
import { DigProgress } from '../data/DigProgress';
import { VoxelTerrain, AIR } from '../world/VoxelTerrain';
import { BendService } from '../services/BendService';
import { PowerSurge } from './PowerSurge';
import { GameAnalytics } from '../analytics/GameAnalytics';

/** Retained for old saves and hub reveal rules; no longer controls tractor offers. */
export const POWER_CHEST_TAKEN = 'power-chest-taken';

/** The rewarded tractor spot's colour: the video button's green, so it never reads as crystal (cyan) or treasure (gold). */
export const TRACTOR_SPOT_COLOR = 0x5cff8a;
const BEAM_HEIGHT = 6;
const BEAM_RADIUS = 0.75;
/** The tractor on the spot, bigger than its 1.1-block chest size so it reads from across the screen. */
const MODEL_SCALE = 1.8;

/** Bright at the bottom, gone at the top. */
function beamTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 128;
    const g = canvas.getContext('2d')!;
    const gradient = g.createLinearGradient(0, 128, 0, 0);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gradient;
    g.fillRect(0, 0, 4, 128);
    return new THREE.CanvasTexture(canvas);
}

/** One deterministic, optional rewarded-tractor spot per mine. Never a buried power chest. */
export class PowerChestSpawner {
    private readonly at = new THREE.Vector3();
    private readonly spot = new THREE.Group();
    private readonly ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
    private readonly beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
    private readonly beamMaterial: THREE.MeshBasicMaterial;
    private readonly materials: THREE.MeshStandardMaterial[] = [];
    private model?: THREE.Object3D;
    private modelHalfHeight = 0;
    private modelRequested = false;
    private entered = false;
    private revealed = false;
    private ix: number;
    private iz: number;
    private readonly zone: number;
    private readonly usedKey = `tractor-used-mine-${DigProgress.currentMine}`;
    private readonly unlockedKey = `tractor-unlocked-mine-${DigProgress.currentMine}`;

    public constructor(private readonly threeScene: THREE.Scene, private readonly terrain: VoxelTerrain, private readonly onOffer: () => void) {
        const config = DIG.chests.power.offer;
        this.zone = DIG.zones.findIndex((zone) => zone.id === config.zone);
        if (this.zone < 0) throw new Error(`[PowerChestSpawner] Unknown offer zone: ${config.zone}`);
        const angle = (DigProgress.mineSeed % 360) * Math.PI / 180;
        const radius = DIG.zones[this.zone].from + 2;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        let nearest = Infinity;
        let cell = -1;
        for (let i = 0; i < terrain.zones.length; i++) {
            if (terrain.zones[i] !== this.zone) continue;
            const ix = i % terrain.size;
            const iz = Math.floor(i / terrain.size);
            terrain.cellCenter(ix, iz, this.at);
            const distance = (this.at.x - x) ** 2 + (this.at.z - z) ** 2;
            if (distance < nearest) {
                nearest = distance;
                cell = i;
            }
        }
        if (cell < 0) throw new Error(`[PowerChestSpawner] No cells in offer zone: ${config.zone}`);
        this.ix = cell % terrain.size;
        this.iz = Math.floor(cell / terrain.size);
        terrain.cellCenter(this.ix, this.iz, this.at);
        this.spot.position.copy(this.at);
        const material = new THREE.MeshBasicMaterial({ color: TRACTOR_SPOT_COLOR, transparent: true, opacity: 0.9, depthWrite: false });
        BendService.applyBend(material);
        this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.08, 8, 40), material);
        this.ring.rotation.x = -Math.PI / 2;
        // A tall light beam, the same soft fade-out-at-the-top look as the treasure beacons but wider and green.
        this.beamMaterial = new THREE.MeshBasicMaterial({
            color: TRACTOR_SPOT_COLOR, map: beamTexture(), transparent: true, opacity: 0.85,
            depthWrite: false, side: THREE.BackSide,
        });
        BendService.applyBend(this.beamMaterial);
        const beamGeometry = new THREE.CylinderGeometry(BEAM_RADIUS * 0.7, BEAM_RADIUS, BEAM_HEIGHT, 20, 8, true);
        beamGeometry.translate(0, BEAM_HEIGHT / 2, 0);
        this.beam = new THREE.Mesh(beamGeometry, this.beamMaterial);
        this.beam.renderOrder = 6;
        this.beam.frustumCulled = false;
        this.spot.add(this.ring, this.beam);
        this.spot.visible = false;
        threeScene.add(this.spot);
    }

    /** Where the floating video badge sits (above the tractor), in world space — only meaningful while `badgeVisible`. */
    public badgePosition(out: THREE.Vector3): THREE.Vector3 {
        return out.set(this.at.x, (this.model?.position.y ?? 0) + this.modelHalfHeight + 1.6, this.at.z);
    }

    public get badgeVisible(): boolean {
        return this.spot.visible && !!this.model;
    }

    public get available(): boolean {
        return DigProgress.hasOnce(this.unlockedKey) && !DigProgress.hasOnce(this.usedKey);
    }

    /** Called only after a successfully completed rewarded video. */
    public consume(): void {
        DigProgress.once(this.usedKey);
        DigProgress.saveNow();
        this.spot.visible = false;
    }

    /** Debug: moves the spot a few blocks in front of the player and makes it available again. */
    public debugPlaceNear(player: THREE.Vector3, forward: THREE.Vector3): void {
        const [ix, iz] = this.terrain.cellOf(player.x + forward.x * 3, player.z + forward.z * 3);
        this.ix = Math.max(0, Math.min(this.terrain.size - 1, ix));
        this.iz = Math.max(0, Math.min(this.terrain.size - 1, iz));
        this.terrain.cellCenter(this.ix, this.iz, this.at);
        this.spot.position.copy(this.at);
        DigProgress.once(this.unlockedKey);
        DigProgress.clearOnce(this.usedKey);
        this.entered = false;
    }

    public update(player: THREE.Vector3, canOffer: boolean): void {
        if (this.terrain.zoneIndexAt(player.x, player.z) >= this.zone) DigProgress.once(this.unlockedKey);
        const config = DIG.chests.power.offer;
        const distance = Math.hypot(player.x - this.at.x, player.z - this.at.z);
        if (distance > config.triggerDistance + 1) this.entered = false;
        this.spot.visible = this.available && distance <= config.revealDistance;
        if (!this.spot.visible) return;
        if (!this.model) {
            const model = this.terrain.chestModel('power');
            if (!model) {
                if (!this.modelRequested) {
                    this.modelRequested = true;
                    this.terrain.loadPowerModel();
                }
                return;
            }
            model.traverse((child) => {
                if (!(child instanceof THREE.Mesh)) return;
                // Keep a single material single: an array on a mesh without geometry groups draws nothing.
                const own = (original: THREE.Material) => {
                    const material = original.clone();
                    BendService.applyBend(material);
                    if (material instanceof THREE.MeshStandardMaterial) this.materials.push(material);
                    return material;
                };
                child.material = Array.isArray(child.material) ? child.material.map(own) : own(child.material);
            });
            model.scale.multiplyScalar(MODEL_SCALE);
            this.modelHalfHeight = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y / 2;
            this.model = model;
            this.spot.add(model);
        }
        const floor = this.terrain.cellValue(this.ix, this.iz) === AIR ? 0 : this.terrain.blockHeight;
        const time = performance.now() / 1000;
        this.ring.position.y = floor + 0.08;
        this.ring.scale.setScalar(1 + Math.sin(time * 3) * 0.08);
        this.beam.position.y = floor;
        this.beamMaterial.opacity = 0.75 + Math.sin(time * 2.4) * 0.15;
        this.beam.scale.set(1 + Math.sin(time * 2.4) * 0.08, 1, 1 + Math.sin(time * 2.4) * 0.08);
        this.model.position.y = floor + this.modelHalfHeight + 0.15 + Math.sin(time * 2) * 0.08;
        this.model.rotation.y = time * 0.5;
        for (const material of this.materials) {
            material.emissive.setRGB(1, 0.95, 0.7);
            material.emissiveIntensity = 0.12 + (Math.sin(time * 4) * 0.5 + 0.5) * 0.18;
        }
        if (!this.revealed) {
            this.revealed = true;
            GameAnalytics.tractorOffer('visible');
        }
        if (!canOffer || this.entered || PowerSurge.active || floor !== 0 || distance > config.triggerDistance) return;
        this.entered = true;
        this.onOffer();
    }

    public destroy(): void {
        this.spot.removeFromParent();
        this.ring.geometry.dispose();
        this.ring.material.dispose();
        this.beam.geometry.dispose();
        this.beamMaterial.map?.dispose();
        this.beamMaterial.dispose();
        this.model?.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                for (const material of Array.isArray(child.material) ? child.material : [child.material]) material.dispose();
            }
        });
    }
}
