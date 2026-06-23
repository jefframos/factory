import * as PIXI from "pixi.js";
import { OfficeDefinition, ResourceType } from "./MiningDemoTypes";
import { TextPopSystem } from "./TextPopSystem";

export class OfficeEntity extends PIXI.Container {
    public static readonly WIDTH = 700;
    public static readonly HEIGHT = 120;

    private readonly background = new PIXI.Graphics();
    private readonly dropbox = new PIXI.Container();
    private readonly dropboxGraphics = new PIXI.Graphics();
    private readonly officeDepositGraphics = new PIXI.Graphics();
    private readonly label: PIXI.Text;
    private readonly dropboxLabel: PIXI.Text;
    private readonly workerContainer = new PIXI.Container();

    public onResourcesChanged: ((data: Record<ResourceType, number>) => void) | undefined;
    public onDropboxChanged: ((data: Record<ResourceType, number>) => void) | undefined;

    private resources: Record<ResourceType, number> = {
        gold: 0,
        iron: 0,
        coal: 0,
        crystal: 0,
    };

    private dropboxResources: Record<ResourceType, number> = {
        gold: 0,
        iron: 0,
        coal: 0,
        crystal: 0,
    };

    public constructor(
        private readonly def: OfficeDefinition,
        private readonly textPopSystem: TextPopSystem
    ) {
        super();

        this.position.set(def.position.x, def.position.y);

        // Draw lane-like background
        this.background.beginFill(0x4a3c28);
        this.background.drawRect(0, 0, OfficeEntity.WIDTH, OfficeEntity.HEIGHT);
        this.background.endFill();
        this.background.lineStyle(2, 0x8b7355, 1);
        this.background.drawRect(0, 0, OfficeEntity.WIDTH, OfficeEntity.HEIGHT);
        this.addChild(this.background);

        // Draw dropbox on the left side
        this.drawDropbox();
        this.addChild(this.dropbox);

        // Draw final office deposit zone on the far right.
        this.officeDepositGraphics.beginFill(0x4caf50);
        this.officeDepositGraphics.drawRect(625, 30, 50, 60);
        this.officeDepositGraphics.endFill();
        this.officeDepositGraphics.lineStyle(2, 0xa5d6a7, 1);
        this.officeDepositGraphics.drawRect(625, 30, 50, 60);
        this.addChild(this.officeDepositGraphics);

        // Worker container for workers inside office
        this.addChild(this.workerContainer);

        this.label = new PIXI.Text("", new PIXI.TextStyle({
            fontFamily: "LEMONMILK-Bold",
            fontSize: 18,
            fill: 0xffffff,
            stroke: "#0c0808",
            strokeThickness: 3,
        }));

        this.label.position.set(290, 14);
        this.label.text = "OFFICE";
        this.addChild(this.label);

        this.dropboxLabel = new PIXI.Text("BOX: 0", new PIXI.TextStyle({
            fontFamily: "LEMONMILK-Bold",
            fontSize: 14,
            fill: 0xffffff,
            stroke: "#0c0808",
            strokeThickness: 3,
        }));
        this.dropboxLabel.position.set(120, 46);
        this.addChild(this.dropboxLabel);

        this.refreshDropboxLabel();
    }

    private drawDropbox(): void {
        this.dropbox.position.set(55, 30);

        this.dropboxGraphics.beginFill(0xffaa00);
        this.dropboxGraphics.drawRect(0, 0, 50, 60);
        this.dropboxGraphics.endFill();
        this.dropboxGraphics.lineStyle(2, 0xffdd00, 1);
        this.dropboxGraphics.drawRect(0, 0, 50, 60);

        this.dropbox.addChild(this.dropboxGraphics);
    }

    public getWorkerContainer(): PIXI.Container {
        return this.workerContainer;
    }

    public loadResources(data: Record<ResourceType, number>): void {
        this.resources.gold = data.gold ?? 0;
        this.resources.iron = data.iron ?? 0;
        this.resources.coal = data.coal ?? 0;
        this.resources.crystal = data.crystal ?? 0;
    }

    public loadDropboxResources(data: Record<ResourceType, number>): void {
        this.dropboxResources.gold = data.gold ?? 0;
        this.dropboxResources.iron = data.iron ?? 0;
        this.dropboxResources.coal = data.coal ?? 0;
        this.dropboxResources.crystal = data.crystal ?? 0;
        this.refreshDropboxLabel();
    }

    public getEconomyData(): Record<ResourceType, number> {
        return { ...this.resources };
    }

    public getDropboxPositionGlobal(): PIXI.Point {
        return this.toGlobal(new PIXI.Point(this.dropbox.x + 25, this.dropbox.y + 30));
    }

    public getWorkerPickupPosition(index: number): PIXI.IPointData {
        return {
            x: 145 + index * 26,
            y: 60,
        };
    }

    public getWorkerDepositPosition(index: number): PIXI.IPointData {
        return {
            x: 595 - index * 20,
            y: 60,
        };
    }

    public getDropboxResourceAmount(): number {
        return this.dropboxResources.gold +
            this.dropboxResources.iron +
            this.dropboxResources.coal +
            this.dropboxResources.crystal;
    }

    public depositToDropbox(
        resourceType: ResourceType,
        amount: number
    ): number {
        const acceptable = Math.min(500, amount);

        this.dropboxResources[resourceType] += acceptable;
        this.refreshDropboxLabel();
        this.onDropboxChanged?.(this.dropboxResources);

        if (acceptable > 0) {
            const worldPos = this.toGlobal(new PIXI.Point(this.dropbox.x + 25, -15));
            this.textPopSystem.show(
                `Dropbox: +${acceptable.toFixed(1)}`,
                worldPos.x,
                worldPos.y
            );
        }

        return acceptable;
    }

    public pickupFromDropbox(resourceType: ResourceType, amount: number): number {
        const available = Math.min(this.dropboxResources[resourceType], amount);

        this.dropboxResources[resourceType] -= available;
        this.refreshDropboxLabel();
        this.onDropboxChanged?.(this.dropboxResources);

        return available;
    }


    public getResourceAmount(resourceType: ResourceType): number {
        return this.resources[resourceType];
    }

    public getAllResources(): Partial<Record<ResourceType, number>> {
        return {
            gold: this.resources.gold,
            iron: this.resources.iron,
            coal: this.resources.coal,
            crystal: this.resources.crystal,
        };
    }

    public canAcceptResource(resourceType: ResourceType, amount: number): number {
        const total = this.resources.gold +
            this.resources.iron +
            this.resources.coal +
            this.resources.crystal;

        const remaining = Math.max(0, this.def.depositLimit - total);
        return Math.min(remaining, amount);
    }

    public depositResource(
        resourceType: ResourceType,
        amount: number
    ): number {
        const acceptable = this.canAcceptResource(resourceType, amount);

        if (acceptable <= 0) {
            return 0;
        }

        this.resources[resourceType] += acceptable;
        this.onResourcesChanged?.(this.getEconomyData());

        if (acceptable > 0) {
            const worldPos = this.toGlobal(new PIXI.Point(300, -15));
            this.textPopSystem.show(
                `+${acceptable.toFixed(1)} ${resourceType}`,
                worldPos.x,
                worldPos.y
            );
        }

        return acceptable;
    }

    public spendResource(resourceType: ResourceType, amount: number): boolean {
        if (this.resources[resourceType] < amount) {
            return false;
        }

        this.resources[resourceType] -= amount;
        this.onResourcesChanged?.(this.getEconomyData());

        return true;
    }

    public collectAll(): Partial<Record<ResourceType, number>> {
        const collected = this.getAllResources();

        this.resources.gold = 0;
        this.resources.iron = 0;
        this.resources.coal = 0;
        this.resources.crystal = 0;


        return collected;
    }

    private refreshDropboxLabel(): void {
        this.dropboxLabel.text = `BOX: ${this.getDropboxResourceAmount().toFixed(0)}`;
    }

}

