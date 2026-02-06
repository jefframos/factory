import gsap from "gsap";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import { DevGuiManager } from "../game/utils/DevGuiManager";
import { ClusterManager } from "./cluster/ClusterManager";
import { ClusterView } from "./cluster/ClusterView";
import { HexGridBuilder } from "./HexGridBuilder";
import { HexGridView } from "./HexGridView";
import { HexInputService } from "./HexInputService";
import { Difficulty, HexPos, HexUtils } from "./HexTypes";
import { HexHUD } from "./ui/HexHud";

export class HexGameMediator {
    private debugGraphics?: PIXI.Graphics;
    private inputService: HexInputService;
    private isAutoCompleting: boolean = false;
    public readonly onRestart: Signal = new Signal();
    constructor(
        private gridArea: PIXI.Rectangle,
        private piecesArea: PIXI.Rectangle,
        public Grid: HexGridView,
        public Manager: ClusterManager,
        public GameLayer: PIXI.Container, // common parent for shared coordinates
        public Root: PIXI.Container,       // stage for events
        private hud: HexHUD
    ) {
        this.layout();
        this.inputService = new HexInputService(this);

        DevGuiManager.instance.addButton("Show Hint", () => this.showHint());
        DevGuiManager.instance.addButton("Auto Complete", () => this.autoComplete());
        DevGuiManager.instance.addButton("Complete 1", () => this.solveOnePiece());

        this.wireSignals();
    }
    public resetGame(): void {
        // 1. Stop any current input interactions
        this.inputService.enabled = false;

        // 2. Clear the Grid occupancy logic and views
        // Assuming your HexGridView has a reset/clear method
        this.Grid.removeChildren();
        // If your grid has a specific logic reset, call it here: 
        // this.Grid.resetLogic();

        // 3. Reset the Cluster Manager (returns pieces to pool)
        this.Manager.reset();

        // 4. Reset state flags
        this.isAutoCompleting = false;

        console.log("Mediator: Game components reset.");
    }

    private wireSignals(): void {
        // ... existing signals ...

        // When the HUD or Main class triggers a restart
        this.hud.onNewPuzzle.add(() => {
            // Force reset of any piece currently in the air
            this.inputService.forceResetHeldPiece();

            // Clean up the current board
            this.resetGame();

            // Dispatch to Main class to generate a new matrix and call initPuzzle again
            this.onRestart.dispatch({});

            // Re-enable input
            this.inputService.enabled = true;
        });

        // Auto Complete Logic
        this.hud.onAutoComplete.add(() => {
            console.log("HUD: Requesting Auto Complete");
            this.autoComplete();
        });

        // Reset Board Logic
        this.hud.onResetBoard.add(() => {
            console.log("HUD: Requesting Reset");
            this.resetBoard();
        });
    }

    public startLevel(matrix: any, difficulty: Difficulty): void {
        // 1. Logic cleanup
        this.inputService.forceResetHeldPiece();
        this.inputService.enabled = false;

        // 2. Re-init Grid (Visual Background + Logic)
        const { data } = HexGridBuilder.buildFromMatrix(matrix);
        this.Grid.init(data);

        // 3. Re-init Pieces (Generate + Pool Setup)
        this.Manager.initPuzzle(matrix, difficulty);

        // 4. Refresh layout
        this.layout();
        this.inputService.enabled = true;
    }

    /**
     * Entry point for just clearing the current board
     */
    public resetCurrentLevel(): void {
        this.inputService.forceResetHeldPiece();
        this.Grid.reset(); // Clears pieces from grid
        this.Manager.getPieces().forEach(p => this.returnToTray(p)); // Moves them to tray
    }

    public layout(): void {
        this.layoutGrid();
        this.layoutPieces();
    }

    private layoutGrid(): void {
        const targetX = this.gridArea.x + this.gridArea.width / 2;
        const targetY = this.gridArea.y + this.gridArea.height / 2;

        this.Grid.position.set(targetX, targetY);

        const bounds = this.Grid.getLocalBounds();
        const scaleX = (this.gridArea.width * 0.9) / bounds.width;
        const scaleY = (this.gridArea.height * 0.9) / bounds.height;
        const finalScale = Math.min(scaleX, scaleY, 1);

        this.Grid.scale.set(finalScale);
    }

    public showHint(): void {
        // 1. Get all pieces
        const allPieces = this.Manager.getPieces(); // Assuming Manager has a way to return all ClusterViews

        // 2. Filter for pieces that are NOT at their solution position
        const incorrectPieces = allPieces.filter(piece => {
            const currentPos = this.getGridPositionOfPiece(piece);
            if (!currentPos) return true; // In tray = incorrect
            return currentPos.q !== piece.data.rootPos.q || currentPos.r !== piece.data.rootPos.r;
        });

        if (incorrectPieces.length === 0) return;

        // 3. Pick a random piece from the "wrong" ones
        const hintPiece = incorrectPieces[Math.floor(Math.random() * incorrectPieces.length)];

        // 4. Calculate the absolute grid coordinates where it belongs
        const solutionCoords = hintPiece.data.coords.map(c => ({
            q: hintPiece.data.rootPos.q + c.q,
            r: hintPiece.data.rootPos.r + c.r
        }));

        // 5. Blink those tiles on the grid
        this.Grid.blinkTiles(solutionCoords);
    }

    public async autoComplete(): Promise<void> {
        if (this.isAutoCompleting) return;
        this.isAutoCompleting = true;
        this.inputService.enabled = false

        const allPieces = this.Manager.getPieces();

        for (const piece of allPieces) {
            const currentGridPos = this.getGridPositionOfPiece(piece);
            const isCorrect = currentGridPos &&
                currentGridPos.q === piece.data.rootPos.q &&
                currentPos.r === piece.data.rootPos.r;

            if (!isCorrect) {
                await this.movePieceToCorrectSlot(piece);
            }
        }

        this.isAutoCompleting = false;
        this.inputService.enabled = true
        console.log("Puzzle Auto-Completed!");
    }

    private async movePieceToCorrectSlot(piece: ClusterView): Promise<void> {
        // 1. Remove from current occupancy logic if it was on the grid
        this.Grid.removePiece(piece);

        // 2. Map the piece's current global position to the GameLayer (workspace)
        const startGlobalPos = piece.getGlobalPosition();
        const startLocalPos = this.GameLayer.toLocal(startGlobalPos);

        this.GameLayer.addChild(piece);
        piece.position.copyFrom(startLocalPos);

        // 3. Calculate target position in GameLayer
        // We find where the root axial coordinate is in Grid space, then map to GameLayer
        const targetGridPos = HexUtils.offsetToPixel(piece.data.rootPos.q, piece.data.rootPos.r);
        const targetGlobalPos = this.Grid.toGlobal(targetGridPos);
        const targetLayerPos = this.GameLayer.toLocal(targetGlobalPos);

        // 4. Animate!
        await gsap.to(piece, {
            x: targetLayerPos.x,
            y: targetLayerPos.y,
            duration: 0.5,
            ease: "power2.out",
            onStart: () => {
                // Smoothly transition scale to match Grid scale
                gsap.to(piece.scale, {
                    x: this.Grid.scale.x,
                    y: this.Grid.scale.y,
                    duration: 0.3
                });
            }
        });

        // 5. Final Parenting to Grid
        this.Grid.addChild(piece);
        piece.scale.set(1); // Scale becomes 1 relative to the already scaled Grid
        piece.position.copyFrom(targetGridPos);

        // 6. Update occupancy data
        const snappedCoords = piece.data.coords.map(c => ({
            q: piece.data.rootPos.q + c.q,
            r: piece.data.rootPos.r + c.r
        }));
        this.Grid.placePiece(piece, snappedCoords);
    }


    public async solveOnePiece(): Promise<void> {
        if (this.isAutoCompleting) return;
        this.isAutoCompleting = true;

        // 1. Find all pieces not in their correct solution slot
        const allPieces = this.Manager.getPieces();
        const incorrectPieces = allPieces.filter(piece => {
            const currentGridPos = this.getGridPositionOfPiece(piece);
            if (!currentGridPos) return true; // In tray
            return currentGridPos.q !== piece.data.rootPos.q ||
                currentGridPos.r !== piece.data.rootPos.r;
        });

        if (incorrectPieces.length === 0) {
            this.isAutoCompleting = false;
            return;
        }

        // 2. Select a random target piece
        const targetPiece = incorrectPieces[Math.floor(Math.random() * incorrectPieces.length)];

        // 3. Identify coordinates this piece NEEDS to occupy
        const neededCoords = targetPiece.data.coords.map(c => ({
            q: targetPiece.data.rootPos.q + c.q,
            r: targetPiece.data.rootPos.r + c.r
        }));

        // 4. Evict any pieces currently occupying those specific coordinates
        const piecesToEvict = new Set<ClusterView>();
        neededCoords.forEach(coord => {
            const occupant = this.Grid.getOccupantAt(coord.q, coord.r);
            if (occupant && occupant !== targetPiece) {
                piecesToEvict.add(occupant);
            }
        });

        // 5. Return evicted pieces to tray
        for (const piece of piecesToEvict) {
            this.Grid.removePiece(piece);
            // Optional: Add a quick gsap tween to the tray instead of instant snap
            this.returnToTray(piece);
        }

        // 6. Move the target piece to its correct slot
        await this.movePieceToCorrectSlot(targetPiece);

        this.isAutoCompleting = false;
    }
    public resetBoard(): void {
        const allPieces = this.Manager.getPieces();
        this.inputService.forceResetHeldPiece();
        allPieces.forEach(piece => {
            // Only return pieces that are currently on the Grid
            if (piece.parent === this.Grid) {
                // 1. Tell the Grid logic the piece is no longer occupying tiles
                this.Grid.removePiece(piece);

                // 2. Use your existing returnToTray logic for animation and re-parenting
                this.returnToTray(piece);
            }
        });
    }

    public clearBoardInstant(): void {
        const allPieces = this.Manager.getPieces();
        this.inputService.forceResetHeldPiece();
        allPieces.forEach(piece => {
            this.Grid.removePiece(piece);

            // Instant snap
            piece.position.copyFrom(piece.homePosition);
            piece.scale.set(1);
            this.Manager.addChild(piece);
        });
        this.Grid.clearPreview();
    }

    /**
     * Helper to check where a piece is currently snapped on the grid
     */
    private getGridPositionOfPiece(piece: ClusterView): HexPos | null {
        if (piece.parent !== this.Grid) return null;

        // Reverse math from pixel to axial
        const gridLocal = piece.position;
        const r = Math.round(gridLocal.y / HexUtils.VERTICAL_SPACING);
        const isOdd = r % 2 !== 0;
        const xOffset = isOdd ? (HexUtils.WIDTH / 2) : 0;
        const q = Math.round((gridLocal.x - xOffset) / HexUtils.WIDTH);

        return { q, r };
    }

    private layoutPieces(): void {
        const targetX = this.piecesArea.x + this.piecesArea.width / 2;
        const targetY = this.piecesArea.y + this.piecesArea.height / 2;

        this.Manager.position.set(targetX, targetY);

        const pBounds = this.Manager.getLocalBounds();
        // prevent division by zero if manager is empty
        if (pBounds.width === 0 || pBounds.height === 0) return;

        const scaleX = (this.piecesArea.width * 0.9) / pBounds.width;
        const scaleY = (this.piecesArea.height * 0.9) / pBounds.height;
        const scale = Math.min(scaleX, scaleY, 0.8);

        this.Manager.scale.set(scale);
    }

    public returnToTray(piece: ClusterView): void {
        // 1. Re-parent to the Manager
        const pos = piece.getGlobalPosition();
        const localPos = this.Manager.toLocal(pos);
        piece.position.copyFrom(localPos);
        this.Manager.addChild(piece);

        // 2. The piece's local scale must now be 1.0 relative to the Manager.
        // However, the Manager itself has a scale (calculated in layoutPieces).
        // To make it smooth, we animate the scale back to 1.
        gsap.to(piece.scale, {
            x: 1,
            y: 1,
            duration: 0.3,
            ease: "back.out(1.7)"
        });

        // 3. Move it back to its specific home position in the tray
        gsap.to(piece.position, {
            x: piece.homePosition.x,
            y: piece.homePosition.y,
            duration: 0.4,
            ease: "power2.out"
        });

        this.Grid.clearPreview();
    }

    public drawDebugZones(): void {
        if (this.debugGraphics) {
            this.debugGraphics.parent?.removeChild(this.debugGraphics);
        }

        this.debugGraphics = new PIXI.Graphics();

        // grid zone (blue)
        this.debugGraphics.lineStyle(4, 0x00AAFF, 1);
        this.debugGraphics.drawRect(this.gridArea.x, this.gridArea.y, this.gridArea.width, this.gridArea.height);

        // pieces zone (orange)
        this.debugGraphics.lineStyle(4, 0xFFAA00, 1);
        this.debugGraphics.drawRect(this.piecesArea.x, this.piecesArea.y, this.piecesArea.width, this.piecesArea.height);

        this.Root.addChild(this.debugGraphics);
    }
}