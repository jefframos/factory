import { GameScene } from "@core/scene/GameScene";
import BaseButton from "@core/ui/BaseButton";
import { Signal } from "signals";
import * as PIXI from "pixi.js";

import { AutonomousEntitySystem } from "./AutonomousEntitySystem";
import { GameEconomy, LocalStorageGameStorage } from "./GameEconomyStorage";
import { LaneEntity } from "./LaneEntity";
import { TextPopSystem } from "./TextPopSystem";

export default class BaseDemoScene extends GameScene {
    public onButtonPressed: Signal = new Signal();

    private collectButton!: BaseButton;

    private readonly entitySystem = new AutonomousEntitySystem();
    private readonly textPopSystem = new TextPopSystem();
    private readonly economy = new GameEconomy(new LocalStorageGameStorage());

    private lane!: LaneEntity;
    private lane2!: LaneEntity;
    private walletLabel!: PIXI.Text;
    private laneStorageLabel!: PIXI.Text;

    public async build(): Promise<void> {
        await this.economy.load();

        this.createMiningDemo();
        this.createCollectButton();
        this.createWalletLabel();

        this.addChild(this.textPopSystem);

        this.refreshWalletLabel();
    }

    public update(delta: number): void {
        this.entitySystem.update(delta);
        this.textPopSystem.update(delta);

        this.refreshWalletLabel();

        this.sortChildren();
    }

    public destroy(): void {
        this.collectButton?.destroy();
        super.destroy?.();
    }

    private createCollectButton(): void {
        this.collectButton = new BaseButton({
            standard: {
                allPadding: 35,
                texture: PIXI.Texture.from("Button01_s_Purple"),
                width: 250,
                height: 80,
                fontStyle: new PIXI.TextStyle({
                    fontFamily: "LEMONMILK-Bold",
                    fill: 0xffffff,
                    stroke: "#0c0808",
                    strokeThickness: 4,
                }),
            },
            over: {
                texture: PIXI.Texture.from("Button01_s_Red"),
            },
            click: {
                callback: async () => {
                    const stored = this.lane.collectStoredResources() + this.lane2.collectStoredResources();

                    if (stored > 0) {
                        await this.economy.addGold(stored);

                        this.textPopSystem.show(
                            `Wallet +${stored.toFixed(1)}`,
                            170,
                            150
                        );
                    }

                    this.refreshWalletLabel();
                    this.onButtonPressed.dispatch();
                },
            },
        });

        this.collectButton.position.set(40, 40);
        this.addChild(this.collectButton);
    }

    private createWalletLabel(): void {
        this.walletLabel = new PIXI.Text("", new PIXI.TextStyle({
            fontFamily: "LEMONMILK-Bold",
            fontSize: 28,
            fill: 0xffffff,
            stroke: "#0c0808",
            strokeThickness: 4,
        }));

        this.walletLabel.position.set(40, 140);
        this.addChild(this.walletLabel);

        this.laneStorageLabel = new PIXI.Text("", new PIXI.TextStyle({
            fontFamily: "LEMONMILK-Bold",
            fontSize: 22,
            fill: 0xffffff,
            stroke: "#0c0808",
            strokeThickness: 4,
        }));

        this.laneStorageLabel.position.set(40, 180);
        this.addChild(this.laneStorageLabel);
    }

    private refreshWalletLabel(): void {
        this.walletLabel.text = `Wallet gold: ${this.economy.gold.toFixed(1)}`;
        this.laneStorageLabel.text = `Lane storage: ${this.lane.getStoredResourceAmount().toFixed(1)}`;
    }

    private createMiningDemo(): void {
        this.lane = new LaneEntity(
            {
                id: "gold-lane-01",
                resourceType: "gold",

                maxWorkers: 4,

                miningSlots: 1,
                miningQueueSpacing: 52,

                depositSlots: 1,
                depositQueueSpacing: 52,
                depositDurationSeconds: 0.75,

                depositLimit: 100,

                entranceX: 200,
                entranceY: 500,

                miningX: 800,
                miningY: 500,

                depositX: 200,
                depositY: 500,
            },
            this.textPopSystem
        );



        this.addChild(this.lane);
        this.entitySystem.addLane(this.lane);

        this.lane.addWorker({
            id: 1,
            velocity: 140,
            miningSpeed: 8,
            carryCapacity: 20,
        });

        this.lane.addWorker({
            id: 2,
            velocity: 115,
            miningSpeed: 10,
            carryCapacity: 15,
        });

        this.lane.addWorker({
            id: 3,
            velocity: 180,
            miningSpeed: 5,
            carryCapacity: 25,
        });



        this.lane2 = new LaneEntity(
            {
                id: "gold-lane-02",
                resourceType: "gold",

                maxWorkers: 4,

                miningSlots: 1,
                miningQueueSpacing: 52,

                depositSlots: 1,
                depositQueueSpacing: 52,
                depositDurationSeconds: 0.75,

                depositLimit: 100,

                entranceX: 200,
                entranceY: 300,

                miningX: 800,
                miningY: 300,

                depositX: 200,
                depositY: 300,
            },
            this.textPopSystem
        );

        this.addChild(this.lane2);
        this.entitySystem.addLane(this.lane2);

        this.lane2.addWorker({
            id: 1,
            velocity: 140,
            miningSpeed: 8,
            carryCapacity: 120,
        });

        // this.lane.addWorker({
        //     id: 4,
        //     velocity: 90,
        //     miningSpeed: 12,
        //     carryCapacity: 10,
        // });
    }
}
