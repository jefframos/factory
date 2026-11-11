// Arena.ts
//
// The battlefield's look, from plain shapes in the references' style (refs/mob): a sandy field between green hedges, an
// island in the sea (UFO's water), the whole world bent away from the cannon (Bend.ts); the blue cannon on its rail at
// the near end, the glowing blue multiplier gates with their "x2" / "x3", the red enemy base far up the field with its
// HP on its front, and a red danger line before the cannon. A level adds its own: raised grass blocks of any outline
// (meshed from their polygons as the level loads: a bevelled grass top over dirt sides, as in refs/mob), water holes,
// brick blocks to break (their hits counting down over them), spinners (a yellow and black cross), pushers (striped bars)
// and giant pads (a counter and a fill bar).
//
// And the juice: bits flying where mobs clash, chunks off the base when it's hit (and everywhere when it falls, with
// confetti), sparkles at a gate as it multiplies, a burst for a new giant, the cannon's flash and recoil on every shot,
// the base's number punching on each hit, the danger line pulsing as reds get near.
//
// The rules are Battle's; this only follows it (update()).

import * as THREE from 'three';
import { GrinderConfig, PIPE, PipeConfig, pipeEnds, pipePath } from '../data/MobConfig';
import { ARENA, BattleConfig, COLORS, TUNING, UNIT_COLORS, houseStyle, needOf, padColor, GateConfig, HelmetConfig, ObstacleConfig, PadConfig, PushBlockConfig, PusherConfig, SpinnerConfig } from '../data/MobConfig';
import { bendObject, bendSegments } from '../services/Bend';
import { createGround, createWater } from '../services/Water';
import { BASE_HALF_WIDTH, Battle, CAR, TRUCK, Target, obstacleShape } from './Battle';
import { shapeCentre } from './Shapes';
import { createGLTFLoader } from 'core/three/GLTFLoaders';
import { Theme } from '../data/Themes';

const FIELD_NEAR = 3;
/** The far end of the ground: a little behind the base (the field is sized per level: ARENA). */
const fieldFar = (): number => ARENA.baseZ - 5;
const HEDGE = { width: 1.1, height: 0.8 };
/** Hedge blocks' length, the grass edge round the field (to the shore), and the sea's colour. */
const HEDGE_BLOCK = 2;
const GRASS_EDGE = 1.4;
/** An island's coast: the least sand past the hedges, how far its ends round off past the field's, how finely its
 *  ground is cut (rows along the field, columns across it), and the waves along it (lengths, a seed per side). */
const COAST = { least: 0.6, cap: 3, row: 0.8, waves: [7.3, 3.1, 1.7], seed: [1.7, 4.2] };
/** With a kit wall the ground round the field is wider (room for its props). */
const KIT_GRASS_EDGE = 3.2;
/** A valley's layout: how far the ground reaches, the gap between the field and the cliffs, the cliff band's width,
 *  how far past the cannon the side cliffs run, and how deep the top behind the base goes. */
const VALLEY = { groundHalf: 40, groundLength: 120, gap: 0.25, band: 2.2, nearExtra: 10, back: 30 };
/** A cliff band's pieces: this many of its edge points (0.5 apart) each. */
const CLIFF_PIECE = 6;
/** The main screen's ground and cliff tops (seen from further off): this wide, past every edge of the screen. */
const WIDE_GROUND = 420;
const GATE = { height: 0.12, depth: 0.35, post: 0.22, postHeight: 1 };
/** A grinder: its roller's core (a share of its radius) and the spikes' length (the rest), how many to a ring and how
 *  far apart the rings are (x its thickness); the colours; a standing one's posts. */
const GRINDER = { core: 0.62, perRing: 7, ringGap: 0.45, roller: 0x3a3f4b, spike: 0xd5dae2, band: 0xff4757, post: 0x5a6270, postWidth: 0.26 };
/** A grinder as drawn: its group (moved), the roller that turns (round its own length), its radius, how far it's turned. */
interface GrinderView { holder: THREE.Group; roller: THREE.Group; radius: number; angle: number }

/** A pipe's colours (the pipe, its openings' rims, the dark inside) and how thick the rim is. */
const PIPE_LOOK = { rimTube: 0.16 };
/** Each pipe's colours by who can go through it (PipeConfig.team): blue, red, or purple (both). */
const PIPE_COLOURS = {
    blue: { body: 0x3d6dff, rim: 0x9fc2ff, inside: 0x0f1c4a },
    red: { body: 0xff3d4f, rim: 0xffa3ad, inside: 0x4a0f18 },
    both: { body: 0x7b5cff, rim: 0xa58bff, inside: 0x1a1240 },
};
const pipeColours = (pipe: PipeConfig) => PIPE_COLOURS[pipe.team ?? 'both'];

/** A locked gate: grey (panel, glow, posts), barred across its span, a padlock with its hits left on it; its "x" label
 *  lifted over the padlock. */
const LOCK = { grey: 0x9aa0a8, dark: 0x5e646d, metal: 0xc9ced6, barHeight: 1.1, barGap: 0.45, labelY: 2.7, padlockY: 0.85, padlockTilt: -0.6 };
const BASE = { depth: 2.6, height: 2.4 };
/** An arena match: the reds' pieces' colours (their gates, houses), and how high a cannon's life floats over it. */
const RED_SIDE = { gate: 0xff5a6a, post: 0xb8243a, wall: 0xffd6da, roof: 0xff3d4f, house: 0xff6b7a, title: '#ffb3bb' };
const CANNON_LIFE_Y = 2.1;
/** The cannon's tracks: a strip of track image (sleepers and two steel rails, trackTexture) across its slide, a little
 *  past it either side: `depth` across, a tile of the image every `tile` along, cut every `segment` (the bend curves it). */
const TRACKS = { depth: 1.35, tile: 1.35, past: 0.9, segment: 0.25, y: 0.015 };

/** The track's image, drawn once: wooden sleepers (grain, dark ends) across, two steel rails (shine, shadow) along. */
let trackImage: THREE.Texture | null = null;
function trackTexture(): THREE.Texture {
    if (trackImage) return trackImage;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const c = canvas.getContext('2d')!;
    c.clearRect(0, 0, 256, 256);
    // Two sleepers a tile (x is along the track, y across it).
    for (const at of [32, 160]) {
        const wood = c.createLinearGradient(at - 22, 0, at + 22, 0);
        wood.addColorStop(0, '#5a3a1e');
        wood.addColorStop(0.18, '#8a5a30');
        wood.addColorStop(0.5, '#9a6838');
        wood.addColorStop(0.82, '#8a5a30');
        wood.addColorStop(1, '#5a3a1e');
        c.fillStyle = 'rgba(0,0,0,0.25)';
        c.fillRect(at - 22 + 3, 18 + 4, 44, 220);
        c.fillStyle = wood;
        c.fillRect(at - 22, 18, 44, 220);
        c.strokeStyle = 'rgba(60,35,15,0.55)';
        c.lineWidth = 2;
        for (const g of [-10, 2, 12]) {
            c.beginPath();
            c.moveTo(at + g, 26);
            c.lineTo(at + g + 3, 230);
            c.stroke();
        }
        c.strokeStyle = '#3d2610';
        c.lineWidth = 3;
        c.strokeRect(at - 22, 18, 44, 220);
    }
    // The rails: a shadow, the steel, its shine.
    for (const y of [70, 186]) {
        c.fillStyle = 'rgba(0,0,0,0.35)';
        c.fillRect(0, y - 9 + 5, 256, 18);
        const steel = c.createLinearGradient(0, y - 9, 0, y + 9);
        steel.addColorStop(0, '#5d6472');
        steel.addColorStop(0.35, '#dfe5ef');
        steel.addColorStop(0.55, '#aab3c2');
        steel.addColorStop(1, '#4a505c');
        c.fillStyle = steel;
        c.fillRect(0, y - 9, 256, 18);
    }
    trackImage = new THREE.CanvasTexture(canvas);
    trackImage.wrapS = THREE.RepeatWrapping;
    trackImage.anisotropy = 8;
    trackImage.colorSpace = THREE.SRGBColorSpace;
    return trackImage;
}
/** An arena match's open cannon: the ring round it (its team's colour), pulsing. */
const EXPOSED = { radius: 1.4, tube: 0.09, y: 0.06, pulse: 5 };
const CANNON_Z = 0.35;
const WALL_HEIGHT = 0.9;
/** A raised block's bevel (round its top edge), and its colours: grass on top, dirt down its sides; a breakable's stone
 *  (grey, so it reads apart from the sand and the grass). */
const BLOCK = { bevel: 0.16, brickHeight: 1.1 };
const SPINNER = { thickness: 0.36, height: 0.55, post: 0.5 };
const PUSHER_HEIGHT = 0.7;
/** The giant house: wall and roof heights, the roof's overhang, colours. */
/** The floor-pad house style: its thickness, and its glowing rim's width. */
const PAD_STYLE = { height: 0.12, rim: 0.12 };
const HOUSE = { wallHeight: 1.5, roofHeight: 0.9, overhang: 0.18, wall: 0xe8f1ff, roof: 0x3d6dff };
/** The unit spinning over a truck / UFO / car house: its size (x its own), and how far over the house's count it floats. */
const HOUSE_ICON = { truck: 0.55, other: 0.8, over: 0.75 };
/** A helmet barrier: its height and colours (an attack barrier's: `attack`), and how wide the floating viking hat is. */
const HELMET = { height: 1.5, olive: 0x6f8236, sand: 0xd8c690, curtain: 0x9ccf5a, dark: 0x5d6e2c, text: '#d8ff9a' };
const ATTACK = { olive: 0xb8332e, sand: 0xf2c14e, curtain: 0xff8a4c, dark: 0x7a1f1c, text: '#ffd27a', hatWidth: 1.3 };
/** A boss level's main building wears the Giant King's viking hat: its width (a share of the building's, at most `most`),
 *  sitting this far into the roof, and how far its number moves up to stay clear of it. */
const KING_HAT = { share: 0.7, most: 2.4, sink: 0.12, labelLift: 1.1 };
/** The PUSH block: its height and colours (a dark slab, a red plate). */
const PUSH_BLOCK = { height: 1.2, body: 0x3a4466, plate: 0xff4757 };
/**
 * The game pieces' models (public/mob/models/props/, built by tools/build-props.mjs): each house kind's building, the
 * enemy's main base and its smaller forts, the truck, the gold saucer. `turn`: the Y turn that faces it at the cannon.
 * A piece is drawn from plain shapes until its model has loaded (or if it can't).
 */
const PROPS = {
    /** Each house's building (the `model` style); the car has none (a plain house). */
    houses: { giant: 'home-blue', truck: 'barracks-blue', saucer: 'home-yellow' } as Record<string, string>,
    houseTitles: { giant: 'GIANT', truck: 'TRUCK', saucer: 'UFO', car: 'RAMMER' } as Record<string, string>,
    /** The plain houses (all but the giant's, which is a building): their wall and roof colours' keys in UNIT_COLORS. */
    houseColours: { giant: ['giantWall', 'giantRoof'], truck: ['truckWall', 'truckRoof'], saucer: ['ufoWall', 'ufoRoof'], car: ['carWall', 'carRoof'] } as Record<string, [UnitColor, UnitColor]>,
    base: 'barracks-red',
    tower: 'tower-red',
    /** An arena match's blue towers. */
    blueTower: 'barracks-blue',
    /** A target narrower than this is a tower, wider the barracks. */
    towerBelow: 3.4,
    turn: Math.PI,
    truck: { model: 'truck', length: 4, turn: 0 },
    // (Drawn bigger than it hits: its collider is the battle's, radiusOf and bodyShare.)
    car: { model: 'car', length: 3.1, turn: 0 },
    // `radius`: its beam's (the reds it sucks up: TUNING.saucerSuck); `size`: its model, x that (bigger than its beam).
    saucer: { model: 'saucer', radius: 0.9, size: 1.7, height: 3.7 },
};
/** Clash puffs: how many at most at once, how long each lasts (seconds), how big it grows. */
const PUFFS = 48;
/** Shockwave rings: how many at once, how long one takes to grow out. */
const RINGS = { count: 8, seconds: 0.4 };
const PUFF_SECONDS = 0.35;
const PUFF_SIZE = 0.55;
/** Flying bits: how many at most at once, and the pull down on them. */
const BITS = 700;
const GRAVITY = 18;
const FONT = 'Baloo2-ExtraBold';
/** The castle blowing apart (and the win burst over the field): red tones only — many colours read as noise. */
const CONFETTI = [0xff3d4f, 0xc42335, 0xff6b6b, 0x8e1525, 0xffa0a0, 0xe0283c];

const lambert = (color: number, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

/** A rounded box (a box with its edges bevelled), for the chunky toy look. */
function roundedBox(width: number, height: number, depth: number, radius: number, material: THREE.Material): THREE.Mesh {
    const r = Math.min(radius, width / 2 - 0.01, depth / 2 - 0.01);
    const shape = new THREE.Shape();
    const w = width / 2 - r;
    const d = depth / 2 - r;
    shape.moveTo(-w, -d - r);
    shape.lineTo(w, -d - r);
    shape.quadraticCurveTo(w + r, -d - r, w + r, -d);
    shape.lineTo(w + r, d);
    shape.quadraticCurveTo(w + r, d + r, w, d + r);
    shape.lineTo(-w, d + r);
    shape.quadraticCurveTo(-w - r, d + r, -w - r, d);
    shape.lineTo(-w - r, -d);
    shape.quadraticCurveTo(-w - r, -d - r, -w, -d - r);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 4 });
    geometry.rotateX(-Math.PI / 2);
    return new THREE.Mesh(geometry, material);
}

/** Kit models, loaded once each (shared by every arena that uses them). */
const kitModels = new Map<string, Promise<THREE.Object3D>>();
function loadKitModel(url: string): Promise<THREE.Object3D> {
    let model = kitModels.get(url);
    if (!model) {
        model = createGLTFLoader().loadAsync(url).then((gltf) => gltf.scene);
        kitModels.set(url, model);
    }
    return model;
}

/** An outline pushed out by `by` (each corner along its two edges' outward normals; either winding). */
function grow(outline: readonly { x: number; z: number }[], by: number): { x: number; z: number }[] {
    const n = outline.length;
    let area = 0;
    for (let i = 0; i < n; i++) {
        const a = outline[i];
        const b = outline[(i + 1) % n];
        area += a.x * b.z - b.x * a.z;
    }
    const out = area > 0 ? -1 : 1;
    return outline.map((p, i) => {
        const prev = outline[(i - 1 + n) % n];
        const next = outline[(i + 1) % n];
        const normal = (ax: number, az: number, bx: number, bz: number) => {
            const length = Math.hypot(bx - ax, bz - az) || 1;
            return [((bz - az) / length) * out, (-(bx - ax) / length) * out];
        };
        const [n1x, n1z] = normal(prev.x, prev.z, p.x, p.z);
        const [n2x, n2z] = normal(p.x, p.z, next.x, next.z);
        const mx = n1x + n2x;
        const mz = n1z + n2z;
        const length = Math.hypot(mx, mz) || 1;
        // The miter: longer at sharp corners (so both edges stay `by` out), capped.
        const miter = by * Math.min(3, 2 / Math.max(0.3, length));
        return { x: p.x + (mx / length) * miter, z: p.z + (mz / length) * miter };
    });
}

/** A model's clone sized so its `axis` extent is `size`, centred on X/Z, base at 0 (wrapped in a group). */
type UnitColor = keyof typeof UNIT_COLORS;

/** A model's materials tinted `hex` over their own colour (kept the first time: white puts it back). */
function tintModel(model: THREE.Object3D, hex: number): void {
    model.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
            if (!(material instanceof THREE.MeshStandardMaterial)) continue;
            if (!material.userData.base) material.userData.base = material.color.clone();
            material.color.copy(material.userData.base).multiply(new THREE.Color(hex));
        }
    });
}

function fitted(source: THREE.Object3D, size: number, axis: 'x' | 'y' | 'z'): THREE.Object3D {
    source.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(source);
    const extent = box.getSize(new THREE.Vector3());
    const scale = size / Math.max(0.01, extent[axis]);
    const centre = box.getCenter(new THREE.Vector3());
    const model = source.clone();
    model.scale.setScalar(scale);
    model.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);
    const holder = new THREE.Group();
    holder.add(model);
    return holder;
}

/** A model's height (its bounding box). */
function pieceHeight(model: THREE.Object3D | undefined): number {
    if (!model) return 0;
    model.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(model);
    return box.max.y - box.min.y;
}

/** A seeded random (mulberry32): the same numbers for the same seed. */
function seeded(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let v = s;
        v = Math.imul(v ^ (v >>> 15), v | 1);
        v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
        return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
    };
}

/** A canvas-drawn label on a plane (text centred, white with a dark outline), redrawable. */
class Label {
    public readonly mesh: THREE.Mesh;
    private readonly canvas = document.createElement('canvas');
    private readonly texture: THREE.CanvasTexture;
    private text = '';

    public constructor(width: number, height: number, pixels = 256, private readonly color = '#ffffff') {
        this.canvas.width = pixels;
        this.canvas.height = Math.round(pixels * (height / width));
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.texture.anisotropy = 4;
        this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false }));
        // Arena.hideLabels() finds them by this.
        this.mesh.userData.label = true;
    }

    public set(text: string): void {
        if (text === this.text) return;
        this.text = text;
        const g = this.canvas.getContext('2d')!;
        const { width, height } = this.canvas;
        g.clearRect(0, 0, width, height);
        g.font = `${Math.round(height * 0.78)}px ${FONT}, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineJoin = 'round';
        g.lineWidth = height * 0.14;
        g.strokeStyle = 'rgba(20, 24, 60, 0.85)';
        g.strokeText(text, width / 2, height * 0.55);
        g.fillStyle = this.color;
        g.fillText(text, width / 2, height * 0.55);
        this.texture.needsUpdate = true;
    }
}

/** A gate: its group, panel, label, pulse; a locked one's lock (bars and padlock), its hits label, the materials that
 *  are grey till it unlocks (with their own colours), and its jolt when hit. */
interface GateView {
    group: THREE.Group; panel: THREE.Mesh; label: THREE.Mesh; pulse: number;
    lock?: { group: THREE.Group; hits: Label; greyed: { material: THREE.MeshLambertMaterial | THREE.MeshBasicMaterial; color: number; emissive?: number }[]; shake: number; open: boolean };
}
/** A house: its group, fill bar, counter, door glow; what it makes, its title, how high its roof is (for what floats over
 *  it), and the spinning model of what it makes (a truck or UFO house), once loaded. */
interface PadView { group: THREE.Group; fill: THREE.Mesh; label: Label; glow: THREE.MeshBasicMaterial; width: number; pulse: number; kind: string; title: THREE.Mesh; top: number; icon: THREE.Object3D | null }
/** A PUSH block: its group (slid along z each frame), and once pushed out, how far it has fallen. */
interface PushBlockView { group: THREE.Group; fall: number; down: boolean }
/** A target's fort: its group, the body that flashes, its number; how it's being hit and how far it has fallen. */
interface TargetView { group: THREE.Group; flashes: THREE.MeshLambertMaterial[] | THREE.MeshStandardMaterial[]; label: Label; x: number; shake: number; flash: number; punch: number; fall: number; down: boolean }
interface BreakableView { mesh: THREE.Mesh; label: Label; centreX: number; centreZ: number; shake: number; gone: boolean }

/** Flying bits (instanced little cubes): velocity, spin, gravity; they shrink away. */
class Bits {
    public readonly mesh: THREE.InstancedMesh;
    private readonly pos = new Float32Array(BITS * 3);
    private readonly vel = new Float32Array(BITS * 3);
    private readonly life = new Float32Array(BITS);
    private readonly lifeMax = new Float32Array(BITS);
    private readonly size = new Float32Array(BITS);
    private readonly spin = new Float32Array(BITS);
    private next = 0;
    private readonly matrix = new THREE.Matrix4();
    private readonly q = new THREE.Quaternion();
    private readonly euler = new THREE.Euler();
    private readonly v = new THREE.Vector3();
    private readonly s = new THREE.Vector3();
    private readonly color = new THREE.Color();

    public constructor() {
        this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), BITS);
        this.mesh.frustumCulled = false;
        this.mesh.count = BITS;
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (let i = 0; i < BITS; i++) {
            this.mesh.setMatrixAt(i, this.matrix.makeScale(0, 0, 0));
            this.mesh.setColorAt(i, this.color.setHex(0xffffff));
        }
    }

    /** `count` bits from (x, y, z), flung out at up to `speed` (and up by `up`), each lasting about `life` seconds. */
    public burst(x: number, y: number, z: number, colors: readonly number[], count: number, speed: number, up: number, life: number, size: number): void {
        for (let n = 0; n < count; n++) {
            const i = this.next;
            this.next = (this.next + 1) % BITS;
            const angle = Math.random() * Math.PI * 2;
            const out = speed * (0.35 + Math.random() * 0.65);
            this.pos.set([x, y, z], i * 3);
            this.vel.set([Math.sin(angle) * out, up * (0.5 + Math.random()), Math.cos(angle) * out], i * 3);
            this.lifeMax[i] = this.life[i] = life * (0.6 + Math.random() * 0.6);
            this.size[i] = size * (0.6 + Math.random() * 0.7);
            this.spin[i] = (Math.random() - 0.5) * 16;
            this.mesh.setColorAt(i, this.color.setHex(colors[n % colors.length]));
        }
        this.mesh.instanceColor!.needsUpdate = true;
    }

    public update(dt: number): void {
        for (let i = 0; i < BITS; i++) {
            if (this.life[i] <= 0) continue;
            this.life[i] -= dt;
            const k = i * 3;
            this.vel[k + 1] -= GRAVITY * dt;
            this.pos[k] += this.vel[k] * dt;
            this.pos[k + 1] += this.vel[k + 1] * dt;
            this.pos[k + 2] += this.vel[k + 2] * dt;
            // Bounce once off the ground, losing most of the speed.
            if (this.pos[k + 1] < 0.05 && this.vel[k + 1] < 0) {
                this.pos[k + 1] = 0.05;
                this.vel[k + 1] *= -0.35;
                this.vel[k] *= 0.6;
                this.vel[k + 2] *= 0.6;
            }
            const t = Math.max(0, this.life[i] / this.lifeMax[i]);
            const scale = this.life[i] <= 0 ? 0 : this.size[i] * Math.min(1, t * 3);
            const turn = (this.lifeMax[i] - this.life[i]) * this.spin[i];
            this.q.setFromEuler(this.euler.set(turn, turn * 0.7, 0));
            this.matrix.compose(this.v.set(this.pos[k], this.pos[k + 1], this.pos[k + 2]), this.q, this.s.setScalar(scale));
            this.mesh.setMatrixAt(i, this.matrix);
        }
        this.mesh.instanceMatrix.needsUpdate = true;
    }
}

export class Arena {
    public readonly group = new THREE.Group();
    /** Called when a fort's model has loaded (its height changed: the camera re-frames). */
    public onLayout: (() => void) | null = null;
    private readonly cannon = new THREE.Group();
    private readonly barrel: THREE.Object3D;
    private readonly flash: THREE.Mesh;
    private readonly gates: GateView[] = [];
    private readonly spinners: THREE.Group[] = [];
    private readonly pushers: THREE.Group[] = [];
    private readonly pads: PadView[] = [];
    private readonly pushBlocks: PushBlockView[] = [];
    /** Truck models in use (one per live truck, by order), and spares; saucer models by the saucer they show. */
    private readonly trucks: THREE.Object3D[] = [];
    private truckModel: THREE.Object3D | null = null;
    /** The plain houses' wall and roof materials (with their UNIT_COLORS keys), and the giant's buildings: recoloured
     *  live (refreshColors). */
    private readonly houseMaterials: { keys: [UnitColor, UnitColor]; wall: THREE.MeshLambertMaterial; roof: THREE.MeshLambertMaterial }[] = [];
    private readonly giantHouses: THREE.Object3D[] = [];
    private carModel: THREE.Object3D | null = null;
    private readonly cars: THREE.Object3D[] = [];
    /** The grinders' views, by the level's order. */
    private readonly grinders: GrinderView[] = [];
    /** Each helmet barrier's floating helmet (it spins). */
    private readonly helmetIcons: THREE.Object3D[] = [];
    private saucerModel: THREE.Object3D | null = null;
    private readonly saucerViews = new Map<object, { model: THREE.Object3D; beam: THREE.Mesh }>();
    private readonly targets: TargetView[] = [];
    /** An arena match: the blues' own buildings (the reds' aim), and the reds' cannon at the far end. */
    private readonly ownTargets: TargetView[] = [];
    private readonly redCannon = new THREE.Group();
    private redRecoil = 0;
    /** An arena match: the cannons' row (z up the field: the reds' is its mirror). */
    private cannonRow = 0;
    private redFlashLife = 0;
    private readonly danger: THREE.Mesh;
    private readonly bits = new Bits();
    private readonly puffs: { mesh: THREE.Mesh; life: number }[] = [];
    private nextPuff = 0;
    /** Special units' landing shockwaves: flat rings growing out and fading. */
    private readonly rings: { mesh: THREE.Mesh; life: number; radius: number }[] = [];
    private nextRing = 0;
    private recoil = 0;
    private flashLife = 0;
    private time = 0;
    private disposed = false;
    private readonly waters: THREE.Mesh[] = [];
    /** Each obstacle's breakable view, by the obstacle's index (undefined for the rest). */
    private readonly breakables: (BreakableView | undefined)[] = [];

    /**
     * `plainForts`: the enemy's forts as the plain ones made here, not the barracks and tower models (a zone's choice).
     * `edge`: how far an island's ground reaches past the hedges, every side (unset: as the theme has it; the main
     * screen's is much wider).
     */
    public constructor(config: BattleConfig, targets: readonly Target[], private readonly theme: Theme, private readonly modelRoot = './mob/models/',
        private readonly plainForts = false, private readonly edge?: number, ownTargets: readonly Target[] = []) {
        this.danger = this.buildGround();
        if (theme.kit) void this.buildKit();
        this.buildCannon(this.cannon, COLORS.blue);
        this.barrel = this.cannon.getObjectByName('barrel')!;
        this.flash = this.cannon.getObjectByName('flash') as THREE.Mesh;
        config.gates.forEach((gate) => this.gates.push(this.buildGate(gate)));
        (config.obstacles ?? []).forEach((obstacle, i) => { this.breakables[i] = this.buildObstacle(obstacle); });
        (config.spinners ?? []).forEach((spinner) => this.spinners.push(this.buildSpinner(spinner)));
        (config.pushers ?? []).forEach((pusher) => this.pushers.push(this.buildPusher(pusher)));
        (config.pads ?? []).forEach((pad) => this.pads.push(this.buildPad(pad)));
        (config.pushBlocks ?? []).forEach((block) => this.pushBlocks.push(this.buildPushBlock(block)));
        (config.helmets ?? []).forEach((barrier) => this.helmetIcons.push(this.buildHelmetBarrier(barrier)));
        (config.pipes ?? []).forEach((pipe) => this.buildPipe(pipe));
        (config.grinders ?? []).forEach((grinder) => this.grinders.push(this.buildGrinder(grinder)));
        void this.loadUnits();
        // A boss level (a Giant King): the main building (the one with the most HP) wears his hat.
        const crowned = config.kingAt ? targets.reduce((best, target, i) => (target.hp > targets[best].hp ? i : best), 0) : -1;
        targets.forEach((target, i) => this.targets.push(this.buildTarget(target, i === crowned)));
        // An arena match: the reds' cannon at the far end (facing down the field), the blues' buildings by theirs; no
        // danger line (the reds hit the buildings instead).
        // The cannon's tracks, across its slide.
        this.buildTracks(CANNON_Z + (config.duel?.cannonZ ?? 0), ARENA.cannonRange);
        if (config.duel) {
            this.cannonRow = config.duel.cannonZ;
            this.buildTracks(ARENA.baseZ - CANNON_Z - this.cannonRow, ARENA.cannonRange);
            this.cannon.position.z = CANNON_Z + this.cannonRow;
            this.buildCannon(this.redCannon, COLORS.red);
            this.redCannon.rotation.y = Math.PI;
            this.redCannon.position.set(0, 0, ARENA.baseZ - CANNON_Z - this.cannonRow);
            ownTargets.forEach((target) => this.ownTargets.push(this.buildTarget(target, false, true)));
            this.danger.visible = false;
            // A match's life shows as bars over each building (the HUD's), not numbers on them.
            for (const view of [...this.targets, ...this.ownTargets]) view.label.mesh.visible = false;
            for (const [cannon, colour] of [[this.cannon, 0xffd23f], [this.redCannon, 0xffd23f]] as [THREE.Group, number][]) {
                const ring = new THREE.Mesh(new THREE.TorusGeometry(EXPOSED.radius, EXPOSED.tube, 8, 40), new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.9 }));
                ring.rotation.x = Math.PI / 2;
                ring.position.y = EXPOSED.y;
                ring.visible = false;
                ring.name = 'exposed';
                cannon.add(ring);
            }
        }
        this.buildPuffs();
        this.buildRings();
        this.group.add(this.bits.mesh);
        bendObject(this.group);
    }

    /** Every number and word over the field hidden (the main screen's view of a level: just the pieces). */
    /** The forts' own numbers hidden (the battle shows a bar over each instead). */
    public hideTargetLabels(): void {
        for (const view of this.targets) view.label.mesh.visible = false;
    }

    public hideLabels(): void {
        this.group.traverse((object) => {
            if (object.userData.label) object.visible = false;
        });
    }

    /** Frees what isn't freed with the scene (the waters' shore textures). */
    public dispose(): void {
        this.disposed = true;
        for (const water of this.waters) (water.userData.free as (() => void) | undefined)?.();
    }

    // ------------------------------------------------------------------ building

    /** How far an island's ground reaches past the hedges at its sides. */
    private islandEdge(): number {
        return this.edge ?? (this.theme.kit ? KIT_GRASS_EDGE : GRASS_EDGE);
    }

    /** The island's ends (z): where its sand starts past the cannon's end and stops behind the base, before they round off. */
    private coastEnds(): { near: number; far: number } {
        const ends = this.edge ?? GRASS_EDGE;
        return { near: FIELD_NEAR + ends, far: fieldFar() - ends };
    }

    /**
     * How far the island's sand reaches from the middle at `z`, on one `side` (-1 left, 1 right): past the hedges by
     * COAST.least at the least, out to the island's edge at the most, in smooth waves (each side its own); its ends round
     * off over COAST.cap (0 past them).
     */
    private coastHalf(z: number, side: number): number {
        const inner = ARENA.halfWidth + HEDGE.width;
        const seed = COAST.seed[side < 0 ? 0 : 1];
        const [a, b, c] = COAST.waves;
        const wave = 0.5 * Math.sin(z / a * 2.1 + seed) + 0.3 * Math.sin(z / b * 1.7 + seed * 2.3) + 0.2 * Math.sin(z / c * 1.3 + seed * 3.1);
        const reach = this.islandEdge() - COAST.least;
        let half = inner + COAST.least + reach * (0.55 + 0.45 * wave);
        const { near, far } = this.coastEnds();
        const past = z > near ? z - near : z < far ? far - z : 0;
        if (past > 0) half *= Math.sqrt(Math.max(0, 1 - (past / COAST.cap) ** 2));
        return half;
    }

    /**
     * The island's ground: rows along the field (COAST.row apart), each from the left coast to the right in even steps
     * (fine enough to follow the bend), from one rounded end to the other.
     */
    private coastGround(): THREE.BufferGeometry {
        const { near, far } = this.coastEnds();
        const top = near + COAST.cap;
        const bottom = far - COAST.cap;
        const rows = Math.ceil((top - bottom) / COAST.row);
        const columns = bendSegments((ARENA.halfWidth + HEDGE.width + this.islandEdge()) * 2);
        const positions: number[] = [];
        const index: number[] = [];
        for (let r = 0; r <= rows; r++) {
            const z = top - (r / rows) * (top - bottom);
            const left = -this.coastHalf(z, -1);
            const right = this.coastHalf(z, 1);
            for (let c = 0; c <= columns; c++) positions.push(left + (c / columns) * (right - left), 0, z);
        }
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < columns; c++) {
                const a = r * (columns + 1) + c;
                const b = a + columns + 1;
                // Wound to face up.
                index.push(a, a + 1, b, a + 1, b + 1, b);
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex(index);
        geometry.computeVertexNormals();
        return geometry;
    }

    /** The island's coast as a closed outline (the sea's shore): down the right side, back up the left. */
    private coastOutline(): { x: number; z: number }[] {
        const { near, far } = this.coastEnds();
        const top = near + COAST.cap;
        const bottom = far - COAST.cap;
        const steps = Math.ceil((top - bottom) / 0.5);
        const right: { x: number; z: number }[] = [];
        const left: { x: number; z: number }[] = [];
        for (let k = 0; k <= steps; k++) {
            const z = top - (k / steps) * (top - bottom);
            right.push({ x: this.coastHalf(z, 1), z });
            left.push({ x: -this.coastHalf(z, -1), z });
        }
        return [...right, ...left.reverse()];
    }

    private buildGround(): THREE.Mesh {
        const length = FIELD_NEAR - fieldFar();
        const middle = (FIELD_NEAR + fieldFar()) / 2;
        const valley = this.theme.surround === 'valley';
        // The island: the field, its hedges, and a grass edge round them; the sea all round (UFO's water). A valley:
        // grass everywhere, cliffs either side and behind the base.
        const islandHalf = VALLEY.groundHalf;
        if (valley) {
            this.buildCliffs();
        } else {
            // The coast: wavy sides, rounded ends (coastHalf).
            // (The main screen's island, seen from further off: a sea to every edge of the screen.)
            const seaSize = this.edge !== undefined ? 420 : 0;
            const sea = createWater(this.theme.sea, seaSize || 130, seaSize || 170, this.coastOutline(), 0, middle);
            this.waters.push(sea);
            this.group.add(sea);
        }
        if (valley) {
            // The ground (the water's shading, still: light by the field, darker off), out to every edge of the screen on
            // the main screen (seen from further off).
            const wide = this.edge !== undefined;
            const grass = createGround(this.theme.ground, wide ? WIDE_GROUND : islandHalf * 2, wide ? WIDE_GROUND : VALLEY.groundLength, this.coastOutline(), 0, middle, -0.01, wide ? 48 : undefined);
            this.waters.push(grass);
            this.group.add(grass);
        } else {
            // The island's ground, to its wavy coast (cut finely: the bend drops it sideways too, and a wide piece would
            // sag under the sea between its corners).
            const sand = new THREE.Mesh(this.coastGround(), lambert(this.theme.ground));
            sand.position.y = -0.01;
            this.group.add(sand);
        }
        // Cut finely across too: the bend drops it sideways as well, and a coarse piece sags under the ground below it.
        const across = bendSegments(ARENA.halfWidth * 2);
        const field = new THREE.Mesh(new THREE.PlaneGeometry(ARENA.halfWidth * 2, length, across, bendSegments(length)), lambert(this.theme.field));
        field.rotation.x = -Math.PI / 2;
        field.position.set(0, 0, middle);
        this.group.add(field);
        // Soft stripes across the field (darker sand), for a sense of distance.
        // (Pulled toward the camera in the depth test, and cut finer than the field: the bend curves it at least as much,
        // so from further off — the arena's camera — it never fights the field under it.)
        const stripe = lambert(this.theme.stripe, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
        for (let z = FIELD_NEAR - 2; z > fieldFar(); z -= 4) {
            const band = new THREE.Mesh(new THREE.PlaneGeometry(ARENA.halfWidth * 2, 2, across * 2, 4), stripe);
            band.rotation.x = -Math.PI / 2;
            band.position.set(0, 0.005, z);
            this.group.add(band);
        }
        // The hedges either side: a row of bush blocks (short pieces follow the bend). A kit with wall pieces has those instead.
        const hedge = lambert(this.theme.hedge[0]);
        const hedgeDark = lambert(this.theme.hedge[1]);
        const blocks = this.theme.kit?.wall || valley ? 0 : Math.ceil(length / HEDGE_BLOCK);
        for (const side of [-1, 1]) {
            for (let b = 0; b < blocks; b++) {
                const block = roundedBox(HEDGE.width, HEDGE.height, HEDGE_BLOCK - 0.08, 0.28, b % 2 ? hedgeDark : hedge);
                block.position.set(side * (ARENA.halfWidth + HEDGE.width / 2), 0, FIELD_NEAR - (b + 0.5) * HEDGE_BLOCK);
                this.group.add(block);
            }
        }
        // The danger line: a red strip just before the cannon (it pulses as reds get near).
        const danger = new THREE.Mesh(new THREE.PlaneGeometry(ARENA.halfWidth * 2, 0.22, 6, 1), new THREE.MeshBasicMaterial({ color: COLORS.red, transparent: true, opacity: 0.75 }));
        danger.rotation.x = -Math.PI / 2;
        danger.position.set(0, 0.01, ARENA.dangerZ);
        this.group.add(danger);
        // (The cannon runs on its train tracks: buildTracks.)
        return danger;
    }

    /**
     * The theme's kit: wall pieces down both sides of the field (a pillar every few), towers at the corners, props dotted
     * on the ground outside (a seeded scatter). Loaded after the field is up; each piece bent with the world.
     */
    private async buildKit(): Promise<void> {
        const kit = this.theme.kit!;
        const names = new Set<string>([...(kit.wall ? [kit.wall] : []), ...(kit.pillar ? [kit.pillar] : []), ...(kit.tower ?? []), ...(kit.props ?? []).map((p) => p.model)]);
        const valley = this.theme.surround === 'valley';
        const ground = valley ? this.theme.cliff?.height ?? 0 : 0;
        const models = new Map<string, THREE.Object3D>();
        await Promise.all([...names].map(async (name) => {
            try {
                models.set(name, await loadKitModel(`${this.modelRoot}${name}`));
            } catch (error) {
                console.warn('[mob] kit model', name, error);
            }
        }));
        if (this.disposed) return;
        const decor = new THREE.Group();
        const place = (name: string, x: number, y: number, z: number, scale: number, rotation: number) => {
            const model = models.get(name);
            if (!model) return;
            const piece = model.clone();
            piece.position.set(x, y, z);
            piece.scale.setScalar(scale);
            piece.rotation.y = rotation;
            decor.add(piece);
        };
        // The walls: 1-unit pieces along X in the kit, turned to run along the field.
        const length = FIELD_NEAR - fieldFar();
        const pieces = Math.ceil(length / kit.scale);
        const wallX = ARENA.halfWidth + kit.scale * 0.5;
        for (const side of kit.wall ? [-1, 1] : []) {
            for (let p = 0; p < pieces; p++) {
                const z = FIELD_NEAR - (p + 0.5) * kit.scale;
                const pillar = !!kit.pillar && !!kit.pillarEvery && p % kit.pillarEvery === 0;
                place(pillar ? kit.pillar! : kit.wall!, side * wallX, 0, z, kit.scale, Math.PI / 2);
            }
        }
        // Towers at the corners: their pieces stacked.
        const towerScale = kit.scale * 1.2;
        // In a valley, the towers stand on the cliffs by the far end.
        const towerX = valley ? ARENA.halfWidth + VALLEY.gap + VALLEY.band + 1.2 : wallX;
        const towerZs = valley ? [fieldFar() + 3] : [FIELD_NEAR - kit.scale * 0.5, fieldFar() + kit.scale * 0.5];
        for (const x of [-towerX, towerX]) {
            for (const z of towerZs) {
                let y = ground;
                for (const name of kit.tower ?? []) {
                    place(name, x, y, z, towerScale, 0);
                    y += pieceHeight(models.get(name)) * towerScale;
                }
            }
        }
        // Props outside the walls, either side (seeded: the same layout every time).
        const random = seeded(7);
        // In a valley, near the cliff edge (where the camera sees them), a few further back.
        const inner = valley ? ARENA.halfWidth + VALLEY.gap + 1.6 : wallX + kit.scale * 0.9;
        const outer = valley ? inner + 4.5 : ARENA.halfWidth + HEDGE.width + this.islandEdge() - 0.5;
        for (const prop of kit.props ?? []) {
            for (let n = 0; n < prop.count; n++) {
                const side = random() < 0.5 ? -1 : 1;
                let x = side * (inner + random() * (outer - inner));
                const z = FIELD_NEAR + (valley ? 6 : -1) - random() * (length + (valley ? 6 : -2));
                // On an island, on the sand: in from the coast where it comes in.
                if (!valley) x = side * Math.min(Math.abs(x), Math.max(inner, this.coastHalf(z, side) - 0.7));
                const model = models.get(prop.model);
                if (!model) continue;
                // Its base on the ground, scaled to its height.
                const piece = fitted(model, prop.height, 'y');
                piece.position.set(x, ground, z);
                piece.rotation.y = random() * Math.PI * 2;
                decor.add(piece);
            }
        }
        bendObject(decor);
        this.group.add(decor);
    }

    /**
     * A valley's cliffs: either side of the field and across behind the base, a band with a wavy grass edge and a dirt face
     * (extruded, its long edges cut short so it follows the bend), and past it a flat grass top (a segmented plane, so
     * the bend reaches its far side too).
     */
    private buildCliffs(): void {
        // The main screen's (seen from further off): the cliffs' tops out to every edge of the screen.
        const wide = this.edge !== undefined;
        const cliff = this.theme.cliff ?? { height: 2.4, top: this.theme.ground, side: 0xa8774a };
        const wave = (v: number) => 0.35 * Math.sin(v * 0.7) + 0.22 * Math.sin(v * 1.9 + 1.3) + 0.12 * Math.sin(v * 3.7 + 0.4);
        const near = FIELD_NEAR + VALLEY.nearExtra;
        const back = fieldFar() - 0.3;
        // Sides: the inner edge just off the field (never over it), the band VALLEY.band wide.
        for (const side of [-1, 1]) {
            const inner: [number, number][] = [];
            for (let z = near; z >= back - VALLEY.band; z -= 0.5) inner.push([side * (ARENA.halfWidth + VALLEY.gap + Math.abs(wave(z + side * 3))), z]);
            this.addCliffBands(inner, ([x, z]) => [x + side * VALLEY.band, z], cliff);
            // Its top: the ground's still shading (as the ground below: no hard-edged flat colour), out to the screen's
            // edges on the main screen.
            const innerX = ARENA.halfWidth + VALLEY.gap + VALLEY.band * 0.6;
            const topWidth = (wide ? WIDE_GROUND / 2 : VALLEY.groundHalf) - innerX;
            const from = wide ? WIDE_GROUND / 2 : near;
            const to = back - (wide ? WIDE_GROUND / 2 : VALLEY.back);
            const top = createGround(cliff.top, topWidth, from - to, this.coastOutline(), side * (innerX + topWidth / 2), (from + to) / 2, cliff.height - 0.02, wide ? 48 : undefined);
            this.waters.push(top);
            this.group.add(top);
        }
        // Behind the base: a band across, then the top.
        const across: [number, number][] = [];
        const half = ARENA.halfWidth + VALLEY.gap + 0.8;
        for (let x = -half; x <= half; x += 0.5) across.push([x, back - Math.abs(wave(x * 1.3))]);
        this.addCliffBands(across, ([x, z]) => [x, z - VALLEY.band], cliff);
        const depth = wide ? WIDE_GROUND / 2 : VALLEY.back;
        const width = half * 2 + 1;
        const top = createGround(cliff.top, width, depth, this.coastOutline(), 0, back - VALLEY.band * 0.6 - depth / 2, cliff.height - 0.025, wide ? 48 : undefined);
        this.waters.push(top);
        this.group.add(top);
    }

    /**
     * A cliff band along `edge` (its inner edge's points; `out` gives each one's outer point), in short pieces: one long
     * piece's top is cut into triangles the whole band long, which sag under the bend (the cliff top beside it shows over).
     */
    private addCliffBands(edge: [number, number][], out: (point: [number, number]) => [number, number], cliff: { height: number; top: number; side: number }): void {
        for (let start = 0; start < edge.length - 1; start += CLIFF_PIECE) {
            const piece = edge.slice(start, start + CLIFF_PIECE + 1);
            if (piece.length < 2) break;
            this.addCliffBand([...piece, ...piece.map(out).reverse()], cliff);
        }
    }

    /** One cliff band from its outline ([x, z] corners): extruded to the cliff's height, grass on top, dirt down its face. */
    private addCliffBand(outline: [number, number][], cliff: { height: number; top: number; side: number }): void {
        const xs = outline.map((p) => p[0]);
        const zs = outline.map((p) => p[1]);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
        const mesh = this.extrude(new Float32Array(outline.flat()), cx, cz, cliff.height, cliff.top, cliff.side);
        mesh.position.set(cx, 0, cz);
        this.group.add(mesh);
    }

    /** Train tracks across the cannon's slide at row z: the track image on a flat strip, cut finely so the bend curves it. */
    private buildTracks(z: number, range: number): void {
        const length = range * 2 + TRACKS.past * 2;
        const geometry = new THREE.PlaneGeometry(length, TRACKS.depth, Math.max(8, Math.ceil(length / TRACKS.segment)), 2);
        // The image tiles along it (a whole number of tiles, centred).
        const tiles = Math.max(1, Math.round(length / TRACKS.tile));
        const uv = geometry.attributes.uv as THREE.BufferAttribute;
        for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * tiles);
        const material = new THREE.MeshLambertMaterial({ map: trackTexture(), transparent: true, alphaTest: 0.05, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
        const strip = new THREE.Mesh(geometry, material);
        strip.rotation.x = -Math.PI / 2;
        strip.position.set(0, TRACKS.y, z);
        strip.renderOrder = 1;
        this.group.add(strip);
    }

    /** An arena match: whose cannon is open to hits now (the ring round it pulses). */
    public showExposed(blue: boolean, red: boolean): void {
        const own = this.cannon.getObjectByName('exposed');
        const theirs = this.redCannon.getObjectByName('exposed');
        if (own) own.visible = blue;
        if (theirs) theirs.visible = red;
    }

    private buildCannon(cannon: THREE.Group, colour: number): void {
        const blue = lambert(colour);
        const dark = lambert(0x24304f);
        const body = roundedBox(1.1, 0.5, 1, 0.3, blue);
        body.position.y = 0.25;
        cannon.add(body);
        for (const side of [-1, 1]) {
            for (const end of [-1, 1]) {
                const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.2, 14), dark);
                wheel.rotation.z = Math.PI / 2;
                wheel.position.set(side * 0.6, 0.22, end * 0.32);
                cannon.add(wheel);
            }
        }
        const barrel = new THREE.Group();
        barrel.name = 'barrel';
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 1.1, 18), blue);
        tube.rotation.x = Math.PI / 2;
        tube.position.z = -0.35;
        barrel.add(tube);
        const muzzle = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.07, 8, 18), lambert(0xffffff));
        muzzle.position.z = -0.9;
        barrel.add(muzzle);
        const flash = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), new THREE.MeshBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 0 }));
        flash.name = 'flash';
        flash.position.z = -1.05;
        barrel.add(flash);
        barrel.position.y = 0.75;
        barrel.rotation.x = 0.18;
        cannon.add(barrel);
        cannon.position.set(0, 0, CANNON_Z);
        this.group.add(cannon);
    }

    private buildGate(gate: GateConfig): GateView {
        const group = new THREE.Group();
        // An arena match's red gate (it multiplies the reds): red.
        const colour = gate.team === 'red' ? RED_SIDE.gate : COLORS.gate;
        const panel = new THREE.Mesh(
            new THREE.BoxGeometry(gate.width, GATE.height, GATE.depth),
            new THREE.MeshLambertMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.35, transparent: true, opacity: 0.85 }),
        );
        panel.position.y = GATE.height / 2;
        group.add(panel);
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(gate.width, 1.2), new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
        glow.position.y = 0.6;
        group.add(glow);
        const post = lambert(gate.team === 'red' ? RED_SIDE.post : 0x2f6fd1);
        for (const side of [-1, 1]) {
            const pole = roundedBox(GATE.post, GATE.postHeight, GATE.post * 1.6, 0.08, post);
            pole.position.set(side * (gate.width / 2 + GATE.post / 2), 0, 0);
            group.add(pole);
        }
        const label = new Label(1.6 * 2, 0.8 * 2);
        label.set(`x${gate.value}`);
        label.mesh.position.set(0, (gate.lock ?? 0) > 0 ? LOCK.labelY : 1.25, 0);
        label.mesh.rotation.x = -0.6;
        group.add(label.mesh);
        group.position.set(gate.x, 0, gate.z);
        this.group.add(group);
        const view: GateView = { group, panel, label: label.mesh, pulse: 0 };
        if ((gate.lock ?? 0) > 0) view.lock = this.buildLock(gate, group, [panel.material as THREE.MeshLambertMaterial, glow.material as THREE.MeshBasicMaterial, post]);
        return view;
    }

    /**
     * A pipe: along its centre line (pipePath: a roller coaster's hill from one opening, lying on the field and open
     * along it, over to the other); a rim round each opening and the dark inside.
     */
    private buildPipe(pipe: PipeConfig): void {
        const [a, b] = pipeEnds(pipe);
        const r = PIPE.radius;
        const path = new THREE.CatmullRomCurve3(pipePath(pipe).map(([x, y, z]) => new THREE.Vector3(x, y, z)));
        const body = new THREE.Mesh(new THREE.TubeGeometry(path, Math.max(96, bendSegments(path.getLength()) * 3), r, 20, false), lambert(pipeColours(pipe).body));
        this.group.add(body);
        for (const end of [a, b]) {
            // The opening faces along the field: the rim stood up across it, the dark inside just within.
            const rim = new THREE.Mesh(new THREE.TorusGeometry(r, PIPE_LOOK.rimTube, 10, 28), lambert(pipeColours(pipe).rim));
            rim.position.set(end.x, r, end.z);
            this.group.add(rim);
            const inside = new THREE.Mesh(new THREE.CircleGeometry(r - 0.02, 28), new THREE.MeshBasicMaterial({ color: pipeColours(pipe).inside }));
            inside.position.set(end.x, r, end.z - end.facing * 0.05);
            if (end.facing < 0) inside.rotation.y = Math.PI;
            this.group.add(inside);
        }
    }

    /**
     * A grinder: a dark steel roller lying on the field (along x, turned to lie along z for a vertical one), rings of
     * spikes round it and red bands at its ends; a standing one held up by a post at each end.
     */
    private buildGrinder(grinder: GrinderConfig): GrinderView {
        const radius = grinder.thickness / 2;
        const length = grinder.length;
        const holder = new THREE.Group();
        const roller = new THREE.Group();
        const core = radius * GRINDER.core;
        const body = new THREE.Mesh(new THREE.CylinderGeometry(core, core, length, 18, 1).rotateZ(Math.PI / 2), lambert(GRINDER.roller));
        roller.add(body);
        for (const side of [-1, 1]) {
            const band = new THREE.Mesh(new THREE.CylinderGeometry(core * 1.08, core * 1.08, Math.min(0.22, length * 0.08), 18).rotateZ(Math.PI / 2), lambert(GRINDER.band));
            band.position.x = side * (length / 2 - Math.min(0.11, length * 0.04));
            roller.add(band);
        }
        // The spikes: a ring every ringGap x thickness, each ring turned half a step from the last.
        const spikeLength = radius - core;
        const spike = new THREE.ConeGeometry(Math.max(0.05, spikeLength * 0.42), spikeLength * 1.15, 6);
        const spikeMaterial = lambert(GRINDER.spike);
        const rings = Math.max(2, Math.floor(length / Math.max(0.2, grinder.thickness * GRINDER.ringGap)));
        for (let k = 0; k < rings; k++) {
            const x = -length / 2 + ((k + 0.5) / rings) * length;
            for (let n = 0; n < GRINDER.perRing; n++) {
                const angle = ((n + (k % 2) * 0.5) / GRINDER.perRing) * Math.PI * 2;
                const cone = new THREE.Mesh(spike, spikeMaterial);
                cone.position.set(x, Math.cos(angle) * (core + spikeLength * 0.5), Math.sin(angle) * (core + spikeLength * 0.5));
                cone.rotation.x = angle;
                roller.add(cone);
            }
        }
        holder.add(roller);
        roller.position.y = radius;
        if (!grinder.move) {
            // Standing: a post at each end, the roller's axle through them.
            for (const side of [-1, 1]) {
                const post = roundedBox(GRINDER.postWidth, radius * 2 + 0.25, GRINDER.postWidth * 1.6, 0.06, lambert(GRINDER.post));
                post.position.set(side * (length / 2 + GRINDER.postWidth / 2), 0, 0);
                holder.add(post);
            }
        }
        // Built along x; a vertical one lies along the field.
        if (grinder.axis === 'z') holder.rotation.y = Math.PI / 2;
        holder.position.set(grinder.x, 0, grinder.z);
        this.group.add(holder);
        return { holder, roller, radius, angle: 0 };
    }

    /** A mob ground up at (x, z): bits of it in its colour, and grit. */
    public ground(x: number, z: number, color: number, big: boolean): void {
        this.bits.burst(x, 0.5, z, [color, 0x7a0f1c, GRINDER.spike], big ? 24 : 6, big ? 4.5 : 3, big ? 6 : 4.5, big ? 0.8 : 0.5, big ? 0.2 : 0.12);
    }

    /** A mob went into a pipe, or came out of one, at that end: a little puff there. */
    public pipeMouth(pipe: PipeConfig, end: number, team: number): void {
        const at = pipeEnds(pipe)[end];
        this.bits.burst(at.x, PIPE.radius, at.z + at.facing * 0.3, [pipeColours(pipe).rim, team === 0 ? COLORS.blue : COLORS.red], 2, 1.8, 3, 0.4, 0.12);
    }

    /** A locked gate's lock: its materials greyed, bars across its span, a padlock in the middle with the hits left. */
    private buildLock(gate: GateConfig, group: THREE.Group, materials: (THREE.MeshLambertMaterial | THREE.MeshBasicMaterial)[]): NonNullable<GateView['lock']> {
        const greyed = materials.map((material) => {
            const was = { material, color: material.color.getHex(), emissive: material instanceof THREE.MeshLambertMaterial ? material.emissive.getHex() : undefined };
            material.color.setHex(LOCK.grey);
            if (material instanceof THREE.MeshLambertMaterial) material.emissive.setHex(0x000000);
            return was;
        });
        const lock = new THREE.Group();
        const bar = lambert(LOCK.dark);
        const bars = Math.max(2, Math.round(gate.width / LOCK.barGap));
        for (let k = 0; k <= bars; k++) {
            const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, LOCK.barHeight, 8), bar);
            rod.position.set(-gate.width / 2 + (k / bars) * gate.width, LOCK.barHeight / 2, 0);
            lock.add(rod);
        }
        for (const y of [0.18, LOCK.barHeight - 0.08]) {
            const rail = new THREE.Mesh(new THREE.BoxGeometry(gate.width, 0.1, 0.12), bar);
            rail.position.y = y;
            lock.add(rail);
        }
        // The padlock: a shackle over a rounded body, its hits on the front.
        const padlock = new THREE.Group();
        const metal = lambert(LOCK.metal);
        const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.1, 8, 20, Math.PI), metal);
        shackle.position.y = 0.55;
        const body = roundedBox(1.6, 1.15, 0.36, 0.14, lambert(LOCK.grey));
        body.position.y = -0.575;
        padlock.add(shackle, body);
        // Big, flat on the body's face (inside its edges: three digits fit); the padlock is tipped back towards the
        // camera, so it reads from above.
        const hits = new Label(1.5, 1.0, 256, '#ffffff');
        hits.set(String(gate.lock));
        hits.mesh.position.set(0, 0, 0.19);
        padlock.add(hits.mesh);
        padlock.rotation.x = LOCK.padlockTilt;
        padlock.position.set(0, LOCK.padlockY, 0.12);
        lock.add(padlock);
        group.add(lock);
        return { group: lock, hits, greyed, shake: 0, open: false };
    }

    /** A locked gate hit at (x, z): its lock jolts, a grey chip flies. */
    public hitLock(index: number, x: number, z: number): void {
        const lock = this.gates[index]?.lock;
        if (!lock || lock.open) return;
        lock.shake = 0.12;
        this.bits.burst(x, 0.7, z, [LOCK.grey, LOCK.dark], 2, 2.5, 3.5, 0.5, 0.14);
    }

    /** A locked gate worn down: the lock bursts off, its colours come back, it pulses. */
    public unlockGate(index: number): void {
        const view = this.gates[index];
        const lock = view?.lock;
        if (!view || !lock || lock.open) return;
        lock.open = true;
        lock.group.visible = false;
        for (const { material, color, emissive } of lock.greyed) {
            material.color.setHex(color);
            if (emissive !== undefined && material instanceof THREE.MeshLambertMaterial) material.emissive.setHex(emissive);
        }
        view.label.position.y = 1.25;
        view.pulse = 1;
        const { x, z } = view.group.position;
        this.bits.burst(x, 0.7, z, [LOCK.grey, LOCK.dark, LOCK.metal, 0x9fe6ff], 40, 5, 6, 1, 0.22);
        this.puff(x, z, 0xdfe6ee, 2.5);
    }

    /** A water hole with a dark rim, a raised grass block, or a brick block to break (its view returned). */
    private buildObstacle(o: ObstacleConfig): BreakableView | undefined {
        // An enemy wall: not seen.
        if (o.kind === 'enemyWall') return undefined;
        const x = o.x ?? 0;
        const z = o.z ?? 0;
        if (o.kind === 'water' && o.points && o.points.length >= 3) {
            // A drawn hole: the water fills the outline; a rim a little outside it.
            const outline = o.points.map(([px, pz]) => ({ x: px, z: pz }));
            const xs = outline.map((p) => p.x);
            const zs = outline.map((p) => p.z);
            const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
            const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
            const width = Math.max(...xs) - Math.min(...xs);
            const depth = Math.max(...zs) - Math.min(...zs);
            const rimShape = new THREE.Shape(grow(outline, 0.22).map((p) => new THREE.Vector2(p.x - cx, -(p.z - cz))));
            const rim = new THREE.Mesh(new THREE.ShapeGeometry(rimShape).rotateX(-Math.PI / 2), lambert(this.theme.rim));
            rim.position.set(cx, 0.012, cz);
            this.group.add(rim);
            const water = createWater(this.theme.sea, width, depth, outline, cx, cz, { deepAt: Math.min(width, depth) * 0.6, polygon: true, y: 0.02 });
            this.waters.push(water);
            this.group.add(water);
            return undefined;
        }
        if (o.kind === 'water') {
            const round = o.radius !== undefined;
            const width = round ? o.radius! * 2 : o.width ?? 1;
            const depth = round ? o.radius! * 2 : o.depth ?? 1;
            const rimMaterial = lambert(this.theme.rim);
            const rim = round
                ? new THREE.Mesh(new THREE.CircleGeometry(o.radius! + 0.22, 32).rotateX(-Math.PI / 2), rimMaterial)
                : new THREE.Mesh(new THREE.PlaneGeometry(width + 0.44, depth + 0.44, 2, bendSegments(depth)).rotateX(-Math.PI / 2), rimMaterial);
            rim.position.set(x, 0.012, z);
            this.group.add(rim);
            const outline = round
                ? Array.from({ length: 32 }, (_, i) => ({ x: x + Math.sin((i / 32) * Math.PI * 2) * o.radius!, z: z + Math.cos((i / 32) * Math.PI * 2) * o.radius! }))
                : [{ x: x - width / 2, z: z - depth / 2 }, { x: x + width / 2, z: z - depth / 2 }, { x: x + width / 2, z: z + depth / 2 }, { x: x - width / 2, z: z + depth / 2 }];
            const water = createWater(this.theme.sea, width, depth, outline, x, z, { deepAt: Math.min(width, depth) * 0.6, round, y: 0.02, segments: Math.max(4, Math.ceil(Math.max(width, depth) * 2)) });
            this.waters.push(water);
            this.group.add(water);
            return undefined;
        }
        const breakable = o.kind === 'breakable';
        if (o.radius !== undefined && !o.points) {
            const pillar = new THREE.Mesh(new THREE.CylinderGeometry(o.radius, o.radius, WALL_HEIGHT, 20), [lambert(this.theme.block.side), lambert(this.theme.block.top), lambert(this.theme.block.top)]);
            pillar.position.set(x, WALL_HEIGHT / 2, z);
            this.group.add(pillar);
            if (!breakable) return undefined;
        }
        // Any outline (a box is four corners): the block built from it, as the level loads.
        const shape = obstacleShape(o);
        const [cx, cz] = shapeCentre(shape);
        const mesh = this.extrude(shape.points, cx, cz, breakable ? BLOCK.brickHeight : WALL_HEIGHT, breakable ? this.theme.breakable.top : this.theme.block.top, breakable ? this.theme.breakable.side : this.theme.block.side);
        mesh.position.set(cx, 0, cz);
        this.group.add(mesh);
        if (!breakable) return undefined;
        const label = new Label(1.8 * 2, 0.8 * 2);
        label.set(String(o.hp ?? 40));
        label.mesh.position.set(cx, BLOCK.brickHeight + 0.7, cz);
        label.mesh.rotation.x = -0.6;
        this.group.add(label.mesh);
        return { mesh, label, centreX: cx, centreZ: cz, shake: 0, gone: false };
    }

    /**
     * A raised block from a polygon (flat [x, z, x, z, ...] corners): extruded `height` up with a rounded top edge, the
     * top one colour and the sides another. Long edges are cut into short pieces, so the block follows the world's bend.
     */
    private extrude(points: Float32Array, cx: number, cz: number, height: number, top: number, side: number): THREE.Mesh {
        const shape = new THREE.Shape();
        const n = points.length / 2;
        for (let i = 0; i <= n; i++) {
            const a = (i % n) * 2;
            const bx = points[a] - cx;
            // The shape is drawn in x / y and stood up afterwards: its y becomes -z.
            const by = -(points[a + 1] - cz);
            if (i === 0) {
                shape.moveTo(bx, by);
                continue;
            }
            const p = ((i - 1) % n) * 2;
            const ax = points[p] - cx;
            const ay = -(points[p + 1] - cz);
            const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 1));
            for (let s = 1; s <= steps; s++) shape.lineTo(ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps);
        }
        const bevel = Math.min(BLOCK.bevel, height * 0.3);
        const geometry = new THREE.ExtrudeGeometry(shape, { depth: height - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: 4 });
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, bevel, 0);
        // ExtrudeGeometry's groups: 0 the caps (top and bottom), 1 the sides.
        return new THREE.Mesh(geometry, [lambert(top), lambert(side)]);
    }

    /** A post with `arms` yellow and black bars round it, turned each frame to the battle's angle. */
    private buildSpinner(s: SpinnerConfig): THREE.Group {
        const group = new THREE.Group();
        const post = new THREE.Mesh(new THREE.CylinderGeometry(SPINNER.post, SPINNER.post * 1.2, SPINNER.height + 0.4, 20), lambert(0x2b2f45));
        post.position.y = (SPINNER.height + 0.4) / 2;
        group.add(post);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(SPINNER.post * 0.9, 16, 10), lambert(0xffd23f));
        cap.position.y = SPINNER.height + 0.4;
        group.add(cap);
        const yellow = lambert(0xffd23f);
        const black = lambert(0x2b2f45);
        const stripes = Math.max(2, Math.round(s.length / 0.6));
        for (let a = 0; a < s.arms; a++) {
            const arm = new THREE.Group();
            for (let k = 0; k < stripes; k++) {
                const length = s.length / stripes;
                const bar = new THREE.Mesh(new THREE.BoxGeometry(SPINNER.thickness, SPINNER.height, length), k % 2 ? black : yellow);
                bar.position.set(0, SPINNER.height / 2 + 0.05, (k + 0.5) * length);
                arm.add(bar);
            }
            arm.rotation.y = (a / s.arms) * Math.PI * 2;
            group.add(arm);
        }
        group.position.set(s.x, 0, s.z);
        this.group.add(group);
        return group;
    }

    private buildPusher(p: PusherConfig): THREE.Group {
        const group = new THREE.Group();
        const stripes = Math.max(2, Math.round(p.width / 0.5));
        for (let k = 0; k < stripes; k++) {
            const width = p.width / stripes;
            const bar = new THREE.Mesh(new THREE.BoxGeometry(width, PUSHER_HEIGHT, p.depth), lambert(k % 2 ? 0x2b2f45 : 0xffd23f));
            bar.position.set(-p.width / 2 + (k + 0.5) * width, PUSHER_HEIGHT / 2, 0);
            group.add(bar);
        }
        group.position.set(p.x, 0, p.z);
        this.group.add(group);
        return group;
    }

    /**
     * A giant house: blue walls, a pitched roof, a glowing door facing the cannon (where the blues go in) and one at the
     * back (where the giant comes out), a fill bar over the front door, its counter ("7/16") and GIANT over the roof.
     */
    private buildPad(p: PadConfig): PadView {
        const group = new THREE.Group();
        const wallHeight = HOUSE.wallHeight;
        const kind = p.kind ?? 'giant';
        const style = houseStyle(kind);
        // The plain house's own parts (walls, roof, doors): hidden for a floor pad, or under a building.
        const houseParts: THREE.Object3D[] = [];
        // An arena match's red house (the reds walk in): red, not recoloured with the upgrades' colours.
        const red = p.team === 'red';
        const keys = red ? undefined : PROPS.houseColours[kind];
        const colours = red ? [RED_SIDE.wall, RED_SIDE.roof] : keys ? [UNIT_COLORS[keys[0]], UNIT_COLORS[keys[1]]] : [HOUSE.wall, HOUSE.roof];
        const walls = roundedBox(p.width, wallHeight, p.depth, 0.25, lambert(colours[0]));
        group.add(walls);
        houseParts.push(walls);
        // The roof: a triangle across, run the house's depth, with a little overhang.
        const roofShape = new THREE.Shape();
        const half = p.width / 2 + HOUSE.overhang;
        roofShape.moveTo(-half, 0);
        roofShape.lineTo(half, 0);
        roofShape.lineTo(0, HOUSE.roofHeight);
        roofShape.closePath();
        const roofDepth = p.depth + HOUSE.overhang * 2;
        const roofGeometry = new THREE.ExtrudeGeometry(roofShape, { depth: roofDepth, bevelEnabled: false });
        roofGeometry.translate(0, 0, -roofDepth / 2);
        const roof = new THREE.Mesh(roofGeometry, lambert(colours[1]));
        roof.position.y = wallHeight;
        group.add(roof);
        houseParts.push(roof);
        if (keys) this.houseMaterials.push({ keys, wall: walls.material as THREE.MeshLambertMaterial, roof: roof.material as THREE.MeshLambertMaterial });
        // The doors: dark openings with a glowing frame (it pulses as blues go in).
        const glow = new THREE.MeshBasicMaterial({ color: 0x7fd0ff, transparent: true, opacity: 0.6 });
        const doorWidth = Math.min(p.width * 0.55, 1.6);
        const doorHeight = wallHeight * 0.78;
        for (const side of [1, -1]) {
            const frame = new THREE.Mesh(new THREE.BoxGeometry(doorWidth + 0.24, doorHeight + 0.12, 0.06), glow);
            frame.position.set(0, (doorHeight + 0.12) / 2, side * (p.depth / 2 + 0.02));
            group.add(frame);
            houseParts.push(frame);
            const door = new THREE.Mesh(new THREE.BoxGeometry(doorWidth, doorHeight, 0.08), lambert(0x14183a));
            door.position.set(0, doorHeight / 2, side * (p.depth / 2 + 0.04));
            group.add(door);
            houseParts.push(door);
        }
        // The fill bar, on the front wall over the door.
        const barWidth = p.width * 0.8;
        const barY = doorHeight + 0.32;
        const track = new THREE.Mesh(new THREE.BoxGeometry(barWidth, 0.2, 0.08), lambert(0x1b2148));
        track.position.set(0, barY, p.depth / 2 + 0.04);
        group.add(track);
        const fill = new THREE.Mesh(new THREE.BoxGeometry(barWidth, 0.2, 0.1), lambert(0xffd23f, { emissive: 0xffd23f, emissiveIntensity: 0.3 }));
        fill.position.set(0, barY, p.depth / 2 + 0.06);
        fill.scale.x = 0.001;
        group.add(fill);
        const top = wallHeight + HOUSE.roofHeight;
        const label = new Label(2.2, 0.9);
        label.set(`0/${needOf(p)}`);
        label.mesh.position.set(0, top + 0.55, 0.3);
        label.mesh.rotation.x = -0.6;
        group.add(label.mesh);
        const title = new Label(2.4, 0.6, 256, red ? RED_SIDE.title : '#ffe066');
        title.set(PROPS.houseTitles[kind] ?? 'GIANT');
        title.mesh.position.set(0, top + 1.2, 0.1);
        title.mesh.rotation.x = -0.6;
        group.add(title.mesh);
        group.position.set(p.x, 0, p.z);
        this.group.add(group);
        // The building, when it loads: the plain house goes; the bar and the labels float over the roof.
        const keep = [track, fill, label.mesh, title.mesh];
        // Its style (the Units tab): its building (when it loads), the plain house, or a coloured pad on the floor; the
        // non-giants have what they make spinning over them (updateHouseIcon).
        if (style === 'pad') {
            for (const part of houseParts) part.visible = false;
            const slab = roundedBox(p.width, PAD_STYLE.height, p.depth, Math.min(0.35, p.width / 4), lambert(padColor(kind)));
            group.add(slab);
            // A glowing rim (it pulses as blues go in, as the doors do).
            for (const [w, d, x, z] of [[p.width, PAD_STYLE.rim, 0, p.depth / 2], [p.width, PAD_STYLE.rim, 0, -p.depth / 2], [PAD_STYLE.rim, p.depth, p.width / 2, 0], [PAD_STYLE.rim, p.depth, -p.width / 2, 0]]) {
                const edge = new THREE.Mesh(new THREE.BoxGeometry(w, PAD_STYLE.height + 0.04, d), glow);
                edge.position.set(x, (PAD_STYLE.height + 0.04) / 2, z);
                group.add(edge);
            }
            const low = PAD_STYLE.height;
            track.position.set(0, low + 0.5, 0.2);
            fill.position.set(0, low + 0.5, 0.22);
            label.mesh.position.y = low + 1.15;
            title.mesh.position.y = low + 1.8;
        } else if (style === 'model' && PROPS.houses[kind]) {
            void this.dress(group, PROPS.houses[kind], p.width * 1.15, p.depth * 1.35, keep, (height, model) => {
                if (red) tintModel(model, RED_SIDE.house);
                else if (kind === 'giant') {
                    this.giantHouses.push(model);
                    tintModel(model, UNIT_COLORS.giantHouse);
                }
                track.position.set(0, height + 0.3, 0.2);
                fill.position.set(0, height + 0.3, 0.22);
                label.mesh.position.y = height + 0.95;
                title.mesh.position.y = height + 1.6;
                view.top = height;
            });
        }
        const view: PadView = { group, fill, label, glow, width: barWidth, pulse: 0, kind, title: title.mesh, top: style === 'pad' ? PAD_STYLE.height : top, icon: null };
        return view;
    }

    /**
     * A helmet barrier: an olive arch across the field (posts, a striped bar overhead, a soft green curtain), "x2 HP"
     * and an army helmet floating over it. An attack barrier: the same in red and gold, "x2 ATK", a viking hat over it
     * (props/viking.glb; plain shapes till it loads).
     */
    private buildHelmetBarrier(h: HelmetConfig): THREE.Object3D {
        const group = new THREE.Group();
        const attack = h.kind === 'attack';
        const look = attack ? ATTACK : HELMET;
        const olive = lambert(look.olive);
        for (const side of [-1, 1]) {
            const post = roundedBox(0.26, HELMET.height, 0.26, 0.08, olive);
            post.position.set(side * (h.width / 2 + 0.13), 0, 0);
            group.add(post);
        }
        const stripes = Math.max(2, Math.round(h.width / 0.5));
        for (let k = 0; k < stripes; k++) {
            const width = (h.width + 0.5) / stripes;
            const bar = new THREE.Mesh(new THREE.BoxGeometry(width, 0.22, 0.22), lambert(k % 2 ? look.olive : look.sand));
            bar.position.set(-(h.width + 0.5) / 2 + (k + 0.5) * width, HELMET.height, 0);
            group.add(bar);
        }
        const curtain = new THREE.Mesh(new THREE.PlaneGeometry(h.width, HELMET.height, 4, 1), new THREE.MeshBasicMaterial({ color: look.curtain, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
        curtain.position.y = HELMET.height / 2;
        group.add(curtain);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(h.width, 0.08, 0.3), lambert(look.curtain, { emissive: look.curtain, emissiveIntensity: 0.3 }));
        strip.position.y = 0.04;
        group.add(strip);
        const label = new Label(2, 0.7, 256, look.text);
        label.set(attack ? `x${TUNING.vikingDamage} ATK` : `x${TUNING.helmetHp} HP`);
        label.mesh.position.set(0, HELMET.height + 0.55, 0);
        label.mesh.rotation.x = -0.6;
        group.add(label.mesh);
        // The helmet: a dome with a brim (a viking hat: horns too, then the model).
        const helmet = new THREE.Group();
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), attack ? lambert(0x9aa3ad) : olive);
        const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.58, 0.07, 20), lambert(attack ? 0x8a5a2b : look.dark));
        helmet.add(dome, brim);
        if (attack) {
            for (const side of [-1, 1]) {
                const horn = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.5, 10), lambert(0xf3ead2));
                horn.position.set(side * 0.47, 0.32, 0);
                horn.rotation.z = -side * 0.7;
                helmet.add(horn);
            }
            void this.dressViking(helmet);
        }
        helmet.position.set(0, HELMET.height + 1.7, 0);
        group.add(helmet);
        group.position.set(h.x, 0, h.z);
        this.group.add(group);
        return helmet;
    }

    /** The Giant King's viking hat (props/viking.glb), `width` across, its bottom at `holder`'s height. */
    private async dressKingHat(holder: THREE.Group, width: number): Promise<void> {
        let source: THREE.Object3D;
        try {
            source = await loadKitModel(`${this.modelRoot}props/viking.glb`);
        } catch (error) {
            console.warn('[mob] model viking', error);
            return;
        }
        if (this.disposed) return;
        source.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(source);
        const size = box.getSize(new THREE.Vector3());
        const scale = width / Math.max(0.01, size.x);
        const model = source.clone();
        model.scale.setScalar(scale);
        model.position.set(-((box.min.x + box.max.x) / 2) * scale, -box.min.y * scale, -((box.min.z + box.max.z) / 2) * scale);
        holder.add(model);
        bendObject(model);
    }

    /** The viking hat model in place of the floating hat's plain shapes, once it loads. */
    private async dressViking(icon: THREE.Group): Promise<void> {
        let source: THREE.Object3D;
        try {
            source = await loadKitModel(`${this.modelRoot}props/viking.glb`);
        } catch (error) {
            console.warn('[mob] model viking', error);
            return;
        }
        if (this.disposed) return;
        source.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(source);
        const size = box.getSize(new THREE.Vector3());
        const scale = ATTACK.hatWidth / Math.max(0.01, size.x);
        const model = source.clone();
        // Centred, its bottom at the icon's (the plain brim's) height.
        model.scale.setScalar(scale);
        model.position.set(-((box.min.x + box.max.x) / 2) * scale, -box.min.y * scale, -((box.min.z + box.max.z) / 2) * scale);
        for (const child of icon.children) child.visible = false;
        icon.add(model);
        bendObject(model);
    }

    /** A blue just got a helmet (a little green puff) or a viking hat (a red-gold one). */
    public helmetOn(x: number, z: number, kind: 'hp' | 'attack' = 'hp'): void {
        const look = kind === 'attack' ? ATTACK : HELMET;
        this.bits.burst(x, 1.4, z, [look.olive, look.curtain], 2, 1.5, 3, 0.4, 0.12);
    }

    /** A PUSH block: a heavy dark slab with a red PUSH plate on its front and top. */
    private buildPushBlock(p: PushBlockConfig): PushBlockView {
        const group = new THREE.Group();
        const body = roundedBox(p.width, PUSH_BLOCK.height, p.depth, 0.2, lambert(PUSH_BLOCK.body));
        group.add(body);
        const plate = roundedBox(p.width - 0.3, 0.12, p.depth - 0.3, 0.15, lambert(PUSH_BLOCK.plate));
        plate.position.y = PUSH_BLOCK.height;
        group.add(plate);
        const front = new THREE.Mesh(new THREE.BoxGeometry(p.width - 0.4, PUSH_BLOCK.height * 0.6, 0.06), lambert(PUSH_BLOCK.plate));
        front.position.set(0, PUSH_BLOCK.height * 0.5, p.depth / 2 + 0.03);
        group.add(front);
        const word = new Label(Math.min(2.6, p.width - 0.5), 0.75);
        word.set('PUSH');
        word.mesh.rotation.x = -Math.PI / 2;
        word.mesh.position.set(0, PUSH_BLOCK.height + 0.13, 0);
        group.add(word.mesh);
        const frontWord = new Label(Math.min(2.4, p.width - 0.6), PUSH_BLOCK.height * 0.5);
        frontWord.set('PUSH');
        frontWord.mesh.position.set(0, PUSH_BLOCK.height * 0.5, p.depth / 2 + 0.07);
        group.add(frontWord.mesh);
        group.position.set(p.x, 0, p.z);
        this.group.add(group);
        return { group, fall: 0, down: false };
    }

    /** PUSH block `index` was pushed out: puffs, and it tips over and sinks. */
    public clearPush(index: number): void {
        const view = this.pushBlocks[index];
        if (!view || view.down) return;
        view.down = true;
        const { x, z } = view.group.position;
        for (let i = 0; i < 4; i++) this.puff(x + (Math.random() - 0.5) * 2.5, z + (Math.random() - 0.5), 0xffffff, 2.5);
        this.bits.burst(x, 1, z, [PUSH_BLOCK.body, PUSH_BLOCK.plate, 0xffffff], 40, 6, 7, 1, 0.25);
    }

    /** A red fort for a target: the usual base's look, scaled to its width (a narrow one is a tower). `crowned`: the Giant
     *  King's viking hat on its roof (in place of the flag). */
    private buildTarget(target: Target, crowned = false, own = false): TargetView {
        if (target.kind === 'cannon') return this.buildCannonLife(target, own);
        const group = new THREE.Group();
        const red = lambert(own ? COLORS.blue : COLORS.red);
        const width = target.halfWidth * 2;
        const scale = Math.min(1, width / (BASE_HALF_WIDTH * 2));
        const height = BASE.height * (0.75 + 0.25 * scale);
        const body = roundedBox(width, height, BASE.depth * (0.7 + 0.3 * scale), 0.35, red);
        group.add(body);
        const roof = roundedBox(width + 0.4, 0.35, BASE.depth * (0.7 + 0.3 * scale) + 0.4, 0.3, lambert(own ? 0x2350c4 : 0xc42335));
        roof.position.y = height;
        group.add(roof);
        const door = roundedBox(Math.min(1.3, width * 0.4), 1.2 * scale + 0.3, 0.2, 0.2, lambert(0x3a1520));
        door.position.set(0, 0, (BASE.depth * (0.7 + 0.3 * scale)) / 2);
        group.add(door);
        for (const side of [-1, 1]) {
            const tower = roundedBox(0.9 * scale + 0.3, height + 0.9, 0.9 * scale + 0.3, 0.25, red);
            tower.position.set(side * (width / 2), 0, 0);
            group.add(tower);
        }
        const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 6), lambert(0xffffff));
        flagPole.position.set(0, height + 1, 0);
        group.add(flagPole);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshLambertMaterial({ color: own ? COLORS.blue : COLORS.red, side: THREE.DoubleSide }));
        flag.position.set(0.42, height + 1.45, 0);
        group.add(flag);
        const hat = new THREE.Group();
        if (crowned) {
            flagPole.visible = false;
            flag.visible = false;
            hat.position.set(0, height + 0.35 - KING_HAT.sink, 0);
            group.add(hat);
            void this.dressKingHat(hat, Math.min(KING_HAT.most, width * KING_HAT.share));
        }
        const label = new Label(Math.max(1.8, width * 0.6) * 2, 0.8 * 2);
        label.set(String(target.hp));
        // Above the door (in front of the wall, clear of the door box), not on it.
        label.mesh.position.set(0, 1.2 * scale + 0.3 + 0.45, (BASE.depth * (0.7 + 0.3 * scale)) / 2 + 0.516);
        group.add(label.mesh);
        // (An arena match's own tower stands behind its front, towards the cannon's end.)
        group.position.set(target.x, 0, target.z + (own ? BASE.depth / 2 : -BASE.depth / 2));
        this.group.add(group);
        const view: TargetView = { group, flashes: [body.material as THREE.MeshLambertMaterial], label, x: target.x, shake: 0, flash: 0, punch: 0, fall: 0, down: false };
        // The red barracks (a tower for a narrow one), when it loads — unless the zone keeps the plain ones; its number
        // over the roof, facing the camera. An arena match's own towers: the blue barracks.
        const tower = width < PROPS.towerBelow;
        const model = own ? PROPS.blueTower : tower ? PROPS.tower : PROPS.base;
        if (!this.plainForts) void this.dress(group, model, own ? width * 1.05 : tower ? width * 0.8 : width * 1.05, BASE.depth * 1.6, [label.mesh], (height, model) => {
            label.mesh.position.set(0, height + 0.55 + (crowned ? KING_HAT.labelLift : 0), 0.4);
            label.mesh.rotation.x = -0.5;
            hat.position.y = height - KING_HAT.sink;
            const flashes: THREE.MeshStandardMaterial[] = [];
            model.traverse((child) => {
                if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) flashes.push(child.material);
            });
            view.flashes = flashes;
            this.onLayout?.();
        }, undefined, own ? 0 : PROPS.turn);
        return view;
    }

    /** An arena match's cannon's life: its number floating over the cannon (it follows it: update). */
    private buildCannonLife(target: Target, own: boolean): TargetView {
        const group = new THREE.Group();
        const label = new Label(2.4 * 2, 0.8 * 2, 256, own ? '#cfe0ff' : '#ffd0d6');
        label.set(String(target.hp));
        label.mesh.position.set(0, CANNON_LIFE_Y, 0);
        label.mesh.rotation.x = -0.6;
        group.add(label.mesh);
        group.position.set(target.x, 0, own ? CANNON_Z + this.cannonRow : ARENA.baseZ - CANNON_Z - this.cannonRow);
        this.group.add(group);
        return { group, flashes: [], label, x: target.x, shake: 0, flash: 0, punch: 0, fall: 0, down: false };
    }

    /**
     * Swaps a piece's plain shapes for a model (props/<name>.glb), when it loads: everything in `group` but `keep` hides,
     * the model goes in scaled to `width` across (its own materials, so it can flash alone) and turned to face the
     * cannon; `placed(height, model)` then moves the labels to suit.
     */
    private async dress(group: THREE.Group, name: string, width: number, depth: number, keep: THREE.Object3D[], placed: (height: number, model: THREE.Object3D) => void, tint?: number, turn: number = PROPS.turn): Promise<void> {
        let source: THREE.Object3D;
        try {
            source = await loadKitModel(`${this.modelRoot}props/${name}.glb`);
        } catch (error) {
            console.warn('[mob] model', name, error);
            return;
        }
        if (this.disposed) return;
        const model = source.clone();
        model.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            const material = (child.material as THREE.Material).clone();
            if (tint !== undefined && material instanceof THREE.MeshStandardMaterial) {
                material.color.setHex(tint);
                material.metalness = 0.35;
                material.roughness = 0.45;
            }
            child.material = material;
        });
        source.updateWorldMatrix(true, true);
        const size = new THREE.Box3().setFromObject(source).getSize(new THREE.Vector3());
        // As wide as asked, unless that makes it deeper than its footprint allows.
        const scale = Math.min(width / Math.max(0.01, size.x), depth / Math.max(0.01, size.z));
        model.scale.setScalar(scale);
        model.rotation.y = turn;
        for (const child of [...group.children]) if (!keep.includes(child)) child.visible = false;
        group.add(model);
        bendObject(model);
        placed(size.y * scale, model);
    }

    /** The truck and saucer models (each live one gets a clone). */
    private async loadUnits(): Promise<void> {
        try {
            const [truck, saucer, car] = await Promise.all([
                loadKitModel(`${this.modelRoot}props/${PROPS.truck.model}.glb`),
                loadKitModel(`${this.modelRoot}props/${PROPS.saucer.model}.glb`),
                loadKitModel(`${this.modelRoot}props/${PROPS.car.model}.glb`),
            ]);
            if (this.disposed) return;
            this.truckModel = fitted(truck, PROPS.truck.length, 'z');
            this.carModel = fitted(car, PROPS.car.length, 'z');
            this.saucerModel = fitted(saucer, PROPS.saucer.radius * 2 * PROPS.saucer.size, 'x');
            this.refreshColors();
        } catch (error) {
            console.warn('[mob] unit models', error);
        }
    }

    /** The upgrades' colours (UNIT_COLORS) on everything already built: the plain houses, the giant's buildings, the
     *  vehicles (their live clones share these materials). The debug panel calls it as colours are picked. */
    public refreshColors(): void {
        for (const { keys, wall, roof } of this.houseMaterials) {
            wall.color.setHex(UNIT_COLORS[keys[0]]);
            roof.color.setHex(UNIT_COLORS[keys[1]]);
        }
        for (const model of this.giantHouses) tintModel(model, UNIT_COLORS.giantHouse);
        if (this.truckModel) tintModel(this.truckModel, UNIT_COLORS.truck);
        if (this.carModel) tintModel(this.carModel, UNIT_COLORS.car);
        if (this.saucerModel) tintModel(this.saucerModel, UNIT_COLORS.ufo);
    }

    /** Trucks and cars: one model per live one, placed and turned like the mob it is (spares hidden). */
    private updateVehicles(battle: Battle): void {
        this.placeVehicles(battle, TRUCK, this.truckModel, this.trucks, PROPS.truck.turn);
        this.placeVehicles(battle, CAR, this.carModel, this.cars, PROPS.car.turn);
    }

    private placeVehicles(battle: Battle, kind: number, model: THREE.Object3D | null, pool: THREE.Object3D[], turn: number): void {
        if (!model) return;
        let used = 0;
        for (let i = 0; i < battle.count; i++) {
            if (battle.big[i] !== kind) continue;
            let vehicle = pool[used];
            if (!vehicle) {
                vehicle = model.clone();
                bendObject(vehicle);
                pool.push(vehicle);
                this.group.add(vehicle);
            }
            vehicle.visible = true;
            vehicle.position.set(battle.x[i], 0, battle.z[i]);
            vehicle.rotation.y = battle.heading[i] + Math.PI + turn;
            const grow = (0.2 + 0.8 * Math.min(1, battle.age[i] / 0.25)) * (1 - battle.leaving[i]);
            vehicle.scale.setScalar(Math.max(0.001, grow));
            used++;
        }
        for (let k = used; k < pool.length; k++) pool[k].visible = false;
    }

    /** Saucers: a gold saucer each, rising after take-off, bobbing and spinning, a beam under it; gone when it crashes. */
    private updateSaucers(battle: Battle): void {
        if (!this.saucerModel) return;
        const live = new Set<object>(battle.saucers);
        for (const [saucer, view] of this.saucerViews) {
            if (live.has(saucer)) continue;
            this.group.remove(view.model, view.beam);
            this.saucerViews.delete(saucer);
        }
        for (const saucer of battle.saucers) {
            let view = this.saucerViews.get(saucer);
            if (!view) {
                const model = this.saucerModel.clone();
                bendObject(model);
                const beam = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.35, PROPS.saucer.radius * 1.9, 1, 20, 1, true),
                    new THREE.MeshBasicMaterial({ color: 0xfff3a0, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }),
                );
                this.group.add(model, beam);
                view = { model, beam };
                this.saucerViews.set(saucer, view);
            }
            const rise = Math.min(1, saucer.age / 0.6);
            const y = PROPS.saucer.height * (0.3 + 0.7 * rise * (2 - rise)) + Math.sin(this.time * 4) * 0.12;
            view.model.position.set(saucer.x, y, saucer.z);
            view.model.rotation.y = this.time * 3;
            view.beam.scale.y = y;
            view.beam.position.set(saucer.x, y / 2, saucer.z);
            (view.beam.material as THREE.MeshBasicMaterial).opacity = 0.2 + 0.1 * Math.sin(this.time * 12);
        }
    }

    /**
     * A truck or UFO house shows what it makes: the unit's model spinning over its counter (in place of the word), bobbing,
     * and bouncing as blues go in.
     */
    private updateHouseIcon(view: PadView): void {
        const source = view.kind === 'truck' ? this.truckModel : view.kind === 'saucer' ? this.saucerModel : view.kind === 'car' ? this.carModel : null;
        if (!source) return;
        if (!view.icon) {
            view.icon = source.clone();
            view.icon.scale.setScalar(view.kind === 'truck' ? HOUSE_ICON.truck : HOUSE_ICON.other);
            bendObject(view.icon);
            view.group.add(view.icon);
            view.title.visible = false;
        }
        const bounce = 1 + view.pulse * 0.25;
        // Over its count (not on it: the number stays in sight).
        view.icon.position.set(0, view.label.mesh.position.y + HOUSE_ICON.over + Math.sin(this.time * 2.5) * 0.12, 0);
        view.icon.rotation.y = this.time * 1.4;
        view.icon.scale.setScalar((view.kind === 'truck' ? HOUSE_ICON.truck : HOUSE_ICON.other) * bounce);
    }

    /** Each standing fort's highest point, its number included (world space), for the camera to keep in view. */
    public fortTops(): THREE.Vector3[] {
        return this.targets.filter((view) => !view.down).map((view) => new THREE.Vector3(
            view.group.position.x, view.group.position.y + view.label.mesh.position.y + 0.5, view.group.position.z + view.label.mesh.position.z));
    }

    /** A red sucked up into a saucer: a little yellow puff where it was. */
    public suck(x: number, z: number): void {
        this.puff(x, z, 0xfff3a0, 0.8);
        this.bits.burst(x, 0.6, z, [0xfff3a0, COLORS.red], 3, 1.5, 6, 0.5, 0.12);
    }

    /** A saucer crashing into a building: a gold and red blast. */
    public saucerCrash(x: number, z: number): void {
        const at = z - BASE.depth / 2;
        this.bits.burst(x, 2, at, [0xffd23f, 0xffb31a, COLORS.red, 0xffffff], 90, 9, 9, 1.2, 0.3);
        for (let i = 0; i < 5; i++) this.puff(x + (Math.random() - 0.5) * 3, at + (Math.random() - 0.5) * 1.5, 0xffe27a, 3);
    }

    private buildRings(): void {
        const geometry = new THREE.RingGeometry(0.82, 1, 48);
        geometry.rotateX(-Math.PI / 2);
        for (let i = 0; i < RINGS.count; i++) {
            const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
            mesh.visible = false;
            this.group.add(mesh);
            this.rings.push({ mesh, life: 0, radius: 1 });
        }
    }

    /** A special unit's landing shockwave at (x, z), `radius` wide, in its team's colour. */
    public shockwave(x: number, z: number, radius: number, color: number): void {
        for (const [delay, tint] of [[0, 0xffffff], [0.08, color]] as [number, number][]) {
            const ring = this.rings[this.nextRing];
            this.nextRing = (this.nextRing + 1) % this.rings.length;
            ring.life = RINGS.seconds + delay;
            ring.radius = radius;
            ring.mesh.position.set(x, 0.12, z);
            ring.mesh.visible = true;
            ring.mesh.scale.setScalar(0.01);
            (ring.mesh.material as THREE.MeshBasicMaterial).color.setHex(tint);
        }
        this.bits.burst(x, 0.3, z, [color, 0xffffff], 26, 7, 3, 0.5, 0.16);
    }

    private buildPuffs(): void {
        const geometry = new THREE.IcosahedronGeometry(0.5, 0);
        for (let i = 0; i < PUFFS; i++) {
            const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
            mesh.visible = false;
            this.group.add(mesh);
            this.puffs.push({ mesh, life: 0 });
        }
    }

    // ------------------------------------------------------------------ effects

    /** A puff where two mobs clashed, with bits of both flying; bigger for a giant. */
    /** A bomb's blast at (x, z), `radius` wide: fire and rock flying, smoke round it. */
    public blast(x: number, z: number, radius: number): void {
        this.bits.burst(x, 0.8, z, [0xffd23f, 0xff8a1f, 0xff4d2e, 0x6b5a4a, 0x9a8a78], 120, 12, 12, 1.3, 0.32);
        this.puff(x, z, 0xffe0a0, radius * 0.9);
        for (let k = 0; k < 6; k++) {
            const angle = (k / 6) * Math.PI * 2;
            this.puff(x + Math.cos(angle) * radius * 0.6, z + Math.sin(angle) * radius * 0.6, 0xd8cbb8, 2.2);
        }
    }

    public clash(x: number, z: number, big: boolean): void {
        this.puff(x, z, big ? 0xffffff : 0xffd0e0, big ? 1.8 : 1);
        this.bits.burst(x, 0.4, z, [COLORS.blue, COLORS.red], big ? 8 : 3, big ? 5 : 3.2, big ? 5 : 3.5, 0.6, big ? 0.22 : 0.13);
    }

    /** A small puff where a mob vanished. */
    public puffAt(x: number, z: number, color: number): void {
        this.puff(x, z, color, 0.7);
    }

    private puff(x: number, z: number, color: number, scale = 1): void {
        const puff = this.puffs[this.nextPuff];
        this.nextPuff = (this.nextPuff + 1) % PUFFS;
        puff.life = PUFF_SECONDS;
        puff.mesh.visible = true;
        puff.mesh.position.set(x, 0.35, z);
        puff.mesh.userData.scale = scale;
        (puff.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    }

    /** Target `index` hit at (x, z): it shakes, flashes, its number punches, chunks fly — more for a giant's hit. */
    public hitBase(index: number, x: number, z: number, damage: number): void {
        const view = this.targets[index];
        if (!view) return;
        const heavy = damage > 1;
        view.shake = heavy ? 0.45 : 0.18;
        view.flash = 0.12;
        view.punch = heavy ? 1 : 0.5;
        this.bits.burst(x, 1.2, z + 0.3, [COLORS.red, 0xc42335, 0xffffff], heavy ? 22 : 4, heavy ? 6 : 3.5, heavy ? 7 : 4.5, 0.7, heavy ? 0.26 : 0.16);
    }

    /** An arena match: the blues' building `index` hit (as hitBase), falling (as destroyTarget), the reds' cannon fired. */
    public hitOwn(index: number, x: number, z: number, damage: number): void {
        const view = this.ownTargets[index];
        if (!view) return;
        const heavy = damage > 1;
        view.shake = heavy ? 0.45 : 0.18;
        view.flash = 0.12;
        view.punch = heavy ? 1 : 0.5;
        this.bits.burst(x, 1.2, z - 0.3, [COLORS.blue, 0x2f6fd1, 0xffffff], heavy ? 22 : 4, heavy ? 6 : 3.5, heavy ? 7 : 4.5, 0.7, heavy ? 0.26 : 0.16);
    }

    /** The blues' building `index` falls (`last`: the one that loses the match, a bigger blast). */
    public destroyOwn(index: number, last = false): void {
        const view = this.ownTargets[index];
        if (!view || view.down) return;
        view.down = true;
        const z = view.group.position.z;
        this.bits.burst(view.x, 1.5, z, [COLORS.blue, 0x2f6fd1, 0x14183a, 0xffffff], last ? 140 : 70, 11, 11, last ? 2 : 1.4, 0.4);
        for (let i = 0; i < (last ? 6 : 3); i++) this.puff(view.x + (Math.random() - 0.5) * (last ? 4 : 3), z + (Math.random() - 0.5) * 2, 0xffffff, 3);
    }

    public redFired(): void {
        this.redRecoil = 1;
        this.redFlashLife = 0.07;
    }

    /** A gate multiplied someone at x: it pulses and sparkles. */
    public pulseGate(index: number, x: number): void {
        const gate = this.gates[index];
        if (!gate) return;
        gate.pulse = 1;
        this.bits.burst(x, 0.5, gate.group.position.z, [0x9fe6ff, 0xffffff], 2, 1.6, 4, 0.5, 0.1);
    }

    /** A breakable hit at (x, z): it shakes, a chip flies. */
    public hitBlock(index: number, x: number, z: number): void {
        const view = this.breakables[index];
        if (!view) return;
        view.shake = 0.12;
        this.bits.burst(x, 0.8, z, [this.theme.breakable.top, this.theme.breakable.side], 2, 2.5, 3.5, 0.5, 0.14);
    }

    /** A breakable gone: bricks everywhere. */
    public breakBlock(index: number): void {
        const view = this.breakables[index];
        if (!view || view.gone) return;
        view.gone = true;
        view.mesh.visible = false;
        view.label.mesh.visible = false;
        this.bits.burst(view.centreX, 0.8, view.centreZ, [this.theme.breakable.top, this.theme.breakable.side, 0xffffff], 50, 6, 7, 1.1, 0.3);
        this.puff(view.centreX, view.centreZ, 0xffe0c0, 3);
    }

    public padFed(index: number): void {
        const pad = this.pads[index];
        if (pad) pad.pulse = 1;
    }

    /** A giant just appeared at (x, z): a ring of bits in its team colour. */
    public giant(x: number, z: number, color: number): void {
        this.puff(x, z, 0xffffff, 2.4);
        this.bits.burst(x, 0.6, z, [color, 0xffffff, 0xffd23f], 30, 6, 6, 0.8, 0.2);
    }

    public fired(): void {
        this.recoil = 1;
        this.flashLife = 0.07;
    }

    /** Target `index` falls: it blows apart (confetti too, `last`: the one that wins the battle), then sinks. */
    public destroyTarget(index: number, last: boolean): void {
        const view = this.targets[index];
        if (!view || view.down) return;
        view.down = true;
        const z = view.group.position.z;
        this.bits.burst(view.x, 1.5, z, [COLORS.red, 0xc42335, 0x3a1520, 0xffffff], last ? 140 : 70, 11, 11, 1.4, 0.4);
        if (last) this.bits.burst(view.x, 3, z + 1, CONFETTI, 160, 9, 14, 2.2, 0.18);
        for (let i = 0; i < (last ? 6 : 3); i++) this.puff(view.x + (Math.random() - 0.5) * 4, z + (Math.random() - 0.5) * 2, 0xffffff, 3);
    }

    /** Confetti over the whole field (the victory). */
    public confetti(): void {
        for (let k = 0; k < 5; k++) this.bits.burst((Math.random() - 0.5) * 8, 6, -4 - Math.random() * 14, CONFETTI, 40, 6, 6, 2.6, 0.16);
    }


    /** Follows the battle: the cannon, gates, spinners, pushers, pads, the targets; ages the effects. */
    public update(battle: Battle, dt: number): void {
        this.time += dt;
        this.cannon.position.x = battle.cannonX;
        this.recoil = Math.max(0, this.recoil - dt * 8);
        this.barrel.position.z = this.recoil * 0.14;
        this.flashLife = Math.max(0, this.flashLife - dt);
        (this.flash.material as THREE.MeshBasicMaterial).opacity = this.flashLife > 0 ? 0.9 : 0;
        this.flash.scale.setScalar(0.8 + Math.random() * 0.5);
        if (battle.duel) {
            for (const cannon of [this.cannon, this.redCannon]) {
                const ring = cannon.getObjectByName('exposed');
                if (ring?.visible) ring.scale.setScalar(1 + 0.12 * Math.sin(this.time * EXPOSED.pulse));
            }
            this.redCannon.position.x = battle.red.cannonX;
            this.redRecoil = Math.max(0, this.redRecoil - dt * 8);
            const barrel = this.redCannon.getObjectByName('barrel');
            if (barrel) barrel.position.z = this.redRecoil * 0.14;
            this.redFlashLife = Math.max(0, this.redFlashLife - dt);
            const flash = this.redCannon.getObjectByName('flash') as THREE.Mesh | undefined;
            if (flash) (flash.material as THREE.MeshBasicMaterial).opacity = this.redFlashLife > 0 ? 0.9 : 0;
        }
        battle.gates.forEach((gate, i) => {
            const view = this.gates[i];
            view.group.position.x = gate.nowX;
            view.pulse = Math.max(0, view.pulse - dt * 4);
            view.panel.scale.set(1 + view.pulse * 0.08, 1 + view.pulse * 2, 1 + view.pulse * 0.4);
            view.label.scale.setScalar(1 + view.pulse * 0.25);
            if (view.lock && !view.lock.open) {
                view.lock.shake = Math.max(0, view.lock.shake - dt);
                view.lock.group.position.x = view.lock.shake > 0 ? (Math.random() - 0.5) * 0.12 : 0;
            }
        });
        // The grinders: where they are now; a moving one rolls as it goes (no skid), a standing one spins.
        battle.grinders.forEach((grinder, i) => {
            const view = this.grinders[i];
            if (!view) return;
            view.holder.position.set(grinder.nowX, 0, grinder.nowZ);
            view.angle += grinder.move ? (grinder.speed / Math.max(0.05, view.radius)) * dt : TUNING.grinderSpin * Math.PI * 2 * dt;
            view.roller.rotation.x = view.angle;
        });
        // Locked gates' hits left, on their padlocks.
        for (const block of battle.blocks) {
            if (block.gate === undefined) continue;
            const lock = this.gates[block.gate]?.lock;
            if (lock && !lock.open) lock.hits.set(String(Math.max(0, Math.ceil(block.hp))));
        }
        battle.spinners.forEach((spinner, i) => {
            this.spinners[i].rotation.y = battle.spinnerAngle(spinner);
        });
        battle.pushers.forEach((pusher, i) => {
            this.pushers[i].position.x = pusher.nowX;
        });
        this.updateVehicles(battle);
        this.helmetIcons.forEach((icon, i) => {
            icon.rotation.y = this.time * 1.6 + i;
            icon.position.y = HELMET.height + 1.7 + Math.sin(this.time * 2.4 + i) * 0.1;
        });
        this.updateSaucers(battle);
        battle.pushBlocks.forEach((block, i) => {
            const view = this.pushBlocks[i];
            view.group.position.z = block.nowZ;
            if (view.down) {
                view.fall = Math.min(1, view.fall + dt / 0.8);
                view.group.position.y = -view.fall * view.fall * (PUSH_BLOCK.height + 1);
                view.group.rotation.x = -view.fall * 0.5;
                view.group.visible = view.fall < 1;
            }
        });
        battle.pads.forEach((pad, i) => {
            const view = this.pads[i];
            const share = pad.count / pad.need;
            view.fill.scale.x = Math.max(0.001, share);
            view.fill.position.x = -view.width / 2 + (view.width * Math.max(0.001, share)) / 2;
            view.label.set(`${pad.count}/${pad.need}`);
            view.pulse = Math.max(0, view.pulse - dt * 5);
            view.glow.opacity = 0.55 + view.pulse * 0.4 + Math.sin(this.time * 4) * 0.08;
            view.label.mesh.scale.setScalar(1 + view.pulse * 0.2);
            this.updateHouseIcon(view);
        });
        const sides: [readonly Target[], TargetView[], number][] = [[battle.targets, this.targets, battle.red.cannonX], [battle.blueTargets, this.ownTargets, battle.cannonX]];
        for (const [list, views, cannonX] of sides) list.forEach((target, i) => {
            const view = views[i];
            if (!view) return;
            // A cannon's life follows its cannon.
            if (target.kind === 'cannon') view.x = cannonX;
            view.label.set(String(target.hp));
            view.punch = Math.max(0, view.punch - dt * 5);
            view.label.mesh.scale.setScalar(1 + view.punch * 0.35);
            view.shake = Math.max(0, view.shake - dt);
            view.flash = Math.max(0, view.flash - dt);
            for (const material of view.flashes) {
                material.emissive.setHex(view.flash > 0 ? 0xffffff : 0x000000);
                material.emissiveIntensity = view.flash > 0 ? 0.5 : 0;
            }
            if (view.down) {
                // Fallen: it sinks and tips over.
                view.fall = Math.min(1, view.fall + dt / 1.1);
                const eased = view.fall * view.fall;
                view.group.position.y = -eased * (BASE.height + 1.5);
                view.group.rotation.z = eased * 0.35;
                return;
            }
            view.group.position.x = view.x + (view.shake > 0 ? (Math.random() - 0.5) * view.shake * 0.6 : 0);
            view.group.scale.set(1 + view.punch * 0.04, 1 - view.punch * 0.06, 1 + view.punch * 0.04);
        });
        // The danger line: faint when no red's near, pulsing faster and brighter as they close in.
        const pulse = 0.5 + 0.5 * Math.sin(this.time * (6 + battle.danger * 10));
        (this.danger.material as THREE.MeshBasicMaterial).opacity = 0.45 + battle.danger * (0.3 + pulse * 0.25);
        this.danger.scale.y = 1 + battle.danger * pulse * 1.5;
        for (const ring of this.rings) {
            if (ring.life <= 0) continue;
            ring.life -= dt;
            const t = Math.min(1, 1 - ring.life / RINGS.seconds);
            if (t < 0) continue;
            ring.mesh.scale.setScalar(Math.max(0.01, ring.radius * (1 - (1 - t) * (1 - t))));
            (ring.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
            if (ring.life <= 0) ring.mesh.visible = false;
        }
        for (const puff of this.puffs) {
            if (puff.life <= 0) continue;
            puff.life -= dt;
            const t = 1 - Math.max(0, puff.life) / PUFF_SECONDS;
            puff.mesh.scale.setScalar(PUFF_SIZE * (puff.mesh.userData.scale ?? 1) * (0.4 + t));
            (puff.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - t);
            if (puff.life <= 0) puff.mesh.visible = false;
        }
        battle.blocks.forEach((block, i) => {
            const view = this.breakables[i];
            if (!view || view.gone) return;
            view.label.set(String(Math.max(0, block.hp)));
            view.shake = Math.max(0, view.shake - dt);
            // Worn down as it loses hits; a jolt when hit.
            view.mesh.scale.y = 0.55 + 0.45 * (block.hp / Math.max(1, block.hpMax));
            view.mesh.position.x = view.centreX + (view.shake > 0 ? (Math.random() - 0.5) * 0.12 : 0);
        });
        this.bits.update(dt);
    }
}
