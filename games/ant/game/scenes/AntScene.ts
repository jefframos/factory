// AntScene.ts
//
// Ant's one scene: the board seen from above. The picture (PictureView) on its tray at the top, the anthill under it,
// then the SLOT_COUNT slots and the tile columns (TileRack). Tapping a column's front tile slides it into a free slot;
// from there its ants (AntSwarm), one per number on the tile, set off one after another, each to a pixel of the tile's
// colour that's exposed (Board: on the bottom edge, or next to one already taken), carry it back and drop it down the
// anthill. A tile whose colour has nothing exposed just waits in its slot — that's the puzzle: with every slot waiting on
// a colour the ants can't reach yet, the level is lost; with the picture gone, it's won.
//
// The deck is dealt from the picture itself (Board.dealDeck), so taking the tiles in the order they come always works.

import * as THREE from 'three';
import { Game } from 'core/Game';
import { ThreeScene } from 'core/scene/ThreeScene';
import SetupThree from 'core/scene/SetupThree';
import { Board, dealDeck, hashString } from '../data/Board';
import { LEVELS, LevelData, pixelsOf } from '../data/Levels';
import { AntSave } from '../data/AntSave';
import { PictureView } from '../world/PictureView';
import { AntSwarm, Ant } from '../world/AntSwarm';
import { TileRack, RackTile, SLOT_COUNT } from '../world/TileRack';
import { AntHud } from '../ui/AntHud';

/** The floor colour (warm sand), also the page's (index.html). */
const FLOOR = 0xf2c9a3;
/** The picture is fitted into this many world units across (and PICTURE_MAX_DEPTH down). */
const PICTURE_WIDTH = 22;
const PICTURE_MAX_DEPTH = 20;
/** Gaps down the board: picture -> anthill -> slots -> tiles. */
const HOLE_GAP = 3.2;
const SLOTS_GAP = 3.9;
const GRID_GAP = 5.2;
const HOLE_RADIUS = 1.5;
/** Seconds between two ants leaving the same slot. */
const RELEASE_SEC = 0.09;
/** An ant goes for one of the few exposed pixels nearest its slot (picked at random among these), so they spread out. */
const NEAREST_CHOICES = 4;
/** Camera: field of view, tilt from straight down, and margin around the board. */
const FOV = 30;
const TILT_DEG = 12;
const MARGIN = 1.06;

/** A tile in a slot: its ants still to send, and when the next leaves. */
interface SlotState {
    tile: RackTile;
    color: number;
    left: number;
    timer: number;
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
    private readonly from = new THREE.Vector3();
    /** The board's extent (world units), for the camera. */
    private readonly bounds = { minZ: 0, maxZ: 0, width: 0 };

    public constructor(game: Game) {
        super(game);
    }

    public build(): void {
        this.threeScene.background = new THREE.Color(FLOOR);
        this.threeScene.add(new THREE.HemisphereLight(0xffffff, 0xd8b090, 1.2));
        const sun = new THREE.DirectionalLight(0xffffff, 1.5);
        sun.position.set(6, 20, 10);
        this.threeScene.add(sun);
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: FLOOR, roughness: 1 }));
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -0.55;
        this.threeScene.add(floor);
        this.buildHole();
        this.threeCamera.fov = FOV;
        this.hud = new AntHud(() => this.loadLevel(this.levelIndex));
        this.game.uiLayer.addChild(this.hud);
        window.addEventListener('pointerdown', this.onPointerDown);
        window.addEventListener('resize', this.onWindowResize);
        this.loadLevel(Math.min(AntSave.level, LEVELS.length - 1));
    }

    /** The anthill: a dark opening ringed with packed earth. */
    private buildHole(): void {
        const opening = new THREE.Mesh(new THREE.CircleGeometry(HOLE_RADIUS, 40), new THREE.MeshBasicMaterial({ color: 0x2e1a0e }));
        opening.rotation.x = -Math.PI / 2;
        opening.position.y = 0.02;
        const rim = new THREE.Mesh(new THREE.TorusGeometry(HOLE_RADIUS + 0.15, 0.35, 12, 40), new THREE.MeshStandardMaterial({ color: 0xa8714a, roughness: 1 }));
        rim.rotation.x = -Math.PI / 2;
        rim.scale.z = 0.5;
        this.hole.add(opening, rim);
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
        this.hud.setLevel(this.levelIndex + 1, this.level.name);

        const pixels = pixelsOf(this.level);
        this.board = new Board(this.level.width, this.level.height, pixels);
        this.palette.length = 0;
        this.level.palette.forEach((hex) => this.palette.push(new THREE.Color(hex)));
        // Tiles of about 1/60 to 1/22 of the picture: a handful of rows per column.
        const min = Math.max(6, Math.round(pixels.length / 60));
        const max = Math.max(min + 6, Math.round(pixels.length / 22));
        const deck = dealDeck(this.board, hashString(this.level.id), min, max);

        const cell = Math.min(PICTURE_WIDTH / this.level.width, PICTURE_MAX_DEPTH / this.level.height);
        this.picture = new PictureView(this.level, pixels, cell);
        this.picture.group.position.set(-this.picture.width / 2, 0, 0);
        this.threeScene.add(this.picture.group);
        const holeZ = this.picture.depth + HOLE_GAP;
        this.hole.position.set(0, 0, holeZ);
        const slotsZ = holeZ + SLOTS_GAP;
        this.rack = new TileRack(this.level.palette, deck, slotsZ, slotsZ + GRID_GAP);
        this.threeScene.add(this.rack.group);
        const picture = this.picture;
        this.swarm = new AntSwarm(this.threeScene, cell * 1.1, this.hole.position.clone(), (x, z) => {
            const i = picture.cellAt(x, z);
            return i >= 0 && this.board.colors[i] >= 0 ? picture.blockTop : 0;
        }, (ant) => this.pickUp(ant), () => undefined);
        this.bounds.minZ = -1.4;
        this.bounds.maxZ = this.rack.bottom + 0.6;
        this.bounds.width = Math.max(this.picture.width + 2.4, this.rack.width + 0.6);
        this.fitCamera();
    }

    /** Frames the whole board, tilted a little so the blocks show their sides. */
    private fitCamera(): void {
        const camera = this.threeCamera;
        camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
        const half = THREE.MathUtils.degToRad(camera.fov / 2);
        const depth = this.bounds.maxZ - this.bounds.minZ;
        const distance = Math.max(depth / 2 / Math.tan(half), this.bounds.width / 2 / (Math.tan(half) * camera.aspect)) * MARGIN
            // The HUD's title over the top of the board.
            + 2;
        const tilt = THREE.MathUtils.degToRad(TILT_DEG);
        const centre = (this.bounds.minZ + this.bounds.maxZ) / 2 - 0.8;
        camera.position.set(0, Math.cos(tilt) * distance, centre + Math.sin(tilt) * distance);
        camera.lookAt(0, 0, centre);
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
        this.checkEnd();
    }

    /** Sends a slot's next ant when its time comes, to an exposed pixel of its colour near the slot (if there is one). */
    private release(slot: SlotState, s: number, delta: number): void {
        slot.timer -= delta;
        if (slot.timer > 0) return;
        const options = this.board.claimable(slot.color);
        if (!options.length) return;
        this.rack!.slotPosition(s, this.from);
        const near = options
            .map((i) => ({ i, d: this.picture!.cellCenter(i).distanceToSquared(this.from) }))
            .sort((a, b) => a.d - b.d)
            .slice(0, NEAREST_CHOICES);
        const pixel = near[Math.floor(Math.random() * near.length)].i;
        this.board.claim(pixel);
        const color = this.palette[slot.color];
        this.from.z -= 1.4;
        this.swarm!.send(s, pixel, color, color, this.from, this.picture!.cellCenter(pixel));
        slot.left--;
        slot.timer = RELEASE_SEC;
        this.rack!.setCount(slot.tile, slot.left);
    }

    /** An ant reached its pixel: the block comes off the picture (it's carrying it now). */
    private pickUp(ant: Ant): void {
        this.board.take(ant.pixel);
        this.picture?.hide(ant.pixel);
    }

    /** Won: the picture's gone. Lost: every slot waits on a colour with nothing exposed, and no ant is out. */
    private checkEnd(): void {
        if (this.ended || !this.swarm) return;
        if (this.board.remaining === 0 && this.swarm.count === 0) {
            this.ended = true;
            AntSave.level = Math.min(this.levelIndex + 1, LEVELS.length - 1);
            this.hud.showResult(true, () => this.loadLevel(this.levelIndex + 1));
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
