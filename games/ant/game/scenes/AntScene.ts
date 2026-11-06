// AntScene.ts
//
// Ant's one scene: the board seen from above, laid out like the reference (Layout.ts): the picture (PictureView) on its
// tray across the top, the anthill with its wooden lid under it, the SLOT_COUNT slots, then the tile columns
// (TileRack). Tapping a column's front tile slides it onto a free slot; from there its ants (AntSwarm), one per number
// on the tile, set off one after another, each to a pixel of the tile's colour that's exposed (Board: on the picture's
// outline, or next to one already taken), carry it back and drop it down the anthill. A tile whose colour has nothing
// exposed just waits in its slot — that's the puzzle: with every slot waiting on a colour the ants can't reach yet, the
// level is lost; with the picture gone, it's won (AntHud.celebrate).
//
// Ants walk in straight lines, turning at right angles: up from their slot to the tray's rim, along the rim (round its
// corners) to the side nearest their pixel, then in through the cells already eaten. Home, it's the reverse: out to the
// nearest border (straight down when the way down is clear), along the rim to its bottom, straight down to just above
// the anthill, across and in. They always go round the anthill and its lid on the way out.
//
// The deck — the tiles, their order, how many columns — is baked into the level (tools/solver.mjs, which also checks
// it can be cleared), so a level always plays the same; an old level file without one is dealt here (Board.dealDeck).
// An ant goes for the exposed pixel of its colour nearest its slot (no dice: the solver plays it the same way).
// The extra-slot power-up (AntHud, once a level) adds a sixth slot — also offered when a level is lost, to play on.
// The first time, the first level is a tutorial: the screen darkens all but the next tile to tap (in the dealt order,
// which always clears it), the hand points at it, and only it can be tapped.

import * as THREE from 'three';
import { Game } from 'core/Game';
import { ThreeScene } from 'core/scene/ThreeScene';
import SetupThree from 'core/scene/SetupThree';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Board, dealDeck, hashString } from '../data/Board';
import { LEVELS, LevelData, pixelsOf, deckOf } from '../data/Levels';
import { AntSave } from '../data/AntSave';
import { Background, FREE_DROP_CHANCE, currentBackground, levelReward, levelTier } from '../data/Shop';
import { BOOSTERS } from '../ui/BoosterBelt';
import { TUNING } from '../data/Tuning';
import { DebugOverlay } from 'core/debug/DebugOverlay';
import { PictureView, TRAY_TOP } from '../world/PictureView';
import { AntSwarm, Ant } from '../world/AntSwarm';
import { TileRack, RackTile, SLOT_COUNT } from '../world/TileRack';
import { LAYOUT } from '../world/Layout';
import { vivid } from '../world/Vivid';
import { AntHud } from '../ui/AntHud';
import { AntAudio } from '../audio/AntAudio';
import { RadialTransition } from '../ui/RadialTransition';

/** The floor's colour past its checker (the background in use's light colour; the page's own peach is index.html's). */
export const floorColor = (): THREE.Color => new THREE.Color(currentBackground().light);
/** Columns for an old level file without its own. */
const DEFAULT_COLUMNS = 4;
/** The tutorial: how long it waits after a tap before pointing at the next tile, how big its hole is (x a tile), and
 *  what it says. */
const TUTORIAL = {
    wait: 0.9, hole: 0.85,
    first: 'Tap the tile!\nIts ants fetch pixels of its colour.', next: 'Now this one!', last: 'The last one!',
};
/** The block an ant carries is a whole pixel's (as it was). The ants themselves are the same size in every level
 *  (TUNING.antSize). */
const CARRIED = 1;
/** Camera: field of view, tilt from straight down, and how far below the screen's middle it looks (a tilted view
 *  squeezes the far end and stretches the near one: aiming lower keeps the board where the reference has it). */
const FOV = 26;
const TILT_DEG = 24;
const AIM_LOWER = 2.2;

/** A tile in a slot: its ants still to send, and when the next leaves. */
interface SlotState {
    tile: RackTile;
    color: number;
    left: number;
    timer: number;
}

/** The floor: the reference's soft peach checker, turned 45° into diamonds. */
export function floorTexture(background: Background = currentBackground()): THREE.CanvasTexture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d')!;
    g.fillStyle = `#${background.dark.toString(16).padStart(6, '0')}`;
    g.fillRect(0, 0, size, size);
    g.fillStyle = `#${background.light.toString(16).padStart(6, '0')}`;
    g.fillRect(0, 0, size / 2, size / 2);
    g.fillRect(size / 2, size / 2, size / 2, size / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(70, 70);
    texture.rotation = Math.PI / 4;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 4;
    return texture;
}

export default class AntScene extends ThreeScene {
    private hud!: AntHud;
    private levelIndex = 0;
    private level!: LevelData;
    private board!: Board;
    private picture?: PictureView;
    private rack?: TileRack;
    private swarm?: AntSwarm;
    private readonly hole = new THREE.Group();
    private readonly slots: (SlotState | null)[] = [];
    private readonly palette: THREE.Color[] = [];
    private ended = false;
    /** What the debug panel's level dropdown shows. */
    private readonly debug = { level: 0 };
    private readonly raycaster = new THREE.Raycaster();
    private readonly pointer = new THREE.Vector2();
    /** The lane round the picture on its rim (world x / z of its sides), where ants walk. */
    private readonly lane = { left: 0, right: 0, top: 0, bottom: 0 };

    /** The pause popup is up: the game's time stands still (Game.timeScale 0) — this is what it was before. */
    private paused = false;
    private travelling = false;
    /** A power-up used this level (no free drop then). */
    private boosterUsed = false;
    /** The tutorial under way: tiles tapped so far, of how many, in how many columns; time to the next pointer. */
    private tutorial: { taps: number; tiles: number; columns: number; wait: number } | null = null;
    private resumeScale = 1;

    /** `onHome`: the pause popup's HOME. */
    public constructor(game: Game, private readonly onHome: () => void = () => undefined) {
        super(game);
    }

    public build(): void {
        this.threeScene.background = floorColor();
        // A soft studio light to reflect: what gives the jelly cubes and tiles their shine.
        const pmrem = new THREE.PMREMGenerator(SetupThree.renderer);
        this.threeScene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        this.threeScene.environmentIntensity = 0.2;
        pmrem.dispose();
        // A soft white sky and a light warm ground (a brown one muddied the colours), a strong sun: colours stay vivid.
        this.threeScene.add(new THREE.HemisphereLight(0xffffff, 0xe6cdb8, 0.85));
        const sun = new THREE.DirectionalLight(0xffffff, 0.95);
        sun.position.set(5, 30, 18);
        this.threeScene.add(sun);
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 1 }));
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(0, -0.02, LAYOUT.screen.centreZ);
        this.threeScene.add(floor);
        this.buildHole();
        this.threeCamera.fov = FOV;
        this.hud = new AntHud(() => this.openPause(), () => this.addExtraSlot());
        this.game.uiLayer.addChild(this.hud);
        window.addEventListener('pointerdown', this.onPointerDown);
        window.addEventListener('resize', this.onWindowResize);
        this.loadLevel(Math.min(AntSave.selected, LEVELS.length - 1));
        this.buildDebug();
    }

    /**
     * The debug panel (dev server, or ?dev=1): pick any level, win it at once, restart; ant speed and release spacing
     * live; what's left of the picture and how many ants are out.
     */
    private buildDebug(): void {
        const panel = DebugOverlay.instance.panel('Ant', { id: 'ant.debug' });
        const choices: Record<string, number> = {};
        LEVELS.forEach((level, i) => (choices[`${i + 1} · ${level.name} (${level.width}x${level.height})`] = i));
        panel.select(this.debug, 'level', choices, {
            label: 'Level', style: 'dropdown', persist: false,
            onChange: (index) => {
                AntSave.level = index;
                this.loadLevel(index);
            },
        });
        panel.number(TUNING, 'antSize', { label: 'Ant size', min: 0.3, max: 2, step: 0.05 });
        panel.number(TUNING, 'antSpeed', { label: 'Ant speed', min: 1, max: 20, step: 0.5 });
        panel.number(TUNING, 'releaseSec', { label: 'Between ants (s)', min: 0.02, max: 0.6, step: 0.01 });
        panel.buttons([
            { label: 'RESTART', action: () => this.loadLevel(this.levelIndex) },
            { label: 'WIN LEVEL', action: () => this.debugWin() },
            { label: 'NEXT', action: () => this.loadLevel(this.levelIndex + 1) },
            { label: '+1 SLOT', action: () => this.addExtraSlot() },
        ]);
        panel.monitor('Baked check', () => {
            const check = this.level?.check;
            if (!check) return 'not baked';
            return check.clearable ? `clearable${check.slots > SLOT_COUNT ? ' (+1 slot)' : ''}, random wins ${Math.round(check.randomWins * 100)}%` : 'NOT clearable';
        });
        panel.monitor('Pixels left', () => `${this.board?.remaining ?? 0}`);
        panel.monitor('Ants out', () => `${this.swarm?.count ?? 0}`);
        panel.monitor('Slots', () => this.slots.map((s) => (s ? `${s.left}` : '-')).join(' '));
    }

    /** Debug: the picture cleared at once (the celebration plays). */
    private debugWin(): void {
        for (let i = 0; i < this.board.colors.length; i++) {
            if (this.board.colors[i] < 0) continue;
            this.board.take(i);
            this.picture?.pop(i);
        }
        this.swarm?.clear();
    }

    /** The anthill: a dark opening in a raised earth ring, its wooden lid set beside it. */
    private buildHole(): void {
        const r = LAYOUT.holeRadius;
        const opening = new THREE.Mesh(new THREE.CircleGeometry(r, 40), new THREE.MeshBasicMaterial({ color: 0x3a2213 }));
        opening.rotation.x = -Math.PI / 2;
        opening.scale.y = 0.62;
        opening.position.y = 0.03;
        const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.22, 10, 40), new THREE.MeshStandardMaterial({ color: 0xb07a50, roughness: 1 }));
        rim.rotation.x = -Math.PI / 2;
        rim.scale.set(1, 0.62, 0.6);
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r * 0.98, 0.32, 40), new THREE.MeshStandardMaterial({ color: 0xd59a6c, roughness: 0.75 }));
        lid.scale.z = 0.66;
        lid.position.set(LAYOUT.lidX, 0.16, 0.15);
        const grooves = new THREE.Mesh(new THREE.TorusGeometry(r * 0.6, 0.05, 6, 32), new THREE.MeshStandardMaterial({ color: 0xb37a4f }));
        grooves.rotation.x = -Math.PI / 2;
        grooves.scale.set(1, 0.66, 1);
        grooves.position.set(LAYOUT.lidX, 0.33, 0.15);
        this.hole.add(opening, rim, lid, grooves);
        this.hole.position.set(0, 0, LAYOUT.holeZ);
        this.threeScene.add(this.hole);
    }

    /** Sets up a level (also a restart): the picture, its dealt tiles, empty slots, no ants. */
    private loadLevel(index: number): void {
        this.levelIndex = (index + LEVELS.length) % LEVELS.length;
        AntSave.selected = this.levelIndex;
        this.debug.level = this.levelIndex;
        DebugOverlay.instance.getPanel('ant.debug')?.refresh();
        this.level = LEVELS[this.levelIndex];
        this.picture?.destroy();
        this.rack?.destroy();
        this.swarm?.destroy();
        this.slots.length = 0;
        for (let s = 0; s < SLOT_COUNT; s++) this.slots.push(null);
        this.ended = false;
        this.hud.hideResult();
        this.hud.setExtraSlot(true);
        this.hud.setLevel(this.levelIndex + 1, levelTier(this.levelIndex));
        this.boosterUsed = false;

        const pixels = pixelsOf(this.level);
        this.board = new Board(this.level.width, this.level.height, pixels);
        this.palette.length = 0;
        this.level.palette.forEach((hex) => this.palette.push(vivid(hex)));
        // The baked deck; an old level file gets tiles of about 1/90 to 1/25 of the picture, dealt here.
        const min = Math.max(6, Math.round(pixels.length / 90));
        const max = Math.max(min + 6, Math.round(pixels.length / 25));
        const deck = deckOf(this.level) ?? dealDeck(this.board, hashString(this.level.id), min, max);

        const cell = Math.min(LAYOUT.pictureMax.width / this.level.width, LAYOUT.pictureMax.depth / this.level.height);
        const picture = new PictureView(this.level, pixels, cell);
        picture.group.position.set(-picture.width / 2, TRAY_TOP, LAYOUT.trayZ - picture.depth / 2);
        this.picture = picture;
        this.threeScene.add(picture.group);
        // The ants' lane: the middle of the rim, all round.
        const lane = LAYOUT.rim / 2;
        this.lane.left = picture.group.position.x - lane;
        this.lane.right = picture.group.position.x + picture.width + lane;
        this.lane.top = picture.group.position.z - lane;
        this.lane.bottom = picture.group.position.z + picture.depth + lane;

        this.rack = new TileRack(this.level.palette, deck, this.level.columns ?? DEFAULT_COLUMNS);
        this.hud.hideTutorial();
        this.tutorial = this.levelIndex === 0 && !AntSave.tutorialDone
            ? { taps: 0, tiles: deck.length, columns: this.level.columns ?? DEFAULT_COLUMNS, wait: TUTORIAL.wait }
            : null;
        this.threeScene.add(this.rack.group);
        this.swarm = new AntSwarm(this.threeScene, cell * CARRIED, cell, (x, z) => {
            if (!picture.onTray(x, z)) return 0;
            const i = picture.cellAt(x, z);
            return TRAY_TOP + (i >= 0 && this.board.colors[i] >= 0 ? picture.blockTop : 0);
        }, (ant) => this.pickUp(ant), () => undefined);
        this.fitCamera();
    }

    /** Frames the reference screen (LAYOUT.screen), tilted a little so the blocks show their sides. */
    private fitCamera(): void {
        const camera = this.threeCamera;
        camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
        const half = THREE.MathUtils.degToRad(camera.fov / 2);
        const { width, height, centreZ } = LAYOUT.screen;
        const tilt = THREE.MathUtils.degToRad(TILT_DEG);
        // Tilted, the board's depth looks shorter (x cos(tilt)): frame that, and the width.
        const distance = Math.max((height * Math.cos(tilt)) / 2 / Math.tan(half), width / 2 / (Math.tan(half) * camera.aspect));
        const aim = centreZ + AIM_LOWER;
        camera.position.set(0, Math.cos(tilt) * distance, aim + Math.sin(tilt) * distance);
        camera.lookAt(0, 0, aim);
        camera.updateProjectionMatrix();
    }

    // ---------------------------------------------------------------- input

    private readonly onPointerDown = (event: PointerEvent): void => {
        if (this.ended || this.paused || !this.rack) return;
        const rect = SetupThree.renderer.domElement.getBoundingClientRect();
        this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        this.raycaster.setFromCamera(this.pointer, this.threeCamera);
        const fronts = this.rack.frontBodies();
        const hit = this.raycaster.intersectObjects(fronts.map((f) => f.body), false)[0];
        if (!hit) return;
        const column = fronts.find((f) => f.body === hit.object)!.column;
        // The tutorial: only the tile it points at (the next in the dealt order: round-robin through the columns).
        const tutorial = this.tutorial;
        if (tutorial && tutorial.taps < tutorial.tiles && column !== tutorial.taps % tutorial.columns) return;
        const slot = this.slots.indexOf(null);
        if (slot < 0) {
            AntAudio.play('full');
            this.rack.shake(column);
            return;
        }
        AntAudio.play('tile');
        const tile = this.rack.take(column, slot);
        if (tile) this.slots[slot] = { tile, color: tile.tile.color, left: tile.tile.count, timer: 0.3 };
        if (tile && tutorial) {
            tutorial.taps++;
            tutorial.wait = TUTORIAL.wait;
            this.hud.hideTutorial();
        }
    };

    /** A level (the next, or this one again) behind the screen transition, which shows its picture. */
    private travelTo(index: number): void {
        if (this.travelling) return;
        this.travelling = true;
        const next = (index + LEVELS.length) % LEVELS.length;
        const level = LEVELS[next];
        void RadialTransition.go(this.game, `LEVEL ${next + 1}`, level.name.toUpperCase(), level, () => this.loadLevel(next)).then(() => {
            this.travelling = false;
        });
    }

    /** The pause popup: time stops; its cross plays on, RETRY starts the level again, HOME goes to the main screen. */
    private openPause(): void {
        if (this.ended || this.paused) return;
        this.paused = true;
        this.resumeScale = Game.timeScale;
        Game.timeScale = 0;
        this.hud.showPause({
            resume: () => this.closePause(),
            retry: () => {
                this.closePause();
                this.travelTo(this.levelIndex);
            },
            home: () => {
                this.closePause();
                this.onHome();
            },
        });
    }

    private closePause(): void {
        if (!this.paused) return;
        this.paused = false;
        Game.timeScale = this.resumeScale;
        this.hud.hidePause();
    }

    /** The power-up: one more slot (once a level). Used on the lost card, the level plays on. */
    private addExtraSlot(): void {
        if (!this.rack || !this.hud.extraSlotAvailable || this.board.remaining === 0) return;
        this.rack.addSlot();
        this.slots.push(null);
        // One fewer owned (the power-ups' shop sells more), and no more this level.
        AntSave.addBooster('slot', -1);
        this.boosterUsed = true;
        this.hud.setExtraSlot(false);
        this.ended = false;
    }

    public update(delta: number): void {
        this.updateTutorial(Math.min(delta, 0.1));
        super.update(delta);
    }

    /** Points at the next tile to tap (after a moment), following it as the rack moves; out of the way when done. */
    private updateTutorial(delta: number): void {
        const tutorial = this.tutorial;
        if (!tutorial || !this.rack) return;
        if (this.ended || this.paused || tutorial.taps >= tutorial.tiles) {
            this.hud.hideTutorial();
            return;
        }
        if (tutorial.wait > 0) {
            tutorial.wait -= delta;
            return;
        }
        const column = tutorial.taps % tutorial.columns;
        const top = this.rack.frontTop(column);
        // No free slot yet: wait for one.
        if (!top || !this.slots.includes(null)) {
            this.hud.hideTutorial();
            return;
        }
        const at = this.worldToScreen(top);
        const edge = this.worldToScreen(top.clone().add(new THREE.Vector3((this.rack.tileSize / 2) * TUTORIAL.hole * 2, 0, 0)));
        if (!at || !edge) return;
        const text = tutorial.taps === 0 ? TUTORIAL.first : tutorial.taps === tutorial.tiles - 1 ? TUTORIAL.last : TUTORIAL.next;
        this.hud.showTutorial(at.x, at.y, Math.abs(edge.x - at.x), text);
    }

    private readonly onWindowResize = (): void => {
        if (this.picture) this.fitCamera();
    };

    // ---------------------------------------------------------------- play

    public fixedUpdate(delta: number): void {
        if (!this.swarm || !this.picture || !this.rack) return;
        this.slots.forEach((slot, s) => {
            if (!slot) return;
            if (slot.left > 0) this.release(slot, s, delta);
            // Its last ant has left: the tile pops and the slot is free at once (no waiting for the ants to get home).
            if (slot.left === 0) {
                AntAudio.play('slot');
                this.rack!.release(slot.tile);
                this.slots[s] = null;
            }
        });
        this.swarm.update(delta);
        this.picture.update(delta);
        this.checkEnd();
    }

    /** Sends a slot's next ant when its time comes, to an exposed pixel of its colour (if there is one). */
    private release(slot: SlotState, s: number, delta: number): void {
        slot.timer -= delta;
        if (slot.timer > 0) return;
        const options = this.board.claimable(slot.color);
        if (!options.length) return;
        const start = this.rack!.slotPosition(s).add(new THREE.Vector3(0, 0.9, -LAYOUT.tile / 2));
        // The nearest to the slot (claimed ones are skipped, so the ants still spread out).
        let pixel = options[0];
        let nearest = Infinity;
        for (const i of options) {
            const d = this.picture!.cellCenter(i).distanceToSquared(start);
            if (d < nearest - 1e-6) {
                nearest = d;
                pixel = i;
            }
        }
        this.board.claim(pixel);
        const color = this.palette[slot.color];
        this.swarm!.send(s, pixel, color, color, start, this.pathIn(start, pixel));
        slot.left--;
        slot.timer = TUNING.releaseSec;
        this.rack!.setCount(slot.tile, slot.left);
    }

    /**
     * Slot -> pixel: straight up to the rim — stepping sideways round the anthill and its lid first, in the gap above the
     * slots, when they're in the way — along the rim to the side the pixel's way in opens on, then in through the eaten
     * cells.
     */
    private pathIn(start: THREE.Vector3, pixel: number): THREE.Vector3[] {
        const cells = this.board.pathOut(pixel);
        const door = this.door(cells[cells.length - 1]);
        const path: THREE.Vector3[] = [];
        let x = start.x;
        const { left, right } = this.holeBand();
        if (x > left && x < right) {
            // Round the anthill: across in the gap above the slots, to the nearer side of the hole-and-lid.
            const gapZ = (LAYOUT.holeZ + LAYOUT.slotsZ) / 2 + 0.3;
            x = x - left < right - x ? left : right;
            path.push(new THREE.Vector3(start.x, 0, gapZ), new THREE.Vector3(x, 0, gapZ));
        }
        const onRim = new THREE.Vector3(THREE.MathUtils.clamp(x, this.lane.left, this.lane.right), TRAY_TOP, this.lane.bottom);
        if (onRim.x !== x) path.push(new THREE.Vector3(x, 0, this.lane.bottom + 1.2), new THREE.Vector3(onRim.x, 0, this.lane.bottom + 1.2));
        return [...path, onRim, ...this.alongRim(onRim, door), door, ...cells.slice().reverse().map((i) => this.picture!.cellCenter(i))];
    }

    /** The anthill and its lid, across (world x): the band ants walking up from the slots go round. */
    private holeBand(): { left: number; right: number } {
        const margin = 0.6;
        return { left: -LAYOUT.holeRadius - margin, right: LAYOUT.lidX + LAYOUT.holeRadius + margin };
    }

    /** Pixel -> anthill: out to its nearest border, along the rim to the bottom, straight down to the anthill's row, across into it. */
    private pathHome(pixel: number): THREE.Vector3[] {
        const cells = this.board.pathOut(pixel);
        const door = this.door(cells[cells.length - 1]);
        // Down the rim at the bottom: where it came out, or the bottom corner on its side.
        const bottomX = door.z >= this.lane.bottom - 1e-3 ? door.x : door.x < 0 ? this.lane.left : this.lane.right;
        const down = new THREE.Vector3(bottomX, TRAY_TOP, this.lane.bottom);
        const path = [...cells.slice(1).map((i) => this.picture!.cellCenter(i)), door, ...this.alongRim(door, down), down];
        // Down to just above the anthill's row, across, and in from above (never over the lid beside it).
        const hole = this.hole.position;
        const aboveZ = hole.z - LAYOUT.holeRadius * 0.9;
        if (Math.abs(bottomX - hole.x) > LAYOUT.holeRadius * 0.4) {
            path.push(new THREE.Vector3(bottomX, 0, aboveZ), new THREE.Vector3(hole.x, 0, aboveZ));
        }
        path.push(hole.clone());
        return path;
    }

    /** Where a cell on the picture's outline opens onto the rim's lane: straight out from its side (bottom, left, right, top). */
    private door(cell: number): THREE.Vector3 {
        const at = this.picture!.cellCenter(cell);
        const x = cell % this.level.width;
        const y = Math.floor(cell / this.level.width);
        if (y === this.level.height - 1) at.z = this.lane.bottom;
        else if (x === 0) at.x = this.lane.left;
        else if (x === this.level.width - 1) at.x = this.lane.right;
        else at.z = this.lane.top;
        return at;
    }

    /** The lane's corners passed going round the rim from `a` to `b` (both on the lane), the shorter way round. */
    private alongRim(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3[] {
        const { left, right, top, bottom } = this.lane;
        const width = right - left;
        const depth = bottom - top;
        const perimeter = 2 * (width + depth);
        // Distance along the lane from the bottom-left corner, going right along the bottom, up the right, left along
        // the top, down the left.
        const along = (p: THREE.Vector3): number => {
            if (Math.abs(p.z - bottom) < 1e-3) return p.x - left;
            if (Math.abs(p.x - right) < 1e-3) return width + (bottom - p.z);
            if (Math.abs(p.z - top) < 1e-3) return width + depth + (right - p.x);
            return 2 * width + depth + (p.z - top);
        };
        const corners = [
            { at: 0, point: new THREE.Vector3(left, TRAY_TOP, bottom) },
            { at: width, point: new THREE.Vector3(right, TRAY_TOP, bottom) },
            { at: width + depth, point: new THREE.Vector3(right, TRAY_TOP, top) },
            { at: 2 * width + depth, point: new THREE.Vector3(left, TRAY_TOP, top) },
        ];
        const from = along(a);
        const to = along(b);
        const forward = (to - from + perimeter) % perimeter;
        const passed: { at: number; point: THREE.Vector3 }[] = [];
        if (forward <= perimeter - forward) {
            for (const c of corners) if (((c.at - from + perimeter) % perimeter) > 1e-3 && ((c.at - from + perimeter) % perimeter) < forward) passed.push(c);
            passed.sort((m, n) => ((m.at - from + perimeter) % perimeter) - ((n.at - from + perimeter) % perimeter));
        } else {
            const back = perimeter - forward;
            for (const c of corners) if (((from - c.at + perimeter) % perimeter) > 1e-3 && ((from - c.at + perimeter) % perimeter) < back) passed.push(c);
            passed.sort((m, n) => ((from - m.at + perimeter) % perimeter) - ((from - n.at + perimeter) % perimeter));
        }
        return passed.map((c) => c.point.clone());
    }

    /** An ant reached its pixel: the block pops out of the picture (it's carrying it now), and the way home is handed back. */
    private pickUp(ant: Ant): THREE.Vector3[] {
        // A soft pop, a little higher as the picture empties.
        AntAudio.play('pick', 0.9 + 0.4 * (1 - this.board.remaining / Math.max(1, this.board.colors.length)));
        this.board.take(ant.pixel);
        this.picture?.pop(ant.pixel);
        return this.pathHome(ant.pixel);
    }

    /** Won: the picture's gone. Lost: every slot waits on a colour with nothing exposed, and no ant is out. */
    private checkEnd(): void {
        if (this.ended || !this.swarm) return;
        if (this.board.remaining === 0 && this.swarm.count === 0) {
            this.ended = true;
            if (this.tutorial) {
                AntSave.finishTutorial();
                this.tutorial = null;
                this.hud.hideTutorial();
            }
            // The coins: the full reward the first time, a little for a replay.
            const reward = levelReward(this.levelIndex, AntSave.hasWon(this.levelIndex));
            AntSave.markWon(this.levelIndex);
            AntSave.addCoins(reward);
            AntSave.reach(Math.min(this.levelIndex + 1, LEVELS.length - 1));
            // Won without a power-up: maybe a free one (one already unlocked).
            const unlocked = BOOSTERS.filter((b) => b.unlock <= this.levelIndex + 1);
            const drop = !this.boosterUsed && unlocked.length && Math.random() < FREE_DROP_CHANCE
                ? unlocked[Math.floor(Math.random() * unlocked.length)].id
                : null;
            if (drop) AntSave.addBooster(drop, 1);
            this.hud.celebrate(this.level, reward, drop, () => this.travelTo(this.levelIndex + 1));
            return;
        }
        const stuck = this.swarm.count === 0 && this.slots.every((slot) => slot && slot.left > 0 && !this.board.claimable(slot.color).length);
        if (stuck) {
            this.ended = true;
            this.hud.showResult(false, () => this.travelTo(this.levelIndex));
        }
    }

    public resize(): void {
        this.hud?.reposition();
        if (this.picture) this.fitCamera();
    }

    public destroy(): void {
        if (this.paused) Game.timeScale = this.resumeScale;
        window.removeEventListener('pointerdown', this.onPointerDown);
        window.removeEventListener('resize', this.onWindowResize);
        DebugOverlay.instance.removePanel('ant.debug');
        this.picture?.destroy();
        this.rack?.destroy();
        this.swarm?.destroy();
        this.hud?.destroy();
        super.destroy();
    }
}
