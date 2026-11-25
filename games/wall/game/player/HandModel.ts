// HandModel.ts
//
// One of the player's hands: the skinned model put on a fist's frame (a point it grips, its turn), its fingers eased between
// poses (ui/hands.json), as There Is Rope's hands are (its ArmsSolver, for hands alone). `fist` is that frame: whoever owns
// the hand moves it; a held tool goes in it.

import * as THREE from 'three';
import handsData from '../../ui/hands.json';

export type Side = 1 | -1;
export type PoseName = 'open' | 'fist' | 'tool';

interface Pose {
    turn: number[];
    offset: number[];
    bones: Record<string, number[]>;
}

const POSES = handsData.poses as unknown as Record<PoseName, Pose>;
const BONES = handsData.bones as Record<string, string>;
const DEG = Math.PI / 180;

/** XYZ degrees (x first, about the fixed axes), as the poses are written; the left hand's mirrored across x. */
function turnOf([x, y, z]: number[], side: Side): THREE.Quaternion {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x * DEG, y * DEG, z * DEG, 'ZYX'));
    return side > 0 ? q : q.set(q.x, -q.y, -q.z, q.w);
}

/** A pose worked out for one hand: each bone's own turn, and how the wrist sits on the fist. */
interface Resolved {
    bones: Map<THREE.Object3D, THREE.Quaternion>;
    wristTurn: THREE.Quaternion;
    wristAt: THREE.Vector3;
}

export class HandModel {
    public readonly fist = new THREE.Group();
    public readonly mesh: THREE.SkinnedMesh;
    private readonly wrist: THREE.Object3D;
    private readonly find: (name: string) => THREE.Object3D | undefined;
    private readonly poses = new Map<PoseName, Resolved>();
    private readonly grips = new Map<number, Resolved>();
    private from: Resolved;
    private to: Resolved;
    private mix = 1;
    private speed = 12;

    /** `gltf`: the loaded hands (both); its skinned mesh for this side goes under `parent`, its bones under the fist. */
    public constructor(gltf: THREE.Object3D, public readonly side: Side, parent: THREE.Object3D) {
        const suffix = side > 0 ? 'R' : 'L';
        gltf.updateMatrixWorld(true);
        const find = (name: string): THREE.Object3D => {
            // (The loader drops the dots from names.)
            const found = gltf.getObjectByName(`${name}${suffix}`) ?? gltf.getObjectByName(`${name}.${suffix}`);
            if (!found) throw new Error(`hands: no ${name} on the ${suffix} hand`);
            return found;
        };
        const mesh = find('hand_mesh') as THREE.SkinnedMesh;
        const skinned = (mesh.isSkinnedMesh ? mesh : mesh.getObjectByProperty('isSkinnedMesh', true)) as THREE.SkinnedMesh;
        const bones = new Map(Object.entries(BONES).map(([id, name]) => [id, find(name)] as const));
        this.wrist = bones.get('Hand')!;
        const restOf = (object: THREE.Object3D) => object.getWorldQuaternion(new THREE.Quaternion());
        const wristRest = restOf(this.wrist);
        for (const name of Object.keys(POSES) as PoseName[]) {
            const pose = POSES[name];
            const turns = new Map<THREE.Object3D, THREE.Quaternion>();
            for (const [id, bone] of bones) {
                if (id === 'Hand') continue;
                // At rest: world = parentRest * local, so local = parentRest^-1 * turn * ownRest turns it by that there.
                const turn = pose.bones[id] ? turnOf(pose.bones[id], side) : new THREE.Quaternion();
                turns.set(bone, restOf(bone.parent!).invert().multiply(turn).multiply(restOf(bone)));
            }
            this.poses.set(name, {
                bones: turns,
                wristTurn: turnOf(pose.turn, side).multiply(wristRest),
                wristAt: new THREE.Vector3(pose.offset[0] * side, pose.offset[1], pose.offset[2]),
            });
        }
        this.mesh = skinned;
        this.find = (name) => skinned.skeleton.bones.find((bone) => bone.name === `${name}${suffix}` || bone.name === `${name}.${suffix}`);
        // (Its bounds are its rest pose's, somewhere else.)
        skinned.frustumCulled = false;
        skinned.removeFromParent();
        this.wrist.removeFromParent();
        this.fist.add(this.wrist);
        parent.add(this.fist, skinned);
        this.from = this.to = this.poses.get('open')!;
        this.apply();
    }

    /** A bone of this hand's (`index_1`). */
    public bone(name: string): THREE.Object3D | undefined {
        return this.find(name);
    }

    /** Where the wrist is now, in `parent`'s space. */
    public wristPosition(out: THREE.Vector3): THREE.Vector3 {
        return out.copy(this.wrist.position).applyQuaternion(this.fist.quaternion).multiplyScalar(this.fist.scale.x).add(this.fist.position);
    }

    /** Between the pose for a thick handle and a closed fist (0 to 1): for a thinner one. */
    private gripped(closed: number): Resolved {
        const open = this.poses.get('tool')!;
        if (closed <= 0) return open;
        const key = Math.round(closed * 100);
        let made = this.grips.get(key);
        if (!made) {
            const fist = this.poses.get('fist')!;
            made = {
                bones: new Map([...open.bones].map(([bone, turn]) => [bone, turn.clone().slerp(fist.bones.get(bone)!, closed)])),
                wristTurn: open.wristTurn.clone().slerp(fist.wristTurn, closed),
                wristAt: open.wristAt.clone().lerp(fist.wristAt, closed),
            };
            this.grips.set(key, made);
        }
        return made;
    }

    /** The fingers ease into a pose, about 1 / `speed` seconds (a tool's: `closed` round its handle, 0 for a thick one). */
    public pose(name: PoseName, closed = 0, speed = 12): void {
        const to = name === 'tool' ? this.gripped(closed) : this.poses.get(name)!;
        if (to === this.to) return;
        this.from = this.to;
        this.to = to;
        this.mix = 0;
        this.speed = speed;
    }

    /** Something done with the fingers in a pose for a moment. */
    public inPose(name: PoseName, what: () => void): void {
        const { from, to, mix } = this;
        this.from = this.to = this.poses.get(name)!;
        this.mix = 1;
        this.apply();
        what();
        Object.assign(this, { from, to, mix });
        this.apply();
    }

    public update(delta: number): void {
        if (this.mix >= 1) return;
        this.mix = Math.min(1, this.mix + delta * this.speed);
        this.apply();
    }

    private apply(): void {
        const t = this.mix * this.mix * (3 - 2 * this.mix);
        for (const [bone, turn] of this.to.bones) bone.quaternion.copy(this.from.bones.get(bone)!).slerp(turn, t);
        this.wrist.quaternion.copy(this.from.wristTurn).slerp(this.to.wristTurn, t);
        this.wrist.position.copy(this.from.wristAt).lerp(this.to.wristAt, t);
    }
}
