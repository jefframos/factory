// MowPlayer.ts
//
// The player: dig's character controller (RigidBody + PlayerMovementController for WASD / the on-screen joystick,
// FacingComponent, the animated rig) walking at the current tool's speed (MowProgress.speed), with the tool in front
// of them, for now a placeholder mower in the tool's size and colour (MowerModel.ts, ui/mow.json `tools`), swapped when a better one
// is bought: a mower out in front on the ground with a push handle (two rails up from the deck's back corners — a
// reel mower's axle — to a crossbar the hands hold). Where the hands go, and how they turn on the bar, is the tool's
// `grip` (edited in the editor's Mowers tab, which builds the same mowers: web/public/mowers.js). The legs walk with the animation while the
// arms hold the tool (holdPose: the arms aimed at the grip each frame, after the animation). `cutPoint()` is where the
// tool cuts, on the ground.

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
import { GripDef, ToolDef } from '../data/MowConfig';
import { BendService } from '../services/BendService';
import { addHandle, buildMower, handleOf, pushAhead, toolGrip, REEL_WHEEL } from './MowerModel';

const HALF_EXTENTS = new THREE.Vector3(0.4, 0.9, 0.4);
/** The character rig is authored in FBX units; same scale as dig's miner. */
const CHARACTER_SCALE = 0.0075;
/** Must match CharacterBody's HAT_SINK: ui/hatfits.json (bandit-controller's editor format) measures from the head top. */
const HAT_SINK = 0.03;
/** CharacterBody's HAT_WIDTH_FIT: hatfits.json scales are the hat width as a fraction of the head. */
const HAT_WIDTH_FIT = 1.05;
type HatFit = { x: number; y: number; z: number; scale: number; rotationY: number };
const HAT_FITS = hatFits as { default: HatFit; hats: Record<string, Partial<HatFit>> };
const UP = new THREE.Vector3(0, 1, 0);
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
    /** Share of the walking speed (MowingSystem: tough grass holds the mower back). */
    public drag = 1;
    /** Sat on the tractor (TractorRide): no tool in the hands, it cuts from the tractor (`ridePoint`). */
    public riding = false;
    /** Where the tractor cuts (set by the scene: TractorRide.cutPoint). */
    public ridePoint?: (out: THREE.Vector3) => THREE.Vector3;

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
        return out.copy(this.transform.position).setY(1.2);
    }

    public override awake(): void {
        this.addComponent(new RigidBody({
            halfExtents: HALF_EXTENTS,
            centerOffset: new THREE.Vector3(0, HALF_EXTENTS.y, 0),
            layer: Layers.Player,
        }));
        this.addComponent(new PlayerMovementController(() => MowProgress.speed * this.drag, this.inputHost));
        this.addComponent(new FacingComponent());
    }

    /** Loads the rig and its clips; movement already works before this resolves. */
    public async loadCharacter(): Promise<void> {
        const config = getPlayerConfig();
        const character = new ThirdPersonCharacter({ walkSpeed: config.walkSpeed, runSpeedMultiplier: config.runSpeedMultiplier });
        const anim = config.animations;
        const clip = (id: string) => modelUrl(MODELS.Characters[id as keyof typeof MODELS.Characters].fullPath);
        await character.loadMesh(modelUrl(MODELS.Characters.CharacterMedium.fullPath));
        for (const side of ['Left', 'Right']) {
            const hand = character.body.getBone(`${side}Hand`);
            if (hand) this.handRest.set(hand, hand.quaternion.clone());
        }
        await character.registerAnimation('idle', clip(anim.idle));
        await character.registerAnimation('walk', clip(anim.walk));
        await character.registerAnimation('run', clip(anim.run));
        // Sat on the tractor (TractorRide -> CharacterBody.sitNow(): straight into the loop).
        await character.registerAnimation(SITTING_STATE, clip('Sitting'));
        character.setUp(config.idleToWalkSpeed, config.walkToRunSpeed);
        // Dressed in the wardrobe's look (applyLook() also rebuilds the head at the rig's natural scale).
        character.container.scale.setScalar(CHARACTER_SCALE);
        this.applyLook(MowProgress.look, character);
        if (this.destroyed) {
            character.destroy();
            return;
        }
        this.threeScene.add(character.container);
        this.loaded = character;
        this.addComponent(new CharacterVisualComponent(character));
    }

    /** Dresses the player: body colour, face and hat (the wardrobe's look, as in Dig; a new player wears no hat). */
    public applyLook(look: Readonly<Look>, character = this.loaded): void {
        if (!character) return;
        // The head cube cancels the head bone's scale as measured when it's built, so it has to be rebuilt at the
        // rig's natural scale, then the player shrinks back.
        const scale = character.container.scale.x;
        character.container.scale.setScalar(1);
        character.container.updateMatrixWorld(true);
        character.applyCharacterView({ color: look.color, headShape: 'cube', face: look.face });
        const model = MODELS.Hats[look.hat as keyof typeof MODELS.Hats];
        if (!model) {
            character.body.setHat(undefined);
        } else {
            // Same placement table as Dig (ui/hatfits.json), keyed by the hat's file name.
            const name = model.fullPath.split('/').pop()!.replace(/\.[^.]+$/, '');
            const fit = { ...HAT_FITS.default, ...HAT_FITS.hats[name] };
            character.body.setHat({ model, scale: fit.scale / HAT_WIDTH_FIT, offsetX: fit.x, offsetY: fit.y + HAT_SINK, offsetZ: fit.z, rotationDeg: fit.rotationY });
        }
        character.container.scale.setScalar(scale);
        character.container.updateMatrixWorld(true);
    }

    /**
     * Builds the tool's placeholder (MowerModel.ts: a reel mower, or a long deck with its engine on top), in its own
     * frame (centred on the cut point, +Z ahead), and the push handle — rails from the deck's back corners (the reel's
     * axle ends) up to a crossbar at the grip.
     */
    private showTool(tool: ToolDef): void {
        this.toolDef = tool;
        this.tool.clear();
        const model = buildMower(tool, (material) => BendService.applyBend(material));
        const { grip, gripZ } = handleOf(tool);
        addHandle(model, tool, grip, gripZ, this.handleMaterial);
        this.tool.add(model.group);
        this.reel = model.reel;
    }

    /** Where the tool cuts: on the ground in front, the middle of the mower. */
    public cutPoint(out = new THREE.Vector3()): THREE.Vector3 {
        if (this.riding && this.ridePoint) return this.ridePoint(out);
        const tool = this.toolDef ?? MowProgress.tool;
        return out.copy(this.transform.position).addScaledVector(this.facing(), pushAhead(tool)).setY(0);
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
        const forward = this.facing();
        const left = this.left.crossVectors(UP, forward);
        const grip = toolGrip(tool);
        const gripAt = this.gripAt.copy(this.transform.position).addScaledVector(forward, grip.forward).setY(grip.height);
        const container = this.loaded?.container;
        if (container) this.tool.quaternion.copy(container.quaternion);
        this.cutPoint(this.tool.position);
        if (this.reel && !changed) {
            const at = this.tool.position;
            const moved = (at.x - this.lastToolAt.x) * forward.x + (at.z - this.lastToolAt.z) * forward.z;
            this.reel.rotation.x += moved / Math.max(0.05, (tool.size[1] / 2) * REEL_WHEEL) * 3;
        }
        this.lastToolAt.copy(this.tool.position);
        if (container) {
            // The hands reach the bar moved by the grip's offset (x outward for each hand); the bar stays put.
            const offset = grip.offset;
            const out = grip.spread + (offset?.x ?? 0);
            const lift = offset?.y ?? 0;
            const ahead = offset?.z ?? 0;
            this.handTarget.copy(gripAt).addScaledVector(left, out).addScaledVector(forward, ahead).setY(grip.height + lift);
            this.handTarget2.copy(gripAt).addScaledVector(left, -out).addScaledVector(forward, ahead).setY(grip.height + lift);
            this.holdPose(this.handTarget, this.handTarget2, grip);
        }
    }

    /**
     * The upper body holds the tool over whatever the legs are doing (walk / idle): each arm is turned so the hand
     * reaches its grip (the upper arm aimed at it, then the forearm) after the animation has posed the frame, so the
     * legs keep walking and the arms stay on the handle. Aiming (not set angles) works whatever the rig's bone axes are.
     */
    private holdPose(leftHand: THREE.Vector3, rightHand: THREE.Vector3, grip: GripDef): void {
        const body = this.loaded!.body;
        this.loaded!.container.updateMatrixWorld(true);
        for (const [side, target] of [['Left', leftHand], ['Right', rightHand]] as const) {
            const arm = body.getBone(`${side}Arm`);
            const fore = body.getBone(`${side}ForeArm`);
            const hand = body.getBone(`${side}Hand`);
            if (!arm || !fore || !hand) continue;
            this.aim(arm, fore, target);
            this.aim(fore, hand, target);
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
