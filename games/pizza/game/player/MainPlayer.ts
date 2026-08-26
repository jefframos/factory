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
import PlayerUIAvoidanceComponent from '../components/PlayerUIAvoidanceComponent';
import PlayerNotificationComponent from '../components/PlayerNotificationComponent';
import { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import { ActionType } from '../actions/ActionTypes';
import ThirdPersonCharacter from '../entities/ThirdPersonCharacter';
import MODELS from '../../registry/assetsRegistry/modelsRegistry';
import { getStarterCharacterView } from '../data/CharacterViewTypes';

/** Player collider half-extents, roughly a standing human's box. */
const HALF_EXTENTS = new THREE.Vector3(0.4, 0.9, 0.4);
/** FBX export scale for this character rig — same value the source project used. */
const CHARACTER_SCALE = 0.0075;
/** Fallback look if CHARACTER_VIEW_CONFIG has no entry flagged isStarter at all (a misconfigured registry) — see getStarterCharacterView()'s own doc. Matches CharacterViewTypes.ts's own "default" entry, kept separately so this file never has to import that entry directly. */
const FALLBACK_CHARACTER_VIEW = { color: '#4aba8a', headShape: 'cube' as const, face: 'skins/face-star-1.webp' };

/** Model-registry entries only carry a repo-relative fullPath (e.g. "pizza/models/..."); served at runtime from ./pizza/... (see public/pizza/models). Works on localhost and GitHub Pages. */
const modelUrl = (fullPath: string): string => `./${fullPath}`;

export default class MainPlayer extends Entity {
    private readonly inputHost: MovementInputHost;
    /** Only needed for loadCharacter() to parent the loaded rig's container directly into the 3D scene — CharacterVisualComponent itself deliberately doesn't do this (see its own doc: ThirdPersonCharacter.update() sets the container's position in WORLD space, so it can't be a child of entity.transform without double-applying that offset). */
    private readonly threeScene: THREE.Scene;
    private thirdPersonCharacter?: ThirdPersonCharacter;
    /** Guards loadCharacter()'s continuation against attaching a component to an entity that got destroyed (or pooled/reused as something else) while the FBX load was still in flight. */
    private destroyed = false;

    /** Optional — powers PlayerUIAvoidanceComponent (see awake()), which needs a way to project the player's head into screen space. Omitted by the headless test harness (scripts/test-gather.ts), which has no PIXI/overlay at all — the player just doesn't get a UI-avoidance region there, since there's no UI to avoid. */
    private readonly screenHost?: ScreenAnchorHost;

    public constructor(inputHost: MovementInputHost, threeScene: THREE.Scene, screenHost?: ScreenAnchorHost) {
        super();
        this.inputHost = inputHost;
        this.threeScene = threeScene;
        this.screenHost = screenHost;
    }

    /** The live "keep UI off the player" region, or undefined if this player has no PlayerUIAvoidanceComponent (e.g. the headless test harness) — see PizzaScene's screenHost.getUIAvoidancePoint() wiring, the one caller. */
    public getUIAvoidancePoint(): { position: THREE.Vector3; radius: number } | undefined {
        return this.getComponent(PlayerUIAvoidanceComponent)?.getRegion();
    }

    /** Once loadCharacter() resolves, this is the loaded rig — undefined until then. Nothing in this class or PizzaScene gates on it; it's exposed purely for callers that want to react to the character specifically becoming available (e.g. triggering a "ready" animation or UI beat). */
    public get character(): ThirdPersonCharacter | undefined {
        return this.thirdPersonCharacter;
    }

    /** Handle for freezing/unfreezing movement without touching anything else — e.g. `mainPlayer.movementController.enabled = false` for a cutscene or death state. Input keeps being recorded in the background; see PlayerMovementController's own doc for exactly what disabling it does. */
    public get movementController(): PlayerMovementController {
        return this.getComponent(PlayerMovementController)!;
    }

    /** The player's own physics collider — e.g. for PizzaScene's "is the player standing somewhere safe to respawn" check (see PhysicsWorld.isOverlappingAny()), which needs the player's actual RigidBody rather than a synthetic box. */
    public get rigidBody(): RigidBody {
        return this.getComponent(RigidBody)!;
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
        if (this.screenHost) {
            this.addComponent(new PlayerUIAvoidanceComponent(this.screenHost));
            this.addComponent(new PlayerNotificationComponent(this.screenHost));
        }

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

        await character.loadMesh(modelUrl(MODELS.Characters.CharacterMedium.fullPath));
        await character.registerAnimation('idle', modelUrl(MODELS.Characters.Idle.fullPath));
        await character.registerAnimation('run', modelUrl(MODELS.Characters.Running.fullPath));
        await character.registerAnimation('pick', modelUrl(MODELS.Characters.PickFruit.fullPath));
        // await character.registerAnimation('jumpUp', modelUrl(MODELS.Characters.JumpingUp.fullPath));
        // await character.registerAnimation('falling', modelUrl(MODELS.Characters.FallingIdle.fullPath));
        // await character.registerAnimation('landing', modelUrl(MODELS.Characters.Landing.fullPath));
        // await character.registerAnimation('roll', modelUrl(MODELS.Characters.Roll.fullPath));
        // Ids here MUST match ACTION_CONFIG's animationTrigger values ('chop'/'mine'/'pick') —
        // that's what PlayerActionController plays on the animator's ACTION layer, not the
        // idle/run/jump board (see AnimatorController's own doc).
        await character.registerAnimation('chop', modelUrl(MODELS.Characters.StandingMeleeAttackDownwardCHOP.fullPath));
        await character.registerAnimation('mine', modelUrl(MODELS.Characters.StandingPICKAXE.fullPath));
        character.setUp();
        // DEBUG — permanent marker at the RightHand bone's own origin, so tool
        // placement bugs can be narrowed to "the bone tracking is wrong" vs "the
        // ToolVisualEntry offset/rotation numbers are wrong" — see CharacterBody's
        // own doc. Remove once tool placement is confirmed working.
        character.debugShowHandMarker();
        // Colors the body + attaches the matching head cube for whichever CharacterView is
        // flagged isStarter (see CharacterViewTypes.ts's own doc) — falls back to a hardcoded
        // look if the registry has none flagged, rather than crashing on a brand-new/
        // misconfigured save.
        character.applyCharacterView(getStarterCharacterView() ?? FALLBACK_CHARACTER_VIEW);
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
