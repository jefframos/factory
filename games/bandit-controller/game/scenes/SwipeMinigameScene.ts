// SwipeMinigameScene.ts
//
// The discrete-lane swipe-runner minigame: forward movement is automatic,
// swipe left/right hops one lane over, swipe up jumps, swipe down slides
// (see SwipeRunnerController). Unlike RunnerMinigameScene's fixed finish
// line, this one ends on a plain countdown timer (SWIPE_MINIGAME_SETTINGS.
// durationSec) — simpler than tracking a score/finish condition for a demo,
// and it guarantees every session is the same short length. This scene only
// dispatches onComplete once the timer runs out — index.ts is what actually
// listens and switches back to the hub (see HubScene.ts's own doc on why a
// scene never touches SceneManager directly).
//
// The player stands still (and the countdown doesn't start either) until a
// fresh input arrives (see waitForFirstInput.ts) — SwipeRunnerController
// isn't activate()d until then, so crossing the hub's own entry gate never
// itself carries straight into automatic forward movement.
//
// World bend: uses RunnerBendService instead of the hub's plain BendService
// — a depth-only curve (docs/level-shader.md) rather than BendService's own
// symmetric radial bowl, so the whole track dips uniformly the farther
// ahead it is, regardless of how far to the side. See RunnerBendService.ts's
// own doc for why that distinction matters here specifically. The floor
// itself is also denser and center-focused here (RUNNER_FLOOR_SETTINGS) —
// see FloorBuilder.build()'s own doc on why.
//
// Obstacles (ObstacleBuilder) block every lane but one at each interval —
// the open lane rotates, so which lane to be in keeps changing. Hitting one
// freezes the player in place (movement disabled, velocity zeroed, "hit"
// animation, timer stopped too) for good; the only way out from then on is
// ReturnToHubButton.

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import { Signal } from 'signals';
import { Game } from 'core/Game';
import { ThreeScene } from 'core/scene/ThreeScene';
import { RunnerBendService } from '../services/RunnerBendService';
import { BendService } from '../services/BendService';
import { WorldEnvironment, CameraFollowOptions } from './shared/WorldEnvironment';
import { laneOffset } from '../data/LaneMath';
import { buildObstacle } from '../builders/ObstacleBuilder';
import { buildCityRow } from '../builders/CityBuilder';
import { buildRoadDetails } from '../builders/RoadDetailsBuilder';
import { waitForFirstInput } from '../utils/waitForFirstInput';
import ReturnToHubButton from '../ui/ReturnToHubButton';
import { RUNNER_LANE_DIRECTION, SWIPE_MINIGAME_SETTINGS, RUNNER_FLOOR_SETTINGS, OBSTACLE_SETTINGS } from '../data/MinigameSettings';

const START_POSITION = new THREE.Vector3(0, 0, 0);
/** Fixed to the lane's own centerline rather than swaying with lane-to-lane hops, and frozen in height across a jump — same "center of the gameplay, not the player" reasoning as RunnerMinigameScene's own camera. */
const CAMERA_FOLLOW_OPTIONS: CameraFollowOptions = {
    lockX: START_POSITION.x,
    freezeHeightWhileAirborne: true,
};
const TIMER_MARGIN = 16;
/** Safety margin (world units) kept clear before the floor's own edge — the lane visuals are sized to comfortably fit the full timer duration at running pace, but never past this. */
const FLOOR_EDGE_MARGIN = 20;

export default class SwipeMinigameScene extends ThreeScene {
    /** Fired once, the instant the countdown timer reaches 0. */
    public readonly onComplete: Signal = new Signal();

    private env!: WorldEnvironment;
    private remainingSec = SWIPE_MINIGAME_SETTINGS.durationSec;
    private started = false;
    private finished = false;
    private timerLabel!: PIXI.Text;
    /** Cancels the "waiting for a fresh input" listeners — see waitForFirstInput.ts's own doc on why this needs cancelling if the scene is torn down before that input ever arrives. */
    private cancelWaitForStart?: () => void;
    private returnToHubButton!: ReturnToHubButton;
    /** True once the player has hit an obstacle — frozen for good until they leave via ReturnToHubButton (see this file's own doc). Also stops the countdown, so standing still doesn't quietly run the clock out from under them. */
    private stopped = false;

    public constructor(game: Game) {
        super(game);
    }

    /** Resolves once this build's player character has finished loading — see index.ts's radial-transition orchestration (RadialTransition.reveal() waits on this before playing). */
    public get ready(): Promise<void> {
        return this.env.playerReady;
    }

    public build(): void {
        // this.env doesn't exist yet — RUNNER_FLOOR_SETTINGS.size is exactly what
        // this.env.floorSize will read back as (see WorldEnvironment's own constructor),
        // so this mirrors maxLaneDistance()'s own formula without needing env first.
        const laneHalfWidth = (SWIPE_MINIGAME_SETTINGS.laneCount * SWIPE_MINIGAME_SETTINGS.laneWidth) / 2;
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
        const player = this.env.spawnPlayer(this, START_POSITION, () => SWIPE_MINIGAME_SETTINGS.forwardSpeed);
        this.env.cameraSystem.cutTo('swipe');
        this.env.updateCamera(this.threeCamera, 0, CAMERA_FOLLOW_OPTIONS);

        // Mutually exclusive with PlayerMovementController — both would otherwise fight over
        // the same RigidBody.velocity in the same fixedUpdate() tick (see SwipeRunnerController's
        // own doc). Disabled outright (never re-enabled) — this scene is swipe-lane-or-nothing.
        player.movementController.enabled = false;

        this.buildLaneMarkers();
        this.buildObstacles();
        void this.buildRoadDecor(laneHalfWidth);

        this.remainingSec = SWIPE_MINIGAME_SETTINGS.durationSec;
        this.started = false;
        this.finished = false;
        this.stopped = false;
        this.cancelWaitForStart = waitForFirstInput(() => {
            this.started = true;
            player.swipeRunnerController.activate(RUNNER_LANE_DIRECTION, SWIPE_MINIGAME_SETTINGS.laneCount, SWIPE_MINIGAME_SETTINGS.laneWidth, START_POSITION);
        });
        this.timerLabel = new PIXI.Text('', new PIXI.TextStyle({
            fontSize: 32,
            fontWeight: 'bold',
            fill: 0xffffff,
            stroke: 0x000000,
            strokeThickness: 5,
        }));
        this.timerLabel.anchor.set(0.5, 0);
        this.game.uiLayer.addChild(this.timerLabel);
        this.updateTimerLabel();
        this.repositionTimer();

        this.returnToHubButton = new ReturnToHubButton(this.game, () => this.onComplete.dispatch());
    }

    /**
     * One full-width, differently-colored rectangle per lane, running the
     * length of the corridor — long enough to comfortably cover the full
     * timer duration at running pace (with a margin), clamped so it never
     * runs past the floor's own edge. Each rectangle is subdivided along its
     * length (see FloorBuilder's own doc on this exact issue) — RunnerBendService's
     * bend is a per-vertex displacement, so a plain 1x1 plane only bends at
     * its 4 corners and would warp/sink out of view over a long strip.
     */
    private buildLaneMarkers(): void {
        const length = this.maxLaneDistance();
        const centerZ = START_POSITION.z + RUNNER_LANE_DIRECTION.z * (length / 2);
        const lengthSegments = Math.max(8, Math.ceil(length / 5));

        for (let i = 0; i < SWIPE_MINIGAME_SETTINGS.laneCount; i++) {
            const x = START_POSITION.x + laneOffset(i, SWIPE_MINIGAME_SETTINGS.laneCount, SWIPE_MINIGAME_SETTINGS.laneWidth);
            const color = SWIPE_MINIGAME_SETTINGS.laneColors[i % SWIPE_MINIGAME_SETTINGS.laneColors.length];

            const geometry = new THREE.PlaneGeometry(SWIPE_MINIGAME_SETTINGS.laneWidth, length, 1, lengthSegments);
            const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45 });
            RunnerBendService.applyBend(material);
            const rect = new THREE.Mesh(geometry, material);
            rect.rotation.x = -Math.PI / 2;
            // Tiny lift above the floor (y=0) to avoid z-fighting.
            rect.position.set(x, 0.02, centerZ);
            this.threeScene.add(rect);
        }
    }

    /** How far (world units) the player could possibly get in the full timer duration at running pace, clamped so it never runs past this environment's own floor edge — the length the lane visuals/obstacles both need to cover. */
    private maxLaneDistance(): number {
        const desiredLength = SWIPE_MINIGAME_SETTINGS.forwardSpeed * SWIPE_MINIGAME_SETTINGS.durationSec * 1.2;
        return Math.min(desiredLength, this.env.floorSize / 2 - FLOOR_EDGE_MARGIN);
    }

    /** Blocks every lane but one at each interval down the lane — which lane stays open rotates every interval, so the player has to actually keep swiping rather than settle into one lane. */
    private buildObstacles(): void {
        const count = Math.floor((this.maxLaneDistance() - OBSTACLE_SETTINGS.startOffset) / OBSTACLE_SETTINGS.spacing);

        for (let i = 0; i < count; i++) {
            const distance = OBSTACLE_SETTINGS.startOffset + i * OBSTACLE_SETTINGS.spacing;
            const z = START_POSITION.z + RUNNER_LANE_DIRECTION.z * distance;
            const openLane = i % SWIPE_MINIGAME_SETTINGS.laneCount;

            for (let lane = 0; lane < SWIPE_MINIGAME_SETTINGS.laneCount; lane++) {
                if (lane === openLane) {
                    continue;
                }
                const x = START_POSITION.x + laneOffset(lane, SWIPE_MINIGAME_SETTINGS.laneCount, SWIPE_MINIGAME_SETTINGS.laneWidth);
                buildObstacle(this.env.world, this.threeScene, x, z, OBSTACLE_SETTINGS.halfExtents, RunnerBendService, () => this.onHitObstacle());
            }
        }
    }

    /**
     * Same "buildings + street props only, sidewalk is WorldEnvironment's
     * own recentering rects" shape as RunnerMinigameScene's own
     * buildRoadDecor() — see that file's own doc, including on why
     * buildings specifically use the plain BendService rather than
     * RunnerBendService (its origin is kept in sync in fixedUpdate()
     * below, same reasoning).
     */
    private async buildRoadDecor(laneHalfWidth: number): Promise<void> {
        const laneLength = this.maxLaneDistance();

        await Promise.all([
            buildCityRow(this.threeScene, laneLength, laneHalfWidth, RUNNER_LANE_DIRECTION.z, BendService),
            buildRoadDetails(this.threeScene, laneLength, laneHalfWidth, RUNNER_LANE_DIRECTION.z, RunnerBendService),
        ]);
    }

    private onHitObstacle(): void {
        if (this.stopped) {
            return;
        }
        this.stopped = true;

        const player = this.env.mainPlayer;
        player.swipeRunnerController.deactivate();
        player.rigidBody.velocity.set(0, 0, 0);
        player.character?.hit();
    }

    private updateTimerLabel(): void {
        this.timerLabel.text = Math.ceil(this.remainingSec).toString();
    }

    private repositionTimer(): void {
        const screen = Game.overlayScreenData;
        if (!screen) {
            return;
        }
        this.timerLabel.position.set(screen.center.x, screen.topLeft.y + TIMER_MARGIN);
    }

    public resize(): void {
        this.repositionTimer();
        this.returnToHubButton?.reposition();
    }

    public update(delta: number): void {
        this.env.update(delta);

        if (this.started && !this.finished && !this.stopped) {
            this.remainingSec = Math.max(0, this.remainingSec - delta);
            this.updateTimerLabel();
            if (this.remainingSec <= 0) {
                this.finished = true;
                this.onComplete.dispatch();
            }
        }

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

    public destroy(): void {
        this.cancelWaitForStart?.();
        this.timerLabel?.destroy();
        this.returnToHubButton?.destroy();
        this.env.destroy();
        super.destroy();
    }
}
