// GlobalResourcesUI.ts
//
// Renders GlobalResourceStorage (see games/pizza/game/data/
// GlobalResourceStorage.ts) as a small panel pinned to a screen corner —
// one row per distinct resource type the player's BASE currently holds
// (icon on the left, count right-aligned), "pop" animated (see
// playGainFeedback()) each time a deposit lands. Distinct from BackpackUI,
// which tracks what's currently being CARRIED, not yet deposited.
//
// Only shows rows for resources actually held — no BackpackUI-style
// "always show at least N slots" minimum, since a vertical list pinned to a
// corner doesn't need to stay visually centered/balanced the way a floating
// HUD panel does; an empty stockpile is just an empty (near-zero-height)
// panel. Rows only ever get ADDED in practice — GlobalResourceStorage never
// drains — but removeRow() still exists for symmetry with BackpackUI and in
// case a future spend mechanic changes that.
//
// Subscribes to GlobalResourceStorage.onChange ONCE and updates only the
// row whose resource actually changed — no per-frame polling. Tracks each
// row's own last-seen count (see `lastCounts`) purely to compute the gained
// delta for playGainFeedback(), since onChange itself only reports WHICH
// resource changed.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import FrameComponent from './FrameComponent';
import { FrameName } from './FrameRegistry';
import { TextStyleRegistry } from './TextStyleRegistry';
import { GlobalResourceStorage } from '../data/GlobalResourceStorage';
import { ResourceType } from '../actions/ResourceTypes';
import { resolveResourceAssetKey } from '../actions/ResourceRegistry';
import { getAssetIcon } from '../world/AssetLibraryRegistry';
import ViewUtils from 'core/utils/ViewUtils';

export interface GlobalResourcesUiConfig {
    /** Width of the rows themselves, NOT counting `padding` — panelWidth (see that field's own doc) adds padding on both sides on top of this. */
    contentWidth: number;
    rowHeight: number;
    rowGap: number;
    /** Which FrameRegistry entry frames the whole panel — see FrameRegistry.ts. Deliberately different from BackpackUI's 'Large' — this is a different concept (base stockpile vs. carried). */
    frame: FrameName;
    title: string;
    /** Space between the panel's frame border and its contents (rows + title). */
    padding: number;
}

const DEFAULT_CONFIG: GlobalResourcesUiConfig = {
    contentWidth: 130,
    rowHeight: 36,
    rowGap: 6,
    frame: 'Main',
    title: 'Base',
    padding: 12,
};

/** Vertical space reserved above the row list for the title text. */
const TITLE_HEIGHT = 22;
/** Gap left between the icon's edge and the row's own height — see addRow()'s ViewUtils.elementScaler() call. */
const ICON_PADDING = 4;

/** Icon jiggle on a gain — a quick punch-out-and-settle, not a full spin. Multiplies the icon's own fitted base scale (see addRow()), not an absolute scale. Same shape as BackpackUI's own jiggle. */
const JIGGLE_PUNCH_SCALE = 1.3;
const JIGGLE_PUNCH_SEC = 0.12;
const JIGGLE_SETTLE_SEC = 0.15;

/** "+N" popup on a gain — rises and fades over this long, see playGainFeedback(). */
const GAIN_POPUP_RISE_PX = 16;
const GAIN_POPUP_DURATION_SEC = 0.6;

interface Row {
    readonly container: PIXI.Container;
    readonly icon: PIXI.Sprite;
    readonly iconBaseScale: number;
    readonly label: PIXI.Text;
    readonly resourceType: ResourceType;
}

export default class GlobalResourcesUI extends PIXI.Container {
    private readonly config: GlobalResourcesUiConfig;
    private readonly rows: Row[] = [];
    private readonly rowsByType = new Map<ResourceType, Row>();
    /** Last count seen per resource type — the only way to compute a gain's delta on onChange (see this file's own doc). */
    private readonly lastCounts = new Map<ResourceType, number>();

    private frameComponent!: FrameComponent;
    private titleText!: PIXI.Text;

    /**
     * The panel's own footprint, in its local space (top-left at (0,0)) — recomputed by
     * layout() every time a row is added/removed. See PizzaScene's positioning code, which
     * re-reads these every frame to anchor this panel by a corner other than top-left (e.g.
     * top-right) without it drifting as the list grows.
     */
    public panelWidth = 0;
    public panelHeight = 0;

    public constructor(config: Partial<GlobalResourcesUiConfig> = {}) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };

        const { frame, title } = this.config;

        this.frameComponent = new FrameComponent(frame, 0, 0);
        this.addChild(this.frameComponent);

        this.titleText = new PIXI.Text(title, TextStyleRegistry.Info);
        this.titleText.anchor.set(0.5, 0);
        this.addChild(this.titleText);

        this.layout();

        GlobalResourceStorage.onChange.add(this.onGlobalResourceChanged, this);
        // Pick up whatever's already been deposited — e.g. this panel building after
        // deposits already happened (a scene rebuild, a HUD toggled back on, ...). Seeds
        // lastCounts from 0 too, so this doesn't itself read as a "gain" worth popping.
        for (const type of GlobalResourceStorage.getAll().keys()) {
            this.onGlobalResourceChanged(type);
        }
    }

    private onGlobalResourceChanged = (type: ResourceType): void => {
        const previous = this.lastCounts.get(type) ?? 0;
        const count = GlobalResourceStorage.getCount(type);
        this.lastCounts.set(type, count);

        if (count <= 0) {
            this.removeRow(type);
            return;
        }

        let row = this.rowsByType.get(type);
        if (!row) {
            row = this.addRow(type);
        }
        row.label.text = count.toString();

        const gained = count - previous;
        if (gained > 0) {
            this.playGainFeedback(row, gained);
        }
    };

    /** First time `type` shows up — builds its row (icon, see AssetLibraryRegistry.getAssetIcon(), + right-aligned count label) and appends it to the list. */
    private addRow(type: ResourceType): Row {
        const { contentWidth, rowHeight } = this.config;

        const container = new PIXI.Container();
        this.addChild(container);

        const icon = new PIXI.Sprite(getAssetIcon(resolveResourceAssetKey(type)));
        icon.anchor.set(0, 0.5);
        icon.position.set(0, rowHeight / 2);
        const iconBaseScale = ViewUtils.elementScaler(icon, rowHeight - ICON_PADDING * 2);
        icon.scale.set(iconBaseScale);
        container.addChild(icon);

        const label = new PIXI.Text('0', TextStyleRegistry.Body);
        label.anchor.set(1, 0.5);
        label.position.set(contentWidth, rowHeight / 2);
        container.addChild(label);

        const row: Row = { container, icon, iconBaseScale, label, resourceType: type };
        this.rows.push(row);
        this.rowsByType.set(type, row);
        this.layout();
        return row;
    }

    /** Tears a row down entirely and drops it from the list — see this file's own doc on why this exists despite GlobalResourceStorage never currently draining. */
    private removeRow(type: ResourceType): void {
        const row = this.rowsByType.get(type);
        if (!row) {
            return;
        }

        gsap.killTweensOf(row.icon.scale);
        row.container.destroy({ children: true });
        this.rowsByType.delete(type);

        const index = this.rows.indexOf(row);
        if (index !== -1) {
            this.rows.splice(index, 1);
        }

        this.layout();
    }

    /** Recomputes the panel's footprint from the current row count, repositions every row, and resizes the frame + retitles to match. */
    private layout(): void {
        const { contentWidth, rowHeight, rowGap, padding } = this.config;

        const contentHeight = this.rows.length > 0
            ? this.rows.length * rowHeight + (this.rows.length - 1) * rowGap
            : 0;

        this.panelWidth = contentWidth + padding * 2;
        this.panelHeight = contentHeight + padding * 2 + TITLE_HEIGHT;

        this.titleText.position.set(this.panelWidth / 2, padding * 0.5);

        this.rows.forEach((row, i) => {
            row.container.position.set(padding, padding + TITLE_HEIGHT + i * (rowHeight + rowGap));
        });

        this.frameComponent.setSize(this.panelWidth, this.panelHeight);
    }

    /** A resource was just deposited — icon punches out and settles, and a "+N" rises and fades above the count. Purely decorative; GlobalResourceStorage's count (already applied by the time onChange fires) is the source of truth regardless. */
    private playGainFeedback(row: Row, gained: number): void {
        const icon = row.icon;
        const baseScale = row.iconBaseScale;
        gsap.killTweensOf(icon.scale);
        icon.scale.set(baseScale);
        gsap.timeline()
            .to(icon.scale, { x: baseScale * JIGGLE_PUNCH_SCALE, y: baseScale * JIGGLE_PUNCH_SCALE, duration: JIGGLE_PUNCH_SEC, ease: 'back.out(2)' })
            .to(icon.scale, { x: baseScale, y: baseScale, duration: JIGGLE_SETTLE_SEC, ease: 'power1.out' });

        const popup = new PIXI.Text(`+${gained}`, TextStyleRegistry.ResourceDamage);
        popup.style.fill = '#33cc66';
        popup.anchor.set(1, 1);
        popup.position.set(this.config.contentWidth, 0);
        row.container.addChild(popup);

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

    public override destroy(options?: Parameters<PIXI.Container['destroy']>[0]): void {
        GlobalResourceStorage.onChange.remove(this.onGlobalResourceChanged, this);
        super.destroy(options);
    }
}
