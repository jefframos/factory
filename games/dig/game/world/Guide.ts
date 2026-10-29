// Guide.ts
//
// First-time guidance: works out the next step from the progress alone (nothing extra is saved) — dig the rock,
// sell at the ATM, buy the first tool, dig up the first find and look at it in the Collection, then whatever opens
// the next hidden part of the hub (HubRoom.nextUnlock) — and points at it with no text: a trail of small triangles on
// the floor along the walking route (GuidePath: around walls, stations and rock), flowing towards the target, and a
// bouncing marker over it (not over buildables: their price tag is there). It ends for good once the first hub piece (a cosmetic) is bought.
// The step's text still goes to `say` (the HUD keeps it hidden; handy for debugging).

import * as THREE from 'three';
import { BendService } from '../services/BendService';
import { DigProgress } from '../data/DigProgress';
import { HUB, hubRects } from '../data/HubData';
import type { HubRoom } from './HubRoom';
import { findPath } from './GuidePath';
import { t, names } from '../i18n/Localization';

const COLOR = 0xffd23f;
/** The trail and the marker ring float this high, above rugs and carpets (up to ~0.17 tall), so they never vanish under them. */
const FLOOR_LIFT = 0.25;
/** Trail: the first triangle sits this far along the route, then one every SPACING, at most TRAIL_MAX; none this close to the target. */
const TRAIL_START = 0.9;
const SPACING = 0.75;
const TRAIL_MAX = 28;
const NEAR = 1.4;
/** The route is worked out again this often (seconds), or at once when the target changes. */
const REPATH_SEC = 0.25;
/** Each triangle grows and fades with a wave that runs along the trail towards the target. */
const WAVE_SPEED = 3.2;

export interface GuideStep {
    text: string;
    target?: THREE.Vector3;
    /** false = only the floor arrow (the target has its own tag in the way). */
    marker?: boolean;
    /** An upgrade is affordable: the HUD's hand points at its buy button in the ATM panel. */
    buy?: boolean;
}

export class Guide {
    private readonly marker = new THREE.Group();
    private readonly trail: THREE.Mesh[] = [];
    private route: THREE.Vector3[] = [];
    private routeTarget = new THREE.Vector3(Infinity, 0, 0);
    private repath = 0;
    private time = 0;

    /** `say` shows (or with null clears) the step's text on the HUD. */
    public constructor(threeScene: THREE.Scene, private readonly hub: HubRoom, private readonly solid: (x: number, z: number) => boolean,
        private readonly say: (text: string | null, buy: boolean) => void) {
        const material = new THREE.MeshStandardMaterial({ color: COLOR, emissive: COLOR, emissiveIntensity: 0.5 });
        BendService.applyBend(material);
        // Marker: a downward cone over the target and a ring on the floor under it.
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.6, 20), material);
        cone.rotation.x = Math.PI;
        cone.name = 'cone';
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.07, 8, 40), material);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = FLOOR_LIFT;
        this.marker.add(cone, ring);
        // Trail: flat triangles with their tip along +Z, turned along the route each frame.
        const shape = new THREE.Shape();
        shape.moveTo(0, 0.24);
        shape.lineTo(0.2, -0.16);
        shape.lineTo(-0.2, -0.16);
        shape.closePath();
        const geometry = new THREE.ShapeGeometry(shape);
        // Flat on the floor facing up: the tip (+Y in the shape) then points to -Z, so turn it to +Z.
        geometry.rotateX(-Math.PI / 2);
        geometry.rotateY(Math.PI);
        const trailMaterial = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, depthWrite: false });
        BendService.applyBend(trailMaterial);
        for (let i = 0; i < TRAIL_MAX; i++) {
            const mesh = new THREE.Mesh(geometry, trailMaterial.clone());
            BendService.applyBend(mesh.material as THREE.Material);
            mesh.visible = false;
            mesh.renderOrder = 2;
            this.trail.push(mesh);
            threeScene.add(mesh);
        }
        this.marker.visible = false;
        threeScene.add(this.marker);
    }

    /** The step for the current progress, or null once the guide is done: after the first hub piece is bought. */
    private step(player: THREE.Vector3): GuideStep | null {
        // Buying the first cosmetic is where the tutorial ends: from there on the player knows the loop.
        if ((HUB.buildables ?? []).some((b) => DigProgress.isBuilt(b.id))) return null;
        const atm = HUB.stations.find((s) => s.kind === 'atm');
        const atmAt = atm ? new THREE.Vector3(atm.x, 0, atm.z) : undefined;
        const door = this.nearestDoor(player);
        const inHub = hubRects().some((r) => Math.abs(player.x - r.x) <= r.width / 2 && Math.abs(player.z - r.z) <= r.depth / 2);
        const tool = DigProgress.nextTool;
        const collection = HUB.stations.find((s) => s.kind === 'collection');

        // The first find (forced early, see MiningController): go and look at it — the Trophy Room just appeared.
        if (collection && DigProgress.unseenFinds.length > 0 && DigProgress.collectedCount === 1 && this.hub.isStationOpen('collection')) {
            return { text: t('guideCollection'), target: new THREE.Vector3(collection.x, 0, collection.z) };
        }
        // The wardrobe just appeared: go and have a look before anything else.
        const wardrobe = HUB.stations.find((s) => s.kind === 'wardrobe');
        if (wardrobe && !DigProgress.wardrobeVisited && this.hub.isStationOpen('wardrobe')) {
            return { text: t('guideWardrobe'), target: new THREE.Vector3(wardrobe.x, 0, wardrobe.z) };
        }
        if (DigProgress.toolLevel === 0) {
            if (DigProgress.achievementStat('blocks') === 0) return { text: t('guideDig'), target: inHub ? door : undefined };
            if (tool && DigProgress.money >= tool.price) return { text: t('guideBuyTool', { tool: names.tool(tool) }), target: atmAt, buy: true };
            return this.digSellLoop(inHub, door, atmAt);
        }
        // The first piece of the hub: the cheapest one in sight (walk into it to buy it).
        // The first artifact turns up soon after the first upgrade (MiningController.forcedFirstFind).
        if (DigProgress.collectedCount === 0) {
            return { text: t('guideTreasure'), target: inHub ? door : undefined };
        }
        const anyBuilt = (HUB.buildables ?? []).some((b) => DigProgress.isBuilt(b.id));
        const first = anyBuilt ? undefined : this.hub.cheapestOpenBuildable;
        if (first) {
            const price = first.price.toLocaleString('en-US');
            const name = names.item(first.name);
            // The cosmetic only once it's affordable; until then go and get the money: sell what's in the bag at the
            // ATM, or (empty bag) dig.
            if (DigProgress.money >= first.price) {
                return { text: t('guideBuild', { name, price }), target: new THREE.Vector3(first.x, 0, first.z), marker: false };
            }
            const text = t('guideEarnBuild', { name, price });
            return DigProgress.backpackCount > 0 ? { text, target: atmAt } : { text, target: inHub ? door : undefined };
        }
        const unlock = this.hub.nextUnlock(player);
        if (unlock) {
            // Building: straight to the next piece. Upgrades / selling (at the ATM): only when there's cash for an
            // upgrade or a full bag to sell — otherwise back out to dig.
            if (unlock.building) return { text: unlock.text, target: unlock.target, marker: false };
            return this.digSellLoop(inHub, door, atmAt, unlock.text);
        }
        return null;
    }

    /**
     * The core loop, for whatever needs money or sales: an affordable upgrade -> the ATM (and the hand on its buy
     * button); a full bag -> the ATM to sell; otherwise -> out through the nearest doorway to dig (no trail once out).
     */
    private digSellLoop(inHub: boolean, door: THREE.Vector3 | undefined, atmAt: THREE.Vector3 | undefined, goal?: string): GuideStep {
        const tool = DigProgress.nextTool;
        const bag = DigProgress.nextBackpack;
        const cheapest = Math.min(tool?.price ?? Infinity, bag?.price ?? Infinity);
        if (DigProgress.money >= cheapest) return { text: goal ?? t('guideBuyUpgrade'), target: atmAt, buy: true };
        if (DigProgress.backpackCount >= DigProgress.capacity) return { text: t('guideBackpackFull'), target: atmAt };
        return { text: goal ?? t('guideKeepDigging'), target: inHub ? door : undefined };
    }

    /** The middle of the doorway (a wall gap) nearest the miner: the way out to the rock. */
    private nearestDoor(player: THREE.Vector3): THREE.Vector3 | undefined {
        let best: THREE.Vector3 | undefined;
        for (const wall of HUB.walls) {
            for (const opening of wall.openings) {
                if (opening.kind !== 'gap') continue;
                const at = new THREE.Vector3((opening.minX + opening.maxX) / 2, 0, (opening.minZ + opening.maxZ) / 2);
                // Only the ones leading out of the hub (a doorway into another room isn't the way to the rock).
                if (hubRects().filter((r) => Math.abs(at.x - r.x) <= r.width / 2 + 0.5 && Math.abs(at.z - r.z) <= r.depth / 2 + 0.5).length > 1) continue;
                if (!best || at.distanceTo(player) < best.distanceTo(player)) best = at;
            }
        }
        return best;
    }

    public update(delta: number, player: THREE.Vector3): void {
        this.time += delta;
        const step = this.step(player);
        this.say(step?.text ?? null, step?.buy === true);
        const target = step?.target;
        this.marker.visible = !!target && step?.marker !== false;
        if (!target) {
            this.showTrail([]);
            return;
        }
        this.marker.position.copy(target);
        const cone = this.marker.getObjectByName('cone')!;
        cone.position.y = 2.1 + Math.abs(Math.sin(this.time * 3)) * 0.35;
        this.marker.rotation.y = this.time * 1.5;
        this.repath -= delta;
        if (this.repath <= 0 || target.distanceToSquared(this.routeTarget) > 0.01) {
            this.repath = REPATH_SEC;
            this.routeTarget.copy(target);
            this.route = findPath(player, target, this.solid, this.hub.blockers);
        } else if (this.route.length) {
            // Between repaths the route starts where the miner is now.
            this.route[0].set(player.x, 0, player.z);
        }
        this.showTrail(player.distanceTo(target) > NEAR ? this.route : []);
    }

    /** Lays the triangles along `route` (every SPACING from TRAIL_START, stopping short of the end), each facing its leg. */
    private showTrail(route: THREE.Vector3[]): void {
        let shown = 0;
        let along = 0;
        let next = TRAIL_START;
        const total = route.reduce((sum, p, i) => (i ? sum + p.distanceTo(route[i - 1]) : 0), 0);
        for (let i = 1; i < route.length && shown < TRAIL_MAX; i++) {
            const a = route[i - 1];
            const b = route[i];
            const leg = a.distanceTo(b);
            while (next <= along + leg && next <= total - NEAR * 0.6 && shown < TRAIL_MAX) {
                const t = (next - along) / Math.max(leg, 1e-4);
                const mesh = this.trail[shown++];
                mesh.visible = true;
                mesh.position.set(a.x + (b.x - a.x) * t, FLOOR_LIFT, a.z + (b.z - a.z) * t);
                mesh.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
                // A wave of size and brightness running towards the target.
                const wave = 0.5 + 0.5 * Math.sin(next * 1.6 - this.time * WAVE_SPEED);
                mesh.scale.setScalar(0.8 + wave * 0.35);
                (mesh.material as THREE.MeshBasicMaterial).opacity = 0.45 + wave * 0.55;
                next += SPACING;
            }
            along += leg;
        }
        for (let i = shown; i < this.trail.length; i++) this.trail[i].visible = false;
    }

    public destroy(): void {
        this.marker.removeFromParent();
        this.trail.forEach((mesh) => mesh.removeFromParent());
    }
}
