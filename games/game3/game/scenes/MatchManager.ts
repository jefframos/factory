import { GlobalDataManager } from './data/GlobalDataManager';
import { MovementResult } from './GridManager';

export type GameStatus = 'waiting' | 'playing' | 'won' | 'lost';

export default class MatchManager {

    public matchTimer: number = 0;
    private startTime: number = 0;
    private status: GameStatus = 'waiting';
    private moveHistory: MovementResult[] = [];
    private mergeStats: Map<number, number> = new Map();
    private pieceCount: Map<number, number> = new Map();
    public moveCounter: number = 0;
    public highestPiece: number = 0;
    public matchPoints: number = 0;
    public static globalMoveCounterKey: string = 'globalMoveCounter';

    constructor() {
        this.loadGlobalMoveCounter();
    }

    public start(): void {
        if (this.status === 'waiting') {
            this.status = 'playing';
            this.startTime = performance.now();
        }
    }

    public reset(): void {
        this.matchTimer = 0;
        this.status = 'waiting';
        this.moveHistory = [];
        this.mergeStats.clear();
        this.pieceCount.clear();
        this.moveCounter = 0;
        this.highestPiece = 0;
    }
    setPoints(points: number) {
        this.matchPoints = points;
    }
    public update(delta: number): void {
        if (this.status === 'playing') {
            this.matchTimer += delta;
        }
    }

    public registerMove(result: MovementResult): void {
        if (this.status === 'waiting') {
            this.start(); // auto-start on first move
        }

        this.moveCounter++;
        MatchManager.incrementGlobalMoveCounter();
        this.moveHistory.push(result);

        for (const value of result.mergedValues) {
            this.increment(this.mergeStats, value);
            this.highestPiece = Math.max(this.highestPiece, value);
        }

        if (result.newPieceId && result.mergedValue > 0) {
            const finalValue = result.mergedValue;
            this.increment(this.pieceCount, finalValue);
            if (finalValue >= 2048 && this.status === 'playing') {
                this.status = 'won';
            }
        }
        //console.log(this.getReadableStats())
    }

    public async checkResults(): Promise<GameStatus> {
        return this.status;
    }

    public getReadableStats(): string {
        const mergeList = Array.from(this.mergeStats.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([val, count]) => `Merged ${val}: ${count}`)
            .join('\n');

        const createdList = Array.from(this.pieceCount.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([val, count]) => `Created ${val}: ${count}`)
            .join('\n');

        return `=== Match Stats ===\nTime: ${(this.matchTimer / 1000).toFixed(1)}s\nMoves: ${this.moveCounter}\nHighest Piece: ${this.highestPiece}\n\n${mergeList}\n\n${createdList}`;
    }

    private increment(map: Map<number, number>, key: number): void {
        map.set(key, (map.get(key) ?? 0) + 1);
    }

    private static incrementGlobalMoveCounter(): void {
        const current = parseInt(GlobalDataManager.getData(this.globalMoveCounterKey) || '0');
        GlobalDataManager.setData(this.globalMoveCounterKey, String(current + 1));
    }

    private loadGlobalMoveCounter(): void {
        const current = GlobalDataManager.getData(MatchManager.globalMoveCounterKey);
        if (!current) {
            GlobalDataManager.setData(MatchManager.globalMoveCounterKey, '0');
        }
    }
}
