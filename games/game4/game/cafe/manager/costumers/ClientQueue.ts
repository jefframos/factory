import Pool from '@core/Pool';
import * as PIXI from 'pixi.js';
import GameplayCharacterData from '../../../character/GameplayCharacterData';
import { ItemType } from '../../progression/ProgressionManager';
import { TableManager } from '../triggers/stations/TableManager';
import { CustomerEntity, CustomerState } from './CostumerEntity';
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
    originalOrder: OrderEntry[];
}


export class ClientQueue {

    private container: PIXI.Container;
    private queuePoints: PIXI.Point[];
    private clients: CustomerEntity[] = [];
    private spawnTimer = 0;
    private spawnInterval = 1;
    private maxClients = 6;
    private activeOrders: Map<CustomerEntity, ClientOrderData> = new Map();
    private tableManager: TableManager = TableManager.instance;
    private waitingForTableClients: CustomerEntity[] = [];


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

        for (const client of this.clients) {
            client?.update(delta);
        }

        for (const [client, data] of this.activeOrders.entries()) {
            if (data.busyTimer > 0) {
                data.busyTimer -= delta;
                if (data.busyTimer < 0) data.busyTimer = 0;
            }
        }

        // Try assigning tables to clients waiting for one
        for (let i = this.waitingForTableClients.length - 1; i >= 0; i--) {
            const client = this.waitingForTableClients[i];
            const table = this.tableManager.getAvailableTable();
            if (table) {
                this.waitingForTableClients.splice(i, 1);
                this.getClientOrderFinish(client); // Re-attempt finish
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
        client.setCharacter((GameplayCharacterData.fetchById(1)!))
        client.setState(CustomerState.Queue);
        this.container.addChild(client);
        this.clients.push(client);
        client.onReachTarget = () => {
            client.setState(CustomerState.Ordering);
        }
        const lastPoint = this.queuePoints[this.queuePoints.length - 1]
        client.positionTo(lastPoint.x, lastPoint.y);

        const order = this.clients.length === 1
            ? OrderTable.getFirstOrder()
            : OrderTable.getRandomOrder();

        const originalOrder = order.map(e => ({ ...e })); // Deep copy
        this.activeOrders.set(client, { order, originalOrder, busyTimer: 0 });


        console.log('order', order)
        //client.setOrder(order);

    }
    public getFirstClientWaiting(): { client: CustomerEntity; order: OrderEntry[] } | null {
        const client = this.clients[0];
        if (!client || client.state !== CustomerState.Ordering) return null;

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
                client.setState(CustomerState.Queue);
            } else {
                if (client.state === CustomerState.Ordering) {
                    client.showOrder(this.activeOrders.get(client)?.order ?? []);
                    //console.log('waiting Here', this.activeOrders.get(client))
                } else {
                    //console.log(client.state)
                }
            }
        }
    }
    public giveItem(itemType: ItemType): { order: OrderEntry[]; total: number } | false {
        const client = this.clients[0];
        const clientData = this.activeOrders.get(client);

        if (!client || !client.isAtTarget || client.state !== CustomerState.Ordering || !clientData) return false;
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
            const original = clientData.originalOrder.map(e => ({ ...e }));
            const total = original.reduce((sum, entry) => sum + entry.amount, 0);
            client.setState(CustomerState.OrderFinished);
            this.getClientOrderFinish(client);
            return { order: original, total };
        }

        console.log('Updated order:', order.map(e => ({
            itemType: e.itemType,
            remainingAmount: e.amount
        })));

        return false;

    }
    private getClientOrderFinish(client: CustomerEntity): void {
        const table = this.tableManager.getAvailableTable();
        if (table) {
            client.setState(CustomerState.Table);
            this.activeOrders.delete(client);
            this.clients = this.clients.filter(c => c !== client);
            client.onReachTarget = undefined;
            table.assignCustomer(client);
        } else {
            // No table available, buffer the client
            if (!this.waitingForTableClients.includes(client)) {
                this.waitingForTableClients.push(client);
            }
            client.setState(CustomerState.WaitingForTable);
        }
    }

    private removeClient(client: CustomerEntity): void {
        // this.container.removeChild(client);
        // Pool.instance.returnElement(client);
        // this.clients = this.clients.filter(c => c !== client);
    }
    public getClientReady(): void {
        const front = this.clients[0];
        // if (!front || front.state !== 'waiting') return;
        this.getClientOrderFinish(front);
        // front.setReady();
        // this.container.removeChild(front);
        // Pool.instance.returnElement(front);
        // this.clients.shift(); // remove from list
    }
}
