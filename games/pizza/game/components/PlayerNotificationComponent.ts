// PlayerNotificationComponent.ts
//
// Optional per-player component (same "requires screenHost, omitted by the
// headless test harness" shape as PlayerUIAvoidanceComponent.ts) that pops a
// brief icon-only bubble above the player's OWN head when an attempted
// action was silently skipped — e.g. AutoGatherController noticing the
// player standing in a resource node's trigger without the tool it needs
// (see that file's own hasRequiredTool()). Content is the blocked icon
// (whatever the caller passes — a tool icon, an ingredient icon, ...) with
// a small exclamation badge overlapping its corner, same composition
// Gate.ts's requirement panel uses for its own "missing" badge, just built
// fresh per call instead of persistent.
//
// Modeled directly on ResourceNode.showResourceGainPopup()'s "throwaway
// ScreenAnchorComponent" shape: spawns a short-lived world entity carrying
// the popup content, which despawns itself once its ttlSec elapses —
// nothing here tracks popup lifetime by hand. One popup at a time: calling
// show() again while a previous one is still up despawns it immediately
// first, rather than stacking two overlapping bubbles over the player's
// head.

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import Component from '../ecs/Component';
import Entity from '../ecs/Entity';
import ScreenAnchorComponent, { ScreenAnchorHost } from './ScreenAnchorComponent';
import AutoFitFrame, { uniformFitPadding } from '../ui/AutoFitFrame';
import ViewUtils from 'core/utils/ViewUtils';

/** World-space offset from the player entity's own transform.position (feet) to where the bubble anchors — above the head, clear of PlayerUIAvoidanceComponent.DEFAULT_HEAD_OFFSET's own point so it doesn't sit right where other popups already dodge. */
const ANCHOR_OFFSET = new THREE.Vector3(0, 2.3, 0);
/** How long the bubble stays up before ScreenAnchorComponent despawns its entity — long enough to read, short enough not to linger once the player's moved on. */
const TTL_SEC = 1.4;
const FRAME_PADDING = uniformFitPadding(14);
const ICON_SIZE = 36;
/** Exclamation badge overlapping the icon's bottom-right corner — same composition/texture as Gate.ts's REQUIREMENT_BADGE_MISSING. */
const BADGE_SIZE = 20;
const BADGE_INSET = -2;
const BADGE_TEXTURE = 'Icon_Exclamation';

export default class PlayerNotificationComponent extends Component {
    private readonly host: ScreenAnchorHost;
    /** The currently-showing popup's own entity, if any — despawned up front the next time show() is called (see this file's own doc on "one popup at a time"). */
    private activePopup?: Entity;

    public constructor(host: ScreenAnchorHost) {
        super();
        this.host = host;
    }

    /** Pops `icon` (e.g. ToolRegistry.getToolIcon()) with an exclamation badge briefly above the player's own head — call whenever an action gets silently skipped for a reason the player should see. */
    public showBlocked(icon: PIXI.Texture): void {
        const world = this.entity.world;
        if (!world) {
            return;
        }

        if (this.activePopup) {
            world.despawn(this.activePopup);
            this.activePopup = undefined;
        }

        const iconSprite = new PIXI.Sprite(icon);
        iconSprite.anchor.set(0.5, 1);
        iconSprite.scale.set(ViewUtils.elementScaler(iconSprite, ICON_SIZE));

        const badge = new PIXI.Sprite(PIXI.Texture.from(BADGE_TEXTURE));
        badge.anchor.set(1, 1);
        badge.scale.set(ViewUtils.elementScaler(badge, BADGE_SIZE));
        badge.position.set(ICON_SIZE / 2 - BADGE_INSET, -BADGE_INSET);

        const row = new PIXI.Container();
        row.addChild(iconSprite, badge);

        const content = new AutoFitFrame(FRAME_PADDING, 'Blocked', row);

        const anchorPosition = new THREE.Vector3();
        const popup = world.spawn();
        this.activePopup = popup;
        popup.addComponent(new ScreenAnchorComponent(
            this.host,
            content,
            () => anchorPosition.copy(this.entity.transform.position).add(ANCHOR_OFFSET),
            { ttlSec: TTL_SEC },
        ));
    }

    public destroy(): void {
        if (this.activePopup) {
            this.entity.world?.despawn(this.activePopup);
            this.activePopup = undefined;
        }
    }
}
