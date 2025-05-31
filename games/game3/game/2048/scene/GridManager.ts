import Pool from '@core/Pool';
import * as PIXI from 'pixi.js';
import { Signal } from 'signals';
import GameplayCharacterData from '../../character/GameplayCharacterData';
import { Direction } from '../../io/SwipeInputManager';
import { Piece } from '../view/Piece';

const GRID_SIZE = 4;
const TILE_SIZE_WIDTH = 160;
const TILE_SIZE_HEIGHT = 160;
const TILE_PADDING = 10;

export type MovementResult = {
    isValid: boolean,
    mergedValue: number;
    newPieceId?: number;
    mergedValues: number[];
};

export class GridManager {
    private grid: (Piece | null)[][] = [];
    private container: PIXI.Container;
    private backgroundContainer: PIXI.Container;
    private latestDirection: Direction = 'right';
    public points = 0;
    public moveCount = 0;
    public spawnedPieces: Piece[] = [];
    public onPointsUpdated: Signal = new Signal();
    public onGameOver: Signal = new Signal();
    public onWin: Signal = new Signal();

    constructor(container: PIXI.Container) {
        this.container = container;

        this.backgroundContainer = new PIXI.Container();
        this.container.addChild(this.backgroundContainer);
        this.backgroundContainer.zIndex = -88888888;
        this.container.sortableChildren = true;

        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const tile = new PIXI.NineSlicePlane(PIXI.Texture.from('ItemFrame03_Single_Gray'), 10, 10, 10, 10);
                tile.width = TILE_SIZE_WIDTH;
                tile.height = TILE_SIZE_HEIGHT;
                const pos = this.getTilePosition(x, y);
                tile.position.set(pos.x, pos.y);
                this.backgroundContainer.addChild(tile);
            }
        }

        this.container.pivot.x = this.backgroundContainer.width / 2;
        this.container.pivot.y = this.backgroundContainer.height / 2;

        for (let y = 0; y < GRID_SIZE; y++) {
            this.grid[y] = [];
            for (let x = 0; x < GRID_SIZE; x++) {
                this.grid[y][x] = null;
            }
        }
    }

    public start() {
        this.spawnInitialTiles();
    }

    public reset() {
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const piece = this.grid[y][x];
                if (piece) {
                    Pool.instance.returnElement(piece);
                    this.container.removeChild(piece);
                }
                this.grid[y][x] = null;
            }
        }
        this.points = 0;
        this.moveCount = 0;
        this.spawnedPieces = [];
        this.onPointsUpdated.dispatch(this.points);
    }

    public spawnInitialTiles() {
        this.spawnRandomTile();
        this.spawnRandomTile();
    }

    update(delta: number) {
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const piece = this.grid[y][x];
                if (piece) {
                    piece.update(delta);
                }
            }
        }
    }

    private getTilePosition(x: number, y: number): { x: number; y: number } {
        return {
            x: x * (TILE_SIZE_WIDTH + TILE_PADDING),
            y: y * (TILE_SIZE_HEIGHT + TILE_PADDING),
        };
    }

    private async spawnRandomTile() {
        const empty: { x: number, y: number }[] = [];
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                if (!this.grid[y][x]) empty.push({ x, y });
            }
        }

        if (empty.length === 0) return;

        const spot = empty[Math.floor(Math.random() * empty.length)];
        const value = Math.random() < 0.9 ? 2 : 4;
        const power = Math.log2(value) - 1;

        const piece = Pool.instance.getElement<Piece>(Piece);
        piece.build(TILE_SIZE_WIDTH, TILE_SIZE_HEIGHT);
        console.log(power, GameplayCharacterData.fetchById(power))
        piece.reset(value, GameplayCharacterData.fetchById(power));
        piece.setDirection(this.getVector(this.latestDirection));

        const pos = this.getTilePosition(spot.x, spot.y);
        piece.position.set(pos.x, pos.y);

        this.container.addChild(piece);
        this.grid[spot.y][spot.x] = piece;
        this.spawnedPieces.push(piece);
        await piece.pop();
    }

    public async move(direction: Direction): Promise<MovementResult> {
        let moved = false;
        let totalMergedValue = 0;
        let newPieceId: number | undefined;
        const mergedValues: number[] = [];

        const transitions: Promise<void>[] = [];

        const vector = this.getVector(direction);
        this.latestDirection = direction;
        const traversal = this.buildTraversals(vector);

        this.resetMergeFlags();

        for (const y of traversal.y) {
            for (const x of traversal.x) {
                const piece = this.grid[y][x];
                if (!piece) continue;

                piece.setDirection(vector);

                let currentX = x;
                let currentY = y;
                let { x: farX, y: farY } = this.findFarthestPosition(currentX, currentY, vector);
                let nextX = farX + vector.x;
                let nextY = farY + vector.y;

                const nextPiece = this.grid[nextY]?.[nextX];

                if (nextPiece && nextPiece.value === piece.value && !nextPiece.merged) {
                    this.grid[currentY][currentX] = null;
                    this.grid[nextY][nextX] = piece;
                    piece.merged = true;
                    nextPiece.merged = true;

                    const pos = this.getTilePosition(nextX, nextY);
                    const newValue = piece.value * 2;

                    transitions.push(
                        piece.moveTo(pos.x, pos.y).then(() => {
                            Pool.instance.returnElement(nextPiece);
                            this.container.removeChild(nextPiece);

                            const power = Math.log2(newValue) - 1;
                            piece.reset(newValue, GameplayCharacterData.fetchById(power));
                            piece.upgrade();

                            this.points += newValue;
                            this.onPointsUpdated.dispatch(this.points);

                            if (newValue === 2048) {
                                this.onWin.dispatch();
                            }

                            const highScore = parseInt(localStorage.getItem('highscore') || '0');
                            if (this.points > highScore) {
                                localStorage.setItem('highscore', String(this.points));
                            }

                            totalMergedValue += newValue;
                            mergedValues.push(piece.value);
                            newPieceId = newValue;
                        })
                    );

                    moved = true;
                } else {
                    if (farX !== currentX || farY !== currentY) {
                        this.grid[currentY][currentX] = null;
                        this.grid[farY][farX] = piece;

                        const pos = this.getTilePosition(farX, farY);
                        transitions.push(piece.moveTo(pos.x, pos.y));

                        moved = true;
                    }
                }
            }
        }

        await Promise.all(transitions);


        if (moved) {
            this.moveCount++;
            await this.spawnRandomTile();
        }

        if (!this.canMove()) {
            this.onGameOver.dispatch();
        }

        return {
            mergedValue: totalMergedValue,
            newPieceId,
            isValid: moved,
            mergedValues
        };
    }

    private canMove(): boolean {
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const current = this.grid[y][x];
                if (!current) return true;
                for (const [dx, dy] of [[1, 0], [0, 1]]) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= GRID_SIZE || ny >= GRID_SIZE) continue;
                    const neighbor = this.grid[ny][nx];
                    if (neighbor && neighbor.value === current.value) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private findFarthestPosition(x: number, y: number, vector: { x: number; y: number }) {
        let previous;
        do {
            previous = { x, y };
            x += vector.x;
            y += vector.y;
        } while (this.withinBounds(x, y) && !this.grid[y][x]);

        return previous;
    }

    private getVector(dir: Direction): { x: number; y: number } {
        switch (dir) {
            case 'up': return { x: 0, y: -1 };
            case 'down': return { x: 0, y: 1 };
            case 'left': return { x: -1, y: 0 };
            case 'right': return { x: 1, y: 0 };
        }
    }

    private buildTraversals(vector: { x: number; y: number }) {
        const x = [...Array(GRID_SIZE).keys()];
        const y = [...Array(GRID_SIZE).keys()];
        if (vector.x > 0) x.reverse();
        if (vector.y > 0) y.reverse();
        return { x, y };
    }

    private withinBounds(x: number, y: number) {
        return x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE;
    }

    private resetMergeFlags() {
        for (let row of this.grid) {
            for (let piece of row) {
                if (piece && 'merged' in piece) {
                    delete (piece as any).merged;
                }
            }
        }
    }
}