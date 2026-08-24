// BackpackUI.ts
//
// Renders the global BackpackStorage (see games/pizza/game/data/
// BackpackStorage.ts) as a small framed panel with a single centered row of
// item slots. Subscribes to BackpackStorage.onChange ONCE and updates only
// the slot whose resource actually changed — no per-frame polling. Tracks
// each slot's own last-seen count (see `lastCounts`) purely to tell a gain
// from a loss on every change, since onChange itself only reports WHICH
// resource changed, not the delta — a gain plays a "+N" popup and jiggles
// the icon (see playGainFeedback()); a loss (draining out to a drop zone)
// doesn't.
//
// Fully configurable (see BackpackUiConfig/DEFAULT_CONFIG below): the
// minimum slot count, slot size/gap, which FrameRegistry entry frames the
// panel, the title text. Change the look of the whole backpack HUD by
// editing one config object or passing overrides into the constructor — no
// other code here needs to change.
//
// The slot row's length is never a hard cap — it's always
// `max(distinct resource types currently held, minVisualSlots)` (see
// reconcileSlotCount()). The first resource type gathered claims a free
// slot; a brand new slot is grown when every slot is occupied and one more
// distinct type shows up (so a player with the right tool can never get
// stuck for lack of backpack space); once a type's count drops back to 0
// (fully deposited), its slot is torn down entirely and the row shrinks
// back — but never below `minVisualSlots`, so the row always fills the
// panel's full width and reads as centered rather than a lone slot hugging
// an edge. The panel (frame background, title, panelWidth/panelHeight) is
// resized to match every time the row changes — see layoutSlots().

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import FrameComponent from './FrameComponent';
import { FrameName } from './FrameRegistry';
import { TextStyleRegistry } from './TextStyleRegistry';
import { BackpackStorage } from '../data/BackpackStorage';
import { ResourceType } from '../actions/ResourceTypes';
import { resolveResourceAssetKey } from '../actions/ResourceRegistry';
import { getAssetIcon } from '../world/AssetLibraryRegistry';
import ViewUtils from 'core/utils/ViewUtils';

export interface BackpackUiConfig {
    /** Container never shows narrower than this many slots, even with fewer (or zero) occupied — see reconcileSlotCount(). */
    minVisualSlots: number;
    slotSize: number;
    slotGap: number;
    /** Which FrameRegistry entry frames the whole panel — see FrameRegistry.ts. */
    frame: FrameName;
    title: string;
    /** Space between the panel's frame border and its contents (slots row + title). */
    padding: number;
}

const DEFAULT_CONFIG: BackpackUiConfig = {
    minVisualSlots: 2,
    slotSize: 48,
    slotGap: 8,
    frame: 'Large',
    title: 'Backpack',
    padding: 14,
};

/** Plain flat square, tinted/alpha'd in code below rather than needing a pre-darkened asset variant — see addSlot(). */
const SLOT_BG_TEXTURE_KEY = 'BorderFrame_Squrare_Bg';
const SLOT_BG_TINT = 0x000000;
const SLOT_BG_ALPHA = 0.5;
/** Vertical space reserved above the slot grid for the title text. */
const TITLE_HEIGHT = 22;

/** Gap left between the icon's edge and the slot background's edge — see occupySlot()'s ViewUtils.elementScaler() call. */
const ICON_PADDING = 6;

/** Icon jiggle on a gain — a quick punch-out-and-settle, not a full spin. Multiplies the icon's own fitted base scale (see occupySlot()), not an absolute scale — the punch settles back to that fitted size, not to 1. */
const JIGGLE_PUNCH_SCALE = 1.3;
const JIGGLE_PUNCH_SEC = 0.12;
const JIGGLE_SETTLE_SEC = 0.15;

/** "+N" popup on a gain — rises and fades over this long, see playGainFeedback(). */
const GAIN_POPUP_RISE_PX = 20;
const GAIN_POPUP_DURATION_SEC = 0.6;

interface Slot {
    readonly container: PIXI.Container;
    readonly background: PIXI.Sprite;
    icon?: PIXI.Sprite;
    /** The icon's fitted-to-slot scale (see occupySlot()'s ViewUtils.elementScaler() call) — playGainFeedback()'s jiggle punches out from and settles back to this, not to 1. */
    iconBaseScale?: number;
    label?: PIXI.Text;
    resourceType?: ResourceType;
}

export default class BackpackUI extends PIXI.Container {
    private readonly config: BackpackUiConfig;
    private readonly slots: Slot[] = [];
    /** Last count seen per resource type — the only way to tell a gain from a loss on onChange (see this file's own doc). */
    private readonly lastCounts = new Map<ResourceType, number>();

    private frameComponent!: FrameComponent;
    private titleText!: PIXI.Text;

    /**
     * The panel's own footprint, in its local space (top-left at (0,0)) — recomputed by
     * layoutSlots() every time the row's slot count changes, not read off
     * PIXI.Container.getLocalBounds() (which would also have to walk every slot/icon/label
     * child every time something asks). See PizzaScene's positioning code, which re-reads
     * these every frame to anchor this panel by a corner other than top-left (e.g.
     * bottom-center) without it drifting as the row grows or shrinks.
     */
    public panelWidth = 0;
    public panelHeight = 0;

    public constructor(config: Partial<BackpackUiConfig> = {}) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };

        const { frame, title, padding } = this.config;

        this.frameComponent = new FrameComponent(frame, 0, 0);
        this.addChild(this.frameComponent);

        this.titleText = new PIXI.Text(title, TextStyleRegistry.Info);
        this.titleText.anchor.set(0.5, 0);
        this.titleText.position.set(0, padding * 0.5);
        this.addChild(this.titleText);

        this.reconcileSlotCount();

        BackpackStorage.onChange.add(this.onBackpackChanged, this);
        // Pick up whatever's already in the backpack — e.g. this panel building after
        // gathering already started (a scene rebuild, a HUD toggled back on, ...). Seeds
        // lastCounts from 0 too, so this doesn't itself read as a "gain" worth popping.
        for (const type of BackpackStorage.getAll().keys()) {
            this.onBackpackChanged(type);
        }
    }

    /** Appends one more (empty) slot to the row. Doesn't reposition anything by itself — see layoutSlots(). */
    private addSlot(): Slot {
        const { slotSize } = this.config;

        const container = new PIXI.Container();
        this.addChild(container);

        const background = new PIXI.Sprite(PIXI.Texture.from(SLOT_BG_TEXTURE_KEY));
        background.tint = SLOT_BG_TINT;
        background.alpha = SLOT_BG_ALPHA;
        background.width = slotSize;
        background.height = slotSize;
        container.addChild(background);

        const slot: Slot = { container, background };
        this.slots.push(slot);
        return slot;
    }

    /** Tears a slot down entirely and drops it from the row — used only on an empty slot once the row has more than `minVisualSlots` (see reconcileSlotCount()). */
    private removeSlot(slot: Slot): void {
        const index = this.slots.indexOf(slot);
        if (index !== -1) {
            this.slots.splice(index, 1);
        }
        if (slot.icon) {
            gsap.killTweensOf(slot.icon.scale);
        }
        slot.container.destroy({ children: true });
    }

    /**
     * Keeps the slot row at exactly `max(occupied slot count, minVisualSlots)` —
     * grows by adding empty slots when every slot is occupied and one more distinct
     * resource type shows up, and shrinks back down (destroying emptied slots) once a
     * resource is fully deposited, but never below the configured minimum. Because
     * empty slots always pad the row out to that minimum, the row fills the panel's
     * full width exactly — which is what keeps it visually centered rather than a
     * lone slot hugging one edge.
     */
    private reconcileSlotCount(): void {
        const occupiedCount = this.slots.filter(slot => slot.resourceType !== undefined).length;
        const desired = Math.max(occupiedCount, this.config.minVisualSlots);

        while (this.slots.length < desired) {
            this.addSlot();
        }
        while (this.slots.length > desired) {
            const freeSlot = this.findFreeSlot();
            if (!freeSlot) {
                break;
            }
            this.removeSlot(freeSlot);
        }

        this.layoutSlots();
    }

    /** Single row filling the full panel width — resizes the frame + retitles to match the current slot count. */
    private layoutSlots(): void {
        const { slotSize, slotGap, padding } = this.config;

        const gridWidth = this.slots.length * slotSize + Math.max(0, this.slots.length - 1) * slotGap;
        this.panelWidth = gridWidth + padding * 2;
        this.panelHeight = slotSize + padding * 2 + TITLE_HEIGHT;

        const y = padding + TITLE_HEIGHT;
        this.slots.forEach((slot, i) => {
            slot.container.position.set(padding + i * (slotSize + slotGap), y);
        });

        this.frameComponent.setSize(this.panelWidth, this.panelHeight);
        this.titleText.position.x = this.panelWidth / 2;
    }

    private findSlot(type: ResourceType): Slot | undefined {
        return this.slots.find(slot => slot.resourceType === type);
    }

    private findFreeSlot(): Slot | undefined {
        return this.slots.find(slot => slot.resourceType === undefined);
    }

    private onBackpackChanged = (type: ResourceType): void => {
        const previous = this.lastCounts.get(type) ?? 0;
        const count = BackpackStorage.getCount(type);
        this.lastCounts.set(type, count);

        let slot = this.findSlot(type);

        if (count <= 0) {
            if (slot) {
                this.clearSlot(slot);
                this.reconcileSlotCount();
            }
            return;
        }

        if (!slot) {
            // No free slot for a newly-gathered type — grow the row rather than
            // leaving it with nowhere to go (see this file's own doc).
            slot = this.findFreeSlot() ?? this.addSlot();
            this.occupySlot(slot, type);
            this.reconcileSlotCount();
        }

        this.updateSlotLabel(slot, count);

        const gained = count - previous;
        if (gained > 0) {
            this.playGainFeedback(slot, gained);
        }
    };

    /** First time `type` shows up in a slot — builds its icon (see AssetLibraryRegistry.getAssetIcon(), white-square fallback if no icon art is set) and count label. */
    private occupySlot(slot: Slot, type: ResourceType): void {
        slot.resourceType = type;
        const size = slot.background.width;

        const icon = new PIXI.Sprite(getAssetIcon(resolveResourceAssetKey(type)));
        icon.anchor.set(0.5);
        icon.position.set(size / 2, size / 2);
        const baseScale = ViewUtils.elementScaler(icon, size - ICON_PADDING * 2);
        icon.scale.set(baseScale);
        slot.container.addChild(icon);
        slot.icon = icon;
        slot.iconBaseScale = baseScale;

        const label = new PIXI.Text('0', TextStyleRegistry.Body);
        label.anchor.set(1, 1);
        label.position.set(size - 4, size - 2);
        slot.container.addChild(label);
        slot.label = label;
    }

    private updateSlotLabel(slot: Slot, count: number): void {
        if (slot.label) {
            slot.label.text = count.toString();
        }
    }

    /** A resource was just added — icon punches out and settles, and a "+N" rises and fades above it. Purely decorative; BackpackStorage's count (already applied by the time onChange fires) is the source of truth regardless. */
    private playGainFeedback(slot: Slot, gained: number): void {
        if (slot.icon && slot.iconBaseScale !== undefined) {
            const icon = slot.icon;
            const baseScale = slot.iconBaseScale;
            gsap.killTweensOf(icon.scale);
            icon.scale.set(baseScale);
            gsap.timeline()
                .to(icon.scale, { x: baseScale * JIGGLE_PUNCH_SCALE, y: baseScale * JIGGLE_PUNCH_SCALE, duration: JIGGLE_PUNCH_SEC, ease: 'back.out(2)' })
                .to(icon.scale, { x: baseScale, y: baseScale, duration: JIGGLE_SETTLE_SEC, ease: 'power1.out' });
        }

        const popup = new PIXI.Text(`+${gained}`, TextStyleRegistry.ResourceDamage);
        popup.style.fill = '#33cc66';
        popup.anchor.set(0.5, 1);
        popup.position.set(slot.background.width / 2, 0);
        slot.container.addChild(popup);

        const progress = { t: 0 };
        gsap.to(progress, {
            t: 1,
            duration: GAIN_POPUP_DURATION_SEC,
            ease: 'power2.out',
            onUpdate: () => {
                popup.position.y = -progress.t * GAIN_POPUP_RISE_PX;
                popup.alpha = 1 - progress.t;
            },
            onComplete: () => popup.destroy(),
        });
    }

    /** Resource type fully deposited — tear its icon/label down. Whether the now-empty slot itself gets removed is reconcileSlotCount()'s call, made right after this by the caller. */
    private clearSlot(slot: Slot): void {
        if (slot.icon) {
            gsap.killTweensOf(slot.icon.scale);
        }
        slot.icon?.destroy();
        slot.label?.destroy();
        slot.icon = undefined;
        slot.iconBaseScale = undefined;
        slot.label = undefined;
        slot.resourceType = undefined;
    }

    public override destroy(options?: Parameters<PIXI.Container['destroy']>[0]): void {
        BackpackStorage.onChange.remove(this.onBackpackChanged, this);
        super.destroy(options);
    }
}
