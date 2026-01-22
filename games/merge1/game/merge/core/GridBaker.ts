import * as PIXI from "pixi.js";

export class GridBaker {
    private points: PIXI.Point[] = [];
    private currentIndex: number = 0;
    private randomRadius: number;

    constructor(
        private bounds: PIXI.Rectangle,
        private cellSize: number = 90
    ) {
        // Radius is roughly 40% of the cell size to keep things within bounds
        this.randomRadius = (this.cellSize / 2) * 0.8;
        this.bake();
    }

    public bake(): void {
        this.points = [];
        const columns = Math.floor(this.bounds.width / this.cellSize);
        const rows = Math.floor(this.bounds.height / this.cellSize);

        // Calculate starting offsets to center the whole grid in the bounds
        const spareWidth = this.bounds.width - (columns * this.cellSize);
        const spareHeight = this.bounds.height - (rows * this.cellSize);
        const startX = this.bounds.x + (spareWidth / 2);
        const startY = this.bounds.y + (spareHeight / 2);

        for (let c = 0; c < columns; c++) {
            for (let r = 0; r < rows; r++) {
                this.points.push(new PIXI.Point(
                    startX + (c * this.cellSize) + this.cellSize / 2,
                    startY + (r * this.cellSize) + this.cellSize / 2
                ));
            }
        }
        this.shuffle();
    }

    public shuffle(): void {
        for (let i = this.points.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.points[i], this.points[j]] = [this.points[j], this.points[i]];
        }
        this.currentIndex = 0;
    }

    /**
     * Gets the grid center and applies a random radial jitter
     */
    public getNextPoint(): PIXI.Point {
        const center = this.points[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.points.length;

        if (this.currentIndex === 0) this.shuffle();

        // Generate a random position within a circle (radius)
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * this.randomRadius;

        return new PIXI.Point(
            center.x + Math.cos(angle) * dist,
            center.y + Math.sin(angle) * dist
        );
    }
}