import Pool from "@core/Pool";
import gsap from "gsap";
import * as PIXI from "pixi.js";
import { Difficulty } from "../HexTypes";
import { ClusterGenerator } from "./ClusterGenerator";
import { ClusterView } from "./ClusterView";


export class ClusterManager extends PIXI.Container {
    private activeClusters: ClusterView[] = [];
    public getPieces(): ClusterView[] {
        return this.activeClusters;
    }

    public initPuzzle(matrix: any, difficulty: Difficulty): void {
        this.reset();
        const puzzleData = ClusterGenerator.generateFromGrid(matrix, difficulty);
        const maxWidth = 1200;
        const horizontalSpacing = 60;
        const rowGap = 50; // Extra buffer between rows

        const rows: ClusterView[][] = [[]];
        let currentRowIndex = 0;
        let currentRowWidth = 0;

        // 1. Create views and group them into rows based on width
        puzzleData.forEach((data) => {
            const view = Pool.instance.getElement(ClusterView);
            view.setup(data);
            view.scale.set(1);

            const b = view.getLocalBounds();
            const pieceWidth = b.width;

            // Check for wrapping
            if (currentRowWidth + pieceWidth + horizontalSpacing > maxWidth && rows[currentRowIndex].length > 0) {
                currentRowIndex++;
                rows[currentRowIndex] = [];
                currentRowWidth = 0;
            }

            rows[currentRowIndex].push(view);
            currentRowWidth += pieceWidth + horizontalSpacing;

            this.addChild(view);
            this.activeClusters.push(view);
        });

        // 2. Position pieces: Center each row and track dynamic height
        let currentY = 0;

        rows.forEach((rowPieces) => {
            let maxRowHeight = 0;
            let totalRowWidth = 0;

            // Calculate this specific row's dimensions
            rowPieces.forEach((view, i) => {
                const b = view.getLocalBounds();
                totalRowWidth += b.width;
                if (i < rowPieces.length - 1) totalRowWidth += horizontalSpacing;
                if (b.height > maxRowHeight) maxRowHeight = b.height;
            });

            // Start X at negative half of the total row width to center it at x=0
            let startX = -totalRowWidth / 2;

            rowPieces.forEach((view) => {
                const b = view.getLocalBounds();

                // Adjust for the piece's own internal center
                // offsetToPixel creates shapes where (0,0) is the top-left tile
                const offsetX = -b.x;
                const offsetY = -b.y;

                view.x = startX + offsetX;
                view.y = currentY + offsetY;

                startX += b.width + horizontalSpacing;
            });

            // Advance currentY by the tallest piece in this row + gap
            currentY += maxRowHeight + rowGap;
        });

        // 3. Final vertical centering of the whole group
        const finalBounds = this.getLocalBounds();
        this.children.forEach(child => {
            // We only center Y globally because X is already centered at 0 per row
            child.y -= finalBounds.height / 2 + finalBounds.y;
        });

        // 4. Record home positions
        this.activeClusters.forEach(view => {
            view.homePosition.copyFrom(view.position);
        });
    }
    public returnToTray(piece: ClusterView): void {
        this.addChild(piece);
        // You can either snap it back to its exact starting local position 
        // or trigger a layout refresh:
        this.reLayout();
    }

    private reLayout(): void {
        const bounds = this.getLocalBounds();
        this.children.forEach(child => {
            child.scale.set(1); // Reset scale from the "drag lift"
            // re-center logic...
        });
    }

    public reset(): void {
        this.removeChildren();
        this.activeClusters.forEach(view => {
            gsap.killTweensOf(view);
            gsap.killTweensOf(view.scale);
            Pool.instance.returnElement(view);
        });
        this.activeClusters = [];
        this.position.set(0, 0);
        this.scale.set(1);
    }
}