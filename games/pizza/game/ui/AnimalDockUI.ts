// AnimalDockUI.ts
//
// Alternative to AnimalFollowUI.ts — same AnimalFollowStorage data (see
// games/pizza/game/data/AnimalFollowStorage.ts), rendered as a bare vertical
// list instead of a framed, titled panel — same "no FrameComponent
// background/title, just icon + label per row" shape BackpackListUI.ts/
// ToolListUI.ts already use, pinned bottom-left this time. Icons run bigger
// than those two lists (see DEFAULT_CONFIG) since the follower cap
// (MAX_FOLLOWERS, currently 3) is much smaller than the resource/tool
// counts those lists can show at once — more room per row to spend.
//
// No "Animals" title — the FIRST row (see refresh()) is just the capacity
// readout ("1/3"), same red-once-full color swap AnimalFollowUI's own
// updateTitle() used, sized to line up with the icon rows below it rather
// than floating above them as a separate title bar. Each occupied row's
// icon still gets the same square backing (see ICON_BG_* below)
// BackpackListUI/ToolListUI tint behind their own icons, and gently bobs up
// and down forever (see startFloating()) — pure idle flavor, independent of
// the gain-jiggle punch that plays once when a new follower joins.
//
// Hidden ENTIRELY at zero followers (see refresh()) — same reasoning
// ToolListUI.refresh() uses for an empty tool set.
//
// Kept as its own file (rather than editing AnimalFollowUI.ts in place) so
// the old top-anchored panel stays available to switch back to — see
// UIService.ts's own comment on which one is actually wired up.
//
// Rebuilt wholesale on every AnimalFollowStorage.onChange, same "cheap at a
// 3-entry cap" reasoning as AnimalFollowUI.rebuildSlots()'s own doc.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { TextStyleRegistry } from './TextStyleRegistry';
import { AnimalFollowStorage, MAX_FOLLOWERS } from '../data/AnimalFollowStorage';
import { ANIMAL_CONFIG, AnimalType } from '../actions/AnimalTypes';
import { resolveResourceAssetKey } from '../actions/ResourceRegistry';
import { getAssetIcon } from '../world/AssetLibraryRegistry';
import ViewUtils from 'core/utils/ViewUtils';

export interface AnimalDockUiConfig {
    rowHeight: number;
    rowGap: number;
    iconSize: number;
    /** Height reserved for the capacity label row at the top of the list. */
    labelRowHeight: number;
    /** How far an icon bobs up/down from its resting position, in px — see startFloating(). */
    floatAmplitude: number;
    /** One full up-down-up cycle, in seconds — see startFloating(). */
    floatDurationSec: number;
}

const DEFAULT_CONFIG: AnimalDockUiConfig = {
    rowHeight: 48,
    rowGap: 10,
    iconSize: 48,
    labelRowHeight: 22,
    floatAmplitude: 5,
    floatDurationSec: 1.6,
};

/** Same square backing BackpackListUI/ToolListUI tint behind every resource/tool icon (see those files' own ICON_BG_* constants) — reused here so follower icons contrast the same way against the 3D map instead of floating with no backing at all. */
const ICON_BG_TEXTURE_KEY = 'BorderFrame_Squrare_Bg';
const ICON_BG_TINT = 0x000000;
const ICON_BG_ALPHA = 0.5;
/** Gap left between the icon's own edge and its background square's edge. */
const ICON_PADDING = 6;

/** A freshly-caught animal's icon punches out and settles — same feel as AnimalFollowUI's own gain jiggle. Multiplies the icon's own fitted base scale, not an absolute scale, and layers on TOP of the continuous float tween below (different properties — scale vs. position — so the two never fight). */
const JIGGLE_PUNCH_SCALE = 1.3;
const JIGGLE_PUNCH_SEC = 0.12;
const JIGGLE_SETTLE_SEC = 0.15;

/** Capacity label color once the list is at MAX_FOLLOWERS — same red TextStyleRegistry.Damage/ResourceDamage already use for "pay attention to this" numbers. Reverts to Body's own default white once a slot frees up. */
const LABEL_COLOR_FULL = '#FF4444';
const LABEL_COLOR_NORMAL = 0xffffff;

/** Slight per-row stagger so every icon isn't bobbing in lockstep — see startFloating(). */
const FLOAT_STAGGER_SEC = 0.15;

interface Row {
    readonly container: PIXI.Container;
    readonly icon: PIXI.Sprite;
    /** Mutable — occupyRow() re-fits this every refresh() since a row shell is reused across different animal types (icons aren't necessarily the same aspect ratio). */
    iconBaseScale: number;
}

export default class AnimalDockUI extends PIXI.Container {
    private readonly config: AnimalDockUiConfig;
    private readonly rows: Row[] = [];
    private capacityLabel!: PIXI.Text;
    /** How many followers there were as of the last refresh() run — the only way to tell "one just got added" (worth a jiggle) from "the list just shrank" on an event with no payload of its own. */
    private lastCount = 0;

    /** The list's own footprint, in its local space (top-left at (0,0)) — recomputed by refresh() every time the follower set changes. Same "re-read every frame" reasoning as BackpackListUI/ToolListUI's own panelWidth/panelHeight — UIService anchors this without it drifting as followers join. Both stay 0 while hidden. */
    public panelWidth = 0;
    public panelHeight = 0;

    public constructor(config: Partial<AnimalDockUiConfig> = {}) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };

        this.capacityLabel = new PIXI.Text('', TextStyleRegistry.Info);
        this.capacityLabel.anchor.set(0, 0.5);
        this.addChild(this.capacityLabel);

        this.lastCount = AnimalFollowStorage.getCount();
        this.refresh();

        AnimalFollowStorage.onChange.add(this.onFollowersChanged, this);
    }

    /** Rebuilds the whole list (rows, capacity label, visibility) from AnimalFollowStorage's current followers. */
    private refresh(): void {
        const { rowHeight, rowGap, iconSize, labelRowHeight } = this.config;
        const followers = AnimalFollowStorage.getFollowers();

        // Nothing following — hide the list entirely rather than showing an empty label.
        this.visible = followers.length > 0;
        if (!this.visible) {
            this.teardownRows();
            this.panelWidth = 0;
            this.panelHeight = 0;
            return;
        }

        this.capacityLabel.position.set(0, labelRowHeight / 2);
        this.capacityLabel.text = `${followers.length}/${MAX_FOLLOWERS}`;
        this.capacityLabel.style.fill = followers.length >= MAX_FOLLOWERS ? LABEL_COLOR_FULL : LABEL_COLOR_NORMAL;

        this.reconcileRowCount(followers.length);
        followers.forEach((animalType, i) => {
            this.rows[i].container.position.set(0, labelRowHeight + i * (rowHeight + rowGap));
            this.occupyRow(this.rows[i], animalType, i);
        });

        this.panelWidth = iconSize;
        this.panelHeight = followers.length > 0
            ? labelRowHeight + followers.length * rowHeight + (followers.length - 1) * rowGap
            : 0;
    }

    /** Grows/shrinks `this.rows` to exactly `desired`. */
    private reconcileRowCount(desired: number): void {
        while (this.rows.length < desired) {
            this.addRow();
        }
        while (this.rows.length > desired) {
            this.removeRow(this.rows[this.rows.length - 1]);
        }
    }

    /** Appends one more row (bg square + icon) to the list. Icon art gets swapped in by occupyRow() right after — this just builds the shared shell. */
    private addRow(): Row {
        const { iconSize } = this.config;

        const container = new PIXI.Container();
        this.addChild(container);

        const iconBg = new PIXI.Sprite(PIXI.Texture.from(ICON_BG_TEXTURE_KEY));
        iconBg.tint = ICON_BG_TINT;
        iconBg.alpha = ICON_BG_ALPHA;
        iconBg.anchor.set(0, 0.5);
        iconBg.width = iconSize;
        iconBg.height = iconSize;
        iconBg.position.set(0, this.config.rowHeight / 2);
        container.addChild(iconBg);

        // Centered ON the bg square (anchor 0.5 at its middle) — same reasoning as
        // BackpackListUI/ToolListUI's own icons, sized smaller than the bg
        // (iconSize - ICON_PADDING*2) and centered rather than sharing the bg's own anchor.
        const icon = new PIXI.Sprite(PIXI.Texture.EMPTY);
        icon.anchor.set(0.5, 0.5);
        icon.position.set(iconSize / 2, this.config.rowHeight / 2);
        container.addChild(icon);

        const row: Row = { container, icon, iconBaseScale: 1 };
        this.rows.push(row);
        return row;
    }

    /** Tears a row down entirely (killing its float/jiggle tweens first) and drops it from the list. */
    private removeRow(row: Row): void {
        const index = this.rows.indexOf(row);
        if (index !== -1) {
            this.rows.splice(index, 1);
        }
        gsap.killTweensOf(row.icon.scale);
        gsap.killTweensOf(row.icon.position);
        row.container.destroy({ children: true });
    }

    /** Every row torn down — used when the follower list drops to 0 (see refresh()). */
    private teardownRows(): void {
        while (this.rows.length > 0) {
            this.removeRow(this.rows[this.rows.length - 1]);
        }
    }

    /** Swaps in `animalType`'s icon art on an already-built row shell and (re)starts its idle float — rebuilt every refresh() (rather than diffed per-type) since the follower list is tiny and order-sensitive, same reasoning AnimalFollowUI's own rebuildSlots() doc gives. */
    private occupyRow(row: Row, animalType: AnimalType, index: number): void {
        const { iconSize } = this.config;

        row.icon.texture = getAssetIcon(resolveResourceAssetKey(ANIMAL_CONFIG[animalType].resourceType));
        const baseScale = ViewUtils.elementScaler(row.icon, iconSize - ICON_PADDING * 2);
        gsap.killTweensOf(row.icon.scale);
        gsap.killTweensOf(row.icon.position);
        row.icon.scale.set(baseScale);
        row.iconBaseScale = baseScale;

        this.startFloating(row.icon, this.config.rowHeight / 2, index);
    }

    /** Idle "flavor" animation — endlessly eases the icon's Y up and down around its resting position, staggered per row index so a column of animals doesn't bob in unison. Runs forever (repeat: -1, yoyo: true) until killed in removeRow()/occupyRow(). */
    private startFloating(icon: PIXI.Sprite, restY: number, index: number): void {
        const { floatAmplitude, floatDurationSec } = this.config;

        gsap.to(icon.position, {
            y: restY - floatAmplitude,
            duration: floatDurationSec,
            ease: 'sine.inOut',
            yoyo: true,
            repeat: -1,
            delay: index * FLOAT_STAGGER_SEC,
        });
    }

    private onFollowersChanged = (): void => {
        const count = AnimalFollowStorage.getCount();
        this.refresh();

        // Only the growing case gets a jiggle — a shrink (delivered to a queue, or a "Clear
        // Data" reset) has nothing worth celebrating.
        if (count > this.lastCount) {
            const newestRow = this.rows[count - 1];
            if (newestRow) {
                this.playGainFeedback(newestRow);
            }
        }
        this.lastCount = count;
    };

    /** A follower was just caught — icon punches out and settles. Layers on top of the continuous float tween (different property — scale, not position — so the two coexist without conflict). */
    private playGainFeedback(row: Row): void {
        const icon = row.icon;
        const baseScale = row.iconBaseScale;
        gsap.killTweensOf(icon.scale);
        icon.scale.set(baseScale);
        gsap.timeline()
            .to(icon.scale, { x: baseScale * JIGGLE_PUNCH_SCALE, y: baseScale * JIGGLE_PUNCH_SCALE, duration: JIGGLE_PUNCH_SEC, ease: 'back.out(2)' })
            .to(icon.scale, { x: baseScale, y: baseScale, duration: JIGGLE_SETTLE_SEC, ease: 'power1.out' });
    }

    public override destroy(options?: Parameters<PIXI.Container['destroy']>[0]): void {
        AnimalFollowStorage.onChange.remove(this.onFollowersChanged, this);
        for (const row of this.rows) {
            gsap.killTweensOf(row.icon.scale);
            gsap.killTweensOf(row.icon.position);
        }
        super.destroy(options);
    }
}
