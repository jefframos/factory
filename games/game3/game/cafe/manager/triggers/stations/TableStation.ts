import * as PIXI from 'pixi.js';
import GameplayCafeScene from '../../../GameplayCafeScene';
import { AreaProgress, ItemType } from '../../../progression/ProgressionManager';
import ActionEntity from '../../../view/ActionEntity';
import TriggerView from '../../../view/TriggerView';
import { CustomerEntity } from '../../costumers/CostumerEntity';
import { TriggerBox } from '../../TriggerBox';
import { UpgradeableAttributes } from '../../upgrade/UpgradeManager';
import ActiveableTrigger from '../ActiveableTrigger';
import StackList from '../stack/Stackable';
import { TableManager } from './TableManager';

interface SeatData {
    seatSprite: PIXI.Sprite;
    position: PIXI.Point;
    busy: boolean;
    hasGarbage: boolean;
    customer?: CustomerEntity;
    garbageStack: StackList;
}

export default class TableStation extends ActiveableTrigger {
    private seats: SeatData[] = [];

    public setProgressData(areaProgress: AreaProgress): void {
        super.setProgressData(areaProgress);
        this.mainTriggerView = new TriggerView(this.triggerBox.trigger);
        this.mainTriggerView.position.set(this.position.x, this.position.y);


        this.setupSeats([new PIXI.Point(70, -35), new PIXI.Point(-70, 35)])
    }

    public setStats(stats: UpgradeableAttributes): void {
        super.setStats(stats);
    }

    /** Setup seats using world positions */
    public setupSeats(seatPositions: PIXI.Point[]): void {
        this.seats = [];

        for (const pos of seatPositions) {
            const worldX = this.position.x + pos.x;
            const worldY = this.position.y + pos.y;

            // Seat visual (sprite instead of trigger)
            const seatSprite = PIXI.Sprite.from('Label_Badge02'); // replace with actual texture key
            seatSprite.anchor.set(0.5, 0.5);
            seatSprite.scale.y = 0.5
            seatSprite.position.set(worldX, worldY);
            seatSprite.zIndex = -seatSprite.y
            GameplayCafeScene.tiledGameplayLayer.addChild(seatSprite);

            // Garbage stack next to the seat
            const stack = new StackList(GameplayCafeScene.tiledGameplayLayer, 1, 5, 0, 20);
            stack.setPosition(worldX + 20, worldY); // offset for visuals

            const seatData: SeatData = {
                seatSprite,
                position: pos.clone(),
                busy: false,
                hasGarbage: false,
                garbageStack: stack
            };

            this.seats.push(seatData);
        }
    }



    /** Assign a customer to an available seat */
    public assignCustomer(customer: CustomerEntity): boolean {
        const seat = this.seats.find(s => !s.busy);
        if (!seat) return false;

        seat.busy = true;
        seat.customer = customer;

        // You can animate/move the customer here to the seat position
        customer.moveTo(seat.position.x, seat.position.y);

        return true;
    }

    /** Call this when customer finishes eating */
    public markSeatDirty(customer: CustomerEntity): void {
        const seat = this.seats.find(s => s.customer === customer);
        if (!seat) return;

        seat.hasGarbage = true;
        seat.customer = undefined;

        // Add garbage to the stack
        seat.garbageStack.addItemFromType(ItemType.COFFEE); // Use your garbage item type or ID

        console.log('Customer left. Garbage added to stack.');
    }


    /** Handle item disposal on main table */
    protected onStay(trigger: TriggerBox, entity: ActionEntity): void {
        super.onStay();

        console.log('atTable')
        if (entity.disposeAllowed()) {
            entity.disposeFirstItem();
        }
    }

    /** Optional: debug all seat states */
    public debugSeatStates(): void {
        this.seats.forEach((seat, index) => {
            console.log(`Seat ${index}: busy=${seat.busy}, hasGarbage=${seat.hasGarbage}`);
        });
    }
    public isAvailableForCustomer(): boolean {
        return this.seats.some(seat => !seat.busy);
    }
    public onEnable(): void {
        TableManager.instance.registerTable(this);
    }

    public onDisable(): void {
        TableManager.instance.unregisterTable(this);
    }

}
