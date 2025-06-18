import Collider from '@core/collision/Collider';
import { ColliderDebugHelper } from '@core/collision/ColliderDebugHelper';
import { CollisionSystem } from '@core/collision/CollisionSystem';
import * as PIXI from 'pixi.js';
import GameplayCafeScene from '../../../GameplayCafeScene';
import { AreaProgress, ItemType } from '../../../progression/ProgressionManager';
import { DevGuiManager } from '../../../utils/DevGuiManager';
import ActionEntity from '../../../view/ActionEntity';
import TriggerView from '../../../view/TriggerView';
import ActiveableTrigger from '../ActiveableTrigger';
import DispenserTrigger from '../DispenserTrigger';

export default class CashierStation extends ActiveableTrigger {
    private dispenser!: DispenserTrigger;
    private trigger!: Collider;

    private moneyTriggerView!: TriggerView;
    private dispenserTriggerView!: TriggerView;

    public setProgressData(areaProgress: AreaProgress): void {
        super.setProgressData(areaProgress);

        let dispenserFound = false;
        let triggerFound = false;

        for (const element of this.belongings) {
            if (!element?.object) continue;

            const { name, width, height, x, y } = element.object;
            const centerX = x + width / 2;
            const centerY = y + height / 2;

            if (name === 'cashier-money') {
                this.setupDispenser(centerX, centerY, width);
                dispenserFound = true;
            }

            if (name === 'cashier-dispenser') {
                this.setupTrigger(centerX, centerY, width);
                triggerFound = true;
            }
        }

        if (!dispenserFound) {
            console.error('[CashierStation] No "cashier-money" element found in scene');
        } else {
            DevGuiManager.instance.addButton('Cashier Money', () => {
                this.dispenser.tryExecuteAction();
            }, 'CASHIER');
        }

        if (!triggerFound) {
            console.warn('[CashierStation] No "cashier-dispenser" trigger found');
        }

        this.mainTriggerView = new TriggerView(this.triggerBox.trigger);
        this.mainTriggerView.position.set(this.position.x, this.position.y);

        if (!this.viewsEnabled) {
            this.dispenserTriggerView?.setStatus('disabled')
            this.moneyTriggerView?.setStatus('disabled')
        }
    }

    private setupDispenser(x: number, y: number, width: number): void {
        this.dispenser = new DispenserTrigger('clientPurchase', width / 2);
        this.dispenser.itemType = ItemType.MONEY;
        this.dispenser.setUpStackList(2, 2, 40, 40, 50);
        this.dispenser.setPosition(x, y);
        this.dispenser.setStackPosition(-80, -20);
        GameplayCafeScene.tiledGameplayLayer.addChild(this.dispenser.getView());

        this.dispenserTriggerView = new TriggerView(this.dispenser.triggerBox.trigger);
        this.dispenserTriggerView.position.set(x, y);


    }

    private setupTrigger(x: number, y: number, radius: number): void {
        this.trigger = new Collider({
            shape: 'circle',
            radius: radius / 2,
            trigger: true,
            id: this.id,
            position: new PIXI.Point(x, y),
            onCollide: () => {
                this.moneyTriggerView?.setStatus('active');
            },
            onCollideEnter: (entity) => {
                if (entity instanceof ActionEntity) {
                    console.log(entity.stackList)
                    if (entity.stackList.hasItemOfType(ItemType.COFFEE)) {
                        entity.stackList.removeOneItemOfType(ItemType.COFFEE)
                    }
                }

                console.log(entity, '[CashierStation] Player entered cashier dispenser. If holding food, it should drop here for clients.');
            },
            onCollideExit: () => {
                this.moneyTriggerView?.setStatus('available');
            }
        });

        CollisionSystem.addCollider(this.trigger);
        ColliderDebugHelper.addDebugGraphics(this.trigger, GameplayCafeScene.tiledGameplayLayer);

        this.moneyTriggerView = new TriggerView(this.trigger);
        this.moneyTriggerView.position.set(x, y);
    }

    protected onEnter(): void {
        super.onEnter();
        console.log('[CashierStation] Player entered cashier area. If food is ready and order is fulfilled, payment can be received.');
    }

    protected disableViews(): void {
        super.disableViews();
        this.dispenser?.disable();

        this.moneyTriggerView?.setStatus('disabled');
        this.dispenserTriggerView?.setStatus('disabled');
    }

    protected enableViews(animate: boolean = false): void {
        super.enableViews(animate);
        this.dispenser?.enable();

        this.moneyTriggerView?.setStatus('available');
        this.dispenserTriggerView?.setStatus('available');

    }
}
