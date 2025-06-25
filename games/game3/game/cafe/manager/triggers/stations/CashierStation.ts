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
import StackList from '../stack/Stackable';

export default class CashierStation extends ActiveableTrigger {
    private clientMoneyDispenser!: DispenserTrigger;
    private trigger!: Collider;

    private moneyTriggerView!: TriggerView;
    private moneyDispenserPickupTriggerView!: TriggerView;

    public clientOrderStack!: StackList;


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


            if (name === 'cashier-coffee-dispenser') {
                this.setupCoffeeDispenser(centerX, centerY);
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
                this.clientMoneyDispenser.tryExecuteAction();
            }, 'CASHIER');
        }

        if (!triggerFound) {
            console.warn('[CashierStation] No "cashier-dispenser" trigger found');
        }

        this.mainTriggerView = new TriggerView(this.triggerBox.trigger);
        this.mainTriggerView.position.set(this.position.x, this.position.y);

        if (!this.viewsEnabled) {
            this.moneyDispenserPickupTriggerView?.setStatus('disabled')
            this.moneyTriggerView?.setStatus('disabled')
        }

    }

    private setupCoffeeDispenser(x: number, y: number): void {

        this.clientOrderStack = new StackList(GameplayCafeScene.tiledGameplayLayer, 1, 5, 0, 10, 50);
        this.clientOrderStack.setPosition(x, y);
    }
    private setupDispenser(x: number, y: number, width: number): void {
        this.clientMoneyDispenser = new DispenserTrigger('clientPurchase', width / 2);
        this.clientMoneyDispenser.itemType = ItemType.MONEY;
        this.clientMoneyDispenser.setUpStackList(10, 2, 40, 40, 50);
        this.clientMoneyDispenser.setPosition(x, y);
        this.clientMoneyDispenser.setStackPosition(-80, -20);
        GameplayCafeScene.tiledGameplayLayer.addChild(this.clientMoneyDispenser.getView());

        this.moneyDispenserPickupTriggerView = new TriggerView(this.clientMoneyDispenser.triggerBox.trigger);
        this.moneyDispenserPickupTriggerView.position.set(x, y);


    }

    private setupTrigger(x: number, y: number, radius: number): void {
        this.trigger = new Collider({
            shape: 'circle',
            radius: radius / 2,
            trigger: true,
            id: this.id,
            position: new PIXI.Point(x, y),
            onCollide: (entity) => {
                this.moneyTriggerView?.setStatus('active');
                if (entity instanceof ActionEntity && entity.disposeAllowed()) {
                    if (entity.disposeItem(ItemType.COFFEE)) {
                        this.clientOrderStack.addItemFromType(ItemType.COFFEE)
                        console.log(entity, '[CashierStation] Action Entity entered cashier dispenser. If holding food, it should drop here for clients.');
                    }
                }

            },
            onCollideEnter: (entity) => {
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
        this.clientMoneyDispenser?.disable();

        this.moneyTriggerView?.setStatus('disabled');
        this.moneyDispenserPickupTriggerView?.setStatus('disabled');
    }

    protected enableViews(animate: boolean = false): void {
        super.enableViews(animate);
        this.clientMoneyDispenser?.enable();

        this.moneyTriggerView?.setStatus('available');
        this.moneyDispenserPickupTriggerView?.setStatus('available');

    }
}
