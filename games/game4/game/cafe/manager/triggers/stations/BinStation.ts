import { AreaProgress } from '../../../progression/ProgressionManager';
import ActionEntity from '../../../view/ActionEntity';
import TriggerView from '../../../view/TriggerView';
import { TriggerBox } from '../../TriggerBox';
import { UpgradeableAttributes } from '../../upgrade/UpgradeManager';
import ActiveableTrigger from '../ActiveableTrigger';
export default class BinStation extends ActiveableTrigger {


    public setProgressData(areaProgress: AreaProgress): void {
        super.setProgressData(areaProgress)

        this.mainTriggerView = new TriggerView(this.triggerBox.trigger);
        this.mainTriggerView.position.set(this.position.x, this.position.y);

    }
    setStats(stats: UpgradeableAttributes): void {
        super.setStats(stats)


    }
    protected onStay(trigger: TriggerBox, entity: ActionEntity): void {
        super.onStay()
        if (entity.disposeAllowed()) {
            entity.disposeFirstItem();
        }
    }
    // protected disableViews() {
    //     super.disableViews();
    // }

    // protected enableViews(animate: boolean = false) {
    //     super.enableViews(animate);
    // }
}