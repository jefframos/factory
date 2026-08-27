// BackpackListUI.ts
//
// Alternative to BackpackUI.ts — same BackpackStorage data (see
// games/pizza/game/data/BackpackStorage.ts), rendered as a bare vertical
// list instead of a framed, titled, horizontal slot row. No panel
// frame/title wraps the whole list — just a count label + icon per row —
// but each icon still gets the same square backing (see ICON_BG_* below)
// BackpackUI/AnimalFollowUI/ResourceSlotVisual already tint behind every
// resource icon, so the icon reads clearly against the busy 3D map behind
// this HUD instead of floating with nothing but its own alpha edge.
// Pinned top-right directly under the currency topbar (EconomyUI.ts) rather
// than bottom-center. Kept as its own file (rather than editing BackpackUI.ts
// in place) so the old bottom-center panel stays available to switch back to
// — see UIService.ts's own comment on which one is actually wired up.
//
// Only shows rows for resources actually held — same "no BackpackUI-style
// minimum slot count" reasoning as GlobalResourcesUI.ts, since a vertical
// list pinned to a corner doesn't need to stay visually centered/balanced
// the way a floating HUD panel does. Rows only ever get ADDED in practice
// (BackpackStorage drains back to 0 on deposit, which removes the row
// instead), and removeRow() exists for exactly that "fully deposited" case.
//
// Subscribes to BackpackStorage.onChange ONCE and updates only the row whose
// resource actually changed — no per-frame polling. Tracks each row's own
// last-seen count (see `lastCounts`) purely to tell a gain from a loss on
// every change, since onChange itself only reports WHICH resource changed —
// a gain plays a "+N" popup and jiggles the icon (see playGainFeedback()); a
// loss (draining out to a drop zone) doesn't.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { TextStyleRegistry } from './TextStyleRegistry';
import { BackpackStorage } from '../data/BackpackStorage';
import { ResourceType } from '../actions/ResourceTypes';
import { resolveResourceAssetKey } from '../actions/ResourceRegistry';
import { getAssetIcon } from '../world/AssetLibraryRegistry';
import ViewUtils from 'core/utils/ViewUtils';

export interface BackpackListUiConfig {
    rowHeight: number;
    rowGap: number;
    iconSize: number;
    /** Gap between the icon's right edge and the count label. */
    labelGap: number;
    /** Width reserved for the count label, right-aligned within it — keeps every row's label lined up regardless of icon width. */
    labelWidth: number;
}

const DEFAULT_CONFIG: BackpackListUiConfig = {
    rowHeight: 32,
    rowGap: 6,
    iconSize: 32,
    labelGap: 4,
    labelWidth: 32,
};

/** Icon jiggle on a gain — a quick punch-out-and-settle, not a full spin. Same shape as BackpackUI's own jiggle. */
const JIGGLE_PUNCH_SCALE = 1.3;
const JIGGLE_PUNCH_SEC = 0.12;
const JIGGLE_SETTLE_SEC = 0.15;

/** "+N" popup on a gain — rises and fades over this long, see playGainFeedback(). */
const GAIN_POPUP_RISE_PX = 16;
const GAIN_POPUP_DURATION_SEC = 0.6;

/** Same square backing BackpackUI/AnimalFollowUI/ResourceSlotVisual tint behind every resource icon (see those files' own SLOT_BG_* constants) — reused here so this list's icons contrast the same way against the 3D map instead of floating with no backing at all. */
const ICON_BG_TEXTURE_KEY = 'BorderFrame_Squrare_Bg';
const ICON_BG_TINT = 0x000000;
const ICON_BG_ALPHA = 0.5;
/** Gap left between the icon's own edge and its background square's edge — same value as BackpackUI/ResourceSlotVisual's own ICON_PADDING. */
const ICON_PADDING = -3;

interface Row {
    readonly container: PIXI.Container;
    readonly iconBg: PIXI.Sprite;
    readonly icon: PIXI.Sprite;
    readonly iconBaseScale: number;
    readonly label: PIXI.Text;
    readonly resourceType: ResourceType;
}

export default class BackpackListUI extends PIXI.Container {
    private readonly config: BackpackListUiConfig;
    private readonly rows: Row[] = [];
    private readonly rowsByType = new Map<ResourceType, Row>();
    /** Last count seen per resource type — the only way to tell a gain from a loss on onChange (see this file's own doc). */
    private readonly lastCounts = new Map<ResourceType, number>();

    /** The list's own footprint, in its local space (top-left at (0,0)) — recomputed by layout() every time a row is added/removed. Same "re-read every frame" reasoning as BackpackUI.panelWidth/panelHeight — UIService anchors this without it drifting as the list grows. */
    public panelWidth = 0;
    public panelHeight = 0;

    public constructor(config: Partial<BackpackListUiConfig> = {}) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };

        BackpackStorage.onChange.add(this.onBackpackChanged, this);
        // Pick up whatever's already in the backpack — e.g. this list building after
        // gathering already started (a scene rebuild, a HUD toggled back on, ...). Seeds
        // lastCounts from 0 too, so this doesn't itself read as a "gain" worth popping.
        for (const type of BackpackStorage.getAll().keys()) {
            this.onBackpackChanged(type);
        }
    }

    private onBackpackChanged = (type: ResourceType): void => {
        const previous = this.lastCounts.get(type) ?? 0;
        const count = BackpackStorage.getCount(type);
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

    /** First time `type` shows up — builds its row (count on the left, icon on the right — mirrored so the icon hugs the panel's own right-pinned edge, no background/frame) and appends it to the list. */
    private addRow(type: ResourceType): Row {
        const { rowHeight, iconSize, labelGap, labelWidth } = this.config;

        const container = new PIXI.Container();
        this.addChild(container);

        // Right-anchored within its reserved labelWidth (not left-anchored at x=0) so a short
        // number (e.g. "5") still sits right up against the icon instead of stranded on the
        // list's far left with a wide gap that labelGap alone can't close.
        const label = new PIXI.Text('0', TextStyleRegistry.Body);
        label.anchor.set(1, 0.5);
        label.position.set(labelWidth, rowHeight / 2);
        container.addChild(label);

        const iconBg = new PIXI.Sprite(PIXI.Texture.from(ICON_BG_TEXTURE_KEY));
        iconBg.tint = ICON_BG_TINT;
        iconBg.alpha = ICON_BG_ALPHA;
        iconBg.anchor.set(1, 0.5);
        iconBg.width = iconSize;
        iconBg.height = iconSize;
        iconBg.position.set(labelWidth + labelGap + iconSize, rowHeight / 2);
        container.addChild(iconBg);

        // Centered ON the bg square (anchor 0.5 at its middle), NOT flush against its own
        // right edge like iconBg's own anchor(1, 0.5) — the icon renders smaller than the bg
        // (iconSize - ICON_PADDING*2, see elementScaler() below), so sharing iconBg's anchor
        // point would leave it hugging the bg's right inner edge with all the padding slack on
        // the left instead of split evenly on both sides.
        const icon = new PIXI.Sprite(getAssetIcon(resolveResourceAssetKey(type)));
        icon.anchor.set(0.5, 0.5);
        icon.position.set(labelWidth + labelGap + iconSize / 2, rowHeight / 2);
        const iconBaseScale = ViewUtils.elementScaler(icon, iconSize - ICON_PADDING * 2);
        icon.scale.set(iconBaseScale);
        container.addChild(icon);

        const row: Row = { container, iconBg, icon, iconBaseScale, label, resourceType: type };
        this.rows.push(row);
        this.rowsByType.set(type, row);
        this.layout();
        return row;
    }

    /** Tears a row down entirely and drops it from the list — hit once a resource is fully deposited (count back to 0). */
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

    /** Recomputes the list's footprint from the current row count and repositions every row — no frame/title to resize, just plain stacking. */
    private layout(): void {
        const { rowHeight, rowGap, iconSize, labelGap, labelWidth } = this.config;

        this.panelWidth = iconSize + labelGap + labelWidth;
        this.panelHeight = this.rows.length > 0
            ? this.rows.length * rowHeight + (this.rows.length - 1) * rowGap
            : 0;

        this.rows.forEach((row, i) => {
            row.container.position.set(0, i * (rowHeight + rowGap));
        });
    }

    /** A resource was just gathered — icon punches out and settles, and a "+N" rises and fades above the count. Purely decorative; BackpackStorage's count (already applied by the time onChange fires) is the source of truth regardless. */
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
        popup.position.set(row.iconBg.position.x, row.icon.position.y - this.config.rowHeight / 2);
        row.container.addChild(popup);

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
        BackpackStorage.onChange.remove(this.onBackpackChanged, this);
        super.destroy(options);
    }
}
