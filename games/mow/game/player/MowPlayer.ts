// MowPlayer.ts
//
// The player: dig's character controller (RigidBody + PlayerMovementController for WASD / the on-screen joystick,
// FacingComponent, the animated rig) walking at the current tool's speed (MowProgress.speed), with the tool in front
// of them, for now a placeholder cube in the tool's size and colour (ui/mow.json `tools`), swapped when a better one
// is bought: a mower out in front on the ground with a handle up to the hands, the scissors held in the hands. The
// legs walk with the animation while the arms hold the tool (holdPose: the arms aimed at the grip each frame, after
// the animation). `cutPoint()` is where the tool cuts, on the ground.

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
import { MowProgress } from '../data/MowProgress';
import { ToolDef } from '../data/MowConfig';
import { BendService } from '../services/BendService';

const HALF_EXTENTS = new THREE.Vector3(0.4, 0.9, 0.4);
/** The character rig is authored in FBX units; same scale as dig's miner. */
const CHARACTER_SCALE = 0.0075;
/** The starting look (no wardrobe yet). */
const LOOK = { color: '#42a5f5', face: 'skins/face-brave-1.webp' };
/** Gap between the feet and a pushed tool's back edge (room for the handle and the walk). */
const TOOL_GAP = 0.7;
/** Where the hands hold a pushed tool's handle (ahead of the feet, height, each hand this far off the middle). */
const GRIP = { forward: 0.42, height: 0.95, spread: 0.2 };
/** Where the hands hold a held tool (the scissors), and how far ahead it cuts. */
const HELD = { forward: 0.4, height: 0.85, spread: 0.07 };
const HELD_CUT_AHEAD = 0.55;
const UP = new THREE.Vector3(0, 1, 0);
const modelUrl = (fullPath: string): string => `./${fullPath}`;

export default class MowPlayer extends Entity {
    private loaded?: ThirdPersonCharacter;
    private destroyed = false;
    /** The tool in front of the feet (rebuilt on a tool change: showTool()). */
    private readonly tool = new THREE.Group();
    private toolDef?: ToolDef;
    /** A pushed tool's handle: from the back of the deck up to the hands (a thin bar, 1 unit tall, scaled). */
    private readonly handle: THREE.Mesh;
    private readonly forward = new THREE.Vector3();
    private readonly left = new THREE.Vector3();
    private readonly gripAt = new THREE.Vector3();
    private readonly handleBase = new THREE.Vector3();
    private readonly handleDir = new THREE.Vector3();
    private readonly handTarget = new THREE.Vector3();
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
        const handleMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.6 });
        BendService.applyBend(handleMaterial);
        this.handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 8), handleMaterial);
        this.handle.visible = false;
        threeScene.add(this.tool, this.handle);
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
        // The head cube cancels the head bone's scale as measured when it's built: build at the rig's natural scale.
        character.container.updateMatrixWorld(true);
        character.applyCharacterView({ color: LOOK.color, headShape: 'cube', face: LOOK.face });
        character.container.scale.setScalar(CHARACTER_SCALE);
        if (this.destroyed) {
            character.destroy();
            return;
        }
        this.threeScene.add(character.container);
        this.loaded = character;
        this.addComponent(new CharacterVisualComponent(character));
    }

    /** Builds the tool's placeholder: a cube in its size and colour, with a darker deck where it cuts. */
    private showTool(tool: ToolDef): void {
        this.toolDef = tool;
        this.tool.clear();
        const [width, height, length] = tool.size;
        const body = new THREE.MeshStandardMaterial({ color: tool.color, roughness: 0.5 });
        const deck = new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.8 });
        BendService.applyBend(body);
        BendService.applyBend(deck);
        const cube = new THREE.Mesh(new THREE.BoxGeometry(width, height, length), body);
        // Held tools hang from the hands (centred); pushed ones stand on the ground.
        cube.position.y = tool.handheld ? 0 : height / 2 + 0.05;
        this.tool.add(cube);
        if (!tool.handheld) {
            const blade = new THREE.Mesh(new THREE.BoxGeometry(width * 1.05, 0.06, length * 1.05), deck);
            blade.position.y = 0.05;
            this.tool.add(blade);
        }
        this.handle.visible = !tool.handheld;
    }

    /** Where the tool cuts: on the ground in front — the middle of a pushed tool, a step ahead for a held one. */
    public cutPoint(out = new THREE.Vector3()): THREE.Vector3 {
        if (this.riding && this.ridePoint) return this.ridePoint(out);
        const tool = this.toolDef ?? MowProgress.tool;
        const ahead = tool.handheld ? HELD_CUT_AHEAD : TOOL_GAP + tool.size[2] / 2;
        return out.copy(this.transform.position).addScaledVector(this.facing(), ahead).setY(0);
    }

    /** The way the character faces (on the ground). */
    private facing(): THREE.Vector3 {
        const container = this.loaded?.container;
        if (!container) return this.forward.set(0, 0, -1);
        return this.forward.set(0, 0, 1).applyQuaternion(container.quaternion).setY(0).normalize();
    }

    /**
     * Call after the world has updated (the walk / idle animation has posed the body): places the tool (a pushed one
     * out in front on the ground with its handle up to the hands, a held one in the hands) and swaps it after a
     * purchase, then poses the arms to hold it (holdPose). Not `update()`: that is Entity's, which runs the components.
     */
    public syncTool(): void {
        const tool = MowProgress.tool;
        if (tool !== this.toolDef) this.showTool(tool);
        // A ridden mower is the tractor (TractorRide), never in the hands: on foot the hands are free.
        this.tool.visible = !tool.ride;
        if (tool.ride) {
            this.handle.visible = false;
            return;
        }
        const forward = this.facing();
        const left = this.left.crossVectors(UP, forward);
        const grip = tool.handheld ? HELD : GRIP;
        const gripAt = this.gripAt.copy(this.transform.position).addScaledVector(forward, grip.forward).setY(grip.height);
        const container = this.loaded?.container;
        if (container) this.tool.quaternion.copy(container.quaternion);
        if (tool.handheld) {
            this.tool.position.copy(gripAt);
        } else {
            this.cutPoint(this.tool.position);
            // The handle: from the back of the deck, up to the grip.
            const [, height, length] = tool.size;
            const base = this.handleBase.copy(this.tool.position).addScaledVector(forward, -length / 2 + 0.05).setY(height + 0.05);
            this.handle.position.copy(base).add(gripAt).multiplyScalar(0.5);
            this.handle.scale.set(1, base.distanceTo(gripAt), 1);
            this.handle.quaternion.setFromUnitVectors(UP, this.handleDir.copy(gripAt).sub(base).normalize());
        }
        if (container) {
            this.holdPose(this.handTarget.copy(gripAt).addScaledVector(left, grip.spread), this.handTarget2.copy(gripAt).addScaledVector(left, -grip.spread));
        }
    }

    /**
     * The upper body holds the tool over whatever the legs are doing (walk / idle): each arm is turned so the hand
     * reaches its grip (the upper arm aimed at it, then the forearm) after the animation has posed the frame, so the
     * legs keep walking and the arms stay on the handle. Aiming (not set angles) works whatever the rig's bone axes are.
     */
    private holdPose(leftHand: THREE.Vector3, rightHand: THREE.Vector3): void {
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
                hand.quaternion.copy(rest);
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
        this.handle.removeFromParent();
        this.loaded?.destroy();
        super.destroy();
    }
}
