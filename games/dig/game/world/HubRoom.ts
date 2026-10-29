// HubRoom.ts
//
// Builds the miner's hub from levels/hub.json with pizza's room builders, the same way
// bandit-controller builds its levels: checker floor, walls with their openings (the doorways out into
// the rock) and static colliders, decor props, and the stations — a glowing pad in front of the
// station's model (the ATM, the artifact totem, the wardrobe closet) with a floating icon, so they're easy
// to spot from anywhere in the hub, and a bouncing "!" when there's something new to check there — and the
// buildables: pieces the player buys to finish the hub, drawn as see-through ghosts with a price tag (walk
// into one to buy it) until bought, then popped in as the real model. Reveal areas (levels/hub.json `areas`) keep
// everything inside them hidden — no colliders, no station, no buying — until their rule is met, then pop it all in
// (so a new player isn't shown the whole hub at once) — and the trophy tables: each zone's
// finds stand on a table in the trophy room, a see-through blue ghost (fresnel rim) until dug up, then the
// real thing, turning.

import * as THREE from 'three';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import type World from '../ecs/World';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import { BendService } from '../services/BendService';
import { PolyWallBuilder } from '../builders/PolyWallBuilder';
import { CheckerFloorBuilder } from '../builders/CheckerFloorBuilder';
import type { StoreWallPlacement, WallSetupConfig, WallStyleConfig, FloorCheckerConfig } from './RoomTypes';
import { HUB, HubAchievementDecor, HubArea, HubBuildable, HubStation, HubTrophyTable, StationKind, hubAreaAt, hubRects } from '../data/HubData';
import { DigProgress } from '../data/DigProgress';
import type { Box } from './GuidePath';
import { DIG, FindDef } from '../data/DigConfig';
import { CanvasArt } from '../ui/CanvasArt';
import { t, names } from '../i18n/Localization';

const ORIGIN = new THREE.Vector3();
const WALL_SETUP: WallSetupConfig = { height: 2.2, thickness: 0.3, doorHeight: 2, tallDoorHeight: 2.2, windowHeight: 1 };
const WALL_STYLE: WallStyleConfig = { bottomColor: '#5d4030', topColor: '#c49a6c', bottomHeight: 0.8 };
const FLOOR: FloorCheckerConfig = { colorA: '#d9c29b', colorB: '#c9ae84', scale: 1 };
const MODEL_BASE = './dig/models/';

/** Each station: pad colour, its badge icon (UI atlas frame), and its model (path under models/, height, raised on a pedestal). */
export const STATION_LOOK: Record<StationKind, { color: number; icon: string; label: string; model: string; height: number; pedestal: number }> = {
    atm: { color: 0x3fd16b, icon: 'ItemIcon_Money_Bill', label: 'ATM', model: 'mine/atm-01.glb', height: 2.1, pedestal: 0 },
    collection: { color: 0xf4b400, icon: 'ItemIcon_Trophy_Gold', label: 'COLLECTION', model: 'mine/idol-a.glb', height: 1.4, pedestal: 0.8 },
    wardrobe: { color: 0xe266c8, icon: 'ItemIcon_Heart_Red', label: 'WARDROBE', model: 'hub/cute-furniture-glb-closet-02/cute-furniture-glb-closet-02.glb', height: 2.2, pedestal: 0 },
};

/** Station pads are this wide; standing on one uses the station. */
export const STATION_RADIUS = 1.3;
/** The station's model stands this far north of the pad's centre. */
const STATION_MODEL_OFFSET = STATION_RADIUS + 0.25;
/** Walking within this of a buildable's spot buys it. */
export const BUILD_RADIUS = 0.9;
const GHOST_COLOR = 0x8fd3ff;
const GHOST_OPACITY = 0.35;
const POP_SEC = 0.45;
/** Trophies are scaled so their biggest side is this (world units). */
const TROPHY_SIZE = 0.55;
const TROPHY_SPIN = 0.6;
/** Trophy table signs: their size, and the distances they fade in (fully shown) / out over. */
const SIGN_SIZE = { x: 2.6, y: 0.65 };
const SIGN_NEAR = 2.8;
const SIGN_FAR = 4.2;

/** Distance between the two rows of a table holding more than 3 finds. */
const TROPHY_ROW_GAP = 0.62;
/** Trophy ghost look: faint blue body, bright rim where the surface turns away from the camera. */
const GHOST_BODY = new THREE.Color(0x2f6bff);
const GHOST_RIM = new THREE.Color(0xbfe9ff);
const GHOST_RIM_POWER = 2.2;
const GHOST_ALPHA = { body: 0.22, rim: 0.9 };

/** Shared by every ghost trophy so they shimmer together; advanced in update(). */
const ghostTime = { value: 0 };

/**
 * The see-through ghost for trophies not found yet: a lit-less MeshStandardMaterial whose final colour and
 * alpha come from a fresnel term (view direction vs normal), plus a slow shimmer. Its own program cache key
 * keeps three.js from sharing a compiled program with plain bent materials (see BendService.tagProgramCacheKey).
 */
function ghostMaterial(): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false });
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uGhostBody = { value: GHOST_BODY };
        shader.uniforms.uGhostRim = { value: GHOST_RIM };
        shader.uniforms.uGhostTime = ghostTime;
        shader.fragmentShader = `
            uniform vec3 uGhostBody;
            uniform vec3 uGhostRim;
            uniform float uGhostTime;
        ` + shader.fragmentShader.replace('#include <opaque_fragment>', `
            float ghostFacing = clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0);
            float ghostRim = pow(1.0 - ghostFacing, ${GHOST_RIM_POWER.toFixed(2)});
            float ghostShimmer = 0.85 + 0.15 * sin(uGhostTime * 2.6 + vViewPosition.y * 3.0);
            outgoingLight = mix(uGhostBody, uGhostRim * 1.4, ghostRim) * ghostShimmer;
            diffuseColor.a = mix(${GHOST_ALPHA.body.toFixed(2)}, ${GHOST_ALPHA.rim.toFixed(2)}, ghostRim) * ghostShimmer;
            #include <opaque_fragment>
        `);
    };
    material.customProgramCacheKey = () => 'dig-trophy-ghost';
    BendService.applyBend(material);
    return material;
}

/** A reveal area's live state: its own group (hidden until revealed) and the colliders waiting for it. */
interface AreaState {
    def: HubArea;
    group: THREE.Group;
    revealed: boolean;
    pending: [number, number, number, number, number][];
    /** Seconds into the reveal pop-in (-1 = not popping). */
    pop: number;
}

/** How long the pieces of a newly revealed area take to pop in. */
const REVEAL_SEC = 0.55;

interface Trophy {
    find: FindDef;
    object: THREE.Object3D;
    solid: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
    shown: boolean;
}

interface BuildableParts {
    def: HubBuildable;
    object?: THREE.Object3D;
    /** The model's own materials, put back when it's built. */
    solid: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
    tag: THREE.Sprite;
    ring: THREE.Mesh;
    built: boolean;
    /** Seconds into the pop-in once bought (-1 = not popping). */
    pop: number;
    /** The collider waits until the miner has stepped off the spot, so it never spawns on top of them. */
    colliderPending: boolean;
}

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

/** The price (with a coin) over the buildable's name, on a plaque. */
function priceTexture(name: string, price: number): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const g = canvas.getContext('2d')!;
    CanvasArt.plaque(g, 8, 8, 240, 112, 26, 'rgba(255, 224, 102, 0.6)');
    CanvasArt.drawIcon(g, 'ItemIcon_Money_Bill', 46, 50, 54);
    CanvasArt.text(g, `$${price.toLocaleString('en-US')}`, 146, 50, 50, '#ffe066', 168);
    CanvasArt.text(g, name.toUpperCase(), 128, 96, 24, '#ffffff', 224);
    return CanvasArt.texture(canvas);
}

/** A zone's name on a plaque with a trophy, floating over its trophy table. */
function signTexture(name: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    // Drawn at 512 x 128 so it stays sharp at its (large) size in the world.
    canvas.width = 512;
    canvas.height = 128;
    const g = canvas.getContext('2d')!;
    CanvasArt.plaque(g, 6, 6, 500, 116, 34, 'rgba(255, 216, 107, 0.7)');
    CanvasArt.drawIcon(g, 'ItemIcon_Trophy_Gold', 62, 64, 86);
    CanvasArt.text(g, name.toUpperCase(), 284, 68, 54, '#ffd86b', 400);
    return CanvasArt.texture(canvas);
}

/** A station's floating badge: its colour in a white-rimmed disc with a UI icon (cash, trophy, heart). */
function iconTexture(icon: string, color: number): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const g = canvas.getContext('2d')!;
    const base = new THREE.Color(color);
    const gradient = g.createRadialGradient(52, 44, 6, 64, 64, 60);
    gradient.addColorStop(0, `#${base.clone().lerp(new THREE.Color(0xffffff), 0.35).getHexString()}`);
    gradient.addColorStop(1, `#${base.getHexString()}`);
    g.fillStyle = gradient;
    g.beginPath();
    g.arc(64, 64, 56, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = '#ffffff';
    g.stroke();
    CanvasArt.drawIcon(g, icon, 64, 64, 78);
    return CanvasArt.texture(canvas);
}

/** The bouncing "!" over a station with something new: the pizza game's alert icon (UI atlas). */
function alertTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    CanvasArt.drawIcon(canvas.getContext('2d')!, 'Icon_Exclamation', 64, 64, 118);
    return CanvasArt.texture(canvas);
}

export class HubRoom {
    private readonly objects: THREE.Object3D[] = [];
    private readonly stations = new Map<StationKind, StationParts>();
    private readonly buildables = new Map<string, BuildableParts>();
    private readonly trophies: Trophy[] = [];
    /** Trophy table name signs, faded in by the miner's distance; `shown` eases 0..1. */
    private readonly signs: { sign: THREE.Sprite; x: number; z: number; shown: number }[] = [];
    /** Achievement decorations (hidden until earned), with the collider added once they show. */
    private readonly rewards: { def: HubAchievementDecor; object?: THREE.Object3D; shown: boolean; pop: number }[] = [];
    private readonly ghost = ghostMaterial();
    private readonly onProgress = () => {
        this.refreshTrophies();
        this.refreshRewards(true);
        this.refreshAreas(true);
    };
    private readonly areas = new Map<string, AreaState>();
    /** Every collider placed so far (walls, stations, props, built pieces): what the guide's arrow path walks around. */
    public readonly blockers: Box[] = [];
    /** The area whose contents are being built right now (add() and collider() put things in it). */
    private building: AreaState | null = null;
    /** Called when an area is revealed in play: its name and where its pieces stand (for smoke puffs). */
    public onReveal?: (area: HubArea, points: THREE.Vector3[]) => void;
    private time = 0;

    public constructor(private readonly threeScene: THREE.Scene, private readonly world: World) {
        for (const def of HUB.areas ?? []) {
            const group = new THREE.Group();
            this.threeScene.add(group);
            this.areas.set(def.id, { def, group, revealed: true, pending: [], pop: -1 });
        }
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
        // Hidden until revealed: decided before anything is built, so their colliders wait.
        this.refreshAreas(false);
        for (const prop of HUB.props) {
            this.inArea(prop.x, prop.z, () => {
                void this.placeProp(prop.model, prop.x, prop.z, prop.rotationY, prop.height, prop.elevation ?? 0, prop.stretch);
                if (prop.collider) {
                    this.collider(prop.x, prop.z, prop.collider.halfX, prop.collider.halfY, prop.collider.halfZ);
                }
            });
        }
        for (const station of HUB.stations) {
            this.inArea(station.x, station.z, () => this.buildStation(station));
        }
        for (const buildable of HUB.buildables ?? []) {
            this.inArea(buildable.x, buildable.z, () => this.buildBuildable(buildable));
        }
        for (const table of HUB.trophyTables ?? []) {
            this.inArea(table.x, table.z, () => void this.buildTrophyTable(table));
        }
        for (const def of HUB.achievementDecor ?? []) {
            const reward = { def, shown: false, pop: -1 } as (typeof this.rewards)[number];
            this.rewards.push(reward);
            this.building = this.areaState(def.x, def.z);
            void this.placeProp(def.model, def.x, def.z, def.rotationY, def.height, def.elevation ?? 0, def.stretch).then((object) => {
                if (!object) return;
                reward.object = object;
                object.visible = false;
                this.refreshRewards(false);
            });
            this.building = null;
        }
        DigProgress.onChange.add(this.onProgress);
    }

    /** A zone's table: its name floating above, its finds along the long side (ghosts until found). */
    private async buildTrophyTable(table: HubTrophyTable): Promise<void> {
        const area = this.building;
        const elevation = table.elevation ?? 0;
        void this.placeProp(table.model, table.x, table.z, table.rotationY, table.height, elevation, table.stretch);
        if (table.collider) this.collider(table.x, table.z, table.collider.halfX, table.collider.halfY, table.collider.halfZ);
        const zone = DIG.zones[table.zone];
        if (!zone) return;
        // The zone's name: big, but only shown while the miner is near the table (see update()).
        const sign = this.add(new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(names.zone(zone)), depthWrite: false, depthTest: false, transparent: true, opacity: 0 })));
        sign.scale.set(SIGN_SIZE.x, SIGN_SIZE.y, 1);
        sign.position.set(table.x, elevation + table.height + 2.1, table.z);
        sign.renderOrder = 4;
        sign.visible = false;
        sign.userData.relabel = () => signTexture(names.zone(zone));
        this.signs.push({ sign, x: table.x, z: table.z, shown: 0 });
        // The table model's long side is its local X (KayKit tables): finds spread along it, 3 to a row; a zone
        // with more finds gets a second row behind (across the table's depth, local Z).
        const along = new THREE.Vector3(Math.cos(table.rotationY), 0, -Math.sin(table.rotationY));
        const across = new THREE.Vector3(Math.sin(table.rotationY), 0, Math.cos(table.rotationY));
        const finds = DIG.finds.filter((find) => find.zone === table.zone);
        const perRow = 3;
        const rows = Math.ceil(finds.length / perRow);
        const spacing = Math.min(0.85, (table.height * 3) / (perRow + 0.5));
        await Promise.all(finds.map(async (find, i) => {
            const row = Math.floor(i / perRow);
            const inRow = Math.min(perRow, finds.length - row * perRow);
            const offset = ((i % perRow) - (inRow - 1) / 2) * spacing;
            const depth = rows > 1 ? (row - (rows - 1) / 2) * TROPHY_ROW_GAP : 0;
            const object = await this.loadTrophy(find, area);
            if (!object) return;
            object.position.add(new THREE.Vector3(table.x, elevation + table.height, table.z).addScaledVector(along, offset).addScaledVector(across, depth));
            object.rotation.y = table.rotationY;
            const solid = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
            object.traverse((child) => {
                if (child instanceof THREE.Mesh) solid.set(child, child.material);
            });
            this.trophies.push({ find, object, solid, shown: true });
        }));
        this.refreshTrophies();
    }

    /** A find's model sized to TROPHY_SIZE, its base at y = 0 and centred on x/z (placed by the caller). */
    private async loadTrophy(find: FindDef, area: AreaState | null): Promise<THREE.Object3D | undefined> {
        try {
            const object = await ModelLoaderManager.instance.loadModel(`${MODEL_BASE}${find.model}`);
            object.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    child.material = Array.isArray(child.material) ? child.material.map((m) => m.clone()) : child.material.clone();
                    (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => BendService.applyBend(m));
                }
            });
            const holder = new THREE.Group();
            holder.add(object);
            const box = new THREE.Box3().setFromObject(object);
            const size = box.getSize(new THREE.Vector3());
            object.scale.multiplyScalar(TROPHY_SIZE / Math.max(size.x, size.y, size.z, 1e-4));
            const scaled = new THREE.Box3().setFromObject(object);
            const center = scaled.getCenter(new THREE.Vector3());
            object.position.set(-center.x, -scaled.min.y, -center.z);
            return this.add(holder, area);
        } catch (error) {
            console.warn(`[HubRoom] could not load trophy ${find.model}`, error);
            return undefined;
        }
    }

    /** Earned achievement decorations appear (popping in when just earned, `animate`). */
    private refreshRewards(animate: boolean): void {
        for (const reward of this.rewards) {
            if (reward.shown || !reward.object || !DigProgress.hasAchievementDecor(reward.def.achievement)) continue;
            reward.shown = true;
            reward.object.visible = true;
            if (animate) reward.pop = 0;
            const collider = reward.def.collider;
            if (collider) this.collider(reward.def.x, reward.def.z, collider.halfX, collider.halfY, collider.halfZ, this.areaState(reward.def.x, reward.def.z));
        }
    }

    /** Found finds show as themselves, the rest as ghosts. */
    private refreshTrophies(): void {
        for (const trophy of this.trophies) {
            const found = Boolean(DigProgress.found[trophy.find.id]);
            if (found === trophy.shown) continue;
            trophy.shown = found;
            for (const [mesh, material] of trophy.solid) {
                mesh.material = found ? material : this.ghost;
                // Ghosts draw after the tables so the see-through body blends over them, not under.
                mesh.renderOrder = found ? 0 : 3;
            }
        }
    }

    /** Buildables bought / total, for the "hub built" count. */
    public get buildProgress(): { built: number; total: number } {
        const all = [...this.buildables.values()];
        return { built: all.filter((b) => b.built).length, total: all.length };
    }

    /** Redraws every 3D label with text (price tags, trophy table signs) in the current language. */
    public relabel(): void {
        const redraw = (object: THREE.Object3D) => {
            object.traverse((child) => {
                const make = child.userData.relabel as (() => THREE.Texture) | undefined;
                if (!make || !(child instanceof THREE.Sprite)) return;
                child.material.map?.dispose();
                child.material.map = make();
                child.material.needsUpdate = true;
            });
        };
        redraw(this.threeScene);
    }

    /** The unbuilt buildable whose spot is at (x, z), if any. */
    public buildableAt(x: number, z: number): HubBuildable | undefined {
        for (const parts of this.buildables.values()) {
            if (!parts.built && this.isOpen(parts.def.x, parts.def.z) && Math.hypot(x - parts.def.x, z - parts.def.z) <= BUILD_RADIUS) return parts.def;
        }
        return undefined;
    }

    // ---------------------------------------------------------------- reveal areas

    private areaState(x: number, z: number): AreaState | null {
        const def = hubAreaAt(x, z);
        return def ? this.areas.get(def.id) ?? null : null;
    }

    /** Builds whatever `build` adds into the area owning (x, z). */
    private inArea(x: number, z: number, build: () => void): void {
        this.building = this.areaState(x, z);
        build();
        this.building = null;
    }

    /** (x, z) is outside every area, or in a revealed one. */
    public isOpen(x: number, z: number): boolean {
        return this.areaState(x, z)?.revealed ?? true;
    }

    /** A station can be used (its area is revealed). */
    public isStationOpen(kind: StationKind): boolean {
        const station = HUB.stations.find((s) => s.kind === kind);
        return !station || this.isOpen(station.x, station.z);
    }

    /** Buildables standing in an area (the ones `built:<area>` waits for). */
    private static buildablesIn(area: HubArea): HubBuildable[] {
        return (HUB.buildables ?? []).filter((b) => hubAreaAt(b.x, b.z)?.id === area.id);
    }

    /** Whether an area's reveal rule is met (see HubArea): any of its '|'-separated rules. */
    private ruleMet(def: HubArea, seen = new Set<string>()): boolean {
        return def.reveal.split('|').some((rule) => this.singleRuleMet(def, rule.trim(), seen));
    }

    private singleRuleMet(def: HubArea, rule: string, seen: Set<string>): boolean {
        if (rule === 'firstUpgrade') return DigProgress.toolLevel >= 1;
        if (rule.startsWith('upgrade:')) return DigProgress.toolLevel >= Number(rule.slice('upgrade:'.length));
        if (rule === 'firstFind') return DigProgress.collectedCount >= 1;
        if (rule.startsWith('upgrades:')) return DigProgress.upgradesBought >= Number(rule.slice('upgrades:'.length));
        if (rule.startsWith('sells:')) return DigProgress.timesSold >= Number(rule.slice('sells:'.length));
        if (rule.startsWith('upgradeAfter:')) {
            const at = DigProgress.areaRevealedAt(rule.slice('upgradeAfter:'.length));
            return at !== undefined && DigProgress.upgradesBought > at;
        }
        if (rule.startsWith('half:')) {
            const other = HUB.areas?.find((a) => a.id === rule.slice('half:'.length));
            if (!other) return true;
            const pieces = HubRoom.buildablesIn(other);
            return pieces.filter((b) => DigProgress.isBuilt(b.id)).length >= Math.ceil(pieces.length / 2);
        }
        if (rule === 'firstBuild') return (HUB.buildables ?? []).some((b) => DigProgress.isBuilt(b.id));
        if (rule.startsWith('built:')) {
            const other = HUB.areas?.find((a) => a.id === rule.slice('built:'.length));
            if (!other || seen.has(other.id)) return true;
            seen.add(def.id);
            return this.ruleMet(other, seen) && HubRoom.buildablesIn(other).every((b) => DigProgress.isBuilt(b.id));
        }
        return true;
    }

    /**
     * The next hidden area and what unlocks it, for the guide: its name, a line saying what to do, and where to go
     * (the ATM for upgrades / selling, the nearest unbuilt piece for building). Undefined once everything is open.
     */
    public nextUnlock(player: THREE.Vector3): { name: string; text: string; target?: THREE.Vector3; building?: boolean } | undefined {
        const atm = HUB.stations.find((s) => s.kind === 'atm');
        const atmAt = atm ? new THREE.Vector3(atm.x, 0, atm.z) : undefined;
        for (const area of this.areas.values()) {
            if (area.revealed) continue;
            const name = names.area(area.def);
            const rules = area.def.reveal.split('|').map((r) => r.trim());
            // Upgrades and selling both happen at the ATM: say every way in ("buy 1 more upgrade or sell 2 more times").
            const atAtm: string[] = [];
            for (const rule of rules) {
                if (rule.startsWith('upgrades:')) {
                    const left = Number(rule.slice(9)) - DigProgress.upgradesBought;
                    atAtm.push(left === 1 ? t('unlockBuyUpgrade') : t('unlockBuyUpgrades', { count: left }));
                }
                if (rule.startsWith('sells:')) {
                    const left = Number(rule.slice(6)) - DigProgress.timesSold;
                    atAtm.push(left === 1 ? t('unlockSellOnce') : t('unlockSellTimes', { count: left }));
                }
            }
            if (atAtm.length) {
                const what = atAtm.reduce((a, b) => t('unlockOr', { a, b }));
                const text = t('unlockAtAtm', { what, name });
                return { name, text: `${text[0].toUpperCase()}${text.slice(1)}`, target: atmAt };
            }
            for (const rule of rules) {
                if (rule.startsWith('upgradeAfter:')) {
                    return { name, text: t('unlockUpgradeAfter', { name }), target: atmAt };
                }
                if (rule.startsWith('half:') || rule.startsWith('built:')) {
                    const other = HUB.areas?.find((a) => a.id === rule.slice(rule.indexOf(':') + 1));
                    if (!other || !this.areas.get(other.id)?.revealed) continue;
                    const pieces = HubRoom.buildablesIn(other);
                    const need = rule.startsWith('half:') ? Math.ceil(pieces.length / 2) : pieces.length;
                    const left = need - pieces.filter((b) => DigProgress.isBuilt(b.id)).length;
                    const open = pieces.filter((b) => !DigProgress.isBuilt(b.id));
                    const nearest = open.reduce<HubBuildable | undefined>((best, b) => (!best || Math.hypot(b.x - player.x, b.z - player.z) < Math.hypot(best.x - player.x, best.z - player.z) ? b : best), undefined);
                    return { name, text: t('unlockBuild', { count: left, area: names.area(other), name }), target: nearest ? new THREE.Vector3(nearest.x, 0, nearest.z) : undefined, building: true };
                }
            }
        }
        return undefined;
    }

    /** The cheapest buildable the miner can see and hasn't bought (the guide's "first buy"). */
    public get cheapestOpenBuildable(): HubBuildable | undefined {
        return (HUB.buildables ?? []).filter((b) => this.isOpen(b.x, b.z) && !DigProgress.isBuilt(b.id))
            .reduce<HubBuildable | undefined>((best, b) => (!best || b.price < best.price ? b : best), undefined);
    }

    /** Shows areas whose rule is now met; `animate` pops their pieces in (and tells onReveal). */
    private refreshAreas(animate: boolean): void {
        for (const area of this.areas.values()) {
            const met = this.ruleMet(area.def);
            if (met === area.revealed) continue;
            area.revealed = met;
            area.group.visible = met;
            if (!met) continue;
            DigProgress.markAreaRevealed(area.def.id);
            for (const args of area.pending) this.collider(...args, null);
            area.pending = [];
            if (!animate) continue;
            area.pop = 0;
            const points: THREE.Vector3[] = [];
            for (const child of area.group.children) {
                child.userData.revealScale = child.scale.clone();
                child.scale.multiplyScalar(0.01);
                if (!(child instanceof THREE.Sprite)) points.push(child.position.clone());
            }
            this.onReveal?.(area.def, points);
        }
    }

    /** Turns a bought buildable from ghost into the real thing, with a little pop. */
    public completeBuild(id: string): void {
        const parts = this.buildables.get(id);
        if (!parts || parts.built) return;
        parts.built = true;
        parts.tag.visible = false;
        parts.ring.visible = false;
        this.makeSolid(parts);
        parts.pop = 0;
        parts.colliderPending = Boolean(parts.def.collider);
    }

    private buildBuildable(def: HubBuildable): void {
        const area = this.building;
        const tag = this.add(new THREE.Sprite(new THREE.SpriteMaterial({ map: priceTexture(names.item(def.name), def.price), depthWrite: false })));
        tag.userData.relabel = () => priceTexture(names.item(def.name), def.price);
        tag.scale.set(1.6, 0.8, 1);
        tag.position.set(def.x, (def.elevation ?? 0) + def.height + 0.7, def.z);
        tag.renderOrder = 4;
        const ring = this.add(new THREE.Mesh(new THREE.TorusGeometry(BUILD_RADIUS, 0.05, 8, 40), this.material(GHOST_COLOR, GHOST_COLOR)));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(def.x, 0.06, def.z);
        const parts: BuildableParts = { def, solid: new Map(), tag, ring, built: false, pop: -1, colliderPending: false };
        this.buildables.set(def.id, parts);
        void this.placeProp(def.model, def.x, def.z, def.rotationY, def.height, def.elevation ?? 0, def.stretch).then((object) => {
            if (!object) return;
            parts.object = object;
            object.traverse((child) => {
                if (child instanceof THREE.Mesh) parts.solid.set(child, child.material);
            });
            if (DigProgress.isBuilt(def.id)) {
                parts.built = true;
                tag.visible = false;
                ring.visible = false;
                if (def.collider) this.collider(def.x, def.z, def.collider.halfX, def.collider.halfY, def.collider.halfZ, area);
            } else if (!parts.built) {
                this.makeGhost(parts);
            }
        });
    }

    private makeGhost(parts: BuildableParts): void {
        const ghost = new THREE.MeshStandardMaterial({ color: GHOST_COLOR, emissive: GHOST_COLOR, emissiveIntensity: 0.25, transparent: true, opacity: GHOST_OPACITY, depthWrite: false });
        BendService.applyBend(ghost);
        for (const mesh of parts.solid.keys()) mesh.material = ghost;
    }

    private makeSolid(parts: BuildableParts): void {
        for (const [mesh, material] of parts.solid) mesh.material = material;
    }

    /** Adds to the scene, or to `area`'s group (hidden until revealed). */
    private add<T extends THREE.Object3D>(object: T, area: AreaState | null = this.building): T {
        (area ? area.group : this.threeScene).add(object);
        this.objects.push(object);
        return object;
    }

    /** A static box; one in a hidden `area` waits until it's revealed. */
    private collider(x: number, z: number, halfX: number, halfY: number, halfZ: number, area: AreaState | null = this.building): void {
        if (area && !area.revealed) {
            area.pending.push([x, z, halfX, halfY, halfZ]);
            return;
        }
        this.blockers.push({ x, z, halfX, halfZ });
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
        // The model stands behind the pad: -Z unturned, swung round the pad by the station's rotation.
        const turn = station.rotationY ?? 0;
        const size = station.scale ?? 1;
        const height = look.height * size;
        const pedestalHeight = look.pedestal * size;
        const modelX = station.x - Math.sin(turn) * STATION_MODEL_OFFSET;
        const modelZ = station.z - Math.cos(turn) * STATION_MODEL_OFFSET;
        if (pedestalHeight > 0) {
            const pedestal = this.add(new THREE.Mesh(new THREE.BoxGeometry(0.9 * size, pedestalHeight, 0.9 * size), this.material(0x4a3a30)));
            pedestal.position.set(modelX, pedestalHeight / 2, modelZ);
        }
        void this.placeProp(look.model, modelX, modelZ, turn, height, pedestalHeight);
        this.collider(modelX, modelZ, 0.5 * size, (pedestalHeight + height) / 2, 0.45 * size);
        const top = pedestalHeight + height;
        const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture(look.icon, look.color), depthWrite: false }));
        icon.scale.setScalar(1.1);
        icon.position.set(modelX, top + 0.7, modelZ);
        this.add(icon);
        const attention = new THREE.Sprite(new THREE.SpriteMaterial({ map: alertTexture(), depthWrite: false, depthTest: false }));
        attention.scale.setScalar(0.9);
        attention.renderOrder = 5;
        attention.visible = false;
        this.add(attention);
        this.stations.set(station.kind, {
            ring, pad: pad.material as THREE.MeshStandardMaterial, pulse: 0, icon, iconY: top + 0.7, attention,
            target: new THREE.Vector3(modelX + Math.sin(turn) * 0.35, Math.min(top - 0.3, 1.3), modelZ + Math.cos(turn) * 0.35),
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

    /** A model fitted to `height`, optionally stretched along its own width/depth (`stretch`), turned and stood on `elevation`. */
    private async placeProp(model: string, x: number, z: number, rotationY: number, height: number, elevation: number,
        stretch?: { x: number; z: number }): Promise<THREE.Object3D | undefined> {
        const area = this.building;
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
            if (stretch) object.scale.multiply(new THREE.Vector3(stretch.x, 1, stretch.z));
            object.rotation.y = rotationY;
            object.updateMatrixWorld(true);
            const bounds = new THREE.Box3().setFromObject(object);
            object.position.set(x, elevation - bounds.min.y, z);
            return this.add(object, area);
        } catch (error) {
            console.warn(`[HubRoom] could not load prop ${model}`, error);
            return undefined;
        }
    }

    /** Bobs the station icons, bounces the "!" marks, settles pad flashes and plays buildable pop-ins. */
    public update(delta: number, player: { x: number; z: number }): void {
        this.time += delta;
        ghostTime.value = this.time;
        for (const area of this.areas.values()) {
            if (area.pop < 0) continue;
            area.pop += delta;
            const t = Math.min(1, area.pop / REVEAL_SEC);
            // Grows from nothing with a small overshoot, so each piece "lands".
            const s = t < 1 ? t + Math.sin(t * Math.PI) * 0.25 : 1;
            for (const child of area.group.children) {
                const base = child.userData.revealScale as THREE.Vector3 | undefined;
                if (base) child.scale.copy(base).multiplyScalar(Math.max(0.01, s));
            }
            if (t >= 1) area.pop = -1;
        }
        for (const trophy of this.trophies) {
            if (trophy.shown) trophy.object.rotation.y += delta * TROPHY_SPIN;
        }
        for (const entry of this.signs) {
            const distance = Math.hypot(player.x - entry.x, player.z - entry.z);
            const want = THREE.MathUtils.clamp((SIGN_FAR - distance) / (SIGN_FAR - SIGN_NEAR), 0, 1);
            entry.shown += (want - entry.shown) * Math.min(1, delta * 8);
            entry.sign.visible = entry.shown > 0.01;
            entry.sign.material.opacity = entry.shown;
            // A small grow as it appears, so it pops rather than just fades.
            const s = 0.8 + entry.shown * 0.2;
            entry.sign.scale.set(SIGN_SIZE.x * s, SIGN_SIZE.y * s, 1);
        }
        for (const reward of this.rewards) {
            if (reward.pop < 0 || !reward.object) continue;
            reward.pop += delta;
            const t = Math.min(1, reward.pop / POP_SEC);
            reward.object.userData.baseScale ??= reward.object.scale.x;
            reward.object.scale.setScalar(reward.object.userData.baseScale * (t < 1 ? 0.2 + t * 0.8 + Math.sin(t * Math.PI) * 0.2 : 1));
            if (t >= 1) reward.pop = -1;
        }
        for (const parts of this.buildables.values()) {
            if (!parts.built) {
                parts.tag.position.y = (parts.def.elevation ?? 0) + parts.def.height + 0.7 + Math.sin(this.time * 2 + parts.def.x) * 0.08;
            }
            if (parts.pop >= 0 && parts.object) {
                parts.pop += delta;
                const t = Math.min(1, parts.pop / POP_SEC);
                // Swells to ~1.15 and settles back: reads as "it just landed".
                parts.object.userData.baseScale ??= parts.object.scale.x;
                parts.object.scale.setScalar(parts.object.userData.baseScale * (1 + Math.sin(t * Math.PI) * 0.15));
                if (t >= 1) parts.pop = -1;
            }
            const collider = parts.def.collider;
            if (parts.colliderPending && collider && Math.hypot(player.x - parts.def.x, player.z - parts.def.z) > BUILD_RADIUS + 0.4) {
                parts.colliderPending = false;
                this.collider(parts.def.x, parts.def.z, collider.halfX, collider.halfY, collider.halfZ);
            }
        }
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
        DigProgress.onChange.remove(this.onProgress);
        for (const area of this.areas.values()) area.group.removeFromParent();
        for (const object of this.objects) {
            object.removeFromParent();
        }
    }
}
