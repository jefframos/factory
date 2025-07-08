import Pool from '@core/Pool';
import * as PIXI from 'pixi.js';
import GameplayCharacterData from '../../../character/GameplayCharacterData';
import { ItemType } from '../../progression/ProgressionManager';
import EntityView from '../../view/EntityView';
import { CustomerEntity } from './CostumerEntity';
import { OrderEntry, OrderTable } from './OrderTable';
export enum ClientQueueType {
    MainEntrance = 'MainEntrance',
}
export class ClientQueueManager {
    private static _instance: ClientQueueManager;

    private constructor() { }

    public static get instance(): ClientQueueManager {
        if (!ClientQueueManager._instance) {
            ClientQueueManager._instance = new ClientQueueManager();
        }
        return ClientQueueManager._instance;
    }
    private queues: Map<string, ClientQueue> = new Map();

    public registerQueue(name: string, queue: ClientQueue): void {
        if (this.queues.has(name)) {
            throw new Error(`Queue with name "${name}" is already registered.`);
        }
        this.queues.set(name, queue);
    }

    public getQueue(name: string): ClientQueue | undefined {
        return this.queues.get(name);
    }

    public removeQueue(name: string): void {
        if (!this.queues.has(name)) {
            throw new Error(`Queue with name "${name}" does not exist.`);
        }
        this.queues.delete(name);
    }

    public listQueues(): string[] {
        return Array.from(this.queues.keys());
    }
    public updateAllQueues(delta: number): void {
        for (const queue of this.queues.values()) {
            queue.update(delta);
        }
    }
}

export interface ClientOrderData {
    busyTimer: number;
    order: OrderEntry[];
}


export class ClientQueue {

    private container: PIXI.Container;
    private queuePoints: PIXI.Point[];
    private clients: CustomerEntity[] = [];
    private spawnTimer = 0;
    private spawnInterval = 1;
    private maxClients = 8;
    private activeOrders: Map<CustomerEntity, ClientOrderData> = new Map();


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


        for (const [client, data] of this.activeOrders.entries()) {
            if (data.busyTimer > 0) {
                data.busyTimer -= delta;
                if (data.busyTimer < 0) data.busyTimer = 0;
            }
        }


        this.rebuildQueue();
    }
    public isFirstClientBusy(): boolean {
        const client = this.clients[0];
        if (!client) return false;

        const data = this.activeOrders.get(client);
        return !!data && data.busyTimer > 0;
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

        //this.activeOrders.set(client, order);

        this.activeOrders.set(client, { order, busyTimer: 0 });

        console.log('order', order)
        //client.setOrder(order);

    }
    public getFirstClientWaiting(): { client: CustomerEntity; order: OrderEntry[] } | null {
        const client = this.clients[0];
        if (!client || client.state !== 'waiting') return null;

        const order = this.activeOrders.get(client);
        if (!order) return null;

        return { client, order: order.order };
    }
    private rebuildQueue(): void {
        for (let i = 0; i < this.clients.length; i++) {
            const client = this.clients[i];
            const point = this.queuePoints[i] ?? this.queuePoints[this.queuePoints.length - 1];
            client.moveTo(point.x, point.y);
            if (i > 0) {
                client.setQueue();
            }
        }
    }
    public giveItem(itemType: ItemType): boolean {
        const client = this.clients[0];
        const clientData = this.activeOrders.get(client);

        if (!client || !client.isAtTarget || client.state !== 'waiting' || !clientData) return false;
        if (clientData.busyTimer > 0) return false;

        const order = clientData.order;
        const previousOrder = order.map(entry => ({ ...entry }));

        const entry = order.find(e => e.itemType === itemType && e.amount > 0);
        if (!entry) return false;

        entry.amount--;
        clientData.busyTimer = 1; // Set 1 second cooldown

        // Notify client about order change
        // client.updateOrder(previousOrder, order);

        if (order.every(e => e.amount <= 0)) {
            this.removeClient(client);
            return true;
        }

        console.log('Updated order:', order.map(e => ({
            itemType: e.itemType,
            remainingAmount: e.amount
        })));

        return false;

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
