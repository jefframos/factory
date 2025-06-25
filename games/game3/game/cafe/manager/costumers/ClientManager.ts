import Pool from '@core/Pool';
import * as PIXI from 'pixi.js';
import GameplayCharacterData from '../../../character/GameplayCharacterData';
import EntityView from '../../view/EntityView';
import { CustomerEntity } from './CostumerEntity';

export class ClientManager {
    private container: PIXI.Container;
    private queuePoints: PIXI.Point[];
    private clients: CustomerEntity[] = [];
    private spawnTimer = 0;
    private spawnInterval = 1;
    private maxClients = 8;

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
        client.setCharacter(new EntityView(GameplayCharacterData.fetchById(0)!))
        client.setQueue();
        this.container.addChild(client);
        this.clients.push(client);
        const lastPoint = this.queuePoints[this.queuePoints.length - 1]
        client.positionTo(lastPoint.x, lastPoint.y);

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

    public getClientReady(): void {
        const front = this.clients[0];
        if (!front || front.state !== 'waiting') return;

        front.setReady();
        this.container.removeChild(front);
        Pool.instance.returnElement(front);
        this.clients.shift(); // remove from list
    }
}
