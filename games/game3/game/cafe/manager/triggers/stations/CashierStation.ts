import Collider from '@core/collision/Collider';
import { ColliderDebugHelper } from '@core/collision/ColliderDebugHelper';
import { CollisionSystem } from '@core/collision/CollisionSystem';
import * as PIXI from 'pixi.js';
import GameplayCafeScene from '../../../GameplayCafeScene';
import { AreaProgress, ItemType } from '../../../progression/ProgressionManager';
import { DevGuiManager } from '../../../utils/DevGuiManager';
import ActiveableTrigger from '../ActiveableTrigger';
import DispenserTrigger from '../DispenserTrigger';
export default class CashierStation extends ActiveableTrigger {

    private dispenser!: DispenserTrigger
    public setProgressData(areaProgress: AreaProgress): void {
        super.setProgressData(areaProgress)


        console.error('MAKE THIS BETTER')
        this.belongings.forEach(element => {
            if (element && element.object.name === 'cashier-money') {
                this.dispenser = new DispenserTrigger('clientPurchase', element.object.width / 2);
                GameplayCafeScene.tiledGameplayLayer.addChild(this.dispenser.getView());
                this.dispenser.itemType = ItemType.MONEY;
                this.dispenser.getView().zIndex = 5000
                this.dispenser.setUpStackList(2, 2, 40, 40, 50)
                this.dispenser.setPosition(element.object.x + element.object.width / 2, element.object.y + element.object.height / 2);
                this.dispenser.setStackPosition(-80, -20);
            }

            if (element && element.object.name === 'cashier-dispenser') {
                this.trigger = new Collider({
                    shape: 'circle',
                    radius: element.object.width / 2,
                    trigger: true,
                    id: this.id,
                    position: new PIXI.Point(element.object.x + element.object.width / 2, element.object.y + element.object.height / 2),
                    onCollide: (other: PIXI.Container | undefined) => {
                        console.log(other)
                    },
                    onCollideEnter: (other: PIXI.Container | undefined) => {
                        console.log(other)

                    },
                    onCollideExit: (other: PIXI.Container | undefined) => {

                    }
                });
                CollisionSystem.addCollider(this.trigger)
                ColliderDebugHelper.addDebugGraphics(this.trigger, GameplayCafeScene.tiledGameplayLayer)
            }
        });




        if (!this.dispenser) {
            console.error('no dispenser element found on the scene')
        } else {
            DevGuiManager.instance.addButton('Cashier Money', () => {
                this.dispenser.tryExecuteAction()
            }, 'CASHIER')
        }

    }

    protected disableViews() {
        super.disableViews();
        this.dispenser?.disable();
    }

    protected enableViews(animate: boolean = false) {
        super.enableViews(animate);
        this.dispenser?.enable();
    }
}