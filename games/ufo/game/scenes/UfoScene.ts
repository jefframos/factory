// UfoScene.ts
//
// Fly the saucer over the town and eat it. Anything whose middle is under the saucer gets pulled up if it fits (its
// footprint within the saucer's radius) and the saucer flies above it. Each bite grows the saucer, and growing lifts
// it: what stopped it before can be flown over, and eaten once it fits. The level's goal eaten (a level without one:
// everything eaten): the end screen, then the next level, from a small saucer again.
//
// Like the other 3D games, the THREE world sits behind the PIXI overlay (the HUD, and the input catcher: this scene).

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import { Game } from 'core/Game';
import AnalogInput from 'core/io/AnalogInput';
import KeyboardInputMovement from 'core/io/KeyboardInputMovement';
import { DebugOverlay } from 'core/debug/DebugOverlay';
import { ThreeScene } from 'core/scene/ThreeScene';
import { CAMERA, LOOKS, Level, UFO, currentLevel } from '../data/UfoConfig';
import { SpatialAudio } from '../audio/SpatialAudio';
import { UfoAudio } from '../audio/UfoAudio';
import { updateBend } from '../services/Bend';
import { Saucer } from '../player/Saucer';
import { UfoHud } from '../ui/UfoHud';
import { Cars } from '../world/Cars';
import { HomeArrows } from '../world/HomeArrows';
import { People } from '../world/People';
import { Item, UfoTown } from '../world/UfoTown';

/** The longest step simulated (a hitch doesn't throw the saucer through a wall). */
const MAX_FRAME_SEC = 1 / 20;
/** How long a thing takes to reach the saucer: quick for the small, longer for the tall. */
const FLIGHT = { base: 0.22, perHeight: 0.012 };
/** A slurp: how much taller it stretches on the way, and how thin it goes (share of its width left at the top). */
const SLURP = { stretch: 0.9, thin: 0.03 };
const FLIGHT_SPIN = 7;
/** The same "too big" message isn't repeated within this (seconds), nor the thud. */
const SAY_EVERY = 2.5;
const BUMP_EVERY = 0.5;
const SKY = 0x9fd4f2;
/**
 * A portrait screen's camera pulls back, narrower screens more, to keep some width in view: not all of it, or a phone
 * starts far too far out. PORTRAIT_PULL 1 would keep all the width; 0 wouldn't pull back at all.
 */
const REFERENCE_ASPECT = 1.2;
const PORTRAIT_PULL = 0.45;
const CAMERA_LOOK_HEIGHT = 0.35;

interface Flying {
    item: Item;
    time: number;
    duration: number;
    from: THREE.Vector3;
    scale: THREE.Vector3;
}

export default class UfoScene extends ThreeScene {
    private level!: Level;
    private town!: UfoTown;
    private cars!: Cars;
    private people!: People;
    private homeArrows!: HomeArrows;
    private saucer!: Saucer;
    private hud!: UfoHud;
    /** The sea, the parks and the cars, from the first input on (startSound()). */
    private spatial?: SpatialAudio;
    private keyboard!: KeyboardInputMovement;
    private analog!: AnalogInput;
    private readonly input = new THREE.Vector2();
    private readonly flying: Flying[] = [];
    private readonly focus = new THREE.Vector3();
    private readonly saucerAt = new THREE.Vector3();
    private readonly goal = new THREE.Vector3();
    private distance: number = CAMERA.distance;
    /** Where the camera started: the world's curve is `camera.bend` from here. */
    private startDistance: number = CAMERA.distance;
    private eaten = 0;
    private finished = false;
    /** Every model's in: "nothing left to eat" now means the town's gone. */
    private loaded = false;
    /** The level's goal has gone up the beam. */
    private goalEaten = false;
    /** The goal's "you're big enough" has been said. */
    private goalAnnounced = false;
    private sayTimer = 0;
    private bumpTimer = 0;
    private readonly debugPanelId = 'ufo.tuning';
    /** Resolves once the town's models are in. */
    public ready: Promise<void> = Promise.resolve();

    /** `onNextLevel`: the end screen's button. */
    public constructor(game: Game, private readonly onNextLevel: () => void) {
        super(game);
    }

    public build(): void {
        const level = currentLevel();
        this.level = level;
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
        this.homeArrows = new HomeArrows(this.threeScene);
        this.ready = Promise.all([this.town.ready, this.cars.ready, this.people.ready]).then(() => {
            this.loaded = true;
        });
        this.focus.set(level.start.x, 0, level.start.z);
        this.distance = this.startDistance = this.cameraDistance();
        this.placeCamera();
        updateBend(this.focus, CAMERA.bend);

        this.hud = new UfoHud(this.onNextLevel);
        this.game.uiLayer.addChild(this.hud);
        this.buildInput();
        this.buildDebug();
        // After the first level the player has long since done something; browsers only let sound start once they have.
        if (UfoAudio.started()) this.startSound();
        else {
            window.addEventListener('pointerdown', this.startSound, true);
            window.addEventListener('keydown', this.startSound, true);
        }
    }

    /** The soundtrack and the sounds of the place (big downloads, so not before they can be heard). */
    private readonly startSound = (): void => {
        window.removeEventListener('pointerdown', this.startSound, true);
        window.removeEventListener('keydown', this.startSound, true);
        this.spatial ??= new SpatialAudio(this.level);
        UfoAudio.startMusic(this.level);
    };

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
        const choices = (styles: { id: string; name: string }[]) => Object.fromEntries(styles.map((style) => [style.name, style.id]));
        panel.select(LOOKS, 'ufo', choices(LOOKS.ufos), { label: 'UFO style' }).onChange(() => void this.saucer.applyLook());
        panel.select(LOOKS, 'alien', choices(LOOKS.aliens), { label: 'Alien' }).onChange(() => void this.saucer.applyLook());
        panel.slider(UFO, 'speed', 2, 30, 0.5, 'Speed');
        panel.slider(UFO, 'growth', 0, 1, 0.01, 'Growth');
        panel.slider(UFO, 'altitudePerRadius', 1, 6, 0.1, 'Altitude per radius');
        panel.slider(CAMERA, 'bend', 0, 0.01, 0.0001, 'World bend');
        panel.slider(CAMERA, 'pitchDeg', 25, 89, 1, 'Camera pitch');
        panel.slider(CAMERA, 'endPitchDeg', 25, 89, 1, 'Camera pitch, grown');
        panel.slider(CAMERA, 'distance', 6, 40, 0.5, 'Camera distance');
        panel.slider(CAMERA, 'perAltitude', 0, 4, 0.1, 'Camera per altitude');
        panel.slider(CAMERA, 'maxShare', 0.1, 1, 0.01, 'Largest saucer on screen');
        panel.button('GROW', () => this.saucer.grow(40));
        panel.button('NEXT LEVEL', () => this.onNextLevel());
        panel.button('EAT EVERYTHING', () => {
            [...this.town.items].forEach((item) => this.eat(item));
        });
    }

    public update(delta: number): void {
        delta = Math.min(delta, MAX_FRAME_SEC);
        this.saucer.move(this.input, delta, this.town);
        this.saucer.update(delta);
        this.homeArrows.update(delta, this.saucer.position, this.saucer.radius, this.town);
        this.cars.update(delta);
        this.people.update(delta);
        this.spatial?.update(this.saucer.position.x, this.saucer.position.y, this.cars.carSounds());
        this.sayTimer -= delta;
        this.bumpTimer -= delta;
        this.checkBump();
        this.checkItems();
        this.updateFlying(delta);
        this.saucer.setSucking(this.flying.length > 0);
        UfoAudio.setSucking(this.flying.length > 0, this.flying.length, this.saucer.radius);
        UfoAudio.setHum(this.saucer.speedShare, this.saucer.radius);
        this.updateCamera(delta);
        this.town.culler.update(this.threeCamera);
        this.town.fadeBlocking(this.threeCamera.position, this.saucer.worldPosition(this.saucerAt), delta);
        this.hud.setSize(this.saucer.radius, this.saucer.altitude);
        const left = this.town.items.length + this.flying.length;
        const goal = this.level.goal;
        const goalItem = this.town.goalItem;
        // A level with a goal counts up to being big enough for it; any other, what's eaten.
        if (goal && goalItem) this.hud.setProgress(Math.min(1, this.saucer.radius / goal.radius), goal.name.toUpperCase());
        else this.hud.setProgress(this.eaten / Math.max(1, this.eaten + left), 'TOWN');
        if (goal && goalItem && !this.goalAnnounced && this.saucer.radius >= goal.radius) {
            this.goalAnnounced = true;
            this.sayTimer = SAY_EVERY;
            this.hud.say(`BIG ENOUGH! SWALLOW THE ${goal.name.toUpperCase()}!`);
        }
        const done = goalItem ? this.goalEaten : this.loaded && this.eaten > 0 && left === 0;
        if (!this.finished && done) {
            this.finished = true;
            UfoAudio.win();
            this.hud.showEnd(goal && goalItem ? `${goal.name.toUpperCase()} SWALLOWED!` : 'TOWN ABDUCTED!');
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
        this.saucer.warn();
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
            if (Math.hypot(item.x - position.x, item.z - position.y) > radius) continue;
            if (item.height > altitude) {
                this.saucer.warn();
            } else if (item.radius <= radius) {
                this.eat(item);
            } else {
                this.saucer.warn();
                this.say('TOO WIDE! GROW TO FIT IT');
            }
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
    }

    /** Up into the saucer, spinning and shrinking; the bite counts when it gets there. */
    private updateFlying(delta: number): void {
        const target = this.saucer.worldPosition(this.saucerAt);
        for (let i = this.flying.length - 1; i >= 0; i--) {
            const flight = this.flying[i];
            flight.time += delta;
            const t = Math.min(1, flight.time / flight.duration);
            // Slow to come away, then whipped in.
            const pull = t * t * t;
            const { object } = flight.item;
            object.position.lerpVectors(flight.from, target, pull);
            // Drawn out like a noodle: thin at once, long in the middle of the way, gone at the end.
            const thin = Math.max(SLURP.thin, 1 - t * t * (1 - SLURP.thin));
            const long = Math.max(SLURP.thin, (1 + Math.sin(t * Math.PI) * SLURP.stretch) * (1 - pull));
            object.scale.set(flight.scale.x * thin, flight.scale.y * long, flight.scale.z * thin);
            object.rotation.y += FLIGHT_SPIN * delta;
            if (t < 1) continue;
            this.flying.splice(i, 1);
            object.removeFromParent();
            flight.item.materials?.forEach((material) => material.dispose());
            this.eaten++;
            if (flight.item.goal) this.goalEaten = true;
            this.saucer.grow(flight.item.value);
            UfoAudio.eat(Math.min(1, flight.item.radius / Math.max(this.saucer.radius, 1e-3)));
        }
    }

    /** Steeper as the saucer grows: from above, its height over the ground doesn't push it up and off from its beam. */
    private cameraPitch(): number {
        const grown = THREE.MathUtils.smoothstep(this.saucer.radius, UFO.startRadius, CAMERA.endPitchRadius);
        return THREE.MathUtils.degToRad(THREE.MathUtils.lerp(CAMERA.pitchDeg, CAMERA.endPitchDeg, grown));
    }

    /** The usual pull-back, or further if the saucer would fill more than `maxShare` of the screen's narrower side. */
    private cameraDistance(): number {
        const { aspect } = this.threeCamera;
        const { radius, altitude } = this.saucer;
        const portrait = Math.pow(Math.max(1, REFERENCE_ASPECT / aspect), PORTRAIT_PULL);
        const usual = (CAMERA.distance + CAMERA.perAltitude * altitude) * portrait;
        // The saucer's nearer than the focus by its height over it, so that's added back.
        const halfSide = Math.tan(THREE.MathUtils.degToRad(CAMERA.fov / 2)) * Math.min(1, aspect);
        const nearer = altitude * (1 - CAMERA_LOOK_HEIGHT) * Math.sin(this.cameraPitch());
        return Math.max(usual, radius / (CAMERA.maxShare * halfSide) + nearer);
    }

    private updateCamera(delta: number): void {
        const { x, y: z } = this.saucer.position;
        this.goal.set(x, this.saucer.altitude * CAMERA_LOOK_HEIGHT, z);
        this.focus.lerp(this.goal, 1 - Math.exp(-CAMERA.followSpeed * delta));
        this.distance += (this.cameraDistance() - this.distance) * (1 - Math.exp(-CAMERA.zoomSpeed * delta));
        this.placeCamera();
        // Eased off as it pulls back, or the view's wider reach would curve the world harder and harder.
        updateBend(this.focus, CAMERA.bend * Math.min(1, this.startDistance / this.distance));
    }

    private placeCamera(): void {
        const pitch = this.cameraPitch();
        this.threeCamera.position.set(this.focus.x, this.focus.y + Math.sin(pitch) * this.distance, this.focus.z + Math.cos(pitch) * this.distance);
        this.threeCamera.lookAt(this.focus);
    }

    public resize(): void {
        this.hud?.reposition();
    }

    public destroy(): void {
        window.removeEventListener('pointerdown', this.startSound, true);
        window.removeEventListener('keydown', this.startSound, true);
        this.spatial?.destroy();
        UfoAudio.setSucking(false);
        UfoAudio.setHum(0);
        DebugOverlay.instance.removePanel(this.debugPanelId);
        this.keyboard?.destroy();
        this.analog?.destroy();
        this.hud?.destroy();
        this.cars?.destroy();
        this.people?.destroy();
        this.town?.destroy();
        this.saucer?.destroy();
        this.homeArrows?.destroy();
        for (const { item } of this.flying) item.materials?.forEach((material) => material.dispose());
        super.destroy();
    }
}
