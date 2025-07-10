import { FoundTiledObject } from '@core/tiled/TiledLayerObject';
import * as PIXI from 'pixi.js';
import GameplayCafeScene from '../../GameplayCafeScene';
import { AreaProgress } from '../../progression/ProgressionManager';
import { AnimatorUtils } from '../../utils/AnimatorUtils';
import TriggerView from '../../view/TriggerView';
import { UpgradeTrigger } from './UpgradeTrigger';
export default class ActiveableTrigger extends UpgradeTrigger {

    protected belongings: FoundTiledObject[] = []
    protected mainTriggerView!: TriggerView;

    protected viewsEnabled = false;
    protected getBelongingsByName(name: string): FoundTiledObject | undefined {
        return this.belongings.find(element => element?.object?.name === name);
    }
    protected disableViews() {
        this.viewsEnabled = false;
        this.belongings.forEach(element => {
            if (element?.view) {
                if (element?.view) {
                    element.view.visible = false;
                }
            }
            if (element?.collider) {
                element.collider.enabled = false
            }
        });

    }
    protected enableViews(animate: boolean = false) {
        this.viewsEnabled = true;
        const toAnimate: PIXI.DisplayObject[] = [];
        this.belongings.forEach(element => {
            if (element?.view) {
                if (element?.view) {
                    element.view.visible = true;
                    toAnimate.push(element.view);
                }
            }
            if (element?.collider) {
                element.collider.enabled = true
            }
        });
        if (animate) {
            AnimatorUtils.revealWithBounce(toAnimate, -50, 0.05);
        }
    }
    protected onEnter() {
        super.onEnter()
    };

    public levelRefresh(value: number, newValue: number) {
        super.levelRefresh(value, newValue);
        if (newValue) {
            this.setActiveState(true);
        }
    }

    public setProgressData(areaProgress: AreaProgress) {
        super.setProgressData(areaProgress)

        this.belongings = GameplayCafeScene.belongGroup[this.id]
        this.disableViews();

        if (areaProgress.level.value) {
            this.setActiveState();
        }
    }

    public setActiveState(animate: boolean = false) {
        this.enableViews(animate)
    }
}
