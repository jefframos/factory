import Pool from '@core/Pool';
import * as PIXI from 'pixi.js';
import GameplayCafeScene from '../../../GameplayCafeScene';
import { AreaProgress, ItemType } from '../../../progression/ProgressionManager';
import ActionEntity from '../../../view/ActionEntity';
import TriggerView from '../../../view/TriggerView';
import { CustomerEntity, CustomerState } from '../../costumers/CostumerEntity';
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
    private clients: CustomerEntity[] = [];
    private eatingData: Map<CustomerEntity, { seat: SeatData, timeLeft: number }> = new Map();

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
            const stack = new StackList(GameplayCafeScene.tiledGameplayLayer, 1, 5, 0, 20, 30);
            stack.setPosition(worldX + 20, worldY - 50); // offset for visuals

            const seatData: SeatData = {
                seatSprite,
                position: pos.clone(),
                busy: false,
                hasGarbage: false,
                garbageStack: stack
            };

            //this.addGarbageToSeat(seatData);
            this.seats.push(seatData);
        }
    }



    /** Assign a customer to an available seat */
    public assignCustomer(customer: CustomerEntity): boolean {
        const seat = this.seats.find(s => !s.busy);
        if (!seat) return false;

        seat.busy = true;
        seat.customer = customer;

        this.clients.push(customer);

        customer.onReachTarget = () => {
            customer.setState(CustomerState.Eating);
            this.eatingData.set(customer, { seat, timeLeft: 5 });
        }

        // You can animate/move the customer here to the seat position
        customer.moveTo(this.position.x + seat.position.x, this.position.y + seat.position.y);
        console.log(this.position.x + seat.position.x, this.position.y + seat.position.y)

        return true;
    }

    /** Call this when customer finishes eating */

    private addGarbageToSeat(seat: SeatData, itemType: ItemType = ItemType.GARBAGE): void {
        seat.hasGarbage = true;
        seat.customer = undefined;
        seat.garbageStack.addItemFromType(ItemType.GARBAGE);
    }


    /** Handle item disposal on main table */
    protected onStay(trigger: TriggerBox, entity: ActionEntity): void {
        super.onStay();

        if (entity.pickupAllowed()) {
            //PICK ITEM FROM TABLE
            this.pickItemFromTable(entity);
        }


    }
    private pickItemFromTable(entity: ActionEntity): void {
        if (entity.canStack) {
            for (const element of this.seats) {
                if (element.hasGarbage && element.garbageStack.totalAmount > 0) {
                    const itemType = element.garbageStack.getFirstItemType();
                    if (itemType) {
                        entity.takeItem(itemType);
                        element.garbageStack.removeFirstItem();
                        element.hasGarbage = element.garbageStack.totalAmount > 0;
                        break;
                    }
                }
            }
        }
    }

    /** Optional: debug all seat states */
    public debugSeatStates(): void {
        this.seats.forEach((seat, index) => {
            console.log(`Seat ${index}: busy=${seat.busy}, hasGarbage=${seat.hasGarbage}`);
        });
    }
    public isAvailableForCustomer(): boolean {
        return this.seats.some(seat => !seat.busy && !seat.hasGarbage);
    }
    public enable(): void {
        super.enable();
        TableManager.instance.registerTable(this);
    }

    public disable(): void {
        super.disable();
        TableManager.instance.unregisterTable(this);
    }

    public update(delta: number): void {
        super.update(delta);

        for (const client of this.clients) {
            client.update(delta);
        }

        for (const [client, data] of this.eatingData.entries()) {
            data.timeLeft -= delta;
            client.updateEatingTimer?.(data.timeLeft);

            if (data.timeLeft <= 0) {
                this.eatingData.delete(client);
                this.addGarbageToSeat(data.seat);
                this.removeCustomer(client);
            }
        }
    }

    private removeCustomer(customer: CustomerEntity): void {
        const seat = this.seats.find(s => s.customer === customer);
        if (seat) {
            seat.busy = false;
            seat.customer = undefined;
        }

        this.clients = this.clients.filter(c => c !== customer);
        Pool.instance.returnElement(customer);
        customer.parent?.removeChild(customer);
    }
}
