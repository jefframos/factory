// Dungeon.ts
//
// Props round the gates, so it feels like a dungeon: KayKit's barrels and weapons (CC0; tools/build-dungeon.mjs). Where each
// goes is ui/wall.json `dungeon`:
//
// - `gates`: on every gate (both of the tunnel's two, so the next one has them too).
// - `first`: only round wall 1's gate, the first one the player sees (and gone once they're past it).
//
// Each spot: its model, where it stands (world units: the gate's middle at the floor is 0, +x right, +z towards the player),
// how tall (`size`: it's scaled to that), turned (`rot`, degrees), leant back against the wall and tilted (`lean`, `tilt`), a flickering glow (`light`: its size; `lightAt`: how far
// up it, a share of its height). Glows are sprites, not lights: nothing more for a phone to light.
//
// Off: `"on": false` in ui/wall.json `dungeon` (nothing's loaded), or either list emptied.

import * as THREE from 'three';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { DUNGEON, DungeonSpot } from '../data/WallConfig';

const MODELS = './wall/models/dungeon/';
/** The glows' flicker: how much, how fast. */
const FLICKER = { much: 0.09, fast: 11, faster: 23 };

/** A soft orange glow, drawn once and shared. */
function glowTexture(): THREE.Texture {
    const canvas = document.createElement('canvas');
    const s = (canvas.width = canvas.height = 128);
    const c = canvas.getContext('2d')!;
    const fade = c.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2);
    fade.addColorStop(0, 'rgba(255,214,120,1)');
    fade.addColorStop(0.35, 'rgba(255,150,40,0.5)');
    fade.addColorStop(1, 'rgba(255,110,20,0)');
    c.fillStyle = fade;
    c.fillRect(0, 0, s, s);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    return map;
}

export class Dungeon {
    /** One material for every prop (their colours are in their vertices): no new one for the GPU to set up for each. */
    private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });
    private readonly glow = new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
    /** What's round wall 1's gate only. */
    private readonly first = new THREE.Group();
    private readonly glows: { sprite: THREE.Sprite; size: number; phase: number }[] = [];
    private time = 0;

    /** `gates`: the tunnel's two (this wall's first). */
    public constructor(private readonly gates: THREE.Group[]) {
        this.first.visible = false;
    }

    /** The props loaded and put round the gates (nothing if it's off). */
    public async load(): Promise<void> {
        if (!DUNGEON.on) return;
        const spots = [...DUNGEON.gates, ...DUNGEON.first];
        const ids = [...new Set(spots.map((spot) => spot.model))];
        const models = new Map<string, THREE.Object3D>();
        await Promise.all(ids.map(async (id) => {
            try {
                models.set(id, await ModelLoaderManager.instance.loadModel(`${MODELS}${id}.glb`));
            } catch (error) {
                console.warn(`[Dungeon] ${id} didn't load`, error);
            }
        }));
        for (const gate of this.gates) for (const spot of DUNGEON.gates) this.put(gate, models.get(spot.model), spot);
        for (const spot of DUNGEON.first) this.put(this.first, models.get(spot.model), spot);
        this.gates[0].add(this.first);
    }

    /** One prop on its spot: its bottom middle there, as tall as it's to be, turned; its glow, if it has one. */
    private put(parent: THREE.Object3D, model: THREE.Object3D | undefined, spot: DungeonSpot): void {
        if (!model) return;
        const copy = model.clone(true);
        copy.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (mesh.isMesh) mesh.material = this.material;
        });
        // (Its own box, measured as it stands: its matrices brought up to date first.)
        copy.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(copy);
        const height = Math.max(0.001, box.max.y - box.min.y);
        const middle = box.getCenter(new THREE.Vector3());
        copy.position.x -= middle.x;
        copy.position.y -= box.min.y;
        copy.position.z -= middle.z;
        const holder = new THREE.Group();
        holder.add(copy);
        holder.scale.setScalar(spot.size / height);
        // (Turned on its own upright first, then leant back against the wall and tilted sideways, round its foot.)
        const spin = new THREE.Group();
        spin.add(holder);
        spin.rotation.y = THREE.MathUtils.degToRad(spot.rot ?? 0);
        const pivot = new THREE.Group();
        pivot.add(spin);
        pivot.position.set(spot.x, spot.y, spot.z);
        pivot.rotation.set(-THREE.MathUtils.degToRad(spot.lean ?? 0), 0, THREE.MathUtils.degToRad(spot.tilt ?? 0));
        if (spot.light) {
            const sprite = new THREE.Sprite(this.glow);
            sprite.position.set(0, spot.size * (spot.lightAt ?? 0.5), 0.05);
            sprite.scale.setScalar(spot.light);
            pivot.add(sprite);
            this.glows.push({ sprite, size: spot.light, phase: Math.random() * Math.PI * 2 });
        }
        parent.add(pivot);
    }

    /** Wall 1's props: there while that gate is wall 1's (the scene says, when it gets to a wall). */
    public showFirst(shown: boolean): void {
        this.first.visible = shown && DUNGEON.on;
    }

    public update(delta: number): void {
        if (!this.glows.length) return;
        this.time += delta;
        for (const { sprite, size, phase } of this.glows) {
            const t = this.time + phase;
            sprite.scale.setScalar(size * (1 + FLICKER.much * Math.sin(t * FLICKER.fast) + FLICKER.much * 0.6 * Math.sin(t * FLICKER.faster + phase)));
        }
    }
}
