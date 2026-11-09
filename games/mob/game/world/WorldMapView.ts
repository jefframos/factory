// WorldMapView.ts
//
// The world map in 3D, for the main screen: each tile that shows (WorldMap.tileStates) as the pack's models, in the sea
// (the battle's water shader, Water.ts: its shallows glow round the land's outline). An area's tiles go together:
// beaten and being played in colour, the next one grey. The area being played has a glowing border round all of its
// tiles (their outer edges). The markers over the areas (the pin and progress, the padlock, the checks) are the main
// screen's, in 2D: `areas` says where each one goes. When the player has moved on to a new area since the main screen
// was last seen (mob.mapSeen), the area just beaten and the new one pop into colour.

import * as THREE from 'three';
import gsap from 'gsap';
import { createGLTFLoader } from 'core/three/GLTFLoaders';
import { AreaMark, ColourShift, HEX, HEX_MODELS, HexTile, TileView, WORLD_MAP, areaMarks, hexToWorld, tileShift, tileStates, worldToHex } from '../data/WorldMap';
import { Point, createWater } from '../services/Water';

/** The sea; what isn't reached yet faded towards navy (that colour, that much); the current area's border (its bright line, its glow, how it pulses). */
const LOOK = { sea: '#3fb6ff', fade: 0x1f3270, fadeBy: 0.55 };
const BORDER = { line: 0xfff6c8, glow: 0xffc83d, lineWidth: 0.14, glowWidth: 0.55, lift: 0.06, pulse: 2.4, glowFrom: 0.25, glowTo: 0.6 };
/** The sea: how far it reaches past the land's middle (each way), and how far out from the land its shore is drawn. */
const SEA = { size: 160, shore: 0.4, y: -0.1, pattern: 3.5, deepAt: 8 };
/** How far a tile reaches from its middle (its corners), for the camera's box. */
const REACH = HEX.width / Math.sqrt(3);
/** An area's marker: how high over its tiles. */
const ANCHOR_HEIGHT = 1.4;
/** The tiles' pop into colour: the wait before the first, between them, and how long each takes. */
const POP = { delay: 0.6, gap: 0.12, seconds: 0.45 };
const SEEN_KEY = 'mob.mapSeen';

const loaded = new Map<string, Promise<THREE.Object3D>>();
function loadTile(url: string): Promise<THREE.Object3D> {
    let model = loaded.get(url);
    if (!model) {
        model = createGLTFLoader().loadAsync(url).then((gltf) => gltf.scene);
        loaded.set(url, model);
    }
    return model;
}

/** An area the main screen marks: its state and progress, and where over the map its marker goes. */
export interface MapArea extends AreaMark { anchor: THREE.Vector3 }

export class WorldMapView {
    public readonly group = new THREE.Group();
    /** Where the shown tiles reach (x, z), for the camera. */
    public readonly bounds = new THREE.Box3();
    /** The areas to mark (beaten, being played, next, open), each with where its marker goes. */
    public readonly areas: MapArea[];
    private glow: THREE.MeshBasicMaterial | null = null;
    private sea: THREE.Mesh | null = null;
    private time = 0;
    private disposed = false;
    /** How far the whole map is raised out of the sea (ui/worldmap.json `lift`). */
    private readonly lift = WORLD_MAP.lift ?? 0;

    /** `index`: the next battle to beat; `furthest`: the furthest that can be picked (MobSave). */
    /** `remember`: note the area it's at (for the pop when the player moves on); not for a preview of somewhere else. */
    /** `everything`: every tile, the scenery far from any area too (the editor's whole-map preview). */
    public constructor(index: number, furthest: number, private readonly base = './mob/models/', remember = true, everything = false) {
        const views = tileStates(index, furthest, undefined, everything);
        const shown = views.filter((view) => view.state !== 'hidden');
        for (const view of shown) {
            const { x, z } = hexToWorld(view.tile.q, view.tile.r);
            this.bounds.expandByPoint(new THREE.Vector3(x - REACH, 0, z - REACH)).expandByPoint(new THREE.Vector3(x + REACH, 0, z + REACH));
        }
        if (this.bounds.isEmpty()) this.bounds.set(new THREE.Vector3(-4, 0, -4), new THREE.Vector3(4, 0, 4));
        // The sea: the shallows glow round the land (its tiles that aren't the pack's water).
        const centre = this.bounds.getCenter(new THREE.Vector3());
        const land = shown.filter((view) => !view.tile.model.includes('water'));
        // Between the land (y 0) and the pack's water (-0.2): its coasts keep their beaches, all the water's the shader's.
        this.sea = createWater(LOOK.sea, SEA.size, SEA.size, landOutline(land.length ? land : shown), centre.x, centre.z, { y: SEA.y, pattern: SEA.pattern, deepAt: SEA.deepAt });
        this.group.add(this.sea);

        this.areas = areaMarks(index, furthest).map((mark) => ({ ...mark, anchor: this.anchorOf(mark.tiles) }));
        const current = this.areas.find((area) => area.state === 'current');
        // Moved on to a new area since last seen: the one just beaten and the new one pop into colour.
        let popping = new Set<string>();
        try {
            const seen = window.localStorage.getItem(SEEN_KEY);
            if (remember && current && seen !== null && seen !== current.zone.id) popping = new Set([seen, current.zone.id]);
            if (remember && current) window.localStorage.setItem(SEEN_KEY, current.zone.id);
        } catch {
            // No storage: nothing pops.
        }
        let turn = 0;
        for (const view of shown) {
            const pops = !!view.tile.zone && popping.has(view.tile.zone) && (view.state === 'done' || view.state === 'current');
            void this.placeTile(view, pops ? turn++ : -1);
        }
        if (current) this.buildBorder(current.tiles);
    }

    /** Over the middle of an area's tiles, a little above them. */
    private anchorOf(tiles: readonly HexTile[]): THREE.Vector3 {
        const point = new THREE.Vector3();
        for (const tile of tiles) {
            const { x, z } = hexToWorld(tile.q, tile.r);
            point.x += x;
            point.z += z;
            point.y += tile.y ?? 0;
        }
        point.divideScalar(Math.max(1, tiles.length));
        point.y += this.lift + ANCHOR_HEIGHT;
        return point;
    }

    /** A tile (and what stands on it): the pack's models, grey unless it's reached; `pop` >= 0: it starts grey and pops
     *  into colour (its turn). */
    private async placeTile(view: TileView, pop: number): Promise<void> {
        const names = [view.tile.model, ...(view.tile.decor ? [view.tile.decor] : [])];
        let sources: THREE.Object3D[];
        try {
            sources = await Promise.all(names.map((name) => loadTile(`${this.base}${HEX_MODELS}${name}.gltf`)));
        } catch (error) {
            console.warn('[mob] hex tile', names.join(' + '), error);
            return;
        }
        if (this.disposed) return;
        const tile = new THREE.Group();
        sources.forEach((source, k) => {
            const piece = source.clone();
            // What stands on it, raised on its own.
            if (k === 1) piece.position.y = view.tile.decorY ?? 0;
            tile.add(piece);
        });
        const coloured = view.state === 'done' || view.state === 'current' || view.state === 'scenery';
        const greyed = new Map<THREE.Material, THREE.Material>();
        // Its own materials: the ground's colour changed (the map's and its own; what stands on it keeps its own), and a
        // copy faded towards navy (not reached yet).
        const shift = tileShift(view.tile);
        tile.children.forEach((piece, k) => piece.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            const own = k === 0 ? shift : null;
            const material = toneMaterial((child.material as THREE.MeshStandardMaterial).clone(), own, 0);
            const faded = toneMaterial((child.material as THREE.MeshStandardMaterial).clone(), own, LOOK.fadeBy);
            greyed.set(faded, material);
            child.material = !coloured || pop >= 0 ? faded : material;
        }));
        place(tile, view.tile, this.lift);
        const rest = tile.position.y;
        this.group.add(tile);
        if (pop < 0) return;
        // Its turn: up, into colour, back down.
        gsap.timeline({ delay: POP.delay + pop * POP.gap })
            .to(tile.position, { y: rest + 0.35, duration: POP.seconds * 0.4, ease: 'power2.out' })
            .call(() => tile.traverse((child) => {
                if (child instanceof THREE.Mesh && greyed.has(child.material as THREE.Material)) child.material = greyed.get(child.material as THREE.Material)!;
            }))
            .fromTo(tile.scale, { x: 1.12, y: 1.12, z: 1.12 }, { x: 1, y: 1, z: 1, duration: POP.seconds, ease: 'back.out(3)' })
            .to(tile.position, { y: rest, duration: POP.seconds * 0.6, ease: 'bounce.out' }, '<');
    }

    /**
     * The current area's border: along every edge of its tiles that doesn't touch another of them (its outline), a bright
     * line on the ground and a wide soft glow inside it, pulsing.
     */
    private buildBorder(tiles: readonly HexTile[]): void {
        const inArea = new Set(tiles.map((tile) => `${tile.q},${tile.r}`));
        const line: number[] = [];
        const glow: number[] = [];
        // A flat band along the edge from corner a to corner b (angles from the tile's middle), `from` .. `to` in from them.
        const band = (out: number[], x: number, y: number, z: number, a: number, b: number, from: number, to: number) => {
            const at = (angle: number, radius: number) => [x + Math.cos(angle) * radius, y, z + Math.sin(angle) * radius];
            const [p0, p1, p2, p3] = [at(a, REACH - from), at(b, REACH - from), at(b, REACH - to), at(a, REACH - to)];
            out.push(...p0, ...p2, ...p1, ...p0, ...p3, ...p2);
        };
        for (const tile of tiles) {
            const { x, z } = hexToWorld(tile.q, tile.r);
            const y = this.lift + (tile.y ?? 0) + BORDER.lift;
            for (let k = 0; k < 6; k++) {
                const a = Math.PI / 6 + (k * Math.PI) / 3;
                const b = a + Math.PI / 3;
                // The tile across this edge: is it the area's too?
                const middle = a + Math.PI / 6;
                const [q, r] = worldToHex(x + Math.cos(middle) * HEX.width, z + Math.sin(middle) * HEX.width);
                if (inArea.has(`${q},${r}`)) continue;
                band(line, x, y + 0.01, z, a, b, 0, BORDER.lineWidth);
                band(glow, x, y, z, a, b, 0, BORDER.glowWidth);
            }
        }
        const mesh = (positions: number[], material: THREE.Material, order: number) => {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            const object = new THREE.Mesh(geometry, material);
            object.renderOrder = order;
            this.group.add(object);
        };
        this.glow = new THREE.MeshBasicMaterial({ color: BORDER.glow, transparent: true, opacity: BORDER.glowFrom, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
        mesh(glow, this.glow, 2);
        mesh(line, new THREE.MeshBasicMaterial({ color: BORDER.line, side: THREE.DoubleSide, depthWrite: false }), 3);
    }

    public update(dt: number): void {
        this.time += dt;
        if (this.glow) this.glow.opacity = BORDER.glowFrom + (BORDER.glowTo - BORDER.glowFrom) * (0.5 + 0.5 * Math.sin(this.time * BORDER.pulse));
    }

    public dispose(): void {
        this.disposed = true;
        (this.sea?.userData.free as (() => void) | undefined)?.();
        gsap.killTweensOf(this.group.children.map((child) => child.position));
    }
}

/**
 * `material` toned, in its shader, on the colour it ends up (after its texture and its light): `shift` (the ground's
 * colour change: its hue turned, its saturation and brightness scaled), then faded `fade` of the way towards navy (an
 * area not reached yet: darker, but blue, not black). Nothing done for neither.
 */
function toneMaterial<T extends THREE.Material>(material: T, shift: ColourShift | null, fade: number): T {
    const shifting = !!shift && !(shift.hue === 0 && shift.saturation === 1 && shift.brightness === 1);
    if (!shifting && fade <= 0) return material;
    const change = shift ?? { hue: 0, saturation: 1, brightness: 1 };
    const uShift = { value: new THREE.Vector3(change.hue / 360, change.saturation, change.brightness) };
    const uFade = { value: new THREE.Vector4(...new THREE.Color(LOOK.fade).toArray(), fade) };
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uShift = uShift;
        shader.uniforms.uFade = uFade;
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
uniform vec3 uShift;
uniform vec4 uFade;
vec3 shiftRgb2Hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1.0e-10)), d / (q.x + 1.0e-10), q.x);
}
vec3 shiftHsv2Rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}`)
            .replace('#include <opaque_fragment>', `{
    vec3 hsv = shiftRgb2Hsv(max(outgoingLight, vec3(0.0)));
    hsv.x = fract(hsv.x + uShift.x);
    hsv.y = clamp(hsv.y * uShift.y, 0.0, 1.0);
    hsv.z = hsv.z * uShift.z;
    outgoingLight = mix(shiftHsv2Rgb(hsv), uFade.rgb, uFade.a);
}
#include <opaque_fragment>`);
    };
    // Its own program key: those toned and those not don't share one.
    material.customProgramCacheKey = () => 'mob-hex-tone';
    return material;
}

/** The land's outline for the sea's shore: round the corners of its tiles (their convex hull), a little out from them. */
function landOutline(views: readonly TileView[]): Point[] {
    const radius = REACH + SEA.shore;
    const points: Point[] = [];
    for (const view of views) {
        const { x, z } = hexToWorld(view.tile.q, view.tile.r);
        for (let k = 0; k < 6; k++) {
            const angle = Math.PI / 6 + (k * Math.PI) / 3;
            points.push({ x: x + Math.cos(angle) * radius, z: z + Math.sin(angle) * radius });
        }
    }
    if (points.length < 3) return [{ x: -1, z: -1 }, { x: 1, z: -1 }, { x: 1, z: 1 }, { x: -1, z: 1 }];
    // Andrew's monotone chain.
    points.sort((a, b) => a.x - b.x || a.z - b.z);
    const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
    const lower: Point[] = [];
    for (const p of points) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
    }
    const upper: Point[] = [];
    for (let i = points.length - 1; i >= 0; i--) {
        const p = points[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
    }
    return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** A tile at its place on the ground, turned its sixths. */
function place(object: THREE.Object3D, tile: HexTile, lift: number): void {
    const { x, z } = hexToWorld(tile.q, tile.r);
    object.position.set(x, lift + (tile.y ?? 0), z);
    object.rotation.y = ((tile.rot ?? 0) * Math.PI) / 3;
}
