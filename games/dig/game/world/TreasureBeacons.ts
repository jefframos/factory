// TreasureBeacons.ts
//
// Buried treasure calls from afar: a soft, pulsing beam of light rises from the top of every block hiding a find or
// a chest (VoxelTerrain.finds / chests) within chests.beaconRange blocks of the miner, with a glowing ring on the
// block — gold for a cash chest, cyan for a power chest, the find's rarity colour for an artifact. It reads from the
// other side of the screen, long before TreasureSparkles' close-up stars, so the player has something to dig towards.
// The beams fade in at the edge of the range; the nearest POOL are shown. Rescanned a few times a second.

import * as THREE from 'three';
import { VoxelTerrain } from './VoxelTerrain';
import { BendService } from '../services/BendService';
import { DIG, ChestKind, FindDef } from '../data/DigConfig';
import { RARITY_COLORS } from '../ui/CollectionPanel';

const POOL = 16;
const RESCAN_SEC = 0.35;
const BEAM_HEIGHT = 4.2;
const BEAM_RADIUS = 0.34;
const RING_SIZE = 1.5;
/** Beams fade in over this last share of the range. */
const EDGE_FADE = 0.25;
/** Beam opacity: chests (the new curiosities) a little brighter than finds. */
const CHEST_OPACITY = 0.75;
const FIND_OPACITY = 0.55;

const CHEST_COLORS: Record<ChestKind, number> = { power: 0x6fe3ff, cash: 0xffd23f };
const COMMON_FIND_COLOR = 0xffd86b;

/** Bright at the bottom, gone at the top. */
function beamTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 128;
    const g = canvas.getContext('2d')!;
    const gradient = g.createLinearGradient(0, 128, 0, 0);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gradient;
    g.fillRect(0, 0, 4, 128);
    return new THREE.CanvasTexture(canvas);
}

/** A soft ring of light. */
function ringTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const g = canvas.getContext('2d')!;
    const gradient = g.createRadialGradient(64, 64, 8, 64, 64, 62);
    gradient.addColorStop(0, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(0.55, 'rgba(255,255,255,0.35)');
    gradient.addColorStop(0.75, 'rgba(255,255,255,0.9)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gradient;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(canvas);
}

interface Beacon {
    beam: THREE.Mesh;
    ring: THREE.Mesh;
    beamMaterial: THREE.MeshBasicMaterial;
    ringMaterial: THREE.MeshBasicMaterial;
    /** Cell index it marks (-1 = unused), its full opacity and its distance fade. */
    cell: number;
    opacity: number;
    fade: number;
}

/** Seconds a beacon takes to fade in on a newly marked cell (a power chest popping in shows its beam softly too). */
const APPEAR_SEC = 0.8;

export class TreasureBeacons {
    private readonly beacons: Beacon[] = [];
    private readonly beamTexture = beamTexture();
    private readonly ringTexture = ringTexture();
    private readonly beamGeometry: THREE.CylinderGeometry;
    private readonly ringGeometry: THREE.PlaneGeometry;
    private rescan = 0;
    private time = 0;
    /** Fade-in (0..1) of each marked cell. */
    private readonly appeared = new Map<number, number>();

    public constructor(threeScene: THREE.Scene, private readonly terrain: VoxelTerrain) {
        // Enough rings up the beam for the world bend to curve it with the rest.
        this.beamGeometry = new THREE.CylinderGeometry(BEAM_RADIUS * 0.55, BEAM_RADIUS, BEAM_HEIGHT, 14, 8, true);
        this.beamGeometry.translate(0, BEAM_HEIGHT / 2, 0);
        this.ringGeometry = new THREE.PlaneGeometry(RING_SIZE, RING_SIZE, 2, 2);
        this.ringGeometry.rotateX(-Math.PI / 2);
        for (let i = 0; i < POOL; i++) {
            // Normal blending: additive washes out to white over the pale rock, and the colour is what tells chests apart.
            const beamMaterial = new THREE.MeshBasicMaterial({ map: this.beamTexture, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0 });
            const ringMaterial = new THREE.MeshBasicMaterial({ map: this.ringTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
            BendService.applyBend(beamMaterial);
            BendService.applyBend(ringMaterial);
            const beam = new THREE.Mesh(this.beamGeometry, beamMaterial);
            const ring = new THREE.Mesh(this.ringGeometry, ringMaterial);
            beam.renderOrder = ring.renderOrder = 6;
            beam.frustumCulled = ring.frustumCulled = false;
            beam.visible = ring.visible = false;
            threeScene.add(beam, ring);
            this.beacons.push({ beam, ring, beamMaterial, ringMaterial, cell: -1, opacity: 0, fade: 0 });
        }
    }

    public update(delta: number, player: THREE.Vector3): void {
        this.time += delta;
        this.rescan -= delta;
        if (this.rescan <= 0) {
            this.rescan = RESCAN_SEC;
            this.scan(player);
        }
        for (let i = 0; i < this.beacons.length; i++) {
            const beacon = this.beacons[i];
            if (beacon.cell < 0) continue;
            // Dug out since the last scan: gone at once.
            const ix = beacon.cell % this.terrain.size;
            const iz = Math.floor(beacon.cell / this.terrain.size);
            if (!this.terrain.findAt(ix, iz) && !this.terrain.chestAt(ix, iz)) {
                this.hide(beacon);
                continue;
            }
            // The fade-in belongs to the cell (beacons swap cells as the nearest ones change).
            const appear = Math.min(1, (this.appeared.get(beacon.cell) ?? 0) + delta / APPEAR_SEC);
            this.appeared.set(beacon.cell, appear);
            const pulse = 0.72 + 0.28 * Math.sin(this.time * 3.2 + i * 1.7);
            const strength = beacon.opacity * beacon.fade * appear;
            beacon.beamMaterial.opacity = strength * pulse;
            beacon.ringMaterial.opacity = strength * (0.6 + 0.4 * pulse);
            const swell = 1 + 0.12 * Math.sin(this.time * 3.2 + i * 1.7);
            beacon.ring.scale.set(swell, 1, swell);
        }
    }

    private scan(player: THREE.Vector3): void {
        const terrain = this.terrain;
        const range = DIG.chests.beaconRange;
        const [px, pz] = terrain.cellOf(player.x, player.z);
        const found: { cell: number; distance: number; color: number; opacity: number }[] = [];
        for (let iz = pz - range; iz <= pz + range; iz++) {
            for (let ix = px - range; ix <= px + range; ix++) {
                const chest = terrain.chestAt(ix, iz);
                const find = chest ? undefined : terrain.findAt(ix, iz);
                if (!chest && !find) continue;
                const distance = Math.hypot(ix - px, iz - pz);
                if (distance > range) continue;
                found.push({
                    cell: terrain.index(ix, iz), distance,
                    color: chest ? CHEST_COLORS[chest] : findColor(find!),
                    opacity: chest ? CHEST_OPACITY : FIND_OPACITY,
                });
            }
        }
        found.sort((a, b) => a.distance - b.distance);
        // Forget cells out of range, so one coming back fades in again.
        const marked = new Set(found.slice(0, this.beacons.length).map((f) => f.cell));
        for (const cell of this.appeared.keys()) if (!marked.has(cell)) this.appeared.delete(cell);
        const center = new THREE.Vector3();
        for (let i = 0; i < this.beacons.length; i++) {
            const beacon = this.beacons[i];
            const target = found[i];
            if (!target) {
                this.hide(beacon);
                continue;
            }
            beacon.cell = target.cell;
            beacon.opacity = target.opacity;
            beacon.fade = Math.min(1, (1 - target.distance / range) / EDGE_FADE);
            beacon.beamMaterial.color.setHex(target.color);
            beacon.ringMaterial.color.setHex(target.color);
            terrain.cellCenter(target.cell % terrain.size, Math.floor(target.cell / terrain.size), center);
            beacon.beam.position.set(center.x, terrain.blockHeight + 0.02, center.z);
            beacon.ring.position.set(center.x, terrain.blockHeight + 0.03, center.z);
            beacon.beam.visible = beacon.ring.visible = true;
        }
    }

    private hide(beacon: Beacon): void {
        beacon.cell = -1;
        beacon.beam.visible = beacon.ring.visible = false;
    }

    public destroy(): void {
        for (const beacon of this.beacons) {
            beacon.beam.removeFromParent();
            beacon.ring.removeFromParent();
            beacon.beamMaterial.dispose();
            beacon.ringMaterial.dispose();
        }
        this.beamGeometry.dispose();
        this.ringGeometry.dispose();
        this.beamTexture.dispose();
        this.ringTexture.dispose();
    }
}

function findColor(find: FindDef): number {
    return find.rarity === 'common' ? COMMON_FIND_COLOR : new THREE.Color(RARITY_COLORS[find.rarity]).getHex();
}
