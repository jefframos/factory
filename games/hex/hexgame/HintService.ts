import * as PIXI from "pixi.js";
import { ClusterManager } from "./cluster/ClusterManager";
import { HexGridView } from "./HexGridView";
import { HexPos } from "./HexTypes";

interface ActiveHint {
    interval: any;
    affectedHexes: {
        hex: PIXI.Graphics | PIXI.Sprite,
        originalParent: PIXI.Container,
        index: number
    }[];
}

export class HintService {
    private activeHint: ActiveHint | null = null;

    constructor(
        private clusterManager: ClusterManager,
        private gridView: HexGridView
    ) { }

    /**
     * Starts a new hint. Only picks pieces currently in the tray.
     */
    public showHint(): void {
        this.stopHint(); // Ensure any previous hint is cleaned up

        // 1. Get pieces strictly in the tray
        const trayPieces = this.clusterManager.getPieces().filter(piece =>
            piece.parent === this.clusterManager
        );

        if (trayPieces.length === 0) return;

        // 2. Pick a random piece
        const hintPiece = trayPieces[Math.floor(Math.random() * trayPieces.length)];

        // 3. Calculate solution coordinates
        const solutionCoords: HexPos[] = hintPiece.data.coords.map(c => ({
            q: hintPiece.data.rootPos.q + c.q,
            r: hintPiece.data.rootPos.r + c.r
        }));

        // 4. Trigger the visual blink
        this.activeHint = this.gridView.blinkTiles(solutionCoords);
    }

    /**
     * Interrupts and cleans up the current hint.
     * Call this when a player starts dragging a piece.
     */
    public stopHint(): void {
        if (this.activeHint) {
            this.gridView.stopBlink(this.activeHint);
            this.activeHint = null;
        }
    }

    /**
     * Optional: Check if a hint is currently running
     */
    public get isHintActive(): boolean {
        return this.activeHint !== null;
    }
}