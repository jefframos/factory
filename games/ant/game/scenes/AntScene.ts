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
// nearest border (straight down when the way down is clear), along the rim to its bottom, straight down to the
// anthill's row and across into it.
//
// The deck is dealt from the picture itself (Board.dealDeck), so taking the tiles in the order they come always works.

import * as THREE from 'three';
import { Game } from 'core/Game';
import { ThreeScene } from 'core/scene/ThreeScene';
import SetupThree from 'core/scene/SetupThree';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Board, dealDeck, hashString } from '../data/Board';
import { LEVELS, LevelData, pixelsOf } from '../data/Levels';
import { AntSave } from '../data/AntSave';
import { PictureView, TRAY_TOP } from '../world/PictureView';
import { AntSwarm, Ant } from '../world/AntSwarm';
import { TileRack, RackTile, SLOT_COUNT } from '../world/TileRack';
import { LAYOUT } from '../world/Layout';
import { AntHud } from '../ui/AntHud';

/** The floor's peach (also the page's: index.html). */
const FLOOR = 0xf6c597;
/** Seconds between two ants leaving the same slot. */
const RELEASE_SEC = 0.09;
/** An ant goes for one of the few exposed pixels nearest its way in (picked at random among these), so they spread out. */
const NEAREST_CHOICES = 4;
/** An ant is about this many of the picture's pixels long. */
const ANT_PIXELS = 2.6;
/** Camera: field of view and tilt from straight down. */
const FOV = 26;
const TILT_DEG = 6;

/** A tile in a slot: its ants still to send, and when the next leaves. */
interface SlotState {
    tile: RackTile;
    color: number;
    left: number;
    timer: number;
}

/** The floor: the reference's soft peach checker, turned 45° into diamonds. */
function floorTexture(): THREE.CanvasTexture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#f2b583';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#f5c294';
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
    private readonly slots: (SlotState | null)[] = Array(SLOT_COUNT).fill(null);
    private readonly palette: THREE.Color[] = [];
    private ended = false;
    private readonly raycaster = new THREE.Raycaster();
    private readonly pointer = new THREE.Vector2();
    /** The lane round the picture on its rim (world x / z of its sides), where ants walk. */
    private readonly lane = { left: 0, right: 0, top: 0, bottom: 0 };

    public constructor(game: Game) {
        super(game);
    }

    public build(): void {
        this.threeScene.background = new THREE.Color(FLOOR);
        // A soft studio light to reflect: what gives the jelly cubes and tiles their shine.
        const pmrem = new THREE.PMREMGenerator(SetupThree.renderer);
        this.threeScene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        this.threeScene.environmentIntensity = 0.3;
        pmrem.dispose();
        this.threeScene.add(new THREE.HemisphereLight(0xfff4ea, 0xc98f62, 0.75));
        const sun = new THREE.DirectionalLight(0xffffff, 0.95);
        sun.position.set(5, 30, 18);
        this.threeScene.add(sun);
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 1 }));
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(0, -0.02, LAYOUT.screen.centreZ);
        this.threeScene.add(floor);
        this.buildHole();
        this.threeCamera.fov = FOV;
        this.hud = new AntHud(() => this.loadLevel(this.levelIndex));
        this.game.uiLayer.addChild(this.hud);
        window.addEventListener('pointerdown', this.onPointerDown);
        window.addEventListener('resize', this.onWindowResize);
        this.loadLevel(Math.min(AntSave.level, LEVELS.length - 1));
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
        this.level = LEVELS[this.levelIndex];
        this.picture?.destroy();
        this.rack?.destroy();
        this.swarm?.destroy();
        this.slots.fill(null);
        this.ended = false;
        this.hud.hideResult();
        this.hud.setLevel(this.levelIndex + 1);

        const pixels = pixelsOf(this.level);
        this.board = new Board(this.level.width, this.level.height, pixels);
        this.palette.length = 0;
        this.level.palette.forEach((hex) => this.palette.push(new THREE.Color(hex)));
        // Tiles of about 1/90 to 1/25 of the picture.
        const min = Math.max(6, Math.round(pixels.length / 90));
        const max = Math.max(min + 6, Math.round(pixels.length / 25));
        const deck = dealDeck(this.board, hashString(this.level.id), min, max);

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

        this.rack = new TileRack(this.level.palette, deck);
        this.threeScene.add(this.rack.group);
        this.swarm = new AntSwarm(this.threeScene, cell * ANT_PIXELS * 0.9, cell * 0.88, (x, z) => {
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
        const distance = Math.max(height / 2 / Math.tan(half), width / 2 / (Math.tan(half) * camera.aspect));
        const tilt = THREE.MathUtils.degToRad(TILT_DEG);
        camera.position.set(0, Math.cos(tilt) * distance, centreZ + Math.sin(tilt) * distance);
        camera.lookAt(0, 0, centreZ);
        camera.updateProjectionMatrix();
    }

    // ---------------------------------------------------------------- input

    private readonly onPointerDown = (event: PointerEvent): void => {
        if (this.ended || !this.rack) return;
        const rect = SetupThree.renderer.domElement.getBoundingClientRect();
        this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        this.raycaster.setFromCamera(this.pointer, this.threeCamera);
        const fronts = this.rack.frontBodies();
        const hit = this.raycaster.intersectObjects(fronts.map((f) => f.body), false)[0];
        if (!hit) return;
        const column = fronts.find((f) => f.body === hit.object)!.column;
        const slot = this.slots.indexOf(null);
        if (slot < 0) {
            this.rack.shake(column);
            return;
        }
        const tile = this.rack.take(column, slot);
        if (tile) this.slots[slot] = { tile, color: tile.tile.color, left: tile.tile.count, timer: 0.3 };
    };

    private readonly onWindowResize = (): void => {
        if (this.picture) this.fitCamera();
    };

    // ---------------------------------------------------------------- play

    public fixedUpdate(delta: number): void {
        if (!this.swarm || !this.picture || !this.rack) return;
        this.slots.forEach((slot, s) => {
            if (!slot) return;
            if (slot.left > 0) this.release(slot, s, delta);
            // All its ants out and home: the tile goes and the slot is free.
            if (slot.left === 0 && this.swarm!.countFor(s) === 0) {
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
        // The nearest by the way in: along the bottom of the rim from the slot, then up to the pixel.
        const near = options
            .map((i) => ({ i, d: this.picture!.cellCenter(i).distanceToSquared(start) }))
            .sort((a, b) => a.d - b.d)
            .slice(0, NEAREST_CHOICES);
        const pixel = near[Math.floor(Math.random() * near.length)].i;
        this.board.claim(pixel);
        const color = this.palette[slot.color];
        this.swarm!.send(s, pixel, color, color, start, this.pathIn(start, pixel));
        slot.left--;
        slot.timer = RELEASE_SEC;
        this.rack!.setCount(slot.tile, slot.left);
    }

    /** Slot -> pixel: straight up to the rim, along it to the side the pixel's way in opens on, then in through the eaten cells. */
    private pathIn(start: THREE.Vector3, pixel: number): THREE.Vector3[] {
        const cells = this.board.pathOut(pixel);
        const door = this.door(cells[cells.length - 1]);
        const onRim = new THREE.Vector3(THREE.MathUtils.clamp(start.x, this.lane.left, this.lane.right), TRAY_TOP, this.lane.bottom);
        return [onRim, ...this.alongRim(onRim, door), door, ...cells.slice().reverse().map((i) => this.picture!.cellCenter(i))];
    }

    /** Pixel -> anthill: out to its nearest border, along the rim to the bottom, straight down to the anthill's row, across into it. */
    private pathHome(pixel: number): THREE.Vector3[] {
        const cells = this.board.pathOut(pixel);
        const door = this.door(cells[cells.length - 1]);
        // Down the rim at the bottom: where it came out, or the bottom corner on its side.
        const bottomX = door.z >= this.lane.bottom - 1e-3 ? door.x : door.x < 0 ? this.lane.left : this.lane.right;
        const down = new THREE.Vector3(bottomX, TRAY_TOP, this.lane.bottom);
        const path = [...cells.slice(1).map((i) => this.picture!.cellCenter(i)), door, ...this.alongRim(door, down), down];
        const hole = this.hole.position;
        if (Math.abs(bottomX - hole.x) > LAYOUT.holeRadius * 0.6) path.push(new THREE.Vector3(bottomX, 0, hole.z));
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
        this.board.take(ant.pixel);
        this.picture?.pop(ant.pixel);
        return this.pathHome(ant.pixel);
    }

    /** Won: the picture's gone. Lost: every slot waits on a colour with nothing exposed, and no ant is out. */
    private checkEnd(): void {
        if (this.ended || !this.swarm) return;
        if (this.board.remaining === 0 && this.swarm.count === 0) {
            this.ended = true;
            AntSave.level = Math.min(this.levelIndex + 1, LEVELS.length - 1);
            this.hud.celebrate(this.level, () => this.loadLevel(this.levelIndex + 1));
            return;
        }
        const stuck = this.swarm.count === 0 && this.slots.every((slot) => slot && slot.left > 0 && !this.board.claimable(slot.color).length);
        if (stuck) {
            this.ended = true;
            this.hud.showResult(false, () => this.loadLevel(this.levelIndex));
        }
    }

    public resize(): void {
        this.hud?.reposition();
        if (this.picture) this.fitCamera();
    }

    public destroy(): void {
        window.removeEventListener('pointerdown', this.onPointerDown);
        window.removeEventListener('resize', this.onWindowResize);
        this.picture?.destroy();
        this.rack?.destroy();
        this.swarm?.destroy();
        this.hud?.destroy();
        super.destroy();
    }
}
