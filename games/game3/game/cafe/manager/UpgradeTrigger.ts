import { Game } from "@core/Game";
import { GameManager } from "./GameManager";
import { TriggerBox } from "./TriggerBox";
import { TriggerManager } from "./TriggerManager";
import { UpgradeTriggerSaveData } from "./UpdateTriggerSaveData";
import { WorldManager } from "./WorldManager";

export class UpgradeTrigger {
    public readonly id: string;
    private triggerBox: TriggerBox;
    private upgradeLevel = 1;
    private currentAmount = 0;
    private upgradeThreshold: number;
    private timer = 0;
    private collecting = false;
    private levelId: string;

    constructor(id: string, upgradeThreshold: number, levelId: string = 'default', saveData?: UpgradeTriggerSaveData) {
        this.id = id;
        this.upgradeThreshold = upgradeThreshold;
        this.levelId = levelId;

        if (saveData) {
            this.upgradeLevel = saveData.upgradeLevel;
            this.currentAmount = saveData.currentAmount;
        }

        this.triggerBox = new TriggerBox(id, 500, 50);
        TriggerManager.registerTrigger(this.triggerBox, {
            description: 'Upgrade Trigger: ' + id,
            onEnter: this.onEnter,
            onStay: this.onStay,
            onExit: this.onExit,
        });
    }

    public getView(): TriggerBox {
        return this.triggerBox;
    }

    public setPosition(x: number, y: number): void {
        this.triggerBox.setPosition(x, y);
    }
    public getSaveData(): UpgradeTriggerSaveData {
        return {
            upgradeLevel: this.upgradeLevel,
            currentAmount: this.currentAmount,
        };
    }
    public updateData(data: UpgradeTriggerSaveData): void {
        this.upgradeLevel = data.upgradeLevel;
        this.currentAmount = data.currentAmount;
        this.refresh();
    }

    public refresh() {
        this.triggerBox.updateAmount(this.currentAmount, this.upgradeThreshold);
    }
    private onEnter = () => {
        this.collecting = true;
        this.timer = 0;
    };

    private onStay = () => {
        if (!this.collecting) return;

        this.timer += Game.deltaTime;

        const levelData = GameManager.instance.getLevelData(this.levelId);
        const coins = levelData.soft.coins;

        while (this.timer >= 0.2 && coins.value > 0 && this.currentAmount < this.upgradeThreshold) {
            coins.update(-1);
            this.currentAmount += 1;
            this.timer -= 0.2;

            this.triggerBox.updateAmount(this.currentAmount, this.upgradeThreshold);
            WorldManager.instance.save();
            console.log(`[${this.id}] Collecting: ${this.currentAmount}/${this.upgradeThreshold}`);
        }

        if (this.currentAmount >= this.upgradeThreshold) {
            this.collecting = false;
            this.upgradeLevel += 1;
            this.currentAmount = 0;
            console.log(`🎉 [${this.id}] Upgraded to level ${this.upgradeLevel}`);
        }
    };

    private onExit = () => {
        this.collecting = false;
        this.timer = 0;
        console.log(`[${this.id}] Exited. Progress: ${this.currentAmount}/${this.upgradeThreshold}`);
    };
}
