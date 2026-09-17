// MainPlayer.ts
//
// The player, as a dedicated Entity subclass. Everything the player needs
// to physically exist and respond to input — RigidBody, PlayerMovementController —
// is added synchronously in awake(). loadCharacter() is a separate, async,
// optional step that loads the FBX mesh + animation clips and only then
// attaches CharacterVisualComponent — the player already collides, falls
// under gravity and responds to input before it resolves, it just won't
// have a visible/animated body yet.

import * as THREE from 'three';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import PlayerMovementController, { MovementInputHost } from '../components/PlayerMovementController';
import SwipeRunnerController from '../components/SwipeRunnerController';
import CharacterVisualComponent from '../components/CharacterVisualComponent';
import ThirdPersonCharacter from '../entities/ThirdPersonCharacter';
import { TextureBuilder } from '../builders/TextureBuilder';
import MODELS from '../../registry/assetsRegistry/modelsRegistry';
import { DEFAULT_CHARACTER_VIEW, resolveSkinImagePath } from '../data/CharacterViews';
import { PLAYER_SETTINGS } from '../data/PlayerSettings';

/** Player collider half-extents, roughly a standing human's box. */
const HALF_EXTENTS = new THREE.Vector3(0.4, 0.9, 0.4);
/** FBX export scale for this character rig. */
const CHARACTER_SCALE = 0.0075;

/** Model-registry entries carry a repo-relative fullPath (e.g. "bandit-controller/models/..."), served at runtime from ./bandit-controller/... (see public/bandit-controller/models, built via `npm run models`). */
const modelUrl = (fullPath: string): string => `./${fullPath}`;

export default class MainPlayer extends Entity {
    private readonly inputHost: MovementInputHost;
    /** Only needed for loadCharacter() to parent the loaded rig's container directly into the 3D scene — CharacterVisualComponent itself deliberately doesn't do this (ThirdPersonCharacter.update() sets the container's position in WORLD space). */
    private readonly threeScene: THREE.Scene;
    private thirdPersonCharacter?: ThirdPersonCharacter;
    /** Guards loadCharacter()'s continuation against attaching a component to an entity that got destroyed while the FBX load was still in flight. */
    private destroyed = false;

    public constructor(inputHost: MovementInputHost, threeScene: THREE.Scene) {
        super();
        this.inputHost = inputHost;
        this.threeScene = threeScene;
    }

    public get character(): ThirdPersonCharacter | undefined {
        return this.thirdPersonCharacter;
    }

    /** Handle for switching in/out of the free/pointer-follow runner mode from outside — see ControllerScene's (first) pair of runner-lane triggers. */
    public get movementController(): PlayerMovementController {
        return this.getComponent(PlayerMovementController)!;
    }

    /** Handle for the DIFFERENT, discrete-lane swipe controller — see ControllerScene's second pair of runner-lane triggers. Disabled by default; activate()/deactivate() switch it on/off. */
    public get swipeRunnerController(): SwipeRunnerController {
        return this.getComponent(SwipeRunnerController)!;
    }

    /** The player's own physics collider — e.g. for ControllerScene's reset button, which needs to zero velocity directly. */
    public get rigidBody(): RigidBody {
        return this.getComponent(RigidBody)!;
    }

    private readonly collectTargetPosition = new THREE.Vector3();

    /** Where world pickups (Collectible) aim for — transform.position (feet level) raised by PlayerSettings.collectTargetHeight, so items fly to roughly body-center instead of the ground. Returns a reused scratch vector — copy it if the value needs to outlive the current call (see ControllerScene.buildCollectibles()). */
    public getCollectTargetPosition(): THREE.Vector3 {
        return this.collectTargetPosition.set(
            this.transform.position.x,
            this.transform.position.y + PLAYER_SETTINGS.collectTargetHeight,
            this.transform.position.z,
        );
    }

    public override awake(): void {
        this.addComponent(new RigidBody({
            halfExtents: HALF_EXTENTS,
            centerOffset: new THREE.Vector3(0, HALF_EXTENTS.y, 0),
            layer: Layers.Player,
        }));

        this.addComponent(new PlayerMovementController(
            (sprinting) => this.thirdPersonCharacter?.getMoveSpeed(sprinting) ?? 0,
            this.inputHost,
        ));

        this.addComponent(new SwipeRunnerController(
            (sprinting) => this.thirdPersonCharacter?.getMoveSpeed(sprinting) ?? 0,
        ));
    }

    /** Loads the FBX character + the idle/walk/run/jump/roll/slide clips and wires up the animation state graph, then attaches CharacterVisualComponent so it starts tracking the RigidBody that's already been moving this whole time. */
    public async loadCharacter(): Promise<void> {
        const character = new ThirdPersonCharacter();

        await character.loadMesh(modelUrl(MODELS.Characters.CharacterMedium.fullPath));
        await character.registerAnimation('idle', modelUrl(MODELS.Characters.Idle.fullPath));
        await character.registerAnimation('walk', modelUrl(MODELS.Characters.Walking.fullPath));
        await character.registerAnimation('run', modelUrl(MODELS.Characters.Running.fullPath));
        await character.registerAnimation('jumpUp', modelUrl(MODELS.Characters.JumpUpNew.fullPath));
        await character.registerAnimation('falling', modelUrl(MODELS.Characters.LandingNew.fullPath));
        await character.registerAnimation('landing', modelUrl(MODELS.Characters.LandingNew.fullPath));
        await character.registerAnimation('roll', modelUrl(MODELS.Characters.Roll.fullPath));
        await character.registerAnimation('slide', modelUrl(MODELS.Characters.Slide.fullPath));
        character.setUp();

        const faceTexture = await TextureBuilder.load(resolveSkinImagePath(DEFAULT_CHARACTER_VIEW.face));
        character.applyCharacterView(DEFAULT_CHARACTER_VIEW.color, faceTexture);
        character.container.scale.setScalar(CHARACTER_SCALE);

        if (this.destroyed) {
            character.destroy();
            return;
        }

        this.threeScene.add(character.container);
        this.thirdPersonCharacter = character;
        this.addComponent(new CharacterVisualComponent(character));
    }

    public override destroy(): void {
        this.destroyed = true;
        super.destroy();
    }
}
