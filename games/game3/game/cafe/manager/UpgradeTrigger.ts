import { Game } from "@core/Game";
import { Signal } from "signals";
import { AreaProgress } from "../progression/ProgressionManager";
import { GameManager } from "./GameManager";
import { TriggerBox } from "./TriggerBox";
import { TriggerManager } from "./TriggerManager";

export class UpgradeTrigger {
    public readonly id: string;
    private triggerBox: TriggerBox;
    private timer = 0;
    private collecting = false;
    private levelId: string;
    private areaProgress?: AreaProgress;

    public onUpgrade: Signal = new Signal();

    public enable() {
        this.triggerBox.enable()
    }
    public disable() {
        this.triggerBox.disable()
    }

    constructor(id: string, levelId: string = 'default') {
        this.id = id;
        this.levelId = levelId;

        this.triggerBox = new TriggerBox(id, 500, 50);
        TriggerManager.registerTrigger(this.triggerBox, {
            description: 'Upgrade Trigger: ' + id,
            onEnter: this.onEnter,
            onStay: this.onStay,
            onExit: this.onExit,
        });
    }

    public setProgressData(areaProgress: AreaProgress) {
        this.areaProgress = areaProgress;
        this.areaProgress.currentValue.onChange.add((value: number, newValue: number) => {
            this.refresh()
        });

        this.areaProgress.level.onChange.add((value: number, newValue: number) => {
            this.collecting = false;
            this.refresh()
        });

        this.refresh()

        if (this.areaProgress.unlocked) {
            this.enable();
        } else {
            this.disable();
        }
    }

    public getView(): TriggerBox {
        return this.triggerBox;
    }

    public setPosition(x: number, y: number): void {
        this.triggerBox.setPosition(x, y);
    }


    public refresh() {
        if (!this.areaProgress) return;
        if (this.areaProgress.isMaxLevel) {
            this.triggerBox.visible = false
        } else {
            this.triggerBox.updateAmount(this.areaProgress.currentValue.value, this.areaProgress.nextLevelThreshold);
        }
    }
    private onEnter = () => {
        this.collecting = true;
        this.timer = 0;
    };

    private onStay = () => {
        if (!this.collecting) return;

        this.timer += Game.deltaTime;

        const time = 0.1
        if (!this.areaProgress) {
            while (this.timer >= time) {
                this.onUpgrade.dispatch(this.id, 1);
                this.timer -= time;
            }
            return;
        }

        const levelData = GameManager.instance.getLevelData(this.levelId);
        const coins = levelData.soft.coins;
        while (this.timer >= time && coins.value > 0 && this.areaProgress.currentValue.value < this.areaProgress.nextLevelThreshold) {
            coins.update(-1);
            this.onUpgrade.dispatch(this.id, 1);
            this.timer -= time;
        }

    };

    private onExit = () => {
        this.collecting = false;
        this.timer = 0;
    };
}
