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
import { RunnerBendService } from 'core/services/RunnerBendService';
import { BendService } from 'core/services/BendService';
import { buildGateMarker, buildTriggerGate } from '../builders/GateBuilder';
import { buildObstacleKind } from '../builders/ObstacleBuilder';
import { buildCityRow } from '../builders/CityBuilder';
import { buildRoadDetails } from '../builders/RoadDetailsBuilder';
import { waitForFirstInput } from '../utils/waitForFirstInput';
import ReturnToHubButton from '../ui/ReturnToHubButton';
import RestartButton from '../ui/RestartButton';
import { RUNNER_LANE_DIRECTION, RUNNER_MINIGAME_SETTINGS, RUNNER_FLOOR_SETTINGS, OBSTACLE_SETTINGS, OBSTACLE_KINDS, ObstacleKind, maxObstacleHalfWidth, TRAIN_TUNNEL_OVERLAP } from '../data/MinigameSettings';

const START_POSITION = new THREE.Vector3(0, 0, 0);
const CAMERA_FOLLOW_OPTIONS: CameraFollowOptions = {
    lockX: START_POSITION.x,
    freezeHeightWhileAirborne: true,
};

export default class RunnerMinigameScene extends ThreeScene {
    /** Fired once, the instant the player reaches the finish gate. */
    public readonly onComplete: Signal = new Signal();
    /** Fired once, from RestartButton (see onHitObstacle()) — index.ts wires this to a FORCED same-key scene change (see SceneManager.changeScene()'s own doc) so replaying the run rebuilds this scene from scratch rather than going back to the hub first. */
    public readonly onRestart: Signal = new Signal();

    private env!: WorldEnvironment;
    /** Cancels the "waiting for a fresh input" listeners — see waitForFirstInput.ts's own doc on why this needs cancelling if the scene is torn down before that input ever arrives. */
    private cancelWaitForStart?: () => void;
    private returnToHubButton!: ReturnToHubButton;
    /** Only constructed once the player's actually been hit (see onHitObstacle()) — see RestartButton's own doc on why it isn't built up front like returnToHubButton. */
    private restartButton?: RestartButton;
    /** True once the player has hit an obstacle — frozen for good until they leave via ReturnToHubButton or restart (see this file's own doc). Guards the finish gate too, so a stray physics nudge on the same tick as a hit can't still complete the run. */
    private stopped = false;

    public constructor(game: Game) {
        super(game);
    }

    /** Resolves once this build's player character has finished loading — see index.ts's radial-transition orchestration (RadialTransition.reveal() waits on this before playing). */
    public get ready(): Promise<void> {
        return this.env.playerReady;
    }

    public build(): void {
        const laneHalfWidth = OBSTACLE_SETTINGS.runnerLateralOffset + maxObstacleHalfWidth();
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
                    { centerX: -sidewalkCenterX, width: RUNNER_FLOOR_SETTINGS.sidewalkWidth, height: RUNNER_FLOOR_SETTINGS.sidewalkHeight },
                    { centerX: sidewalkCenterX, width: RUNNER_FLOOR_SETTINGS.sidewalkWidth, height: RUNNER_FLOOR_SETTINGS.sidewalkHeight },
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
        buildTriggerGate(this.env.world, this.threeScene, START_POSITION.x, finishZ, () => {
            if (this.stopped) {
                return;
            }
            this.onComplete.dispatch();
        }, RunnerBendService);

        this.returnToHubButton = new ReturnToHubButton(this.game, () => this.onComplete.dispatch());
    }

    /**
     * One obstacle every OBSTACLE_SETTINGS.spacing world units from startOffset to the
     * finish line, alternating left/right of the lane's own centerline so there's always
     * room to steer around the last one before the next (a spansAllLanes kind — TUNNEL —
     * sits centered on the lane instead, since it's not something to steer around at all).
     * Cycles through EVERY registered OBSTACLE_KINDS entry in order (Box, Train, Tunnel,
     * Slide Bar, Stacked, ...), so a full run down the lane shows off each kind at least
     * once — see MinigameSettings.ts to add, remove, or reorder kinds.
     *
     * A TUNNEL directly following a TRAIN is pulled in flush against the train's own far end
     * (see TRAIN_TUNNEL_OVERLAP's own doc) instead of sitting on the normal spacing grid —
     * otherwise there'd be open ground between them the player would just fall back down
     * through before ever reaching the tunnel's own (otherwise unreachable) roof.
     */
    private buildObstacles(): void {
        const count = Math.floor((RUNNER_MINIGAME_SETTINGS.laneLength - OBSTACLE_SETTINGS.startOffset) / OBSTACLE_SETTINGS.spacing);
        let previousKind: ObstacleKind | undefined;
        let previousDistance = 0;

        for (let i = 0; i < count; i++) {
            const kind = OBSTACLE_KINDS[i % OBSTACLE_KINDS.length];

            const distance = kind.id === 'tunnel' && previousKind?.id === 'train'
                ? previousDistance + previousKind.pieces[0].halfExtents.z + kind.pieces[0].halfExtents.z - TRAIN_TUNNEL_OVERLAP
                : OBSTACLE_SETTINGS.startOffset + i * OBSTACLE_SETTINGS.spacing;

            const z = START_POSITION.z + RUNNER_LANE_DIRECTION.z * distance;
            const x = kind.spansAllLanes
                ? START_POSITION.x
                : START_POSITION.x + (i % 2 === 0 ? -1 : 1) * OBSTACLE_SETTINGS.runnerLateralOffset;

            buildObstacleKind(this.env.world, this.threeScene, x, z, kind, RunnerBendService, () => this.onHitObstacle());

            previousKind = kind;
            previousDistance = distance;
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
            buildCityRow(this.threeScene, RUNNER_MINIGAME_SETTINGS.laneLength, laneHalfWidth, RUNNER_LANE_DIRECTION.z, RunnerBendService),
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
        // Backward impulse (see HitKickbackController's own doc) instead of just zeroing
        // velocity — the direction is whichever way the player was actually running, negated.
        player.hitKickbackController.trigger(RUNNER_LANE_DIRECTION.clone().negate());
        player.character?.hit();

        this.restartButton = new RestartButton(this.game, () => this.onRestart.dispatch());
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
        this.restartButton?.reposition();
    }

    public destroy(): void {
        this.cancelWaitForStart?.();
        this.returnToHubButton?.destroy();
        // Only ever constructed on hit (see onHitObstacle()) — undefined on a run that never
        // ended in one, and left as a stale reference across a build()->destroy()->build()
        // restart cycle otherwise (this is the SAME registered scene instance every time —
        // see SceneManager.register()), which is exactly why this cleanup lives in destroy()
        // rather than build(): destroy() runs before EVERY rebuild, restart included.
        this.restartButton?.destroy();
        this.restartButton = undefined;
        this.env.destroy();
        super.destroy();
    }
}
