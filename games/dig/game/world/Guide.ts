// Guide.ts
//
// First-time guidance: works out the next step from the progress alone (nothing extra is saved) — dig the rock,
// sell at the ATM, buy the first tool, dig up the first find (claimed on its banner), then whatever opens
// the next hidden part of the hub (HubRoom.nextUnlock) — and points at it with no text: a trail of small triangles on
// the floor along the walking route (GuidePath: around walls, stations and rock, through the dug tunnels), flowing
// towards the target and drawn over the rock so a tunnel wall never hides them, and a
// bouncing marker over it (not over buildables: their price tag is there). Out in the rock the arrows stay quiet so
// digging isn't interrupted: only a full backpack and the first upgrade lead anywhere from there (`anywhere`); the
// wardrobe and the first build are pointed at once the miner is back in the hub. Never the Trophy Room: finds are
// claimed on their banner, so there's nothing to collect there. The tutorial ends
// once the first hub piece (a cosmetic) is bought; then, for a few relics, the relic hunt (RelicHunt) has the arrows lead to the next relic and to
// the Trophy Room to claim it, and after that the guide only steps in for a full backpack.
// The step's text still goes to `say` (the HUD keeps it hidden; handy for debugging).

import * as THREE from 'three';
import { BendService } from '../services/BendService';
import { DigProgress } from '../data/DigProgress';
import { HUB, hubRects } from '../data/HubData';
import type { HubRoom } from './HubRoom';
import { findPath } from './GuidePath';
import type { RelicHunt } from './RelicHunt';
import { PowerSurge } from '../mining/PowerSurge';
import { t, names } from '../i18n/Localization';

/** Gold with a dark silhouette, so direction is readable on light and dark surfaces. */
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

/**
 * A flat arrowhead with rounded corners, tip along +Z, lying on the floor. `grow` pads it evenly on every side (the
 * outline), so the border keeps one width all round instead of the thin tip a scaled copy would give.
 */
function roundedTriangle(halfWidth: number, tipRadius: number, baseRadius: number, grow = 0): THREE.ShapeGeometry {
    const corners = [new THREE.Vector2(0, 0.24), new THREE.Vector2(halfWidth, -0.16), new THREE.Vector2(-halfWidth, -0.16)];
    const shape = new THREE.Shape();
    for (let i = 0; i < 3; i++) {
        const radius = i === 0 ? tipRadius : baseRadius;
        const r = radius + grow;
        const corner = corners[i];
        const prev = corners[(i + 2) % 3];
        const next = corners[(i + 1) % 3];
        const toPrev = prev.clone().sub(corner).normalize();
        const toNext = next.clone().sub(corner).normalize();
        // Inset the corner to the rounded arc's centre; the arc touches both edges, and `grow` pads it outwards.
        const half = Math.acos(Math.max(-1, Math.min(1, toPrev.dot(toNext)))) / 2;
        const bisector = toPrev.clone().add(toNext).normalize();
        const centre = corner.clone().addScaledVector(bisector, radius / Math.sin(half));
        const along = radius / Math.tan(half);
        const fromPrev = corner.clone().addScaledVector(toPrev, along).sub(centre);
        const toward = corner.clone().addScaledVector(toNext, along).sub(centre);
        const start = Math.atan2(fromPrev.y, fromPrev.x);
        let sweep = Math.atan2(toward.y, toward.x) - start;
        while (sweep > Math.PI) sweep -= Math.PI * 2;
        while (sweep <= -Math.PI) sweep += Math.PI * 2;
        const startPoint = new THREE.Vector2(centre.x + Math.cos(start) * r, centre.y + Math.sin(start) * r);
        if (i === 0) shape.moveTo(startPoint.x, startPoint.y);
        else shape.lineTo(startPoint.x, startPoint.y);
        shape.absarc(centre.x, centre.y, r, start, start + sweep, sweep < 0);
    }
    shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape, 6);
    // Flat on the floor facing up: the tip (+Y in the shape) then points to -Z, so turn it to +Z.
    geometry.rotateX(-Math.PI / 2);
    geometry.rotateY(Math.PI);
    return geometry;
}

export interface GuideStep {
    text: string;
    target?: THREE.Vector3;
    /** false = only the floor arrow (the target has its own tag in the way). */
    marker?: boolean;
    /** An upgrade is affordable: the HUD's hand points at its buy button in the ATM panel. */
    buy?: boolean;
    /** Followed out in the rock too (a full backpack, the first upgrade); every other step only leads from the hub. */
    anywhere?: boolean;
}

export class Guide {
    private readonly marker = new THREE.Group();
    private readonly trail: THREE.Mesh[] = [];
    private readonly trailGeometries: THREE.BufferGeometry[] = [];
    private readonly outlineMaterial = new THREE.MeshBasicMaterial({ color: 0x241d18, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false });
    private route: THREE.Vector3[] = [];
    private routeTarget = new THREE.Vector3(Infinity, 0, 0);
    private repath = 0;
    private time = 0;
    private returnToSell = false;
    /** The first hub piece the arrows lead to, kept while it's still affordable. */
    private buildTarget?: string;

    /** `say` shows (or with null clears) the step's text on the HUD. */
    public constructor(threeScene: THREE.Scene, private readonly hub: HubRoom, private readonly solid: (x: number, z: number) => boolean,
        private readonly hunt: RelicHunt, private readonly say: (text: string | null, buy: boolean) => void) {
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
        // Trail: flat rounded triangles with their tip along +Z, turned along the route each frame.
        const geometry = roundedTriangle(0.2, 0.02, 0.035);
        const outlineGeometry = roundedTriangle(0.2, 0.02, 0.035, 0.06);
        this.trailGeometries.push(geometry, outlineGeometry);
        // Drawn over everything: in a tunnel the rock in front (towards the camera) would hide the arrows on its floor.
        const trailMaterial = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, depthWrite: false, depthTest: false });
        BendService.applyBend(trailMaterial);
        BendService.applyBend(this.outlineMaterial);
        for (let i = 0; i < TRAIL_MAX; i++) {
            const mesh = new THREE.Mesh(geometry, trailMaterial.clone());
            BendService.applyBend(mesh.material as THREE.Material);
            mesh.visible = false;
            mesh.renderOrder = 8;
            const outline = new THREE.Mesh(outlineGeometry, this.outlineMaterial);
            outline.renderOrder = 7;
            mesh.add(outline);
            this.trail.push(mesh);
            threeScene.add(mesh);
        }
        // The marker too: the target is often round a corner, behind a wall or a column of rock.
        material.depthTest = false;
        this.marker.traverse((child) => (child.renderOrder = 8));
        this.marker.visible = false;
        threeScene.add(this.marker);
    }

    /** Turns the way back to the ATM on (the scene: a few tries at digging with a full backpack) or off. */
    public setReturnToSell(on: boolean): void {
        this.returnToSell = on;
    }

    /**
     * The step for the current progress, or null once the guide is done: after the first hub piece is bought. Out in
     * the rock only `anywhere` steps keep their arrows (a full backpack takes over there during the tutorial); the rest
     * wait until the miner is back in the hub.
     */
    private step(player: THREE.Vector3): GuideStep | null {
        const inHub = hubRects().some((r) => Math.abs(player.x - r.x) <= r.width / 2 && Math.abs(player.z - r.z) <= r.depth / 2);
        const atm = HUB.stations.find((s) => s.kind === 'atm');
        const atmAt = atm ? new THREE.Vector3(atm.x, 0, atm.z) : undefined;
        const step = this.pick(player, inHub, atmAt);
        if (!step || inHub || step.anywhere || !step.target) return step;
        const tutorial = !(HUB.buildables ?? []).some((b) => DigProgress.isBuilt(b.id));
        if (tutorial && DigProgress.backpackCount >= DigProgress.capacity) return { text: t('guideBackpackFull'), target: atmAt, anywhere: true };
        return { ...step, target: undefined };
    }

    private pick(player: THREE.Vector3, inHub: boolean, atmAt: THREE.Vector3 | undefined): GuideStep | null {
        // A power surge running: nothing to follow until it's over (then it picks up where it was).
        if (PowerSurge.active) return null;
        // Stuck with a full backpack (even after the tutorial): the arrows lead back to sell it. The power chest is never
        // guided to: it pops up right ahead with its own beam, and pulling players off the tutorial to chase it cost
        // tutorial completion.
        if (this.returnToSell && DigProgress.backpackCount >= DigProgress.capacity) return { text: t('guideBackpackFull'), target: atmAt, anywhere: true };
        const door = this.nearestDoor(player);
        // Buying the first cosmetic is where the tutorial ends: from there on the player knows the loop, and the relic
        // hunt gives them something to dig towards.
        if ((HUB.buildables ?? []).some((b) => DigProgress.isBuilt(b.id))) return this.huntStep(inHub, door);
        const tool = DigProgress.nextTool;
        // Never to the Trophy Room: finds are claimed on their banner, so it holds nothing to pick up — it's there for
        // completing the collection, and its totem's "!" is enough.
        // The wardrobe just appeared: go and have a look before anything else.
        const wardrobe = HUB.stations.find((s) => s.kind === 'wardrobe');
        if (wardrobe && !DigProgress.wardrobeVisited && this.hub.isStationOpen('wardrobe')) {
            return { text: t('guideWardrobe'), target: new THREE.Vector3(wardrobe.x, 0, wardrobe.z) };
        }
        // Until both first upgrades are bought (the pickaxe, then the bag): dig, sell, buy — full bag -> the ATM.
        if (DigProgress.toolLevel === 0 || DigProgress.backpackLevel === 0) {
            if (DigProgress.achievementStat('blocks') === 0) return { text: t('guideDig'), target: inHub ? door : undefined };
            if (tool && DigProgress.money >= DigProgress.priceOf(tool)) return { text: t('guideBuyTool', { tool: names.tool(tool) }), target: atmAt, buy: true, anywhere: true };
            return this.digSellLoop(inHub, door, atmAt);
        }
        // The first piece of the hub: the nearest one in sight the money covers, else the cheapest (walk into it to buy it).
        // The first artifact turns up soon after the first upgrade (MiningController.forcedFirstFind).
        if (DigProgress.collectedCount === 0) {
            return { text: t('guideTreasure'), target: inHub ? door : undefined };
        }
        const anyBuilt = (HUB.buildables ?? []).some((b) => DigProgress.isBuilt(b.id));
        const first = anyBuilt ? undefined : this.hub.firstBuyFor(player, this.buildTarget);
        this.buildTarget = first?.id;
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
     * After the tutorial, while the relic hunt lasts: the named relic's block (out through the nearest doorway first,
     * until it's placed); its reward is claimed on its banner. Null once the hunt is over.
     */
    private huntStep(inHub: boolean, door: THREE.Vector3 | undefined): GuideStep | null {
        if (!this.hunt.guiding) return null;
        const relic = this.hunt.relic;
        if (!relic) return null;
        const text = t('guideRelic', { name: names.find(relic) });
        return { text, target: this.hunt.target() ?? (inHub ? door : undefined) };
    }

    /**
     * The core loop, for whatever needs money or sales: an affordable upgrade -> the ATM (and the hand on its buy
     * button); a full bag -> the ATM to sell; otherwise -> out through the nearest doorway to dig (no trail once out).
     */
    private digSellLoop(inHub: boolean, door: THREE.Vector3 | undefined, atmAt: THREE.Vector3 | undefined, goal?: string): GuideStep {
        const tool = DigProgress.nextTool;
        const bag = DigProgress.nextBackpack;
        const cheapest = Math.min(tool ? DigProgress.priceOf(tool) : Infinity, bag ? DigProgress.priceOf(bag) : Infinity);
        if (DigProgress.money >= cheapest) return { text: goal ?? t('guideBuyUpgrade'), target: atmAt, buy: true };
        if (DigProgress.backpackCount >= DigProgress.capacity) return { text: t('guideBackpackFull'), target: atmAt, anywhere: true };
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
                (mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 + wave * 0.2;
                next += SPACING;
            }
            along += leg;
        }
        for (let i = shown; i < this.trail.length; i++) this.trail[i].visible = false;
    }

    public destroy(): void {
        this.marker.removeFromParent();
        this.trailGeometries.forEach((geometry) => geometry.dispose());
        this.trail.forEach((mesh) => {
            mesh.removeFromParent();
            (mesh.material as THREE.Material).dispose();
        });
        this.outlineMaterial.dispose();
    }
}
