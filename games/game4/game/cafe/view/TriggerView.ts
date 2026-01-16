import Collider from '@core/collision/Collider';
import ViewUtils from '@core/utils/ViewUtils';
import * as PIXI from 'pixi.js';
import GameplayCafeScene from '../GameplayCafeScene';
import { TriggerManager } from '../manager/TriggerManager';

export type TriggerViewStatus = 'available' | 'active' | 'waiting' | 'disabled';

export default class TriggerView extends PIXI.Container {
    public targetCollider?: Collider;
    private sprite: PIXI.Sprite;
    private _status: TriggerViewStatus = 'available';

    private readonly statusColors: Record<TriggerViewStatus, number> = {
        available: 0xffffff, // white
        active: 0x00ff00,    // green
        waiting: 0xffff00,   // yellow
        disabled: 0x000000   // hidden (makes it invisible)
    };

    constructor(trigger?: Collider, radius: number = 20) {
        super();

        this.targetCollider = trigger;

        const texture = PIXI.Texture.from('CardFrame02_n_Light');
        this.sprite = new PIXI.Sprite(texture);
        this.sprite.anchor.set(0.5);

        this.sprite.scale.set(ViewUtils.elementScaler(this.sprite, (trigger?.radius * 2 ?? radius) * 2)); // maintain ellipse shape
        this.sprite.scale.y /= 2
        this.addChild(this.sprite);

        this.setStatus('available');


        GameplayCafeScene.tiledGameplayLayer.addChild(this);

        if (this.targetCollider) {
            TriggerManager.registerTriggerView(this.targetCollider, this)
        }

        setTimeout(() => {
            this.zIndex = -this.y
        }, 1);
    }

    public setStatus(status: TriggerViewStatus): void {
        this._status = status;

        if (status === 'disabled') {
            this.visible = false;
            return;
        }

        this.visible = true;
        this.sprite.tint = this.statusColors[status];
    }

    public get status(): TriggerViewStatus {
        return this._status;
    }
}
