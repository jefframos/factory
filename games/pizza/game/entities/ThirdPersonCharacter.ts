// ThirdPersonCharacter.ts
//
// Player-driven controller wrapping CharacterBody (the mesh/animation half
// — see that file for the FBX load, flat-color material fix, head-cube
// attachment, and idle/run/jump state graph). This class owns only what's
// specific to being PLAYER-controlled: move-speed config and the fake
// jump-airtime timer. Driven externally — call update() once per frame with
// whatever position/move-input the HOST scene's own player physics already
// computed (see PlayerEntity for this repo's actual movement, e.g.
// PizzaScene), rather than owning any physics itself.
//
// NPCs that just idle in place (or otherwise aren't player-controlled)
// don't need this wrapper at all — they can drive a CharacterBody directly
// (see PizzaScene's enemy test NPCs).
//
// A separate, additive character — NOT a replacement for PlayerEntity/the
// cube-based player already in this game.

import * as THREE from 'three';
import CharacterBody from './CharacterBody';

/** Purely cosmetic — fakes an airborne window so the jumpUp→falling→landing chain still plays without any real vertical physics. See jump(). */
const JUMP_AIRTIME = 0.7;

/** Tunable movement speeds for this character — the host scene reads these via getMoveSpeed() instead of hardcoding its own constant, so speed tuning lives in one place alongside the rig it belongs to. */
export interface CharacterConfig {
    /** Base ground speed, world units/second, used while not sprinting. */
    walkSpeed: number;
    /** Multiplied onto walkSpeed while sprinting (see getMoveSpeed(true)) — e.g. 1.8 = 80% faster than the walk. */
    runSpeedMultiplier: number;
}

const DEFAULT_CHARACTER_CONFIG: CharacterConfig = {
    walkSpeed: 5,
    runSpeedMultiplier: 1.8,
};

export default class ThirdPersonCharacter {
    public readonly body: CharacterBody = new CharacterBody();
    public readonly config: CharacterConfig;

    /** Counts down from JUMP_AIRTIME after jump() — see update(). 0 means grounded. */
    private airborneRemaining = 0;

    public constructor(config?: Partial<CharacterConfig>) {
        this.config = { ...DEFAULT_CHARACTER_CONFIG, ...config };
    }

    public get container(): THREE.Group {
        return this.body.container;
    }

    public get animator() {
        return this.body.animator;
    }

    /** Effective ground speed, world units/second — walkSpeed alone, or walkSpeed * runSpeedMultiplier while sprinting. Host scene should use this instead of hardcoding its own move-speed constant. */
    public getMoveSpeed(sprinting: boolean = false): number {
        return sprinting ? this.config.walkSpeed * this.config.runSpeedMultiplier : this.config.walkSpeed;
    }

    public async loadMesh(url: string): Promise<void> {
        return this.body.loadMesh(url);
    }

    public async registerAnimation(id: string, url: string): Promise<void> {
        return this.body.registerAnimation(id, url);
    }

    /** Registers the idle/run/jump state graph — call once after loadMesh()/registerAnimation() for every clip have resolved. */
    public setUp(): void {
        this.body.setUp();
    }

    /** Test hook: colors the body + attaches a matching cube head, both using the same value-based palette the real cube player uses. See CharacterBody.applyValueColor(). */
    public applyColor(value: number): void {
        this.body.applyValueColor(value);
    }

    public setHeadOffset(x: number, y: number, z: number): void {
        this.body.setHeadOffset(x, y, z);
    }

    /** Placeholder backpack cube on the rig's Chest bone — see CharacterBody.mountBackpackCube(). */
    public mountBackpackCube(): void {
        this.body.mountBackpackCube();
    }

    public setBackpackOffset(x: number, y: number, z: number): void {
        this.body.setBackpackOffset(x, y, z);
    }

    /** See CharacterBody.getBackpackWorldPosition() — used by AutoGatherController to aim gathered resource chips. */
    public getBackpackWorldPosition(target?: THREE.Vector3): THREE.Vector3 | undefined {
        return this.body.getBackpackWorldPosition(target);
    }

    /** See CharacterBody.faceDirection()'s own doc — turns the character toward a world-space direction over the next several frames, independent of move input. */
    public faceDirection(dirX: number, dirZ: number): void {
        this.body.faceDirection(dirX, dirZ);
    }

    /**
     * Call once per frame from the host scene. `moveInputX`/`moveInputZ` are
     * the SAME normalized (-1..1) input the host's own PlayerEntity already
     * gets via setMoveInput() — used here purely to drive the idle/run
     * animation state and facing rotation, not to move anything (the host
     * owns actual position via `worldPosition`, e.g. its own PlayerEntity's
     * `.position`).
     */
    public update(delta: number, worldPosition: THREE.Vector3, moveInputX: number, moveInputZ: number): void {
        this.body.container.position.copy(worldPosition);

        let verticalSpeed = 0;

        if (this.airborneRemaining > 0) {
            this.airborneRemaining = Math.max(0, this.airborneRemaining - delta);
            // Simple up-then-down fake arc: positive half, negative half.
            verticalSpeed = this.airborneRemaining > JUMP_AIRTIME / 2 ? 1 : -1;
        }

        this.body.update(delta, moveInputX, moveInputZ, {
            verticalSpeed,
            grounded: this.airborneRemaining <= 0,
        });
    }

    /** Purely cosmetic — see JUMP_AIRTIME. No actual vertical displacement; the host's own physics (or lack thereof) is untouched. */
    public jump(): void {
        if (this.airborneRemaining > 0) {
            return;
        }

        this.airborneRemaining = JUMP_AIRTIME;
        this.body.animator.animatorBoard?.setTrigger('jump');
    }

    /** Fires an animator-board trigger by name — see PlayerActionController, which uses this for the 'chop'/'mine'/'actionDone' triggers registered in CharacterBody.setUp(). Same underlying mechanism jump() uses, just generalized to any trigger name instead of one hardcoded to jump's own airtime bookkeeping. */
    public playTrigger(trigger: string): void {
        this.body.animator.animatorBoard?.setTrigger(trigger);
    }

    /** Get animation settings to configure playback speed per animation. Example: character.getAnimation('chop').setSpeed(1.5) */
    public getAnimation(id: string) {
        return this.body.animator.getAnimation(id);
    }

    public destroy(): void {
        this.body.destroy();
    }
}
