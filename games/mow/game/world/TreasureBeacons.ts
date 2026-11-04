// TreasureBeacons.ts
//
// Dig's treasure beams, for Mow's hidden treasures: a soft, pulsing beam of light rises from every treasure still
// hidden in the grass within treasures.beamRange of the player (GrassField.hiddenTreasuresNear), with a glowing ring
// on the ground — in its rarity's colour — so there's something to mow towards. The beams fade in at the edge of the
// range; the nearest POOL are shown. Rescanned a few times a second.

import * as THREE from 'three';
import type { GrassField } from './GrassField';
import { BendService } from '../services/BendService';
import { MOW, Rarity, lawnLift } from '../data/MowConfig';

const POOL = 8;
const RESCAN_SEC = 0.35;
const BEAM_HEIGHT = 4.2;
const BEAM_RADIUS = 0.34;
const RING_SIZE = 1.5;
/** Beams fade in over this last share of the range. */
const EDGE_FADE = 0.25;
/** Beam opacity. */
const OPACITY = 0.7;
/** Beam colour per rarity (common gold, rare blue, epic purple, legendary gold-white). */
const RARITY_COLORS: Record<Rarity, number> = { common: 0xffd86b, rare: 0x6fb4ff, epic: 0xc77dff, legendary: 0xfff0a0 };

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
    /** The treasure it marks ('' = unused), its full opacity and its distance fade. */
    id: string;
    opacity: number;
    fade: number;
}

/** Seconds a beacon takes to fade in on a newly marked treasure. */
const APPEAR_SEC = 0.8;

export class TreasureBeacons {
    private readonly beacons: Beacon[] = [];
    private readonly beamTexture = beamTexture();
    private readonly ringTexture = ringTexture();
    private readonly beamGeometry: THREE.CylinderGeometry;
    private readonly ringGeometry: THREE.PlaneGeometry;
    private rescan = 0;
    private time = 0;
    /** Fade-in (0..1) of each marked treasure. */
    private readonly appeared = new Map<string, number>();

    /** `isHidden(id)`: the treasure hasn't been found (a found one's beam goes at once). */
    public constructor(threeScene: THREE.Scene, private readonly grass: GrassField, private readonly isHidden: (id: string) => boolean) {
        // Enough rings up the beam for the world bend to curve it with the rest.
        this.beamGeometry = new THREE.CylinderGeometry(BEAM_RADIUS * 0.55, BEAM_RADIUS, BEAM_HEIGHT, 14, 8, true);
        this.beamGeometry.translate(0, BEAM_HEIGHT / 2, 0);
        this.ringGeometry = new THREE.PlaneGeometry(RING_SIZE, RING_SIZE, 2, 2);
        this.ringGeometry.rotateX(-Math.PI / 2);
        for (let i = 0; i < POOL; i++) {
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
            this.beacons.push({ beam, ring, beamMaterial, ringMaterial, id: '', opacity: 0, fade: 0 });
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
            if (!beacon.id) continue;
            // Found since the last scan: gone at once.
            if (!this.isHidden(beacon.id)) {
                this.hide(beacon);
                continue;
            }
            // The fade-in belongs to the treasure (beacons swap as the nearest ones change).
            const appear = Math.min(1, (this.appeared.get(beacon.id) ?? 0) + delta / APPEAR_SEC);
            this.appeared.set(beacon.id, appear);
            const pulse = 0.72 + 0.28 * Math.sin(this.time * 3.2 + i * 1.7);
            const strength = beacon.opacity * beacon.fade * appear;
            beacon.beamMaterial.opacity = strength * pulse;
            beacon.ringMaterial.opacity = strength * (0.6 + 0.4 * pulse);
            const swell = 1 + 0.12 * Math.sin(this.time * 3.2 + i * 1.7);
            beacon.ring.scale.set(swell, 1, swell);
        }
    }

    private scan(player: THREE.Vector3): void {
        const range = MOW.treasures.beamRange;
        const near = this.grass.hiddenTreasuresNear(player.x, player.z, range)
            .map(({ treasure, at }) => ({ treasure, at, distance: Math.hypot(at.x - player.x, at.z - player.z) }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, this.beacons.length);
        // Forget treasures out of range, so one coming back fades in again.
        const marked = new Set(near.map((n) => n.treasure.id));
        for (const id of this.appeared.keys()) if (!marked.has(id)) this.appeared.delete(id);
        for (let i = 0; i < this.beacons.length; i++) {
            const beacon = this.beacons[i];
            const target = near[i];
            if (!target) {
                this.hide(beacon);
                continue;
            }
            const color = RARITY_COLORS[target.treasure.rarity];
            beacon.id = target.treasure.id;
            beacon.opacity = OPACITY;
            beacon.fade = Math.min(1, (1 - target.distance / range) / EDGE_FADE);
            beacon.beamMaterial.color.setHex(color);
            beacon.ringMaterial.color.setHex(color);
            beacon.beam.position.set(target.at.x, 0.05 + lawnLift(), target.at.z);
            beacon.ring.position.set(target.at.x, 0.06 + lawnLift(), target.at.z);
            beacon.beam.visible = beacon.ring.visible = true;
        }
    }

    private hide(beacon: Beacon): void {
        beacon.id = '';
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
