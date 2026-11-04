// UfoScene.ts
//
// Fly the saucer over the town and eat it. Anything whose middle is under the saucer gets pulled up if it fits (its
// footprint within the saucer's radius) and the saucer flies above it. Each bite grows the saucer, and growing lifts
// it: what stopped it before can be flown over, and eaten once it fits. The town gone: the end screen.
//
// Like the other 3D games, the THREE world sits behind the PIXI overlay (the HUD, and the input catcher: this scene).

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import { Game } from 'core/Game';
import AnalogInput from 'core/io/AnalogInput';
import KeyboardInputMovement from 'core/io/KeyboardInputMovement';
import { DebugOverlay } from 'core/debug/DebugOverlay';
import { ThreeScene } from 'core/scene/ThreeScene';
import { CAMERA, UFO, currentLevel } from '../data/UfoConfig';
import { UfoAudio } from '../audio/UfoAudio';
import { updateBend } from '../services/Bend';
import { Saucer } from '../player/Saucer';
import { UfoHud } from '../ui/UfoHud';
import { Cars } from '../world/Cars';
import { People } from '../world/People';
import { Item, UfoTown } from '../world/UfoTown';

/** The longest step simulated (a hitch doesn't throw the saucer through a wall). */
const MAX_FRAME_SEC = 1 / 20;
/** How long a thing takes to reach the saucer: quick for the small, longer for the tall. */
const FLIGHT = { base: 0.35, perHeight: 0.035 };
const FLIGHT_SPIN = 7;
/** The same "too big" message isn't repeated within this (seconds), nor the thud. */
const SAY_EVERY = 2.5;
const BUMP_EVERY = 0.5;
const SKY = 0x9fd4f2;
/** The portrait camera pulls back so the same width stays in view. */
const REFERENCE_ASPECT = 1.2;
const CAMERA_LOOK_HEIGHT = 0.35;

interface Flying {
    item: Item;
    time: number;
    duration: number;
    from: THREE.Vector3;
    scale: THREE.Vector3;
}

export default class UfoScene extends ThreeScene {
    private town!: UfoTown;
    private cars!: Cars;
    private people!: People;
    private saucer!: Saucer;
    private hud!: UfoHud;
    private keyboard!: KeyboardInputMovement;
    private analog!: AnalogInput;
    private readonly input = new THREE.Vector2();
    private readonly flying: Flying[] = [];
    private readonly focus = new THREE.Vector3();
    private readonly saucerAt = new THREE.Vector3();
    private readonly goal = new THREE.Vector3();
    private distance: number = CAMERA.distance;
    private eaten = 0;
    private finished = false;
    /** Every model's in: "nothing left to eat" now means the town's gone. */
    private loaded = false;
    private sayTimer = 0;
    private bumpTimer = 0;
    private readonly debugPanelId = 'ufo.tuning';
    /** Resolves once the town's models are in. */
    public ready: Promise<void> = Promise.resolve();

    public constructor(game: Game, private readonly onRestart: () => void) {
        super(game);
    }

    public build(): void {
        const level = currentLevel();
        this.threeScene.background = new THREE.Color(SKY);
        this.threeScene.add(new THREE.HemisphereLight(0xffffff, 0x5a7a4a, 1.6));
        const sun = new THREE.DirectionalLight(0xffffff, 1.5);
        sun.position.set(6, 14, 8);
        this.threeScene.add(sun);
        this.threeCamera.fov = CAMERA.fov;
        this.threeCamera.near = 1;
        this.threeCamera.far = 1500;
        this.threeCamera.updateProjectionMatrix();

        this.town = new UfoTown(this.threeScene, level);
        this.cars = new Cars(this.threeScene, level, this.town);
        this.people = new People(this.threeScene, level, this.town, this.cars);
        this.saucer = new Saucer(this.threeScene, level.start.x, level.start.z);
        this.ready = Promise.all([this.town.ready, this.cars.ready, this.people.ready]).then(() => {
            this.loaded = true;
        });
        this.focus.set(level.start.x, 0, level.start.z);
        this.distance = this.cameraDistance();
        this.placeCamera();
        updateBend(this.focus, CAMERA.bend);

        this.hud = new UfoHud(this.onRestart);
        this.game.uiLayer.addChild(this.hud);
        this.buildInput();
        this.buildDebug();
    }

    private buildInput(): void {
        this.eventMode = 'static';
        this.hitArea = new PIXI.Rectangle(-2000, -2000, 6000, 6000);
        const steer = ({ direction, magnitude }: { direction: PIXI.Point; magnitude: number }) => {
            this.input.set(magnitude > 0 ? direction.x * magnitude : 0, magnitude > 0 ? direction.y * magnitude : 0);
        };
        this.keyboard = new KeyboardInputMovement();
        this.keyboard.onMove.add(steer);
        this.analog = new AnalogInput(this);
        this.analog.onMove.add(steer);
    }

    /** With ?dev or ?debug: the numbers to feel out, live (saving them for good is the editor's UFO tab). */
    private buildDebug(): void {
        const panel = DebugOverlay.instance.panel('UFO', { id: this.debugPanelId });
        panel.slider(UFO, 'speed', 2, 30, 0.5, 'Speed');
        panel.slider(UFO, 'growth', 0, 1, 0.01, 'Growth');
        panel.slider(UFO, 'altitudePerRadius', 1, 6, 0.1, 'Altitude per radius');
        panel.slider(CAMERA, 'bend', 0, 0.01, 0.0001, 'World bend');
        panel.slider(CAMERA, 'pitchDeg', 25, 89, 1, 'Camera pitch');
        panel.slider(CAMERA, 'distance', 6, 40, 0.5, 'Camera distance');
        panel.slider(CAMERA, 'perAltitude', 0, 4, 0.1, 'Camera per altitude');
        panel.button('GROW', () => this.saucer.grow(40));
        panel.button('EAT EVERYTHING', () => {
            [...this.town.items].forEach((item) => this.eat(item));
        });
    }

    public update(delta: number): void {
        delta = Math.min(delta, MAX_FRAME_SEC);
        this.saucer.move(this.input, delta, this.town);
        this.saucer.update(delta);
        this.cars.update(delta);
        this.people.update(delta);
        this.sayTimer -= delta;
        this.bumpTimer -= delta;
        this.checkBump();
        this.checkItems();
        this.updateFlying(delta);
        this.updateCamera(delta);
        this.town.culler.update(this.threeCamera);
        this.town.fadeBlocking(this.threeCamera.position, this.saucer.worldPosition(this.saucerAt), delta);
        this.hud.setSize(this.saucer.radius, this.saucer.altitude);
        const left = this.town.items.length + this.flying.length;
        this.hud.setProgress(this.eaten / Math.max(1, this.eaten + left));
        if (!this.finished && this.loaded && this.eaten > 0 && left === 0) {
            this.finished = true;
            UfoAudio.win();
            this.hud.showEnd();
        }
        super.update(delta);
    }

    private say(text: string): void {
        if (this.sayTimer > 0) return;
        this.sayTimer = SAY_EVERY;
        this.hud.say(text);
    }

    private checkBump(): void {
        if (!this.saucer.bumped) return;
        this.say('TOO TALL! GROW TO FLY OVER IT');
        if (this.bumpTimer > 0 || this.input.lengthSq() === 0) return;
        this.bumpTimer = BUMP_EVERY;
        UfoAudio.bump();
    }

    /** What's under the saucer: eaten if it fits and the saucer's above it. */
    private checkItems(): void {
        const { radius, altitude, position } = this.saucer;
        for (let i = this.town.items.length - 1; i >= 0; i--) {
            const item = this.town.items[i];
            if (Math.hypot(item.x - position.x, item.z - position.y) > radius || item.height > altitude) continue;
            if (item.radius <= radius) this.eat(item);
            else this.say('TOO WIDE! GROW TO FIT IT');
        }
    }

    private eat(item: Item): void {
        this.town.take(item);
        this.cars.release(item);
        this.people.release(item);
        const world = item.object.getWorldPosition(new THREE.Vector3());
        // Out of the fade's care, and from now on a thing of its own to scale.
        this.flying.push({
            item, time: 0, duration: FLIGHT.base + FLIGHT.perHeight * item.height,
            from: world, scale: item.object.scale.clone(),
        });
        this.threeScene.attach(item.object);
        this.saucer.beamFlash();
    }

    /** Up into the saucer, spinning and shrinking; the bite counts when it gets there. */
    private updateFlying(delta: number): void {
        const target = this.saucer.worldPosition(this.saucerAt);
        for (let i = this.flying.length - 1; i >= 0; i--) {
            const flight = this.flying[i];
            flight.time += delta;
            const t = Math.min(1, flight.time / flight.duration);
            const pull = t * t;
            const { object } = flight.item;
            object.position.lerpVectors(flight.from, target, pull);
            object.scale.copy(flight.scale).multiplyScalar(Math.max(0.02, 1 - pull * 0.98));
            object.rotation.y += FLIGHT_SPIN * delta;
            this.saucer.beamFlash();
            if (t < 1) continue;
            this.flying.splice(i, 1);
            object.removeFromParent();
            flight.item.materials?.forEach((material) => material.dispose());
            this.eaten++;
            this.saucer.grow(flight.item.value);
            UfoAudio.eat(Math.min(1, flight.item.radius / Math.max(this.saucer.radius, 1e-3)));
        }
    }

    private cameraDistance(): number {
        const portrait = Math.max(1, REFERENCE_ASPECT / this.threeCamera.aspect);
        return (CAMERA.distance + CAMERA.perAltitude * this.saucer.altitude) * portrait;
    }

    private updateCamera(delta: number): void {
        const { x, y: z } = this.saucer.position;
        this.goal.set(x, this.saucer.altitude * CAMERA_LOOK_HEIGHT, z);
        this.focus.lerp(this.goal, 1 - Math.exp(-CAMERA.followSpeed * delta));
        this.distance += (this.cameraDistance() - this.distance) * (1 - Math.exp(-CAMERA.zoomSpeed * delta));
        this.placeCamera();
        updateBend(this.focus, CAMERA.bend);
    }

    private placeCamera(): void {
        const pitch = THREE.MathUtils.degToRad(CAMERA.pitchDeg);
        this.threeCamera.position.set(this.focus.x, this.focus.y + Math.sin(pitch) * this.distance, this.focus.z + Math.cos(pitch) * this.distance);
        this.threeCamera.lookAt(this.focus);
    }

    public resize(): void {
        this.hud?.reposition();
    }

    public destroy(): void {
        DebugOverlay.instance.removePanel(this.debugPanelId);
        this.keyboard?.destroy();
        this.analog?.destroy();
        this.hud?.destroy();
        this.cars?.destroy();
        this.people?.destroy();
        this.town?.destroy();
        this.saucer?.destroy();
        for (const { item } of this.flying) item.materials?.forEach((material) => material.dispose());
        super.destroy();
    }
}
