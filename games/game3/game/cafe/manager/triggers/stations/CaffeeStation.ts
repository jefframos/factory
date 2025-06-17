import GameplayCafeScene from '../../../GameplayCafeScene';
import { AreaProgress, ItemType } from '../../../progression/ProgressionManager';
import ActiveableTrigger from '../ActiveableTrigger';
import TimeDispenserTrigger from '../TimeDispenserTrigger';
export default class CaffeeStation extends ActiveableTrigger {

    private dispenser: TimeDispenserTrigger = new TimeDispenserTrigger('caffeeMaker');
    public setProgressData(areaProgress: AreaProgress): void {
        super.setProgressData(areaProgress)


        GameplayCafeScene.tiledGameplayLayer.addChild(this.dispenser.getView());

        this.dispenser.itemType = ItemType.COFFEE;
        this.dispenser.getView().zIndex = 5000
        this.dispenser.setPosition(this.position.x, this.position.y);
        this.dispenser.setUpStackList(2, 2, 40, 20, 50)
        this.dispenser.setStackPosition(-50, -80)

    }

    protected disableViews() {
        super.disableViews();
        this.dispenser.disable();
    }

    protected enableViews(animate: boolean = false) {
        super.enableViews(animate);
        this.dispenser?.enable();
    }
}