// RunnerMinigameScene.ts
//
// The continuous-runner minigame: forward movement is automatic along a
// fixed world direction, sideways steering follows the pointer/finger
// position on screen (see PlayerMovementController.enterRunnerMode()).
// Reaching the finish gate ends the minigame; this scene only dispatches
// onComplete — index.ts is what actually listens and switches back to the
// hub (see HubScene.ts's own doc on why a scene never touches SceneManager
// directly).
//
// Camera: fixed to the lane's own centerline (CAMERA_FOLLOW_OPTIONS.lockX)
// rather than swaying with the player's lateral pointer-follow steering —
// "the center of the gameplay," not the player — and its height only
// tracks the player while grounded, freezing at the last grounded height
// for the duration of a jump so a hop doesn't bob the camera (see
// WorldEnvironment.CameraFollowOptions' own doc).
//
// The player stands still at the start line until a fresh input arrives
// (see waitForFirstInput.ts) — runner mode isn't entered until then, so
// crossing the hub's own entry gate never itself carries straight into
// automatic forward movement.
//
// World bend: uses RunnerBendService instead of the hub's plain BendService
// — a depth-only curve (docs/level-shader.md) rather than BendService's own
// symmetric radial bowl, so the whole track dips uniformly the farther
// ahead it is, regardless of how far to the side. See RunnerBendService.ts's
// own doc for why that distinction matters here specifically. The floor
// itself is also denser and center-focused here (RUNNER_FLOOR_SETTINGS) —
// see FloorBuilder.build()'s own doc on why: RunnerBendService's wave needs
// enough nearby vertices to actually look smooth where the player is.
//
// Obstacles (ObstacleBuilder) alternate side to side down the lane — hitting
// one freezes the player in place (movement disabled, velocity zeroed,
// "hit" animation) for good; the only way out from then on is
// ReturnToHubButton, same as this scene's own doc on why that button exists.

import * as THREE from 'three';
import { Signal } from 'signals';
import { Game } from 'core/Game';
import { ThreeScene } from 'core/scene/ThreeScene';
import { WorldEnvironment, CameraFollowOptions } from './shared/WorldEnvironment';
import { RunnerBendService } from '../services/RunnerBendService';
import { BendService } from '../services/BendService';
import { buildGateMarker, buildTriggerGate } from '../builders/GateBuilder';
import { buildObstacle } from '../builders/ObstacleBuilder';
import { buildCityRow } from '../builders/CityBuilder';
import { buildRoadDetails } from '../builders/RoadDetailsBuilder';
import { waitForFirstInput } from '../utils/waitForFirstInput';
import ReturnToHubButton from '../ui/ReturnToHubButton';
import { RUNNER_LANE_DIRECTION, RUNNER_MINIGAME_SETTINGS, RUNNER_FLOOR_SETTINGS, OBSTACLE_SETTINGS } from '../data/MinigameSettings';

const START_POSITION = new THREE.Vector3(0, 0, 0);
const CAMERA_FOLLOW_OPTIONS: CameraFollowOptions = {
    lockX: START_POSITION.x,
    freezeHeightWhileAirborne: true,
};

export default class RunnerMinigameScene extends ThreeScene {
    /** Fired once, the instant the player reaches the finish gate. */
    public readonly onComplete: Signal = new Signal();

    private env!: WorldEnvironment;
    /** Cancels the "waiting for a fresh input" listeners — see waitForFirstInput.ts's own doc on why this needs cancelling if the scene is torn down before that input ever arrives. */
    private cancelWaitForStart?: () => void;
    private returnToHubButton!: ReturnToHubButton;
    /** True once the player has hit an obstacle — frozen for good until they leave via ReturnToHubButton (see this file's own doc). Guards the finish gate too, so a stray physics nudge on the same tick as a hit can't still complete the run. */
    private stopped = false;

    public constructor(game: Game) {
        super(game);
    }

    /** Resolves once this build's player character has finished loading — see index.ts's radial-transition orchestration (RadialTransition.reveal() waits on this before playing). */
    public get ready(): Promise<void> {
        return this.env.playerReady;
    }

    public build(): void {
        const laneHalfWidth = OBSTACLE_SETTINGS.runnerLateralOffset + OBSTACLE_SETTINGS.halfExtents.x;
        const sidewalkCenterX = laneHalfWidth + RUNNER_FLOOR_SETTINGS.sidewalkOffset + RUNNER_FLOOR_SETTINGS.sidewalkWidth / 2;

        this.env = new WorldEnvironment(
            this.threeScene,
            RunnerBendService,
            RUNNER_FLOOR_SETTINGS.size,
            undefined,
            undefined,
            {
                size: RUNNER_FLOOR_SETTINGS.patchSize,
                segments: RUNNER_FLOOR_SETTINGS.patchSegments,
                sidewalks: [
                    { centerX: -sidewalkCenterX, width: RUNNER_FLOOR_SETTINGS.sidewalkWidth },
                    { centerX: sidewalkCenterX, width: RUNNER_FLOOR_SETTINGS.sidewalkWidth },
                ],
            },
        );
        const player = this.env.spawnPlayer(this, START_POSITION, () => RUNNER_MINIGAME_SETTINGS.forwardSpeed);
        this.env.cameraSystem.cutTo('runner');
        this.env.updateCamera(this.threeCamera, 0, CAMERA_FOLLOW_OPTIONS);

        this.stopped = false;

        // Stand still at the start line — no free movement here either, this scene is
        // runner-mode-or-nothing — until a fresh press/tap actually starts the run.
        player.movementController.enabled = false;
        this.cancelWaitForStart = waitForFirstInput(() => {
            player.movementController.enabled = true;
            player.movementController.enterRunnerMode(RUNNER_LANE_DIRECTION);
        });

        this.buildObstacles();
        void this.buildRoadDecor(laneHalfWidth);

        const finishZ = START_POSITION.z + RUNNER_LANE_DIRECTION.z * RUNNER_MINIGAME_SETTINGS.laneLength;
        buildGateMarker(this.threeScene, START_POSITION.x, finishZ, 0xff8844, RunnerBendService);
        buildTriggerGate(this.env.world, START_POSITION.x, finishZ, () => {
            if (this.stopped) {
                return;
            }
            this.onComplete.dispatch();
        });

        this.returnToHubButton = new ReturnToHubButton(this.game, () => this.onComplete.dispatch());
    }

    /** One obstacle every OBSTACLE_SETTINGS.spacing world units from startOffset to the finish line, alternating left/right of the lane's own centerline so there's always room to steer around the last one before the next. */
    private buildObstacles(): void {
        const count = Math.floor((RUNNER_MINIGAME_SETTINGS.laneLength - OBSTACLE_SETTINGS.startOffset) / OBSTACLE_SETTINGS.spacing);

        for (let i = 0; i < count; i++) {
            const distance = OBSTACLE_SETTINGS.startOffset + i * OBSTACLE_SETTINGS.spacing;
            const z = START_POSITION.z + RUNNER_LANE_DIRECTION.z * distance;
            const x = START_POSITION.x + (i % 2 === 0 ? -1 : 1) * OBSTACLE_SETTINGS.runnerLateralOffset;

            buildObstacle(this.env.world, this.threeScene, x, z, OBSTACLE_SETTINGS.halfExtents, RunnerBendService, () => this.onHitObstacle());
        }
    }

    /**
     * Fires the buildings and street-prop rows at once — the sidewalk
     * itself is no longer a builder call, it's the flat recentering rects
     * WorldEnvironment already built in build() (see VisualFloorPatch.
     * sidewalks' own doc). Fire-and-forget from build(): none of this
     * blocks the scene's own `ready`.
     *
     * Buildings use the plain BendService, NOT RunnerBendService, unlike
     * everything else here — RunnerBendService's X curve is keyed to each
     * vertex's own absolute world Z (see that file's own doc), so a tall
     * building whose front and back walls sit at noticeably different Z
     * values gets each wall shifted sideways by a different amount,
     * reading as the whole building shearing/waving. BendService only
     * drops world-Y by a gentle radial falloff — no lateral shift at all —
     * so buildings just translate rigidly instead of visibly deforming
     * (see fixedUpdate(), which keeps its own origin in sync since
     * WorldEnvironment only updates ITS OWN configured bendService).
     */
    private async buildRoadDecor(laneHalfWidth: number): Promise<void> {
        await Promise.all([
            buildCityRow(this.threeScene, RUNNER_MINIGAME_SETTINGS.laneLength, laneHalfWidth, RUNNER_LANE_DIRECTION.z, BendService),
            buildRoadDetails(this.threeScene, RUNNER_MINIGAME_SETTINGS.laneLength, laneHalfWidth, RUNNER_LANE_DIRECTION.z, RunnerBendService),
        ]);
    }

    private onHitObstacle(): void {
        if (this.stopped) {
            return;
        }
        this.stopped = true;

        const player = this.env.mainPlayer;
        player.movementController.enabled = false;
        player.rigidBody.velocity.set(0, 0, 0);
        player.character?.hit();
    }

    public update(delta: number): void {
        this.env.update(delta);
        super.update(delta);
    }

    public fixedUpdate(delta: number): void {
        this.env.fixedUpdate(delta);
        // WorldEnvironment.fixedUpdate() only advances its OWN configured bendService
        // (RunnerBendService here) — buildings use the plain BendService instead (see
        // buildRoadDecor()'s own doc), so it needs its own origin kept in sync too.
        BendService.updateOrigin(this.env.mainPlayer.transform.position);
        this.env.updateCamera(this.threeCamera, delta, CAMERA_FOLLOW_OPTIONS);
    }

    public resize(): void {
        this.returnToHubButton?.reposition();
    }

    public destroy(): void {
        this.cancelWaitForStart?.();
        this.returnToHubButton?.destroy();
        this.env.destroy();
        super.destroy();
    }
}
