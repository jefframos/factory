// AnimalFollowUI.ts
//
// Renders the global AnimalFollowStorage (see games/pizza/game/data/
// AnimalFollowStorage.ts) as a small framed panel — same "single centered
// row of slots inside a FrameComponent" shape BackpackUI.ts uses, with two
// deliberate differences suited to a MUCH smaller, capped list (at most
// MAX_FOLLOWERS, currently 3, vs. backpack's open-ended resource types):
//
//   - Every slot holds exactly ONE animal (not "one slot per distinct type,
//     with a count label" the way backpack groups same-type stacks) — two
//     Pigs following at once genuinely need two separate slots, since
//     they're two different live AnimalNode instances, not a quantity of
//     one fungible thing.
//   - The whole panel is rebuilt from AnimalFollowStorage.getFollowers()
//     from scratch on every onChange, rather than diffed incrementally —
//     backpack's per-type diffing exists because IT can have many distinct
//     types changing independently at high frequency; at a 3-entry cap, a
//     full rebuild is cheap enough that the extra bookkeeping isn't worth
//     it.
//
// The title doubles as the capacity readout the task asked for — "Animals
// 1/3" — turning red once full (see updateTitle()) so it's visually
// obvious at a glance, not just readable as text.
//
// Starts at minVisualSlots: 1 (same "still reads as a real panel, not an
// empty sliver" reasoning BackpackUI's own default of 2 uses, just smaller
// since this list caps at 3 total rather than growing indefinitely) and
// grows (never shrinks below that) as followers are actually caught.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import FrameComponent from './FrameComponent';
import { FrameName } from './FrameRegistry';
import { TextStyleRegistry } from './TextStyleRegistry';
import { AnimalFollowStorage, MAX_FOLLOWERS } from '../data/AnimalFollowStorage';
import { ANIMAL_CONFIG, AnimalType } from '../actions/AnimalTypes';
import { resolveResourceAssetKey } from '../actions/ResourceRegistry';
import { getAssetIcon } from '../world/AssetLibraryRegistry';
import ViewUtils from 'core/utils/ViewUtils';

export interface AnimalFollowUiConfig {
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

const DEFAULT_CONFIG: AnimalFollowUiConfig = {
    minVisualSlots: 1,
    slotSize: 48,
    slotGap: 8,
    frame: 'Large',
    title: 'Animals',
    padding: 14,
};

/** Same flat-square placeholder BackpackUI's own slot background uses. */
const SLOT_BG_TEXTURE_KEY = 'BorderFrame_Squrare_Bg';
const SLOT_BG_TINT = 0x000000;
const SLOT_BG_ALPHA = 0.5;
/** Vertical space reserved above the slot grid for the title/capacity text. */
const TITLE_HEIGHT = 22;

/** Gap left between the icon's edge and the slot background's edge — see occupySlot()'s ViewUtils.elementScaler() call. */
const ICON_PADDING = 6;

/** A freshly-caught animal's icon punches out and settles — same feel as BackpackUI's own gain jiggle. Multiplies the icon's own fitted base scale (see occupySlot()), not an absolute scale. */
const JIGGLE_PUNCH_SCALE = 1.3;
const JIGGLE_PUNCH_SEC = 0.12;
const JIGGLE_SETTLE_SEC = 0.15;

/** Title/capacity text color once the list is at MAX_FOLLOWERS — same red TextStyleRegistry.Damage/ResourceDamage already use for "pay attention to this" numbers. Reverts to Body's own default white (see TextStyleRegistry.ts) once a slot frees up. */
const TITLE_COLOR_FULL = '#FF4444';
const TITLE_COLOR_NORMAL = 0xffffff;

interface Slot {
    readonly container: PIXI.Container;
    readonly background: PIXI.Sprite;
    icon?: PIXI.Sprite;
    /** The icon's fitted-to-slot scale — playGainFeedback()'s jiggle punches out from and settles back to this, not to 1. */
    iconBaseScale?: number;
    animalType?: AnimalType;
}

export default class AnimalFollowUI extends PIXI.Container {
    private readonly config: AnimalFollowUiConfig;
    private readonly slots: Slot[] = [];
    /** How many followers there were as of the last onFollowersChanged() run — the only way to tell "one just got added" (worth a jiggle) from "the list just shrank" (a reset — no jiggle) on an event that carries no payload of its own. */
    private lastCount = 0;

    private frameComponent!: FrameComponent;
    private titleText!: PIXI.Text;

    /** The panel's own footprint, in its local space — see BackpackUI.panelWidth/panelHeight's own doc, same reasoning (UIService re-reads these every frame to anchor this panel without it drifting as the row grows). */
    public panelWidth = 0;
    public panelHeight = 0;

    public constructor(config: Partial<AnimalFollowUiConfig> = {}) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };

        const { frame, padding } = this.config;

        this.frameComponent = new FrameComponent(frame, 0, 0);
        this.addChild(this.frameComponent);

        this.titleText = new PIXI.Text('', TextStyleRegistry.Info);
        this.titleText.anchor.set(0.5, 0);
        this.titleText.position.set(0, padding * 0.5);
        this.addChild(this.titleText);

        this.lastCount = AnimalFollowStorage.getCount();
        this.reconcileSlotCount();
        this.rebuildSlots();

        AnimalFollowStorage.onChange.add(this.onFollowersChanged, this);
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
     * Keeps the slot row at exactly `max(current follower count, minVisualSlots)` — see this
     * file's own doc; never shrinks below the configured minimum, same "always fills the
     * panel's full width" reasoning BackpackUI's own reconcileSlotCount() uses. Always runs
     * BEFORE rebuildSlots() (see onFollowersChanged()), so slots can still be holding STALE
     * icons from before this change when the shrink case below runs — unlike BackpackUI (which
     * has to find a specifically-EMPTY slot to remove, since it keeps other occupied slots
     * intact across a change), this class rebuilds every icon from scratch right after anyway,
     * so it's safe to just pop from the end regardless of what a slot currently shows.
     */
    private reconcileSlotCount(): void {
        const desired = Math.max(AnimalFollowStorage.getCount(), this.config.minVisualSlots);

        while (this.slots.length < desired) {
            this.addSlot();
        }
        while (this.slots.length > desired) {
            this.removeSlot(this.slots[this.slots.length - 1]);
        }

        this.layoutSlots();
    }

    /** Single row filling the full panel width — resizes the frame to match the current slot count, same shape as BackpackUI.layoutSlots(). */
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

    /**
     * Rebuilds every slot's occupied/empty state from AnimalFollowStorage.getFollowers() —
     * called after reconcileSlotCount() has already sized the row correctly, so `this.slots`
     * always has at least `followers.length` entries to fill by the time this runs. See this
     * file's own doc for why a full rebuild (rather than backpack-style incremental diffing)
     * is the right call at this cap.
     */
    private rebuildSlots(): void {
        for (const slot of this.slots) {
            this.clearSlot(slot);
        }

        const followers = AnimalFollowStorage.getFollowers();
        followers.forEach((animalType, i) => this.occupySlot(this.slots[i], animalType));

        this.updateTitle(followers.length);
    }

    private updateTitle(count: number): void {
        this.titleText.text = `${this.config.title} ${count}/${MAX_FOLLOWERS}`;
        this.titleText.style.fill = count >= MAX_FOLLOWERS ? TITLE_COLOR_FULL : TITLE_COLOR_NORMAL;
    }

    private onFollowersChanged = (): void => {
        const count = AnimalFollowStorage.getCount();
        this.reconcileSlotCount();
        this.rebuildSlots();

        // Only the growing case gets a jiggle — a shrink (a "Clear Data" reset, the only way
        // this list gets smaller right now, see AnimalFollowStorage.clearAll()) has nothing
        // worth celebrating.
        if (count > this.lastCount) {
            const newestSlot = this.slots[count - 1];
            if (newestSlot) {
                this.playGainFeedback(newestSlot);
            }
        }
        this.lastCount = count;
    };

    /** Builds an occupied slot's icon (see AssetLibraryRegistry.getAssetIcon(), white-square fallback if no icon art is set) — no count label (unlike BackpackUI's stacked-count slots), since one slot IS one animal here. */
    private occupySlot(slot: Slot, animalType: AnimalType): void {
        slot.animalType = animalType;
        const size = slot.background.width;

        const icon = new PIXI.Sprite(getAssetIcon(resolveResourceAssetKey(ANIMAL_CONFIG[animalType].resourceType)));
        icon.anchor.set(0.5);
        icon.position.set(size / 2, size / 2);
        const baseScale = ViewUtils.elementScaler(icon, size - ICON_PADDING * 2);
        icon.scale.set(baseScale);
        slot.container.addChild(icon);
        slot.icon = icon;
        slot.iconBaseScale = baseScale;
    }

    /** A follower was just caught — icon punches out and settles. Purely decorative; AnimalFollowStorage's own list (already updated by the time onChange fires) is the source of truth regardless. */
    private playGainFeedback(slot: Slot): void {
        if (!slot.icon || slot.iconBaseScale === undefined) {
            return;
        }
        const icon = slot.icon;
        const baseScale = slot.iconBaseScale;
        gsap.killTweensOf(icon.scale);
        icon.scale.set(baseScale);
        gsap.timeline()
            .to(icon.scale, { x: baseScale * JIGGLE_PUNCH_SCALE, y: baseScale * JIGGLE_PUNCH_SCALE, duration: JIGGLE_PUNCH_SEC, ease: 'back.out(2)' })
            .to(icon.scale, { x: baseScale, y: baseScale, duration: JIGGLE_SETTLE_SEC, ease: 'power1.out' });
    }

    /** Tears an occupied slot's icon down and marks it empty again — a no-op on an already-empty slot. */
    private clearSlot(slot: Slot): void {
        if (slot.icon) {
            gsap.killTweensOf(slot.icon.scale);
        }
        slot.icon?.destroy();
        slot.icon = undefined;
        slot.iconBaseScale = undefined;
        slot.animalType = undefined;
    }

    public override destroy(options?: Parameters<PIXI.Container['destroy']>[0]): void {
        AnimalFollowStorage.onChange.remove(this.onFollowersChanged, this);
        super.destroy(options);
    }
}
