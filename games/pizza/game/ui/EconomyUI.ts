// EconomyUI.ts
//
// Renders EconomyStorage's balances (see games/pizza/game/data/
// EconomyStorage.ts) as a row of pills pinned to a screen corner — one pill
// per currency listed in TopBarStyle.ts's TOP_BAR_STYLE.currencies (icon on
// the left, amount right-aligned, "pop" animated via playGainFeedback() each
// time a balance grows). No panel title/frame wraps the row — each currency
// gets its own small framed pill instead, so the topbar reads as a strip of
// stats rather than a titled "Wallet" panel. All sizing/spacing/frame choice
// lives in TopBarStyle.ts — this file only lays pills out and reacts to
// EconomyStorage.onChange.
//
// Subscribes to EconomyStorage.onChange ONCE and repaints only the pill whose
// currency actually changed — no per-frame polling. Tracks each pill's own
// last-seen balance purely to compute the gained delta for
// playGainFeedback(), since onChange itself only reports WHICH currency
// changed.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import FrameComponent from './FrameComponent';
import { TextStyleRegistry } from './TextStyleRegistry';
import { TOP_BAR_STYLE } from './TopBarStyle';
import { EconomyStorage } from '../data/EconomyStorage';
import { CURRENCY_CONFIG, CurrencyType } from '../data/EconomyTypes';
import { getAssetIcon } from '../world/AssetLibraryRegistry';
import ViewUtils from 'core/utils/ViewUtils';
import { ItemStorage } from '../crafting/ItemStorage';
import { BackpackUnlockStorage } from '../data/BackpackUnlockStorage';
import { CurrencyUnlockStorage } from '../data/CurrencyUnlockStorage';

/** Icon jiggle on a gain — a quick punch-out-and-settle, not a full spin. Same shape as GlobalResourcesUI's own jiggle. */
const JIGGLE_PUNCH_SCALE = 1.3;
const JIGGLE_PUNCH_SEC = 0.12;
const JIGGLE_SETTLE_SEC = 0.15;

/** "+N" popup on a gain — rises and fades over this long, see playGainFeedback(). */
const GAIN_POPUP_RISE_PX = 16;
const GAIN_POPUP_DURATION_SEC = 0.6;

interface Pill {
    readonly container: PIXI.Container;
    readonly frameComponent: FrameComponent;
    readonly icon: PIXI.Sprite;
    readonly iconBaseScale: number;
    readonly amountLabel: PIXI.Text;
    readonly currency: CurrencyType;
    lastBalance: number;
}

export default class EconomyUI extends PIXI.Container {
    private readonly pills: Pill[] = [];
    private readonly pillsByCurrency = new Map<CurrencyType, Pill>();

    /** The row's own footprint, in its local space (top-left at (0,0)) — see GlobalResourcesUI's identical fields for why UIService reads these every frame to anchor by a corner other than top-left. */
    public panelWidth = 0;
    public panelHeight = 0;

    private readonly handleItemsChanged = (): void => {
        // markUnlocked() is a no-op once already unlocked (see BackpackUnlockStorage's own doc) —
        // BackpackButton.ts fires the same call from its own ItemStorage.onChange listener, this
        // is just this row's own independent copy of that same "first tool" check, since the two
        // panels are built/torn down independently by UIService.
        if (ItemStorage.hasAny()) {
            BackpackUnlockStorage.markUnlocked();
        }
        this.visible = BackpackUnlockStorage.isUnlocked();
    };

    public constructor() {
        super();

        for (const currency of TOP_BAR_STYLE.currencies) {
            this.pills.push(this.buildPill(currency));
        }

        // Seeds each pill's lastBalance from whatever's already saved (e.g. this row building
        // after a reload with existing currency) so that read doesn't itself pop as a "gain",
        // and backfills CurrencyUnlockStorage for a save that already held a non-Money currency
        // from BEFORE this feature existed — without this, that balance would never re-fire
        // EconomyStorage.onChange, so its pill would stay hidden forever.
        for (const pill of this.pills) {
            pill.lastBalance = EconomyStorage.getBalance(pill.currency);
            pill.amountLabel.text = pill.lastBalance.toString();
            if (pill.lastBalance > 0) {
                CurrencyUnlockStorage.markHeld(pill.currency);
            }
        }

        this.layout();

        EconomyStorage.onChange.add(this.onEconomyChanged, this);
        ItemStorage.onChange.add(this.handleItemsChanged);
        // Covers a save that already owns a tool from BEFORE this feature existed — same
        // "backfill on construction" reasoning as BackpackButton.ts's own doc.
        this.handleItemsChanged();
    }

    /**
     * Where a given currency's icon actually renders, in THIS row's PARENT's local space (i.e.
     * `game.overlayContainer`'s own coordinate system, since UIService adds this row as a
     * direct child of that container with no extra scale/rotation) — used by
     * FlyingResourceIcon.spawnFlyingIconToOverlayPoint() so a queue's reward can fly to exactly
     * where a currency's pill sits on screen, tracking it live if this row ever moves (a resize
     * UIService repositions it for) rather than a position snapshotted once. Falls back to this
     * row's own position if `currency` isn't shown on the topbar.
     */
    public getIconAnchorPosition(currency: CurrencyType, target: PIXI.Point = new PIXI.Point()): PIXI.Point {
        const pill = this.pillsByCurrency.get(currency);
        if (!pill) {
            return target.set(this.x, this.y);
        }
        return target.set(this.x + pill.container.x + pill.icon.x, this.y + pill.container.y + pill.icon.y);
    }

    private buildPill(currency: CurrencyType): Pill {
        const { pillContentWidth, pillHeight, pillFrame, iconPadding } = TOP_BAR_STYLE;

        const container = new PIXI.Container();
        this.addChild(container);

        const frameComponent = new FrameComponent(pillFrame, 0, 0);
        frameComponent.setSize(pillContentWidth + TOP_BAR_STYLE.pillPadding * 2, pillHeight);
        container.addChild(frameComponent);

        const icon = new PIXI.Sprite(getAssetIcon(CURRENCY_CONFIG[currency].assetKey));
        icon.anchor.set(0, 0.5);
        icon.position.set(TOP_BAR_STYLE.pillPadding, pillHeight / 2);
        const iconBaseScale = ViewUtils.elementScaler(icon, pillHeight - iconPadding * 2);
        icon.scale.set(iconBaseScale);
        container.addChild(icon);

        const amountLabel = new PIXI.Text('0', TextStyleRegistry.Body);
        amountLabel.anchor.set(1, 0.5);
        amountLabel.position.set(TOP_BAR_STYLE.pillPadding + pillContentWidth, pillHeight / 2);
        container.addChild(amountLabel);

        const pill: Pill = { container, frameComponent, icon, iconBaseScale, amountLabel, currency, lastBalance: 0 };
        this.pillsByCurrency.set(currency, pill);
        return pill;
    }

    private onEconomyChanged = (type: CurrencyType): void => {
        const pill = this.pillsByCurrency.get(type);
        if (!pill) {
            return;
        }

        const balance = EconomyStorage.getBalance(type);
        const gained = balance - pill.lastBalance;
        pill.lastBalance = balance;
        pill.amountLabel.text = balance.toString();

        // Sticky reveal — see CurrencyUnlockStorage.ts's own doc on why Gem/Energy stay visible
        // even if later spent back down to 0, rather than un-hiding/re-hiding with the live
        // balance. A no-op (and no re-layout) once already marked, same as markUnlocked().
        const wasVisible = pill.container.visible;
        if (balance > 0) {
            CurrencyUnlockStorage.markHeld(type);
        }
        if (this.isPillVisible(type) !== wasVisible) {
            this.layout();
        }

        if (gained > 0) {
            this.playGainFeedback(pill, gained);
        }
    };

    /** Money always shows; Gem/Energy only once the player's ever held a positive balance of that currency (see CurrencyUnlockStorage.ts's own doc) — checked live (not cached) since layout() is what re-derives the whole row's positions from this every time it's called. */
    private isPillVisible(currency: CurrencyType): boolean {
        return currency === CurrencyType.Money || CurrencyUnlockStorage.hasEverHeld(currency);
    }

    /** Lays out every currently-VISIBLE pill left to right with `pillGap` between them, hiding the rest — called at construction and again by onEconomyChanged() whenever a pill's own visibility just changed, so a newly-revealed (or, in practice never, re-hidden) currency slots into the row instead of leaving a gap where a hidden pill would otherwise still occupy space. */
    private layout(): void {
        const { pillContentWidth, pillHeight, pillGap, pillPadding } = TOP_BAR_STYLE;
        const pillWidth = pillContentWidth + pillPadding * 2;

        let x = 0;
        let visibleCount = 0;
        for (const pill of this.pills) {
            const visible = this.isPillVisible(pill.currency);
            pill.container.visible = visible;
            if (!visible) {
                continue;
            }
            pill.container.position.set(x, 0);
            x += pillWidth + pillGap;
            visibleCount++;
        }

        this.panelWidth = visibleCount > 0 ? visibleCount * pillWidth - pillGap : 0;
        this.panelHeight = pillHeight;
    }

    /** A currency just grew — icon punches out and settles, and a "+N" rises and fades above the amount. Purely decorative; EconomyStorage's balance (already applied by the time onChange fires) is the source of truth regardless. */
    private playGainFeedback(pill: Pill, gained: number): void {
        gsap.killTweensOf(pill.icon.scale);
        pill.icon.scale.set(pill.iconBaseScale);
        gsap.timeline()
            .to(pill.icon.scale, { x: pill.iconBaseScale * JIGGLE_PUNCH_SCALE, y: pill.iconBaseScale * JIGGLE_PUNCH_SCALE, duration: JIGGLE_PUNCH_SEC, ease: 'back.out(2)' })
            .to(pill.icon.scale, { x: pill.iconBaseScale, y: pill.iconBaseScale, duration: JIGGLE_SETTLE_SEC, ease: 'power1.out' });

        const popup = new PIXI.Text(`+${gained}`, TextStyleRegistry.ResourceDamage);
        popup.style.fill = '#33cc66';
        popup.anchor.set(1, 1);
        popup.position.set(pill.amountLabel.position.x, pill.amountLabel.position.y - TOP_BAR_STYLE.pillHeight / 2);
        pill.container.addChild(popup);

        const progress = { t: 0 };
        const baseY = popup.position.y;
        gsap.to(progress, {
            t: 1,
            duration: GAIN_POPUP_DURATION_SEC,
            ease: 'power2.out',
            onUpdate: () => {
                popup.position.y = baseY - progress.t * GAIN_POPUP_RISE_PX;
                popup.alpha = 1 - progress.t;
            },
            onComplete: () => popup.destroy(),
        });
    }

    public override destroy(options?: Parameters<PIXI.Container['destroy']>[0]): void {
        EconomyStorage.onChange.remove(this.onEconomyChanged, this);
        ItemStorage.onChange.remove(this.handleItemsChanged);
        super.destroy(options);
    }
}
