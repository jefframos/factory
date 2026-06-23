import { GameScene } from "@core/scene/GameScene";
import { Signal } from "signals";
import * as PIXI from "pixi.js";

import { FarmSaveStorage } from "./FarmSaveStorage";
import { LaneManager } from "./LaneManager";
import { LaneProgressStorage } from "./LaneProgressStorage";
import { LiftSystem } from "./LiftSystem";
import { OfficeEntity } from "./OfficeEntity";
import {
    LaneFactoryDefinition,
    LaneManagerDefinition,
    LiftSystemDefinition,
    ResourceType,
} from "./MiningDemoTypes";
import { TextPopSystem } from "./TextPopSystem";
import { DevGuiManager } from "@core/utils/DevGuiManager";

export default class BaseDemoScene extends GameScene {
    public onButtonPressed: Signal = new Signal();

    private readonly farmSaveStorage = new FarmSaveStorage();
    private readonly textPopSystem = new TextPopSystem();

    private laneManager!: LaneManager;
    private liftSystem!: LiftSystem;
    private office!: OfficeEntity;

    private economyLabel!: PIXI.Text;
    private laneCostLabel!: PIXI.Text;

    private speedMultiplier = 1;

    public async build(): Promise<void> {
        await this.farmSaveStorage.initialize();

        await this.createLaneManager();
        await this.createLiftSystem();

        // Restore bought lanes (or create the initial gold lane on first run)
        const boughtLanes = await this.farmSaveStorage.loadBoughtLanes();
        if (boughtLanes.length > 0) {
            for (const { resourceType } of boughtLanes) {
                this.laneManager.restoreLane(resourceType as ResourceType);
            }
        } else {
            this.laneManager.createInitialLane("gold");
        }

        // Wire bought-lane changes to storage AFTER restore so restore is silent
        this.laneManager.onBoughtLanesChanged = (lanes) => {
            void this.farmSaveStorage.saveBoughtLanes(lanes);
        };

        // Give the lift system the current lanes
        this.liftSystem.setLanes(this.laneManager.getLanes());

        // Load saved economy into office
        const savedEconomy = await this.farmSaveStorage.loadEconomy();
        this.office.loadResources(savedEconomy as Record<ResourceType, number>);

        // Restore office dropbox
        const savedDropbox = await this.farmSaveStorage.loadOfficeDropbox();
        this.office.loadDropboxResources(savedDropbox as Record<ResourceType, number>);

        // Wire office changes back to save storage
        this.office.onResourcesChanged = (data) => {
            void this.farmSaveStorage.saveEconomy(data);
        };
        this.office.onDropboxChanged = (data) => {
            void this.farmSaveStorage.saveOfficeDropbox(data);
        };

        // Restore lift state if available
        const savedLiftState = await this.farmSaveStorage.loadLiftState();
        if (savedLiftState) {
            this.liftSystem.restoreLiftState(savedLiftState);
        }

        // Wire lift state changes to storage
        this.liftSystem.onLiftStateChanged = (state) => {
            void this.farmSaveStorage.saveLiftState(state);
        };

        this.createLabels();
        this.createDevGui();

        this.addChild(this.textPopSystem);

        this.refreshLabels();
    }

    public update(delta: number): void {
        const scaledDelta = delta * this.speedMultiplier;
        this.laneManager.update(scaledDelta);
        this.liftSystem.update(scaledDelta);
        this.textPopSystem.update(delta);

        this.refreshLabels();

        this.sortChildren();
    }

    public destroy(): void {
        // nothing
    }

    private async createLaneManager(): Promise<void> {
        const managerDef: LaneManagerDefinition = {
            maxLanes: 5,
            laneSpacing: 118,
            baseLaneCost: 10,
            laneCostGrowth: 1.01,
        };

        const factoryDef: LaneFactoryDefinition = {
            defaultLayout: {
                width: 640,
                height: 110,

                entrance: { x: 350, y: 55 },
                miningStartSpot: { x: 430, y: 55 },
                // Keep lane collection box aligned with office dropbox/lift shaft on the left area.
                depositSpot: { x: 20, y: 55 },
                miningSpot: { x: 590, y: 55 },

                miningQueueDirection: { x: -1, y: 0 },
                depositQueueDirection: { x: 1, y: 0 },

                miningQueueSpacing: 40,
                depositQueueSpacing: 40,
            },

            defaultWorkers: [
                {
                    id: 1,
                    velocity: 140,
                    miningSpeed: 8,
                    carryCapacity: 20,
                }
            ],

            defaultMaxWorkers: 4,
            defaultMiningSlots: 1,
            defaultDepositSlots: 1,
            defaultDepositDurationSeconds: 0.75,
            defaultDepositLimit: 100,
            defaultMiningProgressMaxAmount: 1200,
        };

        this.laneManager = new LaneManager(
            managerDef,
            factoryDef,
            this.textPopSystem,
            new LaneProgressStorage(this.farmSaveStorage)
        );

        await this.laneManager.initialize();

        // Lanes are right-aligned under the office area.
        // Office right edge is x=920 (220 + 700), so lane x is 920 - 640 = 280.
        this.laneManager.position.set(280, 220);
        this.addChild(this.laneManager);
        // Note: lanes are restored in build() from saved state
    }

    private async createLiftSystem(): Promise<void> {
        const liftSystemDef: LiftSystemDefinition = {
            liftCount: 1,
            defaultLift: {
                id: "lift-1",
                velocity: 48,
                collectCapacity: 100,
                collectDurationSeconds: 0.75,
            },
            defaultTransportWorkers: [
                {
                    id: 1,
                    velocity: 120,
                    carryCapacity: 50,
                    depositDurationSeconds: 0.5,
                },
                {
                    id: 2,
                    velocity: 120,
                    carryCapacity: 50,
                    depositDurationSeconds: 0.5,
                },
            ],
            office: {
                position: { x: 220, y: 60 },
                depositLimit: 5000,
            },
        };

        this.liftSystem = new LiftSystem(liftSystemDef, this.textPopSystem);
        // Lanes are wired in build() after restoration
        this.office = this.liftSystem.getOffice();

        this.liftSystem.position.set(0, 0);
        this.addChild(this.liftSystem);
    }

    private createDevGui(): void {
        const gui = DevGuiManager.instance;

        gui.addButton("Buy Lane", () => {
            const cost = this.laneManager.getNextLaneCost();

            if (!this.laneManager.canBuyLane) {
                this.textPopSystem.show("Max lanes", 420, 150);
                return;
            }

            if (!this.office.spendResource("gold", cost)) {
                this.textPopSystem.show("Not enough gold", 420, 150);
                return;
            }

            this.laneManager.buyLane(this.getNextLaneResourceType());
            this.liftSystem.setLanes(this.laneManager.getLanes());
            this.refreshLabels();
        }, "Farm");

        gui.addButton("Speed x2", () => {
            this.speedMultiplier = this.speedMultiplier === 1 ? 2 : 1;
        }, "Farm");

        gui.addButton("Reset Data", async () => {
            await this.farmSaveStorage.saveEconomy({ gold: 0, iron: 0, coal: 0, crystal: 0 });
            await this.farmSaveStorage.saveLaneProgress({});
            await this.farmSaveStorage.saveBoughtLanes([]);
            await this.farmSaveStorage.saveLiftState(null);
            window.location.reload();
        }, "Farm");
    }

    private createLabels(): void {
        this.economyLabel = new PIXI.Text("", new PIXI.TextStyle({
            fontFamily: "LEMONMILK-Bold",
            fontSize: 24,
            fill: 0xffffff,
            stroke: "#0c0808",
            strokeThickness: 4,
        }));

        this.economyLabel.position.set(1000, 250);
        this.addChild(this.economyLabel);

        this.laneCostLabel = new PIXI.Text("", new PIXI.TextStyle({
            fontFamily: "LEMONMILK-Bold",
            fontSize: 20,
            fill: 0xffffff,
            stroke: "#0c0808",
            strokeThickness: 4,
        }));

        this.laneCostLabel.position.set(1000, 430);
        this.addChild(this.laneCostLabel);
    }

    private refreshLabels(): void {
        const gold = this.office.getResourceAmount("gold");
        const iron = this.office.getResourceAmount("iron");
        const coal = this.office.getResourceAmount("coal");
        const crystal = this.office.getResourceAmount("crystal");

        this.economyLabel.text = [
            `Gold: ${gold.toFixed(0)}`,
            `Iron: ${iron.toFixed(0)}`,
            `Coal: ${coal.toFixed(0)}`,
            `Crystal: ${crystal.toFixed(0)}`,
        ].join("\n");

        if (!this.laneManager.canBuyLane) {
            this.laneCostLabel.text = "Max lanes reached";
            return;
        }

        this.laneCostLabel.text = `Next lane: ${this.laneManager.getNextLaneCost()} gold`;
    }

    private getNextLaneResourceType(): ResourceType {
        const resourceCycle: ResourceType[] = ["gold", "iron", "coal", "crystal"];
        return resourceCycle[this.laneManager.laneCount % resourceCycle.length];
    }
}
