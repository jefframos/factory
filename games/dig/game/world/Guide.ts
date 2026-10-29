// Guide.ts
//
// First-time guidance: works out the next step from the progress alone (nothing extra is saved) — dig the rock,
// sell at the ATM, buy the first tool, look at the first find in the Collection, build the first piece of the hub —
// and points at it: a line of text on the HUD, a bouncing marker over the target (not over buildables: their price
// tag is there) and an arrow on the floor at the miner's feet aiming at it. After the first build it goes quiet.

import * as THREE from 'three';
import { BendService } from '../services/BendService';
import { DigProgress } from '../data/DigProgress';
import { HUB, hubRects } from '../data/HubData';
import type { HubRoom } from './HubRoom';

const COLOR = 0xffd23f;
/** The floor arrow sits this far from the miner, towards the target; hidden once this close to it. */
const ARROW_OFFSET = 1.3;
const NEAR = 1.6;
/** Items in the backpack before the guide sends the miner to sell. */
const SELL_AT = 6;

export interface GuideStep {
    text: string;
    target?: THREE.Vector3;
    /** false = only the floor arrow (the target has its own tag in the way). */
    marker?: boolean;
}

export class Guide {
    private readonly marker = new THREE.Group();
    private readonly arrow: THREE.Mesh;
    private time = 0;

    /** `say` shows (or with null clears) the step's text on the HUD. */
    public constructor(threeScene: THREE.Scene, private readonly hub: HubRoom, private readonly say: (text: string | null) => void) {
        const material = new THREE.MeshStandardMaterial({ color: COLOR, emissive: COLOR, emissiveIntensity: 0.5 });
        BendService.applyBend(material);
        // Marker: a downward cone over the target and a ring on the floor under it.
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.6, 20), material);
        cone.rotation.x = Math.PI;
        cone.name = 'cone';
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.07, 8, 40), material);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.06;
        this.marker.add(cone, ring);
        // Floor arrow: a flat chevron with its tip along +Z, turned towards the target each frame.
        const shape = new THREE.Shape();
        shape.moveTo(0, 0.55);
        shape.lineTo(0.42, 0);
        shape.lineTo(0.16, 0);
        shape.lineTo(0.16, -0.45);
        shape.lineTo(-0.16, -0.45);
        shape.lineTo(-0.16, 0);
        shape.lineTo(-0.42, 0);
        shape.closePath();
        const geometry = new THREE.ShapeGeometry(shape);
        // Lay it flat facing up: the tip (+Y in the shape) then points to -Z, so turn it to +Z — the direction
        // update() aims at the target.
        geometry.rotateX(-Math.PI / 2);
        geometry.rotateY(Math.PI);
        this.arrow = new THREE.Mesh(geometry, material);
        this.marker.visible = false;
        this.arrow.visible = false;
        threeScene.add(this.marker, this.arrow);
    }

    /** The step for the current progress, or null once the guide is done. */
    private step(player: THREE.Vector3): GuideStep | null {
        const atm = HUB.stations.find((s) => s.kind === 'atm');
        const atmAt = atm ? new THREE.Vector3(atm.x, 0, atm.z) : undefined;
        const door = this.nearestDoor(player);
        const inHub = hubRects().some((r) => Math.abs(player.x - r.x) <= r.width / 2 && Math.abs(player.z - r.z) <= r.depth / 2);
        const carrying = DigProgress.backpackCount;
        const full = carrying >= DigProgress.capacity;
        const tool = DigProgress.nextTool;
        const collection = HUB.stations.find((s) => s.kind === 'collection');

        // The first find (forced early, see MiningController): go and look at it — the Trophy Room just appeared.
        if (collection && DigProgress.unseenFinds.length > 0 && DigProgress.collectedCount === 1 && this.hub.isStationOpen('collection')) {
            return { text: 'You found an artifact! See it in the Trophy Room', target: new THREE.Vector3(collection.x, 0, collection.z) };
        }
        if (DigProgress.toolLevel === 0) {
            if (DigProgress.achievementStat('blocks') === 0) return { text: 'Walk out and dig the rock!', target: inHub ? door : undefined };
            const sell = carrying >= SELL_AT || full;
            if (tool && DigProgress.money >= tool.price) return { text: `Buy the ${tool.name} at the ATM!`, target: atmAt };
            if (sell) return { text: full ? 'Backpack full! Sell it at the ATM' : 'Sell your haul at the ATM', target: atmAt };
            if (DigProgress.achievementStat('earned') === 0) return { text: 'Keep digging to fill your backpack', target: inHub ? door : undefined };
            return { text: `Dig and sell to afford the ${tool?.name ?? 'next tool'} ($${tool?.price ?? 0})`, target: inHub && carrying === 0 ? door : undefined };
        }
        // The first piece of the hub: the cheapest one in sight (walk into it to buy it).
        const anyBuilt = (HUB.buildables ?? []).some((b) => DigProgress.isBuilt(b.id));
        const first = anyBuilt ? undefined : this.hub.cheapestOpenBuildable;
        if (first) {
            const price = `$${first.price.toLocaleString('en-US')}`;
            return {
                text: DigProgress.money >= first.price ? `Walk into the ${first.name} to build it (${price})` : `Earn ${price} to build the ${first.name}`,
                target: new THREE.Vector3(first.x, 0, first.z),
                marker: false,
            };
        }
        return null;
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
        this.say(step?.text ?? null);
        const target = step?.target;
        this.marker.visible = !!target && step?.marker !== false;
        if (!target) {
            this.arrow.visible = false;
            return;
        }
        this.marker.position.copy(target);
        const cone = this.marker.getObjectByName('cone')!;
        cone.position.y = 2.1 + Math.abs(Math.sin(this.time * 3)) * 0.35;
        this.marker.rotation.y = this.time * 1.5;
        const toTarget = target.clone().sub(player).setY(0);
        const distance = toTarget.length();
        this.arrow.visible = distance > NEAR;
        if (this.arrow.visible) {
            toTarget.normalize();
            const pulse = 1 + Math.sin(this.time * 6) * 0.06;
            this.arrow.position.set(player.x + toTarget.x * ARROW_OFFSET, 0.07, player.z + toTarget.z * ARROW_OFFSET);
            this.arrow.rotation.y = Math.atan2(toTarget.x, toTarget.z);
            this.arrow.scale.setScalar(pulse);
        }
    }

    public destroy(): void {
        this.marker.removeFromParent();
        this.arrow.removeFromParent();
    }
}
