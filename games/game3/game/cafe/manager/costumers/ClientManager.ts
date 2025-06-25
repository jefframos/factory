import Pool from '@core/Pool';
import * as PIXI from 'pixi.js';
import GameplayCharacterData from '../../../character/GameplayCharacterData';
import { ItemType } from '../../progression/ProgressionManager';
import EntityView from '../../view/EntityView';
import { CustomerEntity } from './CostumerEntity';
import { OrderEntry, OrderTable } from './OrderTable';

export class ClientManager {
    private container: PIXI.Container;
    private queuePoints: PIXI.Point[];
    private clients: CustomerEntity[] = [];
    private spawnTimer = 0;
    private spawnInterval = 1;
    private maxClients = 8;
    private activeOrders: Map<CustomerEntity, OrderEntry[]> = new Map();

    constructor(container: PIXI.Container, queuePoints: PIXI.Point[], name: string) {
        this.container = container;
        this.queuePoints = queuePoints;
        console.log(`ClientManager "${name}" initialized with ${queuePoints.length} queue points.`);
    }

    public update(delta: number): void {
        this.spawnTimer -= delta;

        if (this.spawnTimer <= 0 && this.clients.length < this.maxClients) {
            this.spawnClient();
            this.spawnTimer = this.spawnInterval;
        }

        // update all clients
        for (const client of this.clients) {
            client?.update(delta);
        }

        this.rebuildQueue();
    }

    private spawnClient(): void {
        if (this.clients.length >= this.queuePoints.length) {
            return
        }
        GameplayCharacterData.setTable('meme')

        const client = Pool.instance.getElement<CustomerEntity>(CustomerEntity);
        client.id = Math.floor(Math.random() * 10000);
        client.setCharacter(new EntityView(GameplayCharacterData.fetchById(1)!))
        client.setQueue();
        this.container.addChild(client);
        this.clients.push(client);
        const lastPoint = this.queuePoints[this.queuePoints.length - 1]
        client.positionTo(lastPoint.x, lastPoint.y);

        const order = this.clients.length === 1
            ? OrderTable.getFirstOrder()
            : OrderTable.getRandomOrder();

        this.activeOrders.set(client, order);

        console.log('order', order)
        //client.setOrder(order);

    }

    private rebuildQueue(): void {
        for (let i = 0; i < this.clients.length; i++) {
            const client = this.clients[i];
            const point = this.queuePoints[i] ?? this.queuePoints[this.queuePoints.length - 1];
            client.moveTo(point.x, point.y);
            if (i === 0) {
                client.setWaiting();
            } else {
                client.setQueue();
            }
        }
    }
    public giveItem(itemType: ItemType): boolean {
        const client = this.clients[0];

        if (!client || !client.isAtTarget || client.state !== 'waiting') return false;

        const order = this.activeOrders.get(client);
        if (!order) return false;

        // Snapshot before mutation
        const previousOrder = order.map(entry => ({ ...entry }));

        // Find matching entry and deduct
        const entry = order.find(e => e.itemType === itemType && e.amount > 0);
        if (!entry) return false;

        entry.amount--;

        // Give the item to the client stack
        // const added = client.addItemToStack(itemType);
        // if (!added) {
        //    entry.amount++; // rollback if not added
        //   return false;
        //}

        // Notify client about order change
        // client.updateOrder(previousOrder, order);

        if (order.every(e => e.amount <= 0)) {
            this.removeClient(client);
        }
        console.log('Updated order:', order.map(e => ({
            itemType: e.itemType,
            remainingAmount: e.amount
        })));
        return true;
    }
    private removeClient(client: CustomerEntity): void {
        client.setReady();
        this.container.removeChild(client);
        this.activeOrders.delete(client);
        Pool.instance.returnElement(client);
        this.clients = this.clients.filter(c => c !== client);
    }
    public getClientReady(): void {
        const front = this.clients[0];
        if (!front || front.state !== 'waiting') return;

        front.setReady();
        this.container.removeChild(front);
        Pool.instance.returnElement(front);
        this.clients.shift(); // remove from list
    }
}
