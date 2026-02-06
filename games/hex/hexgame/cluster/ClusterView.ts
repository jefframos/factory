import * as PIXI from "pixi.js";
import { ClusterData, HexUtils } from "../HexTypes";

export class ClusterView extends PIXI.Container {
    public data!: ClusterData;
    private graphics: PIXI.Graphics = new PIXI.Graphics();
    public visualCenter: PIXI.Point = new PIXI.Point();
    public homePosition: PIXI.Point = new PIXI.Point();

    constructor() {
        super();
        this.addChild(this.graphics);
    }

    public setup(data: ClusterData): void {
        this.graphics.clear();
        this.data = data;
        //this.scale.set(0.6); // Clusters are usually smaller than the main grid

        data.coords.forEach(coord => {
            const pos = HexUtils.offsetToPixel(coord.q, coord.r);
            this.graphics.lineStyle(2, 0x000000, 0.5);
            this.graphics.beginFill(data.color);

            const points = [];
            for (let i = 0; i < 6; i++) {
                const angle = (Math.PI / 180) * (60 * i - 30);
                points.push(pos.x + HexUtils.HEX_SIZE * Math.cos(angle), pos.y + HexUtils.HEX_SIZE * Math.sin(angle));
            }
            this.graphics.drawPolygon(points);
            this.graphics.endFill();
        });



        const bounds = this.graphics.getLocalBounds();
        this.visualCenter.set(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    }

    public reset(): void {
        this.graphics.clear();
        this.position.set(0);
    }
}