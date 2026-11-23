// MowPlayer.ts
//
// The player: dig's character controller (RigidBody + PlayerMovementController for WASD / the on-screen joystick,
// FacingComponent, the animated rig) walking at the current tool's speed (MowProgress.speed), with the tool in front
// of them, for now a placeholder mower in the tool's size and colour (MowerModel.ts, ui/mow.json `tools`), swapped when a better one
// is bought: a mower out in front on the ground with a push handle (two rails up from the deck's back corners — a
// reel mower's axle — to a crossbar the hands hold). Where the hands go, and how they turn on the bar, is the tool's
// `grip` (edited in the editor's Mowers tab, which builds the same mowers: web/public/mowers.js). The legs walk with the animation while the
// arms hold the tool (holdPose: the arms frozen, then a two-bone IK pinning each hand to its grip, each frame after the
// animation). `cutPoint()` is where the tool cuts, on the ground.

import * as THREE from 'three';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import PlayerMovementController, { MovementInputHost } from '../components/PlayerMovementController';
import CharacterVisualComponent from '../components/CharacterVisualComponent';
import FacingComponent from '../components/FacingComponent';
import ThirdPersonCharacter from '../entities/ThirdPersonCharacter';
import { SITTING_STATE } from '../entities/CharacterBody';
import { getPlayerConfig } from '../data/PlayerConfig';
import MODELS from '../../registry/assetsRegistry/modelsRegistry';
import { MowProgress, Look } from '../data/MowProgress';
import hatFits from '../../ui/hatfits.json';
import { GripDef, MOW, ToolDef } from '../data/MowConfig';
import { BendService } from '../services/BendService';
import { addHandle, buildMower, playerHandle, REEL_WHEEL } from './MowerModel';
import { MOUNT, MowerBlades } from './MowerBlades';
import { loadPeople, personCopy, dress, PERSON_HEIGHT, PERSON_MODEL_HEIGHT } from '../farm/People';
import ModelLoaderManager from 'core/three/ModelLoaderManager';

const HALF_EXTENTS = new THREE.Vector3(0.4, 0.9, 0.4);
/** The character rig is authored in FBX units; same scale as dig's miner. */
export const CHARACTER_SCALE = 0.0075;
/** The player's size against the town (MowDesign.playerScale). */
export const playerScale = (): number => MOW.playerScale ?? 1;
/**
 * The player is a person (farm/People.ts, the restaurant game's people, as the customers are): this one, in these
 * colours, the wardrobe's colour on their top. Their head, in the model's own units: its size and how far its top is
 * over the head bone (ui/hatfits.json places hats as fractions of the head from its top).
 */
const PLAYER_PERSON = 0;
const PLAYER_OUTFIT = { skin: '#f7cba4', bottom: '#2f4a7a', shoes: '#f4f1ea', hair: '#5e3c23' };
/** The player's outfit from the wardrobe: the top's colour and pattern, the trousers, the skin (else the player's own). */
const playerOutfit = (look: Readonly<Look>) => ({
    ...PLAYER_OUTFIT, top: look.color, skin: look.skin ?? PLAYER_OUTFIT.skin, bottom: look.bottom ?? PLAYER_OUTFIT.bottom, pattern: look.pattern || undefined,
});
const HEAD = { size: 0.36, top: 0.27 };
type HatFit = { x: number; y: number; z: number; scale: number; rotationY: number };
const HAT_FITS = hatFits as { default: HatFit; hats: Record<string, Partial<HatFit>> };
const UP = new THREE.Vector3(0, 1, 0);
/** Where the elbows point while holding the handle (in the character's frame): back, out to the side, a little down. */
const ELBOW_POLE = { forward: -1, out: 0.7, up: -0.5 };
const modelUrl = (fullPath: string): string => `./${fullPath}`;

export default class MowPlayer extends Entity {
    private loaded?: ThirdPersonCharacter;
    private destroyed = false;
    /** The tool in front of the feet (rebuilt on a tool change: showTool()). */
    private readonly tool = new THREE.Group();
    private toolDef?: ToolDef;
    private readonly forward = new THREE.Vector3();
    private readonly left = new THREE.Vector3();
    private readonly gripAt = new THREE.Vector3();
    private readonly handleMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.6 });
    private readonly handTarget = new THREE.Vector3();
    /** A reel mower's barrel (spun by the distance walked) and where the tool was last frame. */
    private reel?: THREE.Object3D;
    private readonly lastToolAt = new THREE.Vector3();
    private readonly handTurn = new THREE.Quaternion();
    private readonly handEuler = new THREE.Euler();
    private readonly handTarget2 = new THREE.Vector3();
    private readonly aimFrom = new THREE.Vector3();
    private readonly aimCurrent = new THREE.Vector3();
    private readonly aimWanted = new THREE.Vector3();
    private readonly aimTurn = new THREE.Quaternion();
    private readonly aimWorld = new THREE.Quaternion();
    private readonly aimParent = new THREE.Quaternion();
    /** Each hand bone's rest rotation (taken at load, before any animation): the hands stay in it instead of flapping with the walk. */
    private readonly handRest = new Map<THREE.Object3D, THREE.Quaternion>();
    /**
     * The arm chains (shoulder, upper arm, forearm) frozen in one pose (the idle clip's first frame) before the IK
     * runs each frame: the walk / run can't swing or twist them, so the IK always starts from the same arm.
     */
    private readonly armFrozen = new Map<THREE.Object3D, THREE.Quaternion>();
    private readonly ikShoulder = new THREE.Vector3();
    private readonly ikElbow = new THREE.Vector3();
    private readonly ikHand = new THREE.Vector3();
    private readonly ikDir = new THREE.Vector3();
    private readonly ikBend = new THREE.Vector3();
    private readonly ikReach = new THREE.Vector3();
    /** The fingers closed round the handle (the idle clip's first frame): the walk and run would open them. */
    private readonly fingerGrip = new Map<THREE.Object3D, THREE.Quaternion>();
    /** Share of the walking speed (MowingSystem: tough grass holds the mower back). */
    public drag = 1;
    /** Sat on the tractor (TractorRide): no tool in the hands, it cuts from the tractor (`ridePoint`). */
    public riding = false;
    /**
     * Off the grass (the farm test's dens): the player walks in without the mower, which stays parked where it was
     * left until they come back out.
     */
    public onFoot = false;
    /** Where the tractor cuts (set by the scene: TractorRide.cutPoint). */
    public ridePoint?: (out: THREE.Vector3) => THREE.Vector3;
    /** The ground's height at (x, z) (set by the scene: the pavements and road tiles), so the mower rolls on top of them. */
    public groundAt?: (x: number, z: number) => number;
    /** The tool's current lift off y = 0, eased toward groundAt() so a kerb is a quick hop, not a pop. */
    private toolLift = 0;

    public constructor(private readonly inputHost: MovementInputHost, private readonly threeScene: THREE.Scene) {
        super();
        BendService.applyBend(this.handleMaterial);
        threeScene.add(this.tool);
    }

    public get character(): ThirdPersonCharacter | undefined {
        return this.loaded;
    }

    public get movementController(): PlayerMovementController {
        return this.getComponent(PlayerMovementController)!;
    }

    /** Head height (pickups fly here, labels float above). */
    public pickupPoint(out = new THREE.Vector3()): THREE.Vector3 {
        return out.copy(this.transform.position).setY(1.2 * playerScale());
    }

    public override awake(): void {
        this.addComponent(new RigidBody({
            halfExtents: HALF_EXTENTS,
            centerOffset: new THREE.Vector3(0, HALF_EXTENTS.y, 0),
            layer: Layers.Player,
        }));
        // On foot (the mower parked) a running pace; with the mower (or riding) its own speed.
        this.addComponent(new PlayerMovementController(() => (this.onFoot ? MowProgress.footSpeed : MowProgress.speed) * this.drag, this.inputHost));
        this.addComponent(new FacingComponent());
    }

    /** The person's meshes with their undressed geometry (dressed again by applyLook()), and the hat on their head. */
    private personMeshes: { mesh: THREE.SkinnedMesh; source: THREE.BufferGeometry }[] = [];
    private hat?: THREE.Object3D;
    private hatToken = 0;

    /**
     * Loads the player — a person (farm/People.ts) with the people's clips (idle, walk, run, sit) — and dresses them;
     * movement already works before this resolves. The hands' rest and the grip (fingers closed, arms held) come from
     * the same rig and clips, so the mower's hold pose (holdPose()) and the steering wheel work as before.
     */
    public async loadCharacter(): Promise<void> {
        const config = getPlayerConfig();
        const people = await loadPeople();
        const character = new ThirdPersonCharacter({ walkSpeed: config.walkSpeed, runSpeedMultiplier: config.runSpeedMultiplier });
        const { model, meshes } = personCopy(people, PLAYER_PERSON, playerOutfit(MowProgress.look));
        this.personMeshes = meshes;
        character.body.usePerson(model);
        // The hands' rest: the bind pose, before any clip has posed them.
        for (const side of ['Left', 'Right']) {
            const hand = character.body.getBone(`${side}Hand`);
            if (hand) this.handRest.set(hand, hand.quaternion.clone());
        }
        const animator = character.animator;
        animator.registerClip('idle', people.clips.idle);
        for (const side of ['Left', 'Right']) {
            character.body.getBone(`${side}Hand`)?.traverse((bone) => {
                const grip = /(Thumb|Index|Middle|Ring|Pinky)\d$/.test(bone.name) ? animator.firstFrameRotation('idle', bone.name) : undefined;
                if (grip) this.fingerGrip.set(bone, grip);
            });
            for (const name of ['Shoulder', 'Arm', 'ForeArm']) {
                const bone = character.body.getBone(`${side}${name}`);
                if (bone) this.armFrozen.set(bone, animator.firstFrameRotation('idle', bone.name) ?? bone.quaternion.clone());
            }
        }
        animator.registerClip('walk', people.clips.walk);
        animator.registerClip('run', people.clips.run);
        // Sat on the tractor (TractorRide -> CharacterBody.sitNow(): straight into the loop).
        if (people.clips.sit) animator.registerClip(SITTING_STATE, people.clips.sit);
        character.setUp(config.idleToWalkSpeed, config.walkToRunSpeed);
        character.container.scale.setScalar((PERSON_HEIGHT * playerScale()) / PERSON_MODEL_HEIGHT);
        if (this.destroyed) {
            character.destroy();
            return;
        }
        this.threeScene.add(character.container);
        this.loaded = character;
        this.applyLook(MowProgress.look, character);
        this.addComponent(new CharacterVisualComponent(character));
    }

    /**
     * Dresses the player from the wardrobe: its colour on their top, its hat on their head (placed by ui/hatfits.json,
     * as fractions of the head from its top). The wardrobe's faces don't show on a person (they have their own).
     */
    public applyLook(look: Readonly<Look>, character = this.loaded): void {
        if (!character) return;
        dress(this.personMeshes, playerOutfit(look));
        this.hat?.removeFromParent();
        this.hat = undefined;
        const token = ++this.hatToken;
        const model = MODELS.Hats[look.hat as keyof typeof MODELS.Hats];
        if (!model) return;
        const name = model.fullPath.split('/').pop()!.replace(/\.[^.]+$/, '');
        const fit = { ...HAT_FITS.default, ...HAT_FITS.hats[name] };
        void ModelLoaderManager.instance.loadModel(modelUrl(model.fullPath)).then((object) => {
            const head = character.body.getBone('Head');
            if (token !== this.hatToken || !head || this.destroyed) return;
            object.traverse((child) => {
                if (child instanceof THREE.Mesh) [child.material].flat().forEach((material) => BendService.applyBend(material));
            });
            // Sized and centred in the model's units: its width the fit's share of the head, its bottom at 0.
            const box = new THREE.Box3().setFromObject(object);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            object.position.set(-center.x, -box.min.y, -center.z);
            const hat = new THREE.Group();
            const sized = new THREE.Group();
            sized.add(object);
            sized.scale.setScalar((fit.scale * HEAD.size) / Math.max(size.x, size.z, 1e-3));
            sized.rotation.y = THREE.MathUtils.degToRad(fit.rotationY);
            hat.add(sized);
            // Over the head (the person's own frame), then held by the head bone so it moves with it.
            const container = character.container;
            container.updateMatrixWorld(true);
            const top = container.worldToLocal(head.getWorldPosition(new THREE.Vector3()));
            top.add(new THREE.Vector3(fit.x * HEAD.size, HEAD.top + fit.y * HEAD.size, fit.z * HEAD.size));
            hat.position.copy(container.localToWorld(top));
            hat.quaternion.copy(container.quaternion);
            hat.scale.copy(container.scale);
            hat.updateMatrixWorld(true);
            head.attach(hat);
            this.hat = hat;
        }).catch((error) => console.warn('[MowPlayer] hat', look.hat, error));
    }

    /**
     * Builds the tool's placeholder (MowerModel.ts: a reel mower, or a long deck with its engine on top), in its own
     * frame (centred on the cut point, +Z ahead), and the push handle — rails from the deck's back corners (the reel's
     * axle ends) up to a crossbar at the grip.
     */
    private showTool(tool: ToolDef): void {
        this.toolDef = tool;
        this.tool.clear();
        this.blades.set(-1, 0);
        const model = buildMower(tool, (material) => BendService.applyBend(material));
        // The mower at its own size (never stretched); its handle reaching up to the player's hands, whatever their size.
        const { grip, gripZ } = playerHandle(tool, playerScale());
        addHandle(model, tool, grip, gripZ, this.handleMaterial);
        this.tool.add(model.group);
        // (The walked mowers keep their blades hidden: they show from the tractor on.)
        this.reel = model.reel;
    }

    /** The blades under the walked mower (MowerBlades): their level and the cutting width (README_PROGRESSION.md). */
    private readonly blades = new MowerBlades((material) => BendService.applyBend(material));

    /** Where the tool cuts: on the ground in front, the middle of the mower. */
    public cutPoint(out = new THREE.Vector3()): THREE.Vector3 {
        if (this.riding && this.ridePoint) return this.ridePoint(out);
        const tool = this.toolDef ?? MowProgress.tool;
        return out.copy(this.transform.position).addScaledVector(this.facing(), playerHandle(tool, playerScale()).ahead).setY(0);
    }

    /** The chest bone's place in the world (the backpack hangs behind it), or null before the character has loaded. */
    public chestPoint(out = new THREE.Vector3()): THREE.Vector3 | null {
        const body = this.loaded?.body;
        if (!body) return null;
        this.chestBone ??= body.getBone('Chest') ?? body.getBone('Spine2') ?? body.getBone('Spine1');
        return this.chestBone ? this.chestBone.getWorldPosition(out) : null;
    }

    /** The bone the backpack follows (looked up once). */
    private chestBone?: THREE.Object3D;

    /** The way the character faces, on the ground (a copy). */
    public heading(out = new THREE.Vector3()): THREE.Vector3 {
        return out.copy(this.facing());
    }

    /** The way the character faces (on the ground). */
    private facing(): THREE.Vector3 {
        const container = this.loaded?.container;
        if (!container) return this.forward.set(0, 0, -1);
        return this.forward.set(0, 0, 1).applyQuaternion(container.quaternion).setY(0).normalize();
    }

    /**
     * Call after the world has updated (the walk / idle animation has posed the body): places the tool (out in front
     * on the ground with its handle up to the hands; a reel spins with the ground covered) and swaps it after a
     * purchase, then poses the arms to hold it (holdPose). Not `update()`: that is Entity's, which runs the components.
     */
    public syncTool(): void {
        const tool = MowProgress.tool;
        const changed = tool !== this.toolDef;
        if (changed) this.showTool(tool);
        // A ridden mower is the tractor (TractorRide), never in the hands: on foot the hands are free.
        this.tool.visible = !tool.ride;
        if (tool.ride) return;
        // Parked (the player's on foot): it stays where it was left, the hands free.
        if (this.onFoot && !changed) return;
        const forward = this.facing();
        const left = this.left.crossVectors(UP, forward);
        // The grip, grown with the player (the handle was built to it: playerHandle()).
        const { grip } = playerHandle(tool, playerScale());
        const gripAt = this.gripAt.copy(this.transform.position).addScaledVector(forward, grip.forward).setY(grip.height);
        const container = this.loaded?.container;
        if (container) this.tool.quaternion.copy(container.quaternion);
        this.cutPoint(this.tool.position);
        const ground = this.groundAt?.(this.tool.position.x, this.tool.position.z) ?? 0;
        this.toolLift = changed ? ground : this.toolLift + (ground - this.toolLift) * 0.35;
        this.tool.position.y = this.toolLift;
        gripAt.y += this.toolLift;
        if (this.reel && !changed) {
            const at = this.tool.position;
            const moved = (at.x - this.lastToolAt.x) * forward.x + (at.z - this.lastToolAt.z) * forward.z;
            this.reel.rotation.x += moved / Math.max(0.05, (tool.size[1] / 2) * REEL_WHEEL) * 3;
        }
        // The blades: the Blades level across the cutting width, spinning faster while it moves.
        this.blades.set(MowProgress.bladesLevel, MowProgress.width);
        // Against its front edge (a reel mower's front is its wheels' rim: its own length is only the roller's).
        const front = tool.reel ? (tool.size[1] / 2) * REEL_WHEEL : tool.size[2] / 2;
        this.blades.group.position.set(0, MOUNT.lift, front + this.blades.radius * MOUNT.ahead);
        this.blades.spin(1 / 60, this.tool.position.distanceToSquared(this.lastToolAt) > 1e-6);
        this.lastToolAt.copy(this.tool.position);
        if (container) {
            // The hands reach the bar moved by the grip's offset (x outward for each hand); the bar stays put.
            const offset = grip.offset;
            const out = grip.spread + (offset?.x ?? 0) * playerScale();
            const lift = (offset?.y ?? 0) * playerScale();
            const ahead = (offset?.z ?? 0) * playerScale();
            this.handTarget.copy(gripAt).addScaledVector(left, out).addScaledVector(forward, ahead).setY(gripAt.y + lift);
            this.handTarget2.copy(gripAt).addScaledVector(left, -out).addScaledVector(forward, ahead).setY(gripAt.y + lift);
            this.holdPose(this.handTarget, this.handTarget2, grip);
        }
    }

    /**
     * Riding: the hands on the steering wheel (TractorRide, after it has put the player in the seat): `left` / `right`
     * the world points, `hand` the hands' turn (degrees).
     */
    public holdWheel(left: THREE.Vector3, right: THREE.Vector3, hand?: { x: number; y: number; z: number }): void {
        if (!this.loaded) return;
        const container = this.loaded.container;
        this.forward.set(0, 0, 1).applyQuaternion(container.quaternion).setY(0).normalize();
        this.left.crossVectors(UP, this.forward);
        this.holdPose(left, right, { forward: 0, height: 0, spread: 0, hand });
    }

    /**
     * The upper body holds the tool over whatever the legs are doing (walk / idle): the arms are frozen (armFrozen),
     * then each is solved as a two-bone IK chain pinned at its grip, the hand on the bar and the elbow bending
     * toward ELBOW_POLE (back, out and a little down), so the arms bend instead of stretching or swinging. Aiming
     * (not set angles) works whatever the rig's bone axes are.
     */
    private holdPose(leftHand: THREE.Vector3, rightHand: THREE.Vector3, grip: GripDef): void {
        const body = this.loaded!.body;
        for (const [bone, frozen] of this.armFrozen) bone.quaternion.copy(frozen);
        this.loaded!.container.updateMatrixWorld(true);
        for (const [side, target] of [['Left', leftHand], ['Right', rightHand]] as const) {
            const arm = body.getBone(`${side}Arm`);
            const fore = body.getBone(`${side}ForeArm`);
            const hand = body.getBone(`${side}Hand`);
            if (!arm || !fore || !hand) continue;
            this.solveArm(arm, fore, hand, target, side === 'Left' ? 1 : -1);
            const rest = this.handRest.get(hand);
            if (rest) {
                // The grip's turn on top of the rest pose (mirrored for the right hand unless `mirror` is off).
                const turn = grip.hand ?? { x: 0, y: 0, z: 0 };
                const flip = side === 'Right' && grip.mirror !== false ? -1 : 1;
                const rad = THREE.MathUtils.degToRad;
                this.handTurn.setFromEuler(this.handEuler.set(rad(turn.x), rad(turn.y * flip), rad(turn.z * flip)));
                hand.quaternion.copy(rest).multiply(this.handTurn);
                hand.updateMatrixWorld(true);
            }
        }
        for (const [finger, grip] of this.fingerGrip) finger.quaternion.copy(grip);
    }

    /**
     * Two-bone IK: the shoulder fixed, the upper arm and forearm keep their lengths, the hand lands on `target` (or as
     * near as the arm reaches), and the elbow sits on the side of the shoulder-hand line facing ELBOW_POLE
     * (`out`: +1 for the left arm, -1 for the right, mirroring the pole's sideways part).
     */
    private solveArm(arm: THREE.Object3D, fore: THREE.Object3D, hand: THREE.Object3D, target: THREE.Vector3, out: number): void {
        const shoulder = arm.getWorldPosition(this.ikShoulder);
        const upper = fore.getWorldPosition(this.ikElbow).distanceTo(shoulder);
        const lower = hand.getWorldPosition(this.ikHand).distanceTo(this.ikElbow);
        const dir = this.ikDir.copy(target).sub(shoulder);
        const reach = THREE.MathUtils.clamp(dir.length(), Math.abs(upper - lower) + 1e-4, upper + lower - 1e-4);
        dir.normalize();
        // The elbow's angle from the shoulder-hand line (law of cosines), toward the pole's part across that line.
        const cos = THREE.MathUtils.clamp((upper * upper + reach * reach - lower * lower) / (2 * upper * reach), -1, 1);
        const bend = this.ikBend.copy(this.forward).multiplyScalar(ELBOW_POLE.forward)
            .addScaledVector(this.left, ELBOW_POLE.out * out).addScaledVector(UP, ELBOW_POLE.up);
        bend.addScaledVector(dir, -bend.dot(dir)).normalize();
        const elbow = this.ikElbow.copy(shoulder).addScaledVector(dir, upper * cos).addScaledVector(bend, upper * Math.sqrt(1 - cos * cos));
        this.aim(arm, fore, elbow);
        this.aim(fore, hand, this.ikReach.copy(shoulder).addScaledVector(dir, reach));
    }

    /** Turns `bone` (in world space) so its child `toward` lies on the line to `target`. */
    private aim(bone: THREE.Object3D, toward: THREE.Object3D, target: THREE.Vector3): void {
        const from = bone.getWorldPosition(this.aimFrom);
        const current = toward.getWorldPosition(this.aimCurrent).sub(from).normalize();
        const wanted = this.aimWanted.copy(target).sub(from).normalize();
        const turn = this.aimTurn.setFromUnitVectors(current, wanted);
        const world = bone.getWorldQuaternion(this.aimWorld).premultiply(turn);
        const parent = bone.parent!.getWorldQuaternion(this.aimParent).invert();
        bone.quaternion.copy(parent.multiply(world));
        bone.updateMatrixWorld(true);
    }

    public override destroy(): void {
        this.destroyed = true;
        this.tool.removeFromParent();
        this.loaded?.destroy();
        super.destroy();
    }
}
