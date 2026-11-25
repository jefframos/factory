// Hands.ts
//
// The player's hands, in front of everything: their own little scene and camera, drawn over the wall after it (so they're
// never inside it, and a punch lands where the finger is on the screen, however far the wall). Bare, they punch in turn: the
// hand snaps out to the spot and back. With a tool (ui/wall.json `tools`), the right one swings it in an arc, its head
// landing on the spot (swing.ts). What lands when is the caller's: punch() says in how many seconds.
//
// Units are metres, the eyes at the origin looking along -z.

import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { fx } from '../config/Effects';
import { Look } from '../data/Looks';
import { HandDress, paintMetal } from './HandDress';
import { HandModel, Side } from './HandModel';
import { HandPose, HoldPose, SHOULDER, SNAP, SwingSettings, Vec3, contactInHand, snapDuration, snapLands, snapPose, swingDuration, swingLands, swingPose } from './swing';

export interface ToolLook {
    id: string;
    /** Its model's id, its metal's colour and shine. */
    base: string;
    tint: string;
    glow: number;
    hold: HoldPose;
    swing: SwingSettings;
}

const FOV = 46;
/** A hand at rest: ahead of the eyes, `over` the cards (a share of the screen) or, on a wide screen, below the middle, turned. */
const READY = { ahead: 0.95, over: 0.066, wideDown: 0.52, side: 0.5, maxSide: 0.2, pitch: -0.1, roll: 1.05, yaw: 0.22, bob: 0.006, bobSpeed: 1.9 };
/** Shown off (the wardrobe): nearer, side by side, turning. */
const SHOW = { ahead: 0.82, down: 0.5, side: 0.15, pitch: 0.35, yaw: 0.35, turn: 0.75, roll: 0.35, speed: 1.1 };
/** The other hand, out of the way while a tool's held. */
const IDLE_DROP = 0.1;
/** How far off the spot is taken to be: a punch's knuckles, a tool's head. */
const REACH = 1.35;
/** A punch: seconds out, held there, and back; the knuckles are this far ahead of the fist's centre. */
const PUNCH = { out: 0.065, hold: 0.03, back: 0.2, knuckles: 0.06, recoil: 0.018 };
/** The hands drawn this much bigger than life. */
const HAND_SCALE = 1.1;
/** The sleeve: from the wrist to an elbow off the screen. */
const ARM = { elbowSide: 0.34, elbowDown: 0.72, elbowBack: -0.2, wrist: 0.036, elbow: 0.055, cuff: 0.043, cuffLength: 0.036 };

interface Arm {
    hand: HandModel;
    dress: HandDress;
    sleeve: THREE.Mesh;
    cuff: THREE.Mesh;
    /** Seconds into a punch (-1: none), and the spot it goes to. */
    time: number;
    target: THREE.Vector3;
    at: THREE.Vector3;
    turn: THREE.Quaternion;
    startAt: THREE.Vector3;
    startTurn: THREE.Quaternion;
}

/** What a picture's taken with, and where its arm goes. */
const PICTURE = { camera: new THREE.PerspectiveCamera(24, 1, 0.02, 5), at: new THREE.Vector3(-0.03, 0.004, -0.56), elbow: new THREE.Vector3(0.3, -0.4, -0.4) };
/** A linear byte as sRGB. */
const SRGB = Uint8ClampedArray.from({ length: 256 }, (_, i) => {
    const v = i / 255;
    return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
});

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => t * t * (3 - 2 * t);

export class Hands {
    public readonly scene = new THREE.Scene();
    public readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.02, 10);
    private readonly arms: Arm[] = [];
    private readonly tools = new Map<string, THREE.Object3D>();
    private glove?: THREE.Object3D;
    private tool?: ToolLook;
    private contact: Vec3 = [0, 0, 0];
    private swingTime = -1;
    /** This hit's a snap, not a swing. */
    private snaps = false;
    private swingFrom: HandPose | null = null;
    private readonly swingTarget = new THREE.Vector3();
    private clock = 0;
    private next: 0 | 1 = 0;
    /** Swapping tools: 0 ready .. 1 down out of sight. */
    private away = 0;
    private awayTo = 0;
    private pending?: ToolLook;
    private swap = false;
    private look?: Look;
    private showing = false;
    private floor?: number;
    private floorTo?: number;
    /** Towards the show pose: 0 at rest, 1 there. */
    private shown = 0;
    private target?: THREE.WebGLRenderTarget;
    private readonly wrist = new THREE.Vector3();
    private readonly elbow = new THREE.Vector3();
    private readonly spot = new THREE.Vector3();
    private readonly shoulder = new THREE.Vector3();
    private readonly along = new THREE.Vector3();
    private readonly quaternion = new THREE.Quaternion();
    private readonly quaternion2 = new THREE.Quaternion();
    private readonly euler = new THREE.Euler();

    public constructor() {
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0xa08ab0, 2.1));
        const key = new THREE.DirectionalLight(0xfff6ea, 2.4);
        key.position.set(-0.6, 1.2, 0.9);
        this.scene.add(key);
    }

    /** The hands, loaded (both in one). */
    public setModels(hands: GLTF): void {
        const sleeveShape = new THREE.CylinderGeometry(ARM.elbow, ARM.wrist, 1, 18, 1, true).translate(0, 0.5, 0);
        const cuffShape = new THREE.CylinderGeometry(ARM.cuff, ARM.cuff, ARM.cuffLength, 18).translate(0, ARM.cuffLength / 2, 0);
        for (const side of [1, -1] as Side[]) {
            const hand = new HandModel(hands.scene, side, this.scene);
            const sleeve = new THREE.Mesh(sleeveShape);
            const cuff = new THREE.Mesh(cuffShape);
            const dress = new HandDress(hand, sleeve, cuff, this.glove);
            this.scene.add(sleeve, cuff, dress.wrist);
            const arm: Arm = {
                hand, dress, sleeve, cuff, time: -1, target: new THREE.Vector3(), at: new THREE.Vector3(), turn: new THREE.Quaternion(),
                startAt: new THREE.Vector3(), startTurn: new THREE.Quaternion(),
            };
            this.arms.push(arm);
            hand.fist.scale.setScalar(HAND_SCALE);
            hand.pose('fist');
            this.ready(arm, arm.at, arm.turn);
        }
        for (const model of this.tools.values()) this.arms[0].hand.fist.add(model);
        if (this.look) this.wearLook(this.look);
        if (this.pending) this.wear(this.pending);
        this.pending = undefined;
    }

    /** A tool's model, loaded (in the hand, if it's the one it holds). */
    public addTool(id: string, model: THREE.Object3D): void {
        model.visible = false;
        this.tools.set(id, model);
        this.arms[0]?.hand.fist.add(model);
        if (this.tool?.base === id) this.wear(this.tool);
    }

    /** A boxing glove's, loaded (the left one). */
    public setGlove(model: THREE.Object3D): void {
        this.glove = model;
        this.arms.forEach(({ dress }) => dress.setGlove(model));
        if (this.look) this.wearLook(this.look);
    }

    /** A tool in the right hand (undefined: bare). `at once`: no swap (the start). */
    public setTool(tool: ToolLook | undefined, atOnce = false): void {
        if (tool?.id === this.tool?.id && !this.pending) return;
        this.pending = tool;
        if (!this.arms.length) return;
        if (atOnce) {
            this.wear(tool);
            this.pending = undefined;
            return;
        }
        // Down out of sight, changed there, and up again.
        this.swap = true;
        this.awayTo = 1;
    }

    /** What they wear. */
    public wearLook(look: Look): void {
        this.look = look;
        this.arms.forEach(({ dress }) => dress.wear(look));
    }

    /** Held up to be looked at (the wardrobe), or back. */
    public show(on: boolean): void {
        this.showing = on;
    }

    /** The right hand in a look, as a picture `size` across (its pixels, upside down as WebGL has them). */
    public picture(renderer: THREE.WebGLRenderer, look: Look, size: number): ImageData | null {
        const arm = this.arms[0];
        if (!arm || !this.look || (look.gloves.boxing && !this.glove)) return null;
        const worn = this.look;
        const { hand } = arm;
        const tool = this.tool && this.tools.get(this.tool.base);
        const hidden = this.scene.children.filter((child) => child.visible && ![hand.fist, hand.mesh, arm.sleeve, arm.cuff, arm.dress.wrist].includes(child as never) && !(child as THREE.Light).isLight);
        hidden.forEach((child) => (child.visible = false));
        if (tool) tool.visible = false;
        arm.dress.wear(look);
        // The fist from the side: its back, the fingers and the wrist.
        hand.fist.position.copy(PICTURE.at);
        hand.fist.quaternion.setFromEuler(this.euler.set(0.3, 0.8, 0.3, 'YXZ'));
        const target = (this.target ??= new THREE.WebGLRenderTarget(size, size, { samples: 4 }));
        const pixels = new Uint8Array(size * size * 4);
        const color = renderer.getClearColor(new THREE.Color()).clone();
        const alpha = renderer.getClearAlpha();
        renderer.setRenderTarget(target);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        hand.inPose('fist', () => {
            arm.dress.update();
            this.placeSleeve(arm, PICTURE.elbow);
            this.scene.updateMatrixWorld(true);
            hand.mesh.skeleton.update();
            renderer.render(this.scene, PICTURE.camera);
        });
        renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
        renderer.setRenderTarget(null);
        renderer.setClearColor(color, alpha);
        arm.dress.wear(worn);
        hidden.forEach((child) => (child.visible = true));
        if (tool) tool.visible = true;
        // Back where it was.
        hand.fist.position.copy(arm.at);
        hand.fist.quaternion.copy(arm.turn);
        this.placeSleeve(arm);
        // (A render target's linear; and the right way up.)
        const image = new ImageData(size, size);
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            const from = ((size - 1 - y) * size + x) * 4;
            const to = (y * size + x) * 4;
            for (let k = 0; k < 3; k++) image.data[to + k] = SRGB[pixels[from + k]];
            image.data[to + 3] = pixels[from + 3];
        }
        return image;
    }

    private wear(tool: ToolLook | undefined): void {
        this.tool = tool;
        this.swingTime = -1;
        for (const [id, model] of this.tools) model.visible = id === tool?.base;
        const model = tool && this.tools.get(tool.base);
        if (tool && model) {
            const [x, y, z] = tool.hold.rotation.map((degrees) => THREE.MathUtils.degToRad(degrees));
            paintMetal(model, tool.tint, tool.glow);
            model.rotation.set(x, y, z);
            model.scale.setScalar(tool.hold.scale / HAND_SCALE);
            this.contact = contactInHand(tool.hold);
        }
        this.arms[0]?.hand.pose(tool ? 'tool' : 'fist');
    }

    /** A hit at a spot on the screen (-1..1, y up): the seconds until it lands. */
    public punch(x: number, y: number): number {
        if (!this.arms.length) return 0;
        const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
        this.spot.set(x * tan * this.camera.aspect, y * tan, -1).normalize().multiplyScalar(REACH);
        if (this.tool) {
            this.swingTarget.copy(this.spot);
            this.swingTime = 0;
            this.swingFrom = null;
            this.arms[0].startTurn.copy(this.arms[0].turn);
            this.snaps = fx('toolSnap') > 0;
            return this.snaps ? snapLands : swingLands(this.tool.swing);
        }
        // In turn; the one that's free if the other isn't back yet.
        const arm = this.arms[this.next];
        this.next = this.next === 0 ? 1 : 0;
        arm.time = 0;
        arm.target.copy(this.spot);
        arm.startAt.copy(arm.at);
        arm.startTurn.copy(arm.turn);
        return PUNCH.out;
    }

    /** How far up the screen the cards come (undefined: they're not under the hands). */
    public setFloor(floor: number | undefined): void {
        // (Eased up as more's laid out under them; there at once the first time.)
        if (floor === undefined || this.floor === undefined) this.floor = floor;
        this.floorTo = floor;
    }

    public resize(aspect: number): void {
        this.camera.aspect = aspect;
        this.camera.updateProjectionMatrix();
    }

    /** A hand's place at rest. */
    private ready(arm: Arm, at: THREE.Vector3, turn: THREE.Quaternion): void {
        const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
        const height = READY.ahead * tan;
        const side = Math.min(READY.maxSide, height * this.camera.aspect * READY.side);
        const bob = Math.sin(this.clock * READY.bobSpeed + (arm.hand.side > 0 ? 0 : 1.3)) * READY.bob * fx('handBob');
        const idle = this.tool && arm.hand.side < 0 ? IDLE_DROP : 0;
        const low = this.floor === undefined ? READY.wideDown : 1 - 2 * (this.floor + READY.over);
        at.set(arm.hand.side * side, -height * low - idle - this.away * 0.45 + bob, -READY.ahead);
        this.euler.set(READY.pitch + this.away * 0.6, arm.hand.side * READY.yaw, arm.hand.side * (this.tool && arm.hand.side > 0 ? 0.15 : READY.roll), 'YXZ');
        turn.setFromEuler(this.euler);
        if (this.shown < 0.002) return;
        const near = SHOW.ahead * tan;
        this.spot.set(arm.hand.side * Math.min(SHOW.side, near * this.camera.aspect * 0.5), -near * SHOW.down + bob, -SHOW.ahead);
        at.lerp(this.spot, this.shown);
        this.euler.set(SHOW.pitch, arm.hand.side * (SHOW.yaw + Math.sin(this.clock * SHOW.speed) * SHOW.turn), arm.hand.side * SHOW.roll, 'YXZ');
        turn.slerp(this.quaternion.setFromEuler(this.euler), this.shown);
    }

    public update(delta: number): void {
        if (!this.arms.length) return;
        this.clock += delta;
        if (this.floor !== undefined && this.floorTo !== undefined) this.floor += (this.floorTo - this.floor) * (1 - Math.exp(-delta * 4));
        this.away += (this.awayTo - this.away) * (1 - Math.exp(-delta * 16));
        this.shown += ((this.showing ? 1 : 0) - this.shown) * (1 - Math.exp(-delta * 10));
        if (this.swap && this.away > 0.94) {
            this.wear(this.pending);
            this.pending = undefined;
            this.swap = false;
            this.awayTo = 0;
        }
        for (const arm of this.arms) {
            const swinging = this.tool && arm.hand.side > 0;
            if (swinging) this.swing(arm, delta);
            else this.jab(arm, delta);
            arm.hand.fist.position.copy(arm.at);
            arm.hand.fist.quaternion.copy(arm.turn);
            arm.hand.update(delta);
            arm.dress.update();
            this.placeSleeve(arm);
        }
    }

    private readonly readyAt = new THREE.Vector3();
    private readonly readyTurn = new THREE.Quaternion();

    /** A bare hand: at rest, or snapping out to its spot and back. */
    private jab(arm: Arm, delta: number): void {
        this.ready(arm, this.readyAt, this.readyTurn);
        if (arm.time < 0) {
            const follow = 1 - Math.exp(-delta * 14);
            arm.at.lerp(this.readyAt, follow);
            arm.turn.slerp(this.readyTurn, follow);
            return;
        }
        arm.time += delta;
        // Knuckles on the spot, from this side's shoulder, the fist turned along the way.
        this.shoulder.set(arm.hand.side * SHOULDER.side, -SHOULDER.down, 0);
        this.along.copy(arm.target).sub(this.shoulder).normalize();
        this.spot.copy(arm.target).addScaledVector(this.along, -PUNCH.knuckles);
        this.euler.set(Math.asin(THREE.MathUtils.clamp(this.along.y, -1, 1)), Math.atan2(-this.along.x, -this.along.z), arm.hand.side * READY.roll, 'YXZ');
        this.quaternion.setFromEuler(this.euler);
        const { out, hold, back } = PUNCH;
        if (arm.time < out) {
            const t = easeOut(arm.time / out);
            arm.at.lerpVectors(arm.startAt, this.spot, t);
            arm.turn.copy(arm.startTurn).slerp(this.quaternion, t);
        } else if (arm.time < out + hold) {
            arm.at.copy(this.spot).addScaledVector(this.along, -PUNCH.recoil * ((arm.time - out) / hold));
            arm.turn.copy(this.quaternion);
        } else {
            const t = easeInOut(Math.min(1, (arm.time - out - hold) / back));
            arm.at.copy(this.spot).addScaledVector(this.along, -PUNCH.recoil).lerp(this.readyAt, t);
            arm.turn.copy(this.quaternion).slerp(this.readyTurn, t);
            if (t >= 1) arm.time = -1;
        }
    }

    /** The hand with the tool: at rest, or somewhere along its swing. */
    private swing(arm: Arm, delta: number): void {
        const tool = this.tool!;
        this.ready(arm, this.readyAt, this.readyTurn);
        if (this.swingTime >= 0) this.swingTime += delta;
        if (this.swingTime < 0 || this.swingTime > (this.snaps ? snapDuration : swingDuration(tool.swing))) {
            this.swingTime = -1;
            const follow = 1 - Math.exp(-delta * 14);
            arm.at.lerp(this.readyAt, follow);
            arm.turn.slerp(this.readyTurn, follow);
            return;
        }
        // Into the swing's frame: at the shoulder, turned to face the spot.
        this.shoulder.set(SHOULDER.side * Math.min(1, this.camera.aspect * 1.4), -SHOULDER.down, 0);
        this.along.copy(this.swingTarget).sub(this.shoulder);
        const yaw = Math.atan2(-this.along.x, -this.along.z);
        this.quaternion.setFromAxisAngle(UP, yaw);
        this.quaternion2.copy(this.quaternion).invert();
        const inFrame = (at: THREE.Vector3): Vec3 => {
            const v = this.spot.copy(at).sub(this.shoulder).applyQuaternion(this.quaternion2);
            return [v.x, v.y, v.z];
        };
        const pitchOf = (turn: THREE.Quaternion) => this.euler.setFromQuaternion(turn, 'YXZ').x;
        const target = inFrame(this.swingTarget);
        const ready: HandPose = { pos: inFrame(this.readyAt), pitch: pitchOf(this.readyTurn), roll: 0.15 };
        this.swingFrom ??= { pos: inFrame(arm.at), pitch: pitchOf(arm.turn), roll: 0 };
        const pose = (this.snaps ? snapPose : swingPose)(tool.swing, this.contact, target, this.swingFrom, ready, this.swingTime);
        arm.at.set(...pose.pos).applyQuaternion(this.quaternion).add(this.shoulder);
        this.euler.set(pose.pitch, yaw, pose.roll, 'YXZ');
        arm.turn.setFromEuler(this.euler);
        if (!this.snaps) return;
        // (Its own turn while it only stirs; eased back to it after.)
        const back = this.swingTime - snapLands - SNAP.hold;
        if (this.swingTime < SNAP.stir) {
            this.euler.set(SNAP.pitch * easeOut(this.swingTime / SNAP.stir), 0, 0);
            arm.turn.copy(arm.startTurn).multiply(this.quaternion2.setFromEuler(this.euler));
        } else if (back > 0) arm.turn.slerp(this.readyTurn, easeInOut(Math.min(1, back / SNAP.back)));
    }

    /** The sleeve from the wrist off the bottom of the screen. */
    private placeSleeve(arm: Arm, elbow?: THREE.Vector3): void {
        arm.hand.wristPosition(this.wrist);
        this.elbow.set(arm.hand.side * ARM.elbowSide * Math.min(1, this.camera.aspect * 1.3), -ARM.elbowDown, ARM.elbowBack);
        if (elbow) this.elbow.copy(elbow);
        this.along.copy(this.elbow).sub(this.wrist);
        const length = this.along.length();
        this.quaternion.setFromUnitVectors(UP, this.along.divideScalar(Math.max(1e-4, length)));
        arm.sleeve.position.copy(this.wrist);
        arm.sleeve.quaternion.copy(this.quaternion);
        arm.sleeve.scale.set(1, length, 1);
        arm.cuff.position.copy(this.wrist);
        arm.cuff.quaternion.copy(this.quaternion);
        arm.dress.wrist.position.copy(this.wrist);
        arm.dress.wrist.quaternion.copy(this.quaternion);
    }
}

const UP = new THREE.Vector3(0, 1, 0);
