// AlertAboveComponent.ts
//
// A bobbing '!' (ui/AlertIcon.ts) floating `height` above its entity while `isActive()` is true —
// e.g. over a desk NPC while something it sells is affordable (PizzaScene.setupHireDesks() /
// setupFarmDesks(): the hire manager's staff upgrades, the farm manager's farm upgrades, the
// animal keeper's stall upgrades). Polled every frame — keep `isActive` cheap. Same anchor
// options as the store's own prompts (STORE_ALERT_ANCHOR_OPTIONS), so it calls the player over
// from a distance.

import * as THREE from 'three';
import Component from '../ecs/Component';
import ScreenAnchorComponent, { ScreenAnchorHost } from './ScreenAnchorComponent';
import { createAlertIcon, destroyAlertIcon } from '../ui/AlertIcon';
import { STORE_ALERT_ANCHOR_OPTIONS } from '../store/StoreAlertConfig';

/** Same size as the '!' over the cashier (StoreCashier.ts). */
const ALERT_SIZE = 44;

export default class AlertAboveComponent extends Component {
    private readonly screenHost: ScreenAnchorHost;
    private readonly height: number;
    private readonly isActive: () => boolean;
    private icon?: ReturnType<typeof createAlertIcon>;
    private anchor?: ScreenAnchorComponent;
    private shown?: boolean;

    public constructor(screenHost: ScreenAnchorHost, height: number, isActive: () => boolean) {
        super();
        this.screenHost = screenHost;
        this.height = height;
        this.isActive = isActive;
    }

    public override awake(): void {
        this.icon = createAlertIcon('exclamation', ALERT_SIZE);
        const target = new THREE.Vector3();
        const position = this.entity.transform.position;
        this.anchor = this.entity.addComponent(new ScreenAnchorComponent(
            this.screenHost,
            this.icon,
            () => target.copy(position).setY(position.y + this.height),
            STORE_ALERT_ANCHOR_OPTIONS,
        ));
        this.refresh();
    }

    public override update(): void {
        this.refresh();
    }

    public override destroy(): void {
        if (this.icon) {
            destroyAlertIcon(this.icon);
        }
    }

    /** Only touches the anchor when the state flips. */
    private refresh(): void {
        const show = this.isActive();
        if (show !== this.shown) {
            this.shown = show;
            this.anchor?.setForceHidden(!show);
        }
    }
}
