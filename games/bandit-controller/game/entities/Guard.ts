// Guard.ts
//
// A patrolling guard: the player's rig in a reserved navy uniform, walking a repeating route and carrying a
// translucent view cone on the floor. Movement is a pure function of the time fed to advance(), so a
// level is a deterministic puzzle. The cone is clipped by walls (see LevelSight).

import * as THREE from 'three';
import ThirdPersonCharacter from './ThirdPersonCharacter';
import { TextureBuilder } from '../builders/TextureBuilder';
import MODELS from '../../registry/assetsRegistry/modelsRegistry';
import { GUARD_CHARACTER_VIEW, resolveSkinImagePath } from '../data/CharacterViews';
import type { LevelGuard } from '../data/LevelData';
import type { LevelSight } from '../utils/LevelSight';
import { WorldBendService } from 'core/services/BendService';

const CHARACTER_SCALE = 0.0075;
const TURN_RATE = THREE.MathUtils.degToRad(280);
const SWEEP_PERIOD_SEC = 3;
const CONE_RAYS = 28;
const CONE_Y = 0.045;
const CALM_COLOR = new THREE.Color(0xffe066);
const ALERT_COLOR = new THREE.Color(0xff2d2d);
const WALK_INPUT = 0.5;
const ALERT_ICON_THRESHOLD = 0.5;
const ICON_HEIGHT = 2.5;
const ANGRY_ANIMATION_URL = './bandit-controller/models/animations/Talking.glb';
const TOUCH_RADIUS = 1.0;
const CLOSE_FRONT_RADIUS = 2.2;
const FOCUS_HOLD_SEC = 1.6;
const CHASE_SPEED = 5.5;
const CHASE_STOP_DISTANCE = 1.15;
const modelUrl = (fullPath: string): string => `./${fullPath}`;

type GuardMode = 'wait' | 'move';

export default class Guard {
    public readonly position = new THREE.Vector3();
    /** 0..1 — how close the player is to being busted by this guard. */
    public alert = 0;

    private readonly path: THREE.Vector3[];
    private readonly coneHalfAngle: number;
    private readonly coneGeometry: THREE.BufferGeometry;
    private readonly coneMaterial: THREE.MeshBasicMaterial;
    private readonly cone: THREE.Mesh;
    private readonly routeLine?: THREE.Line;
    private readonly routeMarkers: THREE.Mesh[] = [];
    private character?: ThirdPersonCharacter;
    private readonly icon: THREE.Sprite;
    private readonly iconTextures: Record<'?' | '!', THREE.CanvasTexture>;
    private iconShown: '?' | '!' | null = null;
    private destroyed = false;

    private heading: number;
    private baseHeading: number;
    private mode: GuardMode = 'wait';
    private waitTime = 0;
    private targetIndex: number;
    private direction = 1;
    private moving = false;
    private running = false;
    private angry = false;
    private focusPoint?: THREE.Vector3;
    private focusTime = 0;

    public constructor(
        private readonly threeScene: THREE.Scene,
        private readonly data: LevelGuard,
        private readonly sight: LevelSight,
        private readonly bendService: WorldBendService,
    ) {
        this.path = data.path.map((point) => new THREE.Vector3(point.x, 0, point.z));
        this.position.copy(this.path[0]);
        this.coneHalfAngle = THREE.MathUtils.degToRad(data.fov) / 2;
        this.targetIndex = this.path.length > 1 ? 1 : 0;
        this.heading = this.path.length > 1
            ? Math.atan2(this.path[1].x - this.path[0].x, this.path[1].z - this.path[0].z)
            : THREE.MathUtils.degToRad(data.facing);
        this.baseHeading = this.heading;

        this.coneGeometry = new THREE.BufferGeometry();
        this.coneGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((CONE_RAYS + 2) * 3), 3));
        const indices: number[] = [];
        for (let i = 0; i < CONE_RAYS; i++) {
            indices.push(0, i + 1, i + 2);
        }
        this.coneGeometry.setIndex(indices);
        this.coneMaterial = new THREE.MeshBasicMaterial({
            color: CALM_COLOR.clone(),
            transparent: true,
            opacity: 0.38,
            depthWrite: false,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
        });
        this.bendService.applyBend(this.coneMaterial);
        this.cone = new THREE.Mesh(this.coneGeometry, this.coneMaterial);
        this.cone.frustumCulled = false;
        this.cone.renderOrder = 2;
        this.threeScene.add(this.cone);

        if (this.path.length > 1) {
            const points = this.path.map((point) => new THREE.Vector3(point.x, 0.03, point.z));
            if (data.loop) {
                points.push(points[0].clone());
            }
            const lineMaterial = new THREE.LineBasicMaterial({ color: GUARD_CHARACTER_VIEW.color, transparent: true, opacity: 0.55 });
            this.bendService.applyBend(lineMaterial);
            this.routeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial);
            this.routeLine.frustumCulled = false;
            this.threeScene.add(this.routeLine);
            for (const point of this.path) {
                const markerMaterial = new THREE.MeshBasicMaterial({ color: GUARD_CHARACTER_VIEW.color, transparent: true, opacity: 0.6 });
                this.bendService.applyBend(markerMaterial);
                const marker = new THREE.Mesh(new THREE.CircleGeometry(0.18, 16), markerMaterial);
                marker.rotation.x = -Math.PI / 2;
                marker.position.set(point.x, 0.035, point.z);
                this.threeScene.add(marker);
                this.routeMarkers.push(marker);
            }
        }
        this.iconTextures = { '?': Guard.makeIconTexture('?', '#ffd33d'), '!': Guard.makeIconTexture('!', '#ff3b3b') };
        this.icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.iconTextures['?'], depthTest: false, transparent: true }));
        this.icon.scale.set(0.9, 0.9, 1);
        this.icon.renderOrder = 10;
        this.icon.visible = false;
        this.threeScene.add(this.icon);
        this.rebuildCone();
    }

    private static makeIconTexture(symbol: string, color: string): THREE.CanvasTexture {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 128;
        const ctx = canvas.getContext('2d')!;
        ctx.font = 'bold 120px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 14;
        ctx.strokeStyle = '#1a1a1a';
        ctx.strokeText(symbol, 64, 70);
        ctx.fillStyle = color;
        ctx.fillText(symbol, 64, 70);
        return new THREE.CanvasTexture(canvas);
    }

    /** Standing still (patrol frozen) — keeps the rig from playing the walk cycle in place. */
    public hold(): void {
        this.moving = false;
    }

    public async load(): Promise<void> {
        const character = new ThirdPersonCharacter(this.bendService);
        await character.loadMesh(modelUrl(MODELS.Characters.CharacterMedium.fullPath));
        await character.registerAnimation('idle', modelUrl(MODELS.Characters.Idle.fullPath));
        await character.registerAnimation('walk', modelUrl(MODELS.Characters.Walking.fullPath));
        await character.registerAnimation('run', modelUrl(MODELS.Characters.Running.fullPath));
        character.setUp();
        await character.registerAnimation('angry', ANGRY_ANIMATION_URL);
        const view = GUARD_CHARACTER_VIEW;
        const faceTexture = await TextureBuilder.load(resolveSkinImagePath(view.face));
        character.applyCharacterView(view.color, faceTexture);
        character.container.scale.setScalar(CHARACTER_SCALE);
        if (this.destroyed) {
            character.destroy();
            return;
        }
        this.threeScene.add(character.container);
        this.character = character;
        character.container.position.copy(this.position);
        character.faceDirection(Math.sin(this.heading), Math.cos(this.heading));
    }

    public setConeVisible(visible: boolean): void {
        this.cone.visible = visible;
        if (this.routeLine) {
            this.routeLine.visible = visible;
        }
        this.routeMarkers.forEach((marker) => (marker.visible = visible));
    }

    /** Busted sequence: sprints at `target` and stops next to it. Returns true once arrived. */
    public chase(target: THREE.Vector3, delta: number): boolean {
        const dx = target.x - this.position.x;
        const dz = target.z - this.position.z;
        const distance = Math.hypot(dx, dz);
        this.heading = Math.atan2(dx, dz);
        if (distance <= CHASE_STOP_DISTANCE) {
            this.moving = false;
            return true;
        }
        const step = Math.min(CHASE_SPEED * delta, distance - CHASE_STOP_DISTANCE);
        this.position.x += (dx / distance) * step;
        this.position.z += (dz / distance) * step;
        this.moving = true;
        this.running = true;
        return false;
    }

    public playAngry(): void {
        this.moving = false;
        this.running = false;
        this.angry = true;
        this.character?.animator.playExclusive('angry', 0.25, true);
    }

    public faceToward(target: THREE.Vector3): void {
        this.heading = Math.atan2(target.x - this.position.x, target.z - this.position.z);
    }

    /** Moves the patrol forward by `delta` seconds. Only call while the level clock is running. */
    public advance(delta: number): void {
        this.moving = false;
        if (this.focusPoint && this.focusTime > 0) {
            this.focusTime -= delta;
            this.turnToward(Math.atan2(this.focusPoint.x - this.position.x, this.focusPoint.z - this.position.z), delta);
            return;
        }
        if (this.mode === 'wait') {
            this.waitTime += delta;
            const sweepOffset = THREE.MathUtils.degToRad(this.data.sweep) * Math.sin((this.waitTime * Math.PI * 2) / SWEEP_PERIOD_SEC);
            this.turnToward(this.baseHeading + sweepOffset, delta);
            if (this.path.length > 1 && this.waitTime >= this.data.pause) {
                this.mode = 'move';
            }
            return;
        }

        const target = this.path[this.targetIndex];
        const dx = target.x - this.position.x;
        const dz = target.z - this.position.z;
        const distance = Math.hypot(dx, dz);
        const step = this.data.speed * delta;
        this.turnToward(Math.atan2(dx, dz), delta);
        if (distance <= step) {
            this.position.copy(target);
            this.baseHeading = this.heading;
            this.mode = 'wait';
            this.waitTime = 0;
            this.targetIndex = this.nextIndex();
            return;
        }
        this.moving = true;
        this.position.x += (dx / distance) * step;
        this.position.z += (dz / distance) * step;
    }

    /** Per-frame visuals (rig, cone) — runs even while the patrol is frozen. */
    public render(delta: number): void {
        if (this.character) {
            const dirX = Math.sin(this.heading);
            const dirZ = Math.cos(this.heading);
            this.character.faceDirection(dirX, dirZ);
            const input = this.moving ? (this.running ? 1 : WALK_INPUT) : 0;
            this.character.update(delta, this.position, dirX * input, dirZ * input, { grounded: true });
        }
        const wanted: '?' | '!' | null = this.alert <= 0.01 ? null : this.alert < ALERT_ICON_THRESHOLD ? '?' : '!';
        if (wanted !== this.iconShown) {
            this.iconShown = wanted;
            this.icon.visible = wanted !== null;
            if (wanted) {
                this.icon.material.map = this.iconTextures[wanted];
                this.icon.material.needsUpdate = true;
            }
        }
        const bob = Math.sin(performance.now() / 120) * 0.06;
        this.icon.position.set(this.position.x, ICON_HEIGHT + bob, this.position.z);
        this.coneMaterial.color.copy(CALM_COLOR).lerp(ALERT_COLOR, this.alert);
        this.coneMaterial.opacity = 0.34 + this.alert * 0.3;
        this.rebuildCone();
    }

    /** Locks the guard's gaze (and pauses its patrol) on where the player was last noticed. */
    public focusOn(point: THREE.Vector3): void {
        (this.focusPoint ??= new THREE.Vector3()).copy(point);
        this.focusTime = FOCUS_HOLD_SEC;
    }

    /** True when the target is close enough to be noticed immediately: touching, or right in front. */
    public isTooClose(target: THREE.Vector3): boolean {
        const dx = target.x - this.position.x;
        const dz = target.z - this.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance <= TOUCH_RADIUS) {
            return true;
        }
        if (distance > CLOSE_FRONT_RADIUS) {
            return false;
        }
        const offset = Math.abs(THREE.MathUtils.euclideanModulo(Math.atan2(dx, dz) - this.heading + Math.PI, Math.PI * 2) - Math.PI);
        return offset <= this.coneHalfAngle && this.sight.hasLineOfSight(this.position.x, this.position.z, target.x, target.z);
    }

    /** True when `target` is inside the cone with a clear line of sight. */
    public sees(target: THREE.Vector3): boolean {
        const dx = target.x - this.position.x;
        const dz = target.z - this.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance > this.data.range) {
            return false;
        }
        if (distance > 0.05) {
            const offset = Math.abs(THREE.MathUtils.euclideanModulo(Math.atan2(dx, dz) - this.heading + Math.PI, Math.PI * 2) - Math.PI);
            if (offset > this.coneHalfAngle) {
                return false;
            }
        }
        return this.sight.hasLineOfSight(this.position.x, this.position.z, target.x, target.z);
    }

    public destroy(): void {
        this.destroyed = true;
        this.character?.destroy();
        this.character = undefined;
        this.threeScene.remove(this.cone);
        this.threeScene.remove(this.icon);
        this.icon.material.dispose();
        this.iconTextures['?'].dispose();
        this.iconTextures['!'].dispose();
        this.coneGeometry.dispose();
        this.coneMaterial.dispose();
        if (this.routeLine) {
            this.threeScene.remove(this.routeLine);
            this.routeLine.geometry.dispose();
            (this.routeLine.material as THREE.Material).dispose();
        }
        for (const marker of this.routeMarkers) {
            this.threeScene.remove(marker);
            marker.geometry.dispose();
            (marker.material as THREE.Material).dispose();
        }
        this.routeMarkers.length = 0;
    }

    private nextIndex(): number {
        const count = this.path.length;
        if (count <= 1) {
            return 0;
        }
        if (this.data.loop) {
            return (this.targetIndex + 1) % count;
        }
        let next = this.targetIndex + this.direction;
        if (next >= count || next < 0) {
            this.direction = -this.direction;
            next = this.targetIndex + this.direction;
        }
        return next;
    }

    private turnToward(target: number, delta: number): void {
        const difference = THREE.MathUtils.euclideanModulo(target - this.heading + Math.PI, Math.PI * 2) - Math.PI;
        const maxStep = TURN_RATE * delta;
        this.heading += THREE.MathUtils.clamp(difference, -maxStep, maxStep);
    }

    private rebuildCone(): void {
        const positions = this.coneGeometry.getAttribute('position') as THREE.BufferAttribute;
        positions.setXYZ(0, this.position.x, CONE_Y, this.position.z);
        for (let i = 0; i <= CONE_RAYS; i++) {
            const angle = this.heading - this.coneHalfAngle + (this.coneHalfAngle * 2 * i) / CONE_RAYS;
            const dx = Math.sin(angle);
            const dz = Math.cos(angle);
            const length = this.sight.castRay(this.position.x, this.position.z, dx, dz, this.data.range);
            positions.setXYZ(i + 1, this.position.x + dx * length, CONE_Y, this.position.z + dz * length);
        }
        positions.needsUpdate = true;
    }
}
