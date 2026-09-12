import Pool from "core/Pool";
import { CollisionLayer } from "core/phyisics/core/CollisionLayer";
import { BoxEntity } from "core/phyisics/entities/BoxEntity";
import { Body } from "matter-js";
import * as PIXI from 'pixi.js';

export class PhysicsTestLevelManager {
    private entities: BoxEntity[] = [];

    constructor(private root: PIXI.Container) {
        this.createFloor();
    }

    private createFloor() {
        const floor = Pool.instance.getElement(BoxEntity) as BoxEntity;

        floor.build({
            w: 1200,
            h: 60,
            layer: CollisionLayer.DEFAULT,
            debugColor: 0x00ff00
        });

        floor.isStatic = true;
        Body.setPosition(floor.body, {
            x: 600,
            y: 700
        });

        floor.syncView();

        this.root.addChild(floor.view);
        this.entities.push(floor);
    }

    public spawnBox(x: number, y: number) {
        const box = Pool.instance.getElement(BoxEntity) as BoxEntity;

        const size = 30 + Math.random() * 50;

        box.build({
            w: size,
            h: size,
            layer: CollisionLayer.DEFAULT,
            debugColor: Math.random() * 0xffffff
        });

        Body.setPosition(box.body, { x, y });

        box.syncView();

        this.root.addChild(box.view);
        this.entities.push(box);
    }

    public update(delta: number) {
        for (const e of this.entities) {
            e.update(delta);
        }
    }

    public destroy() {
        this.entities.forEach(e => e.destroy());
        this.entities.length = 0;
    }
}