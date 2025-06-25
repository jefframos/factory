import { AreaProgress } from '../../../progression/ProgressionManager';
import ActionEntity from '../../../view/ActionEntity';
import { TriggerBox } from '../../TriggerBox';
import { UpgradeableAttributes } from '../../upgrade/UpgradeManager';
import ActiveableTrigger from '../ActiveableTrigger';
export default class BinStation extends ActiveableTrigger {


    public setProgressData(areaProgress: AreaProgress): void {
        super.setProgressData(areaProgress)



    }
    setStats(stats: UpgradeableAttributes): void {
        super.setStats(stats)


    }
    protected onStay(trigger: TriggerBox, entity: ActionEntity): void {
        if (entity.disposeAllowed()) {
            entity.disposeFirstItem();
        }
    }
    protected disableViews() {
        super.disableViews();
    }

    protected enableViews(animate: boolean = false) {
        super.enableViews(animate);
    }
}