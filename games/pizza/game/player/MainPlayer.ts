// MainPlayer.ts
//
// The player, as a dedicated Entity subclass (see Entity.ts's own doc on
// awake() for why this pattern exists). Everything the player needs —
// RigidBody, PlayerMovementController, collision/trigger event wiring — is
// added in awake(), so the caller doesn't need to know any of MainPlayer's
// internals: `world.add(new MainPlayer(inputHost))` is the entire setup.
//
// Movement works from the very first frame, independent of the FBX
// character: RigidBody + PlayerMovementController are added synchronously
// in awake(). loadCharacter() is a SEPARATE, async, optional step — it
// loads the FBX mesh + animation clips and only THEN attaches
// CharacterVisualComponent, but nothing here waits on it. Call it whenever
// convenient (see PizzaScene) and the player already collides, falls under
// gravity, and responds to input before it resolves — it just won't have a
// visible/animated body yet.

import * as THREE from 'three';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import PlayerMovementController, { MovementInputHost } from '../components/PlayerMovementController';
import CharacterVisualComponent from '../components/CharacterVisualComponent';
import FacingComponent from '../components/FacingComponent';
import PlayerActionController, { ActionResult, ActionTarget } from '../components/PlayerActionController';
import AutoGatherController from '../components/AutoGatherController';
import { ActionType } from '../actions/ActionTypes';
import ThirdPersonCharacter from '../entities/ThirdPersonCharacter';
import MODELS from '../../registry/assetsRegistry/modelsRegistry';

/** Player collider half-extents, roughly a standing human's box. */
const HALF_EXTENTS = new THREE.Vector3(0.4, 0.9, 0.4);
/** FBX export scale for this character rig — same value the source project used. */
const CHARACTER_SCALE = 0.0075;
/** Cube color/value the head-cube test used — see ThirdPersonCharacter.applyColor(). */
const HEAD_CUBE_VALUE = 2;

/** Model-registry entries only carry a repo-relative fullPath (e.g. "pizza/models/..."); served at runtime from ./pizza/... (see public/pizza/models). Works on localhost and GitHub Pages. */
const modelUrl = (fullPath: string): string => `./${fullPath}`;

export default class MainPlayer extends Entity {
    private readonly inputHost: MovementInputHost;
    /** Only needed for loadCharacter() to parent the loaded rig's container directly into the 3D scene — CharacterVisualComponent itself deliberately doesn't do this (see its own doc: ThirdPersonCharacter.update() sets the container's position in WORLD space, so it can't be a child of entity.transform without double-applying that offset). */
    private readonly threeScene: THREE.Scene;
    private thirdPersonCharacter?: ThirdPersonCharacter;
    /** Guards loadCharacter()'s continuation against attaching a component to an entity that got destroyed (or pooled/reused as something else) while the FBX load was still in flight. */
    private destroyed = false;

    public constructor(inputHost: MovementInputHost, threeScene: THREE.Scene) {
        super();
        this.inputHost = inputHost;
        this.threeScene = threeScene;
    }

    /** Once loadCharacter() resolves, this is the loaded rig — undefined until then. Nothing in this class or PizzaScene gates on it; it's exposed purely for callers that want to react to the character specifically becoming available (e.g. triggering a "ready" animation or UI beat). */
    public get character(): ThirdPersonCharacter | undefined {
        return this.thirdPersonCharacter;
    }

    /** Handle for freezing/unfreezing movement without touching anything else — e.g. `mainPlayer.movementController.enabled = false` for a cutscene or death state. Input keeps being recorded in the background; see PlayerMovementController's own doc for exactly what disabling it does. */
    public get movementController(): PlayerMovementController {
        return this.getComponent(PlayerMovementController)!;
    }

    /**
     * Starts a repeated-hit action (chop, mine, ...) against `target` — turns the player to
     * face it, hits it every hitIntervalSec, and resolves with 'completed' once the target
     * depletes or 'cancelled' if it was interrupted (e.g. walking out of range). See
     * PlayerActionController's own doc for the full sequence; this is just a pass-through so
     * callers don't need to know MainPlayer is made of components at all —
     * `mainPlayer.onPlayActionAnimation(...)` is the whole public surface. Not declared
     * `async` for the same reason PlayerActionController.onPlayActionAnimation() isn't —
     * see its own doc: the busy-guard should throw synchronously through this pass-through
     * too, not get wrapped into a rejected Promise by an extra layer of `async`.
     */
    public onPlayActionAnimation(action: ActionType, target: ActionTarget): Promise<ActionResult> {
        return this.getComponent(PlayerActionController)!.onPlayActionAnimation(action, target);
    }

    /** Cancels whatever action is in flight, if any — the target keeps its progress. See PlayerActionController.cancel(). */
    public cancelAction(): void {
        this.getComponent(PlayerActionController)!.cancel();
    }

    /** Entity's self-configure hook (see Entity.ts) — everything needed for the player to physically exist and respond to input, all synchronous. */
    public override awake(): void {
        const rigidBody = this.addComponent(new RigidBody({
            halfExtents: HALF_EXTENTS,
            centerOffset: new THREE.Vector3(0, HALF_EXTENTS.y, 0),
            layer: Layers.Player,
        }));

        this.addComponent(new PlayerMovementController(
            () => this.thirdPersonCharacter?.getMoveSpeed() ?? 0,
            this.inputHost,
        ));
        this.addComponent(new FacingComponent());
        this.addComponent(new PlayerActionController());
        this.addComponent(new AutoGatherController());

        this.registerCollisionEvents(rigidBody);

    }

    /**
     * Demo hookup for RigidBody's event API (see RigidBody.ts's own doc) — logs whichever
     * OTHER body the player just started/kept/stopped overlapping. Swap these console.log
     * calls for real gameplay logic (damage zones, pickups, checkpoints, ...) — the event
     * wiring itself is the point being demonstrated.
     */
    private registerCollisionEvents(rigidBody: RigidBody): void {
        // rigidBody.onCollisionEnter.add(other => console.log('[collision] enter', other));
        // rigidBody.onCollisionStay.add(other => console.log('[collision] stay', other));
        // rigidBody.onCollisionExit.add(other => console.log('[collision] exit', other));
        // rigidBody.onTriggerEnter.add(other => console.log('[trigger] enter', other));
        // rigidBody.onTriggerStay.add(other => console.log('[trigger] stay', other));
        // rigidBody.onTriggerExit.add(other => console.log('[trigger] exit', other));
    }

    /**
     * Loads the FBX character + its animation clips and wires up the same
     * idle/run/jump state graph the source project used (see
     * ThirdPersonCharacter.setUp()), then attaches CharacterVisualComponent
     * so it starts tracking the RigidBody that's already been moving this
     * whole time. See this class's own doc — movement never waits on this.
     */
    public async loadCharacter(): Promise<void> {
        const character = new ThirdPersonCharacter();

        await character.loadMesh(modelUrl(MODELS.CharacterMedium.fullPath));
        await character.registerAnimation('idle', modelUrl(MODELS.Idle.fullPath));
        await character.registerAnimation('run', modelUrl(MODELS.Running.fullPath));
        await character.registerAnimation('pick', modelUrl(MODELS.PickFruit.fullPath));
        // await character.registerAnimation('jumpUp', modelUrl(MODELS.JumpingUp.fullPath));
        // await character.registerAnimation('falling', modelUrl(MODELS.FallingIdle.fullPath));
        // await character.registerAnimation('landing', modelUrl(MODELS.Landing.fullPath));
        // await character.registerAnimation('roll', modelUrl(MODELS.Roll.fullPath));
        // Ids here MUST match ACTION_CONFIG's animationTrigger values ('chop'/'mine') — that's
        // also the animator-board STATE name (see CharacterBody.setUp()'s per-action transitions).
        await character.registerAnimation('chop', modelUrl(MODELS.StandingMeleeAttackDownwardCHOP.fullPath));
        await character.registerAnimation('mine', modelUrl(MODELS.StandingPICKAXE.fullPath));
        character.setUp();
        // Test hook — colors the body + attaches a matching cube head, both using the
        // same value-based palette the real cube player uses.
        character.applyColor(HEAD_CUBE_VALUE);
        // Placeholder backpack cube — see CharacterBody.mountBackpackCube()'s own doc for
        // tuning its position live via character.setBackpackOffset(x, y, z).
        character.mountBackpackCube();
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
        // CharacterVisualComponent.destroy() (if it was ever attached — see loadCharacter())
        // already destroys `character` as part of the component teardown below; nothing
        // extra to do here if the FBX load never got that far.
        super.destroy();
    }
}
