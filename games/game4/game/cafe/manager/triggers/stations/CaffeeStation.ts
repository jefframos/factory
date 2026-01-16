import GameplayCafeScene from '../../../GameplayCafeScene';
import { AreaProgress, ItemType } from '../../../progression/ProgressionManager';
import TriggerView from '../../../view/TriggerView';
import { UpgradeableAttributes } from '../../upgrade/UpgradeManager';
import ActiveableTrigger from '../ActiveableTrigger';
import TimeDispenserTrigger from '../TimeDispenserTrigger';
export default class CaffeeStation extends ActiveableTrigger {

    private dispenser: TimeDispenserTrigger = new TimeDispenserTrigger('caffeeMaker');

    public setProgressData(areaProgress: AreaProgress): void {
        super.setProgressData(areaProgress)



        this.dispenser.itemType = ItemType.COFFEE;
        this.dispenser.getView().zIndex = 5000
        this.dispenser.setUpStackList(1, 1, 40, 20, 50)
        this.dispenser.setStackPosition(0, -50)


        this.mainTriggerView = new TriggerView(this.triggerBox.trigger);
        this.mainTriggerView.position.set(this.position.x, this.position.y);
        this.dispenser.setPosition(this.position.x, this.position.y);

        const expressoView = this.getBelongingsByName('expresso2')
        if (expressoView) {
            const stackView = this.dispenser.getView()
            expressoView.view.addChild(this.dispenser.getView());
            stackView.position.set(0, 0);

        } else {
            GameplayCafeScene.tiledGameplayLayer.addChild(this.dispenser.getView());
        }



        this.dispenser.resizeStackList(1, this.rawStats.stack[0])
        console.log('CaffeeStation', this.rawStats)

    }
    setStats(stats: UpgradeableAttributes): void {
        super.setStats(stats)

        this.dispenser.itemType = this.rawStats.item[0] as unknown as ItemType;
        this.dispenser.interval = this.rawStats.speed[0];


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