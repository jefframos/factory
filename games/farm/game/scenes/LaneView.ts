import * as PIXI from "pixi.js";
import { LaneLayoutDefinition, ResourceType } from "./MiningDemoTypes";

export class LaneView extends PIXI.Container {
    private readonly graphics = new PIXI.Graphics();
    private readonly label: PIXI.Text;
    private readonly boxLabel: PIXI.Text;
    private storedAmount = 0;
    private isDepositFull = false;
    private miningProgress = 0;

    public constructor(
        public readonly layout: LaneLayoutDefinition,
        private readonly resourceType: ResourceType
    ) {
        super();

        this.addChild(this.graphics);

        this.label = new PIXI.Text("", new PIXI.TextStyle({
            fontFamily: "LEMONMILK-Bold",
            fontSize: 18,
            fill: 0xffffff,
            stroke: "#0c0808",
            strokeThickness: 4,
        }));

        this.label.position.set(16, 8);
        this.addChild(this.label);

        this.boxLabel = new PIXI.Text("0", new PIXI.TextStyle({
            fontFamily: "LEMONMILK-Bold",
            fontSize: 11,
            fill: 0x000000,
        }));
        this.boxLabel.anchor.set(0.5, 0.5);
        this.boxLabel.position.set(
            this.layout.depositSpot.x,
            this.layout.depositSpot.y + 47
        );
        this.addChild(this.boxLabel);

        this.draw();
    }

    public setStorageState(amount: number, isFull: boolean): void {
        this.storedAmount = amount;
        this.isDepositFull = isFull;
        this.boxLabel.text = amount.toFixed(0);
        this.draw();
    }

    public setMiningProgress(progress: number): void {
        this.miningProgress = Math.max(0, Math.min(1, progress));
        this.draw();
    }

    public getEntrancePosition(): PIXI.IPointData {
        return this.layout.entrance;
    }

    public getMiningSpotPosition(): PIXI.IPointData {
        const startSpot = this.layout.miningStartSpot ?? this.layout.miningSpot;
        const endSpot = this.layout.miningSpot;

        return {
            x: startSpot.x + (endSpot.x - startSpot.x) * this.miningProgress,
            y: startSpot.y + (endSpot.y - startSpot.y) * this.miningProgress,
        };
    }

    public getDepositSpotPosition(): PIXI.IPointData {
        return this.layout.depositSpot;
    }

    public getMiningQueuePosition(index: number): PIXI.IPointData {
        const miningSpot = this.getMiningSpotPosition();

        return {
            x: miningSpot.x +
                this.layout.miningQueueDirection.x *
                this.layout.miningQueueSpacing *
                (index + 1),
            y: miningSpot.y +
                this.layout.miningQueueDirection.y *
                this.layout.miningQueueSpacing *
                (index + 1),
        };
    }

    public getDepositQueuePosition(index: number): PIXI.IPointData {
        return {
            x: this.layout.depositSpot.x +
                this.layout.depositQueueDirection.x *
                this.layout.depositQueueSpacing *
                (index + 1),
            y: this.layout.depositSpot.y +
                this.layout.depositQueueDirection.y *
                this.layout.depositQueueSpacing *
                (index + 1),
        };
    }

    private draw(): void {
        this.graphics.clear();

        this.graphics.beginFill(0x101018, 0.55);
        this.graphics.lineStyle(2, 0xffffff, 0.18);
        this.graphics.drawRoundedRect(0, 0, this.layout.width, this.layout.height, 16);
        this.graphics.endFill();

        const entrance = this.layout.entrance;
        const miningSpot = this.getMiningSpotPosition();
        const depositSpot = this.layout.depositSpot;

        this.graphics.lineStyle(6, 0xffffff, 0.35);
        this.graphics.moveTo(entrance.x, entrance.y);
        this.graphics.lineTo(miningSpot.x, miningSpot.y);

        this.graphics.beginFill(0x5c3a1e);
        this.graphics.drawCircle(miningSpot.x, miningSpot.y, 35);
        this.graphics.endFill();

        this.graphics.beginFill(this.isDepositFull ? 0xff3333 : 0xffcc00);
        this.graphics.drawRect(depositSpot.x - 45, depositSpot.y + 35, 90, 25);
        this.graphics.endFill();

        this.drawQueueMarkers();

        this.label.text = `${this.resourceType.toUpperCase()} lane | stored: ${this.storedAmount.toFixed(1)}`;
    }

    private drawQueueMarkers(): void {
        this.graphics.lineStyle(2, 0xffffff, 0.2);

        const markerCount = 4;

        for (let i = 0; i < markerCount; i++) {
            const miningQueuePosition = this.getMiningQueuePosition(i);
            const depositQueuePosition = this.getDepositQueuePosition(i);

            this.graphics.drawCircle(
                miningQueuePosition.x,
                miningQueuePosition.y,
                18
            );

            this.graphics.drawCircle(
                depositQueuePosition.x,
                depositQueuePosition.y,
                18
            );
        }
    }
}
