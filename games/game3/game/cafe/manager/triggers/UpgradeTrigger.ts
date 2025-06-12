import { Game } from "@core/Game";
import { Signal } from "signals";
import { AreaProgress } from "../../progression/ProgressionManager";
import { GameManager } from "../GameManager";
import { TriggerBox } from "../TriggerBox";
import { TriggerManager } from "../TriggerManager";

export class UpgradeTrigger {
    public readonly id: string;
    protected triggerBox: TriggerBox;
    protected timer = 0;
    protected collecting = false;
    protected levelId: string;
    protected areaProgress?: AreaProgress;

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
            onEnter: this.onEnter.bind(this),
            onStay: this.onStay.bind(this),
            onExit: this.onExit.bind(this),
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
    protected onEnter() {
        this.collecting = true;
        this.timer = 0;
    };

    protected onStay() {
        if (!this.collecting) return;

        this.timer += Game.deltaTime;

        const time = 0.1
        if (!this.areaProgress) {
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

    protected onExit() {
        this.collecting = false;
        this.timer = 0;
    };
}
