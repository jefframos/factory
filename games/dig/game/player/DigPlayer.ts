// DigPlayer.ts
//
// The miner: pizza's character controller (RigidBody + PlayerMovementController for WASD / on-screen
// joystick, FacingComponent, CharacterVisualComponent for the animated rig) without any of pizza's
// gameplay components. `world.add(new DigPlayer(scene, threeScene))` sets up a player that moves and
// collides immediately; loadCharacter() then loads the visible, animated body.
//
// Mining, inventory and tools are added in later steps as their own components.

import * as THREE from 'three';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import PlayerMovementController, { MovementInputHost } from '../components/PlayerMovementController';
import CharacterVisualComponent from '../components/CharacterVisualComponent';
import FacingComponent from '../components/FacingComponent';
import ThirdPersonCharacter from '../entities/ThirdPersonCharacter';
import { getPlayerConfig } from '../data/PlayerConfig';
import MODELS from '../../registry/assetsRegistry/modelsRegistry';
import { DigProgress, Look } from '../data/DigProgress';
import hatFits from '../../ui/hatfits.json';
import { SITTING_STATE } from '../entities/CharacterBody';

const HALF_EXTENTS = new THREE.Vector3(0.4, 0.9, 0.4);
/** The character rig is authored in FBX units; same scale as pizza's MainPlayer. */
const CHARACTER_SCALE = 0.0075;
/** Must match CharacterBody's HAT_SINK: ui/hatfits.json (bandit-controller's editor format) measures from the head top. */
const HAT_SINK = 0.03;
/** CharacterBody's HAT_WIDTH_FIT: hatfits.json scales are the hat width as a fraction of the head. */
const HAT_WIDTH_FIT = 1.05;
type HatFit = { x: number; y: number; z: number; scale: number; rotationY: number };
const HAT_FITS = hatFits as { default: HatFit; hats: Record<string, Partial<HatFit>> };
const modelUrl = (fullPath: string): string => `./${fullPath}`;

export default class DigPlayer extends Entity {
    private loaded?: ThirdPersonCharacter;
    private destroyed = false;
    /** On top of the walking speed (the tractor drives faster). */
    public speedMultiplier = 1;
    /** Riding the tractor: the miner just sits (no tool in hand, no swing — MiningController). */
    public seated = false;

    public constructor(private readonly inputHost: MovementInputHost, private readonly threeScene: THREE.Scene) {
        super();
    }

    /** The animated rig, once loadCharacter() has resolved. */
    public get character(): ThirdPersonCharacter | undefined {
        return this.loaded;
    }

    /** Head height point pickups fly into. */
    public pickupPoint(out = new THREE.Vector3()): THREE.Vector3 {
        return out.copy(this.transform.position).setY(1.2);
    }

    public get movementController(): PlayerMovementController {
        return this.getComponent(PlayerMovementController)!;
    }

    public override awake(): void {
        this.addComponent(new RigidBody({
            halfExtents: HALF_EXTENTS,
            centerOffset: new THREE.Vector3(0, HALF_EXTENTS.y, 0),
            layer: Layers.Player,
        }));
        this.addComponent(new PlayerMovementController(() => (this.loaded?.getMoveSpeed() ?? 0) * this.speedMultiplier * DigProgress.moveMultiplier, this.inputHost));
        this.addComponent(new FacingComponent());
    }

    /** Loads the rig and its idle/walk/run clips; movement already works before this resolves. */
    public async loadCharacter(): Promise<void> {
        const config = getPlayerConfig();
        const character = new ThirdPersonCharacter({ walkSpeed: config.walkSpeed, runSpeedMultiplier: config.runSpeedMultiplier });
        const anim = config.animations;
        const clip = (id: string) => modelUrl(MODELS.Characters[id as keyof typeof MODELS.Characters].fullPath);
        await character.loadMesh(modelUrl(MODELS.Characters.CharacterMedium.fullPath));
        await character.registerAnimation('idle', clip(anim.idle));
        await character.registerAnimation('walk', clip(anim.walk));
        await character.registerAnimation('run', clip(anim.run));
        // Tool swings, on the action layer (MiningController): shovel digging, pickaxe/drill mining.
        await character.registerAnimation('dig', clip('Digging'));
        await character.registerAnimation('mine', clip('StandingPICKAXE'));
        // Sitting in the tractor (TractorRide -> CharacterBody.sitNow(): straight into the loop).
        await character.registerAnimation(SITTING_STATE, clip('Sitting'));
        character.setUp(config.idleToWalkSpeed, config.walkToRunSpeed);
        this.applyLook(DigProgress.look, character);
        // The hand's tool holder cancels the hand bone's scale as measured when it's first built, so it
        // must be built at the rig's natural scale (as pizza does) — built after the shrink below, it
        // would cancel CHARACTER_SCALE too and the tools would come out ~130x too big.
        character.showTool('shovel');
        character.showTool(undefined);
        character.container.scale.setScalar(CHARACTER_SCALE);
        if (this.destroyed) {
            character.destroy();
            return;
        }
        this.threeScene.add(character.container);
        this.loaded = character;
        this.addComponent(new CharacterVisualComponent(character));
    }

    /** Dresses the miner: body colour, face and hat (the wardrobe's look; a new miner wears no hat). */
    public applyLook(look: Readonly<Look>, character = this.loaded): void {
        if (!character) return;
        // Like the tool holder (below), the head cube cancels the head bone's scale as measured when it's
        // built, so it has to be rebuilt at the rig's natural scale, then the miner shrinks back.
        const scale = character.container.scale.x;
        character.container.scale.setScalar(1);
        character.container.updateMatrixWorld(true);
        character.applyCharacterView({ color: look.color, headShape: 'cube', face: look.face });
        const model = MODELS.Hats[look.hat as keyof typeof MODELS.Hats];
        if (!model) {
            // No hat (a new miner, before the first one is bought).
            character.body.setHat(undefined);
            character.container.scale.setScalar(scale);
            character.container.updateMatrixWorld(true);
            return;
        }
        // Same placement table as bandit-controller, keyed by the hat's file name: edit it in `npm run editor`, Hats tab.
        const name = model.fullPath.split('/').pop()!.replace(/\.[^.]+$/, '');
        const fit = { ...HAT_FITS.default, ...HAT_FITS.hats[name] };
        character.body.setHat({ model, scale: fit.scale / HAT_WIDTH_FIT, offsetX: fit.x, offsetY: fit.y + HAT_SINK, offsetZ: fit.z, rotationDeg: fit.rotationY });
        character.container.scale.setScalar(scale);
        character.container.updateMatrixWorld(true);
    }

    public override destroy(): void {
        this.destroyed = true;
        this.loaded?.destroy();
        super.destroy();
    }
}
