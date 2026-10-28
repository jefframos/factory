// DigMap.ts
//
// Developer map (?dev=1 only): the whole mine top-down in 2D, drawn into a canvas one cell = CELL_PX
// pixels — rock in its material colour, dug tunnels dark, the hub floor light, bedrock black — with
// the zone borders traced, every buried find marked, and the miner as a dot. Tapping the map
// teleports the miner to that spot (open ground only). Redraws while open as blocks get dug.

import * as PIXI from 'pixi.js';
import { Game } from 'core/Game';
import { DIG } from '../data/DigConfig';
import { VoxelTerrain, AIR, BEDROCK } from '../world/VoxelTerrain';

const CELL_PX = 3;
const DUG_COLOR = '#2b1e16';
const HUB_COLOR = '#e6d2a6';
const BEDROCK_COLOR = '#151515';
const FIND_COLOR = '#ff3df0';
const REDRAW_SEC = 0.25;

export class DigMap extends PIXI.Container {
    private readonly backdrop = new PIXI.Graphics();
    private readonly frame = new PIXI.Container();
    private readonly canvas = document.createElement('canvas');
    private readonly texture: PIXI.Texture;
    private readonly map: PIXI.Sprite;
    private readonly playerDot = new PIXI.Graphics();
    private readonly legend: PIXI.Text;
    private drawnChange = -1;
    private redrawTimer = 0;

    public constructor(
        private readonly terrain: VoxelTerrain,
        private readonly playerPosition: () => { x: number; z: number },
        /** A tap on open ground: world x, z. */
        private readonly onPick: (x: number, z: number) => void,
    ) {
        super();
        this.visible = false;
        this.canvas.width = this.canvas.height = terrain.size * CELL_PX;
        this.texture = PIXI.Texture.from(this.canvas);
        this.texture.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
        this.map = new PIXI.Sprite(this.texture);
        this.map.anchor.set(0.5);
        this.map.eventMode = 'static';
        this.map.cursor = 'crosshair';
        this.map.on('pointertap', (event: PIXI.FederatedPointerEvent) => this.pick(event));

        this.backdrop.eventMode = 'static';
        this.backdrop.on('pointertap', () => this.close());

        const title = new PIXI.Text('MINE MAP (dev) — tap to teleport', { fontFamily: 'Arial', fontWeight: 'bold', fontSize: 22, fill: 0xffffff });
        title.anchor.set(0.5, 1);
        title.name = 'title';
        const zones = DIG.zones.map((zone, i) => {
            const fill = DIG.materials.find((m) => m.id === zone.fill);
            const tool = DIG.tools.find((t) => t.power >= (fill?.minPower ?? 1));
            return `${i + 1} ${zone.name} (${tool?.name ?? '?'})`;
        });
        this.legend = new PIXI.Text(
            `${zones.join('   ')}\n● finds: ${DIG.finds.map((f) => f.name).join(', ')}`,
            { fontFamily: 'Arial', fontSize: 15, fill: 0xffffff, align: 'center', wordWrap: true, wordWrapWidth: 500 },
        );
        this.legend.anchor.set(0.5, 0);

        const close = new PIXI.Container();
        close.name = 'close';
        close.addChild(new PIXI.Graphics().lineStyle(3, 0xffffff).beginFill(0xd2463c).drawCircle(0, 0, 22).endFill());
        const cross = new PIXI.Text('✕', { fontFamily: 'Arial', fontWeight: 'bold', fontSize: 24, fill: 0xffffff });
        cross.anchor.set(0.5);
        close.addChild(cross);
        close.eventMode = 'static';
        close.cursor = 'pointer';
        close.on('pointertap', () => this.close());

        this.frame.addChild(this.map, this.playerDot, title, this.legend, close);
        this.addChild(this.backdrop, this.frame);
    }

    public get isOpen(): boolean {
        return this.visible;
    }

    public open(): void {
        this.visible = true;
        this.drawnChange = -1;
        this.reposition();
        this.update(0);
    }

    public close(): void {
        this.visible = false;
    }

    public toggle(): void {
        if (this.visible) this.close();
        else this.open();
    }

    public update(delta: number): void {
        if (!this.visible) return;
        this.redrawTimer -= delta;
        if (this.drawnChange !== this.terrain.changed && this.redrawTimer <= 0) {
            this.draw();
            this.redrawTimer = REDRAW_SEC;
        }
        const player = this.playerPosition();
        // World (0, 0) is the middle of the mine, which is where the sprite is anchored.
        const scale = this.map.scale.x * CELL_PX;
        this.playerDot.clear()
            .lineStyle(2, 0xffffff)
            .beginFill(0x4fd2ff)
            .drawCircle(this.map.x + player.x * scale, this.map.y + player.z * scale, 6)
            .endFill();
    }

    private draw(): void {
        const { terrain } = this;
        const g = this.canvas.getContext('2d')!;
        const size = terrain.size;
        for (let iz = 0; iz < size; iz++) {
            for (let ix = 0; ix < size; ix++) {
                const index = terrain.index(ix, iz);
                const value = terrain.cells[index];
                g.fillStyle = value === AIR
                    ? (terrain.dug[index] ? DUG_COLOR : HUB_COLOR)
                    : value === BEDROCK ? BEDROCK_COLOR : DIG.materials[value - 1].color;
                g.fillRect(ix * CELL_PX, iz * CELL_PX, CELL_PX, CELL_PX);
            }
        }
        // Zone borders: a dark pixel line wherever the zone changes.
        g.fillStyle = 'rgba(0, 0, 0, 0.55)';
        for (let iz = 0; iz < size - 1; iz++) {
            for (let ix = 0; ix < size - 1; ix++) {
                const zone = terrain.zones[terrain.index(ix, iz)];
                if (zone !== terrain.zones[terrain.index(ix + 1, iz)]) g.fillRect((ix + 1) * CELL_PX - 1, iz * CELL_PX, 1, CELL_PX);
                if (zone !== terrain.zones[terrain.index(ix, iz + 1)]) g.fillRect(ix * CELL_PX, (iz + 1) * CELL_PX - 1, CELL_PX, 1);
            }
        }
        // Finds, bigger than a cell so they stand out.
        g.fillStyle = FIND_COLOR;
        g.strokeStyle = '#ffffff';
        g.lineWidth = 1;
        for (let index = 0; index < terrain.finds.length; index++) {
            if (!terrain.finds[index] || terrain.cells[index] === AIR) continue;
            const ix = index % size;
            const iz = Math.floor(index / size);
            g.fillRect(ix * CELL_PX - 1, iz * CELL_PX - 1, CELL_PX + 2, CELL_PX + 2);
            g.strokeRect(ix * CELL_PX - 1.5, iz * CELL_PX - 1.5, CELL_PX + 3, CELL_PX + 3);
        }
        this.texture.update();
        this.drawnChange = terrain.changed;
    }

    private pick(event: PIXI.FederatedPointerEvent): void {
        event.stopPropagation();
        const local = this.map.toLocal(event.global);
        // The sprite is anchored at its centre: local (0, 0) is the middle of the mine.
        const x = local.x / CELL_PX;
        const z = local.y / CELL_PX;
        const [ix, iz] = this.terrain.cellOf(x, z);
        if (this.terrain.cellValue(ix, iz) === AIR) {
            this.onPick(x, z);
            this.close();
        }
    }

    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        this.backdrop.clear().beginFill(0x000000, 0.75).drawRect(screen.topLeft.x, screen.topLeft.y, screen.width, screen.height).endFill();
        const side = Math.min(screen.width * 0.94, screen.height - 260);
        this.map.scale.set(side / this.canvas.width);
        this.frame.position.set(screen.center.x, screen.center.y - 20);
        const title = this.frame.getChildByName('title')!;
        title.y = -side / 2 - 12;
        const close = this.frame.getChildByName('close')!;
        close.position.set(side / 2 - 10, -side / 2 - 34);
        this.legend.style.wordWrapWidth = side;
        this.legend.y = side / 2 + 10;
    }
}
