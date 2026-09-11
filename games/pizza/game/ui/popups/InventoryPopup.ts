// InventoryPopup.ts
//
// Backpack popup opened from BackpackButton (see ../BackpackButton.ts) —
// extends Popup (see Popup.ts's own doc) so it only has to describe its own
// content; the title/close button/panel chrome/backdrop-click-to-close/
// transition are all handled generically by Popup/PopupManager.
//
// Bottom tab strip (Tools / Resources / Farm, more tabs can be appended to
// TABS below later) switches which body content is shown, same "small
// standalone list, no shared tab component exists yet" approach as
// PopupManager's own exploration found — see this popup's own tab-row
// building code. Body content is a plain rebuild-on-switch (same "just a
// couple of rows" reasoning as ToolListUI.refresh()'s own doc), not diffed,
// since switching tabs is rare compared to a live stat tick.
//
// Resources vs. Farm is a split by ResourceConfig.category (see that
// field's own doc): Resources shows only 'main'-category BackpackStorage
// holdings — the same ones GlobalResourcesUI/BackpackListUI already put on
// the always-visible main-screen panels — while Farm shows 'farm'-category
// holdings (a crop's own harvest yield) PLUS every held SeedTypes.ts seed
// (SeedStorage, a wholly separate bank — see that file's own doc), since
// both only matter once the player's actually farming and would otherwise
// clutter the main Resources grid with one entry per crop. Farm further
// splits its own two sources into labeled sub-sections (Seeds above Crops —
// see renderFarmSection()) rather than one merged grid, since a seed and
// the crop it grows into are conceptually different things even though
// both only live on this one tab.
//
// The body reserves a FIXED footprint (BODY_WIDTH x BODY_HEIGHT, a tinted
// 'back1' background sprite added once and never removed) regardless of
// which tab is showing — Popup sizes its AutoFitFrame around buildContent()'s
// output exactly once, at construction, so a later tab switch that rendered
// a taller/shorter content container would either get clipped or leave dead
// space inside a frame that already committed to its first tab's size.
//
// Live-updates while open: subscribes to ItemStorage/ShopUpgradeStorage
// (Tools tab) and BackpackStorage (Resources tab) and re-renders only the
// currently active tab's content on change — same reasoning ToolListUI/
// BackpackListUI already subscribe for, just scoped to "only matters while
// this popup is on screen." Unsubscribed via root's own 'destroyed' event
// (PIXI.DisplayObject.destroy() emits this) rather than a custom destroy()
// method, since PopupManager tears down popups by destroying their `root`
// container directly (see PopupManager.close()/closeImmediate()) — it never
// calls back into the Popup instance itself.

import * as PIXI from 'pixi.js';
import Popup from './Popup';
import PanelBackground, { PANEL_CONTENT_MARGIN } from '../PanelBackground';
import ScrollView from '../ScrollView';
import { TextStyleRegistry } from '../TextStyleRegistry';
import { getToolIcon, ToolId, TOOL_LIBRARY } from '../../actions/ToolRegistry';
import { ItemStorage } from '../../crafting/ItemStorage';
import { ItemType } from '../../crafting/ItemTypes';
import { ShopUpgradeStorage } from '../../shop/ShopUpgradeStorage';
import { SHOP_CONFIG_BY_ID } from '../../shop/ShopTypes';
import { ACTION_CONFIG } from '../../actions/ActionTypes';
import { BackpackStorage } from '../../data/BackpackStorage';
import { RESOURCE_CONFIG, ResourceType } from '../../actions/ResourceTypes';
import { resolveResourceAssetKey } from '../../actions/ResourceRegistry';
import { getAssetIcon } from '../../world/AssetLibraryRegistry';
import { SeedStorage } from '../../data/SeedStorage';
import { SeedId } from '../../data/SeedTypes';
import { LevelBadgeStyle } from '../LevelBadgeStyle';
import { createIconSlotBackground, IconSlotName, IconSlotRegistry } from '../IconSlotRegistry';
import { getIconLayout } from '../LayoutRegistry';

type TabId = 'tools' | 'resources' | 'farm';

interface TabDef {
    id: TabId;
    label: string;
}

/** Declaration order = left-to-right tab order. Add a new tab here (plus a render*Tab() method below) — the tab strip itself lays out evenly across however many are listed, no other change needed. */
const TABS: TabDef[] = [
    { id: 'tools', label: 'Tools' },
    { id: 'resources', label: 'Resources' },
    { id: 'farm', label: 'Farm' },
];

/** The actual canvas every render*Tab()'s own row/grid math is tuned against — same 450x500 footprint this file always used, kept as its own named constants (rather than the two magic numbers they used to be) now that BODY_WIDTH/BODY_HEIGHT below mean something bigger. Also the ScrollView viewport size — see buildContent()'s own doc. */
const CONTENT_WIDTH = 450;
const CONTENT_HEIGHT = 500;
/** Inset applied to `contentArea` within `body` on every side (see buildContent()'s own doc) — BODY_WIDTH/BODY_HEIGHT below bake in `2 * BODY_CONTENT_MARGIN` on top of CONTENT_WIDTH/CONTENT_HEIGHT, so the actual content canvas stays exactly CONTENT_WIDTH x CONTENT_HEIGHT regardless of this margin's own value. */
const BODY_CONTENT_MARGIN = PANEL_CONTENT_MARGIN;
const BODY_WIDTH = CONTENT_WIDTH + BODY_CONTENT_MARGIN * 2;
const BODY_HEIGHT = CONTENT_HEIGHT + BODY_CONTENT_MARGIN * 2;
const BODY_TABS_GAP = 14;

/** Label_Parallelogram_*.png's own bake — stretchable only in the middle 30px-to-30px band, full height (no top/bottom slack) — see the nine-slice widths passed into PIXI.NineSlicePlane below. */
const TAB_HEIGHT = 66;
const TAB_PADDING_X = 30;
/** The parallelogram art's slanted edges leave a visible wedge-shaped gap when two tabs sit flush side by side — this pulls the second tab left, UNDER that slant, so the pair reads as one continuous banner instead of two separate labels with a gap between them. */
const TAB_OVERLAP = 2;

const TAB_ACTIVE_TEXTURE = 'Label_Parallelogram_Yellow';
const TAB_INACTIVE_TEXTURE = 'Label_Parallelogram_Gray';

/**
 * Sourced from LayoutRegistry's 'ToolRow' preset (see that file's own doc),
 * overridden to this tab's own 80px row and its level BADGE presentation
 * (a tiered ring, texture resolved per-level by LevelBadgeStyle — NOT
 * 'ToolRow's own inline "Lv.N" text label, which ToolListUI/ToolLevelUI use
 * instead) — anchor (0.5,0.5)/inset 0 centers the badge exactly ON the
 * icon's own bottom-right corner, rather than the (1,1)/-2 "overlaps
 * outward past the corner" convention every OTHER badge in the game uses;
 * kept as this tab's own deliberate override, not folded into the shared
 * default.
 */
const TOOL_LAYOUT = getIconLayout('ToolRow', {
    slotSize: 80,
    badge: { enabled: true, size: 32, inset: 0, anchor: [0.5, 0.5] },
});
const TOOL_ROW_HEIGHT = TOOL_LAYOUT.slotSize;
const TOOL_ROW_GAP = 10;
const TOOL_ICON_SIZE = TOOL_LAYOUT.slotSize;
const TOOL_ICON_PADDING = TOOL_LAYOUT.iconPadding;
const TOOL_LABEL_GAP = 12;
/** Level badge (see LevelBadgeStyle.ts) pinned to the icon's own bottom-right corner — same "pinned to the corner" idiom QueueZone's upgrade badge/Popup's old close button used, just on a tool icon instead. */
const TOOL_BADGE_SIZE = TOOL_LAYOUT.badge.size;

/** Sourced from LayoutRegistry's 'Grid' preset — see that file's own doc — rather than local constants. */
const GRID_LAYOUT = getIconLayout('Grid');
const RESOURCE_GRID_COLUMNS = 5;
const RESOURCE_CELL_SIZE = GRID_LAYOUT.slotSize;
const RESOURCE_CELL_GAP = GRID_LAYOUT.gapToNeighbor;
const RESOURCE_ICON_SIZE = RESOURCE_CELL_SIZE - GRID_LAYOUT.iconPadding * 2;

/**
 * Farm tab's own Seeds/Crops sub-headers (see renderFarmTab()) — DELIBERATELY
 * its own smaller, uppercase, letter-spaced style rather than
 * TextStyleRegistry.Inventory (every other label in this popup — tab names,
 * tool names, "No X yet" empty states), and tinted the same green
 * IconSlotRegistry's own 'Crop' style uses. The two sit one tab away from
 * Tools/Resources, which each show ONE flat list with no sub-grouping at
 * all — Seeds/Crops need to read as SUB-CATEGORIES of the Farm tab, not as
 * more body text sitting above a grid, or they blend into the rows/cells
 * right below them.
 */
const FARM_SECTION_HEADER_STYLE: Partial<PIXI.TextStyle> = {
    ...TextStyleRegistry.Inventory,
    fontSize: 16,
    letterSpacing: 1,
    fill: IconSlotRegistry.Crop.tint,
};
const FARM_SECTION_HEADER_HEIGHT = 26;
/** Split evenly around FARM_SECTION_DIVIDER's own line — see renderFarmTab(). */
const FARM_SECTION_GAP = 18;
/** Thin rule between the Seeds and Crops sub-sections — the one further, explicit separation a font/color change alone doesn't give: without it, Crops' own header can still read as "one more row of Seeds' grid" at a glance. Pale/translucent so it reads as a divider, not another piece of content. */
const FARM_SECTION_DIVIDER_COLOR = 0xffffff;
const FARM_SECTION_DIVIDER_ALPHA = 0.15;
const FARM_SECTION_DIVIDER_HEIGHT = 1;

/** Every tool id in TOOL_LIBRARY's own declaration order — same convention as ToolListUI.TOOL_IDS. ToolId and ItemType share the exact same string values (see ItemTypes.ts's own doc), so casting one to the other below is safe. */
const TOOL_IDS = Object.keys(TOOL_LIBRARY) as ToolId[];

/** The shop id that upgrades `toolId`, if any — same lookup as ToolListUI.shopIdForTool(). */
function shopIdForTool(toolId: ToolId): string | undefined {
    for (const [id, config] of Object.entries(SHOP_CONFIG_BY_ID)) {
        if (config?.tool === toolId) {
            return id;
        }
    }
    return undefined;
}

export default class InventoryPopup extends Popup {
    // `declare` (NOT a plain `!`-asserted field) — this project compiles with
    // useDefineForClassFields on (target esnext), which emits `Object.defineProperty(this,
    // 'x', { value: undefined })` for EVERY class field, initializer or not, right after
    // super() returns. super() (see Popup's own constructor) calls buildContent() synchronously
    // — which needs these already set — so a plain field, even uninitialized, would still get
    // wiped back to undefined immediately after. `declare` emits no JS at all for the field,
    // just the type; buildContent() is what actually assigns these, and nothing overwrites it
    // afterward.
    private declare activeTab: TabId;
    private declare body: PIXI.Container;
    /** Inset within `body` by BODY_CONTENT_MARGIN on every side — every render*Tab() method adds its content HERE, never directly into `body`, so content never sits flush against the background's own edges/rounded corners (see buildContent()'s own doc). Scrolled/clipped by `scrollView` — its own `y` is that ScrollView's to manage, not something render*Tab() methods should ever set directly. */
    private declare contentArea: PIXI.Container;
    /** Clips/scrolls `contentArea` to CONTENT_WIDTH x CONTENT_HEIGHT — see buildContent()'s own doc and ScrollView.ts. refresh() must be called after every renderActiveTab() rebuild (see that method), since contentArea's own height can change per tab/per re-render. */
    private declare scrollView: ScrollView;
    private declare tabButtons: Map<TabId, PIXI.NineSlicePlane>;

    private readonly handleToolsChanged = (): void => {
        if (this.activeTab === 'tools') {
            this.renderActiveTab();
        }
    };

    private readonly handleResourcesChanged = (): void => {
        if (this.activeTab === 'resources') {
            this.renderActiveTab();
        }
    };

    /** Shared by BOTH BackpackStorage (farm-category holdings) and SeedStorage — either one changing can affect what the Farm tab shows, so both wire to this same handler rather than each needing its own. */
    private readonly handleFarmChanged = (): void => {
        if (this.activeTab === 'farm') {
            this.renderActiveTab();
        }
    };

    public constructor() {
        // closeOnBackdropTap: false — this is a multi-tab menu meant to be browsed rather than
        // glanced at, so it should only close via its own header close button, not a stray tap
        // outside it — see Popup.ts's own doc on that option.
        // 'survival-backpack' — the exact same icon BackpackButton.ts uses to open this popup in
        // the first place, so the popup reads as "the same thing" the player just tapped.
        super('Backpack', { contentWidth: BODY_WIDTH, frame: 'ItemFrame', closeOnBackdropTap: false, titleIcon: 'survival-backpack' });

        ItemStorage.onChange.add(this.handleToolsChanged);
        ShopUpgradeStorage.onChange.add(this.handleToolsChanged);
        BackpackStorage.onChange.add(this.handleResourcesChanged);
        BackpackStorage.onChange.add(this.handleFarmChanged);
        SeedStorage.onChange.add(this.handleFarmChanged);
        this.root.once('destroyed', () => {
            ItemStorage.onChange.remove(this.handleToolsChanged);
            ShopUpgradeStorage.onChange.remove(this.handleToolsChanged);
            BackpackStorage.onChange.remove(this.handleResourcesChanged);
            BackpackStorage.onChange.remove(this.handleFarmChanged);
            SeedStorage.onChange.remove(this.handleFarmChanged);
        });
    }

    protected buildContent(content: PIXI.Container, contentWidth: number): void {
        this.activeTab = TABS[0].id;
        this.tabButtons = new Map();

        this.body = new PIXI.Container();
        content.addChild(this.body);

        // The tab content's own backdrop — see PanelBackground.ts's own doc: the SAME shared
        // dark panel component InventoryPopup/MartPopup/CraftingTablePopup all use, so every
        // list/grid-style popup in the game renders the exact same tint/alpha/corner style.
        // Sized to the exact BODY_WIDTH x BODY_HEIGHT footprint, which ALSO locks the body's own
        // reported bounds to that fixed size regardless of which tab is showing (see this file's
        // own top doc) — a second, invisible spacer for that purpose alone would be redundant
        // now that this frame already occupies exactly that rect. Stays the ONLY direct child of
        // `body` — every render*Tab() adds its own content into `contentArea` below instead,
        // never here.
        const background = new PanelBackground();
        background.setFixedSize(BODY_WIDTH, BODY_HEIGHT);
        this.body.addChild(background);

        // Inset by BODY_CONTENT_MARGIN on every side so tab content never sits flush against the
        // background's own edges/rounded corners — see BODY_CONTENT_MARGIN's own doc for why
        // none of the row/grid layout constants below needed to change to make room for this.
        // Wrapped in a ScrollView rather than added to `body` directly — the Farm tab's own
        // Seeds+Crops content can run taller than CONTENT_HEIGHT once a player's holding enough
        // distinct seeds/crops, so this clips it to the fixed footprint and lets a drag scroll
        // through the rest. A no-op for Tools/Resources, which both still fit — see ScrollView's
        // own doc on why content shorter than the viewport just never moves.
        this.contentArea = new PIXI.Container();
        this.scrollView = new ScrollView({ target: this.contentArea, width: CONTENT_WIDTH, height: CONTENT_HEIGHT });
        this.scrollView.position.set(BODY_CONTENT_MARGIN, BODY_CONTENT_MARGIN);
        this.body.addChild(this.scrollView);

        const tabsRow = new PIXI.Container();
        tabsRow.position.set(0, BODY_HEIGHT + BODY_TABS_GAP);
        content.addChild(tabsRow);

        // Even split BEFORE overlap — overlap only pulls each tab's own start position left,
        // it doesn't shrink what width each individual plane stretches to (see TAB_OVERLAP's own
        // doc). Centers the whole (now narrower, thanks to the overlap) strip within
        // contentWidth rather than pinning it flush left.
        const tabWidth = contentWidth / TABS.length;
        const totalTabsWidth = tabWidth * TABS.length - TAB_OVERLAP * (TABS.length - 1);
        const startX = (contentWidth - totalTabsWidth) / 2;

        TABS.forEach((tab, index) => {
            const tabContainer = new PIXI.Container();
            tabContainer.position.set(startX + index * (tabWidth - TAB_OVERLAP), 0);
            tabContainer.interactive = true;
            tabContainer.cursor = 'pointer';
            tabContainer.on('pointertap', () => this.setActiveTab(tab.id));
            tabsRow.addChild(tabContainer);

            const bg = new PIXI.NineSlicePlane(PIXI.Texture.from(TAB_INACTIVE_TEXTURE), TAB_PADDING_X, 0, TAB_PADDING_X, 0);
            bg.width = tabWidth;
            bg.height = TAB_HEIGHT;
            tabContainer.addChild(bg);

            const label = new PIXI.Text(tab.label, TextStyleRegistry.Inventory);
            label.anchor.set(0.5, 0.5);
            label.position.set(tabWidth / 2, TAB_HEIGHT / 2);
            tabContainer.addChild(label);

            this.tabButtons.set(tab.id, bg);
            this.redrawTab(tab.id, bg);
        });

        this.renderActiveTab();
    }

    private setActiveTab(tab: TabId): void {
        if (this.activeTab === tab) {
            return;
        }
        this.activeTab = tab;

        for (const [id, bg] of this.tabButtons) {
            this.redrawTab(id, bg);
        }
        this.renderActiveTab();
    }

    private redrawTab(tab: TabId, bg: PIXI.NineSlicePlane): void {
        bg.texture = PIXI.Texture.from(tab === this.activeTab ? TAB_ACTIVE_TEXTURE : TAB_INACTIVE_TEXTURE);
        // The active tab reads on top of the inactive one where their slanted edges overlap —
        // reorder on every switch rather than fixing z-order once, since which tab is "active"
        // (and therefore which one should read on top) changes.
        if (tab === this.activeTab) {
            bg.parent.parent.setChildIndex(bg.parent, bg.parent.parent.children.length - 1);
        }
    }

    /** Clears whatever contentArea currently shows and rebuilds it for `this.activeTab` — `body`'s own background (see buildContent) is a sibling of contentArea, never touched here. */
    private renderActiveTab(): void {
        this.contentArea.removeChildren().forEach(child => child.destroy({ children: true }));

        if (this.activeTab === 'tools') {
            this.renderToolsTab();
        } else if (this.activeTab === 'resources') {
            this.renderResourcesTab();
        } else {
            this.renderFarmTab();
        }

        // Re-measures contentArea's freshly-rebuilt height and re-clamps/resets scroll — the
        // Farm tab can run taller than CONTENT_HEIGHT (see ScrollView's own doc); switching to a
        // shorter tab must also snap scroll back to the top, which refresh() already does on its
        // own once it sees the new content fits.
        this.scrollView.refresh();
    }

    private renderToolsTab(): void {
        const ownedToolIds = TOOL_IDS.filter(toolId => ItemStorage.hasCount(toolId as ItemType, 1));

        if (ownedToolIds.length === 0) {
            const empty = new PIXI.Text('No tools crafted yet.', TextStyleRegistry.Inventory);
            empty.position.set(0, 0);
            this.contentArea.addChild(empty);
            return;
        }

        ownedToolIds.forEach((toolId, index) => {
            const row = new PIXI.Container();
            row.position.set(0, index * (TOOL_ROW_HEIGHT + TOOL_ROW_GAP));
            this.contentArea.addChild(row);

            const iconBg = createIconSlotBackground(TOOL_ICON_SIZE, 'Tool');
            iconBg.anchor.set(0, 0.5);
            iconBg.position.set(0, TOOL_ROW_HEIGHT / 2);
            row.addChild(iconBg);

            const icon = new PIXI.Sprite(getToolIcon(toolId));
            icon.anchor.set(0.5, 0.5);
            icon.width = TOOL_ICON_SIZE - TOOL_ICON_PADDING * 2;
            icon.height = TOOL_ICON_SIZE - TOOL_ICON_PADDING * 2;
            icon.position.set(TOOL_ICON_SIZE / 2, TOOL_ROW_HEIGHT / 2);
            row.addChild(icon);

            const shopId = shopIdForTool(toolId);

            // maxLevel 0 (rope/hammer — see ToolVisualEntry.maxLevel's own doc) means this tool
            // never upgrades, so a permanent "Lv.1" badge would just be noise — skip it
            // entirely rather than show a level that can never change. nameLabel/statsLabel
            // below are positioned off TOOL_ICON_SIZE, not the badge, so skipping it doesn't
            // shift anything else in the row.
            if (TOOL_LIBRARY[toolId].maxLevel > 0) {
                // +1 — same reasoning as ToolListUI's own doc: owning the tool at all already
                // puts a player at its base tier, so this never reads "level 0".
                const level = (shopId ? ShopUpgradeStorage.getLevel(shopId) : 0) + 1;

                const badge = new PIXI.Sprite(PIXI.Texture.from(LevelBadgeStyle.badgeTextureForLevel(level)));
                badge.anchor.set(TOOL_LAYOUT.badge.anchor[0], TOOL_LAYOUT.badge.anchor[1]);
                badge.width = TOOL_BADGE_SIZE;
                badge.height = TOOL_BADGE_SIZE;
                badge.position.set(TOOL_ICON_SIZE - TOOL_LAYOUT.badge.inset, TOOL_ROW_HEIGHT / 2 + TOOL_ICON_SIZE / 2 - TOOL_LAYOUT.badge.inset);
                row.addChild(badge);

                const badgeLabel = new PIXI.Text(level.toString(), { ...TextStyleRegistry.Inventory, fontSize: 13 });
                badgeLabel.anchor.set(0.5, 0.5);
                badgeLabel.position.copyFrom(badge.position);
                row.addChild(badgeLabel);
            }

            const textX = TOOL_ICON_SIZE + TOOL_LABEL_GAP;

            const nameLabel = new PIXI.Text(TOOL_LIBRARY[toolId].label, TextStyleRegistry.Inventory);
            nameLabel.anchor.set(0, 0.5);
            nameLabel.position.set(textX, TOOL_ROW_HEIGHT / 2 - 12);
            row.addChild(nameLabel);

            const config = shopId ? SHOP_CONFIG_BY_ID[shopId] : undefined;
            const stats = config ? ACTION_CONFIG[config.action] : undefined;
            // hitScale/resourcePerHit are lerped floats (see ShopTypes.applyShopLevel()) — at a
            // mid-ladder level they can land on values like 2.3333333333333335, unreadable
            // un-rounded. toFixed(1) matches hitIntervalSec's own existing rounding below.
            const statsText = stats
                ? `Speed ${stats.hitIntervalSec.toFixed(2)}s  x${stats.hitScale.toFixed(1)}  +${stats.resourcePerHit.toFixed(1)}/hit`
                : '';
            const statsLabel = new PIXI.Text(statsText, { ...TextStyleRegistry.Inventory, fontSize: 16 });
            statsLabel.alpha = 0.8;
            statsLabel.anchor.set(0, 0.5);
            statsLabel.position.set(textX, TOOL_ROW_HEIGHT / 2 + 12);
            row.addChild(statsLabel);
        });
    }

    private renderResourcesTab(): void {
        const counts = BackpackStorage.getAll();
        // 'main'-category only (the default when ResourceConfig.category is unset) — a crop's
        // own 'farm'-category harvest yield shows on the Farm tab instead, see this file's own
        // top doc.
        const heldTypes = Object.values(ResourceType)
            .filter(type => counts.get(type) && RESOURCE_CONFIG[type]?.category !== 'farm');

        this.renderIconCountGrid(
            heldTypes.map(type => ({ texture: getAssetIcon(resolveResourceAssetKey(type)), count: counts.get(type) ?? 0 })),
            'No resources yet.',
            0,
            'Resource',
        );
    }

    /** 'farm'-category BackpackStorage holdings (a crop's own harvest yield) PLUS every held SeedTypes.ts seed, each in its OWN labeled sub-section (Seeds above Crops) — see this file's own top doc for why these two share a tab despite being two different banks. Seeds route their icon through AssetLibraryRegistry under the SAME id as the SeedId itself (see entityMap.mjs's `seeds` mapping's own externalFields), same join-by-id convention getAssetIcon()/resolveResourceAssetKey() already use for resources. */
    private renderFarmTab(): void {
        const seedCounts = SeedStorage.getAll();
        const heldSeedIds = Object.values(SeedId).filter(id => seedCounts.get(id));
        const seedEntries = heldSeedIds.map(id => ({ texture: getAssetIcon(id), count: seedCounts.get(id) ?? 0 }));

        const backpackCounts = BackpackStorage.getAll();
        const farmResourceTypes = Object.values(ResourceType)
            .filter(type => backpackCounts.get(type) && RESOURCE_CONFIG[type]?.category === 'farm');
        const cropEntries = farmResourceTypes.map(type => ({ texture: getAssetIcon(resolveResourceAssetKey(type)), count: backpackCounts.get(type) ?? 0 }));

        let y = 0;
        y += this.renderFarmSection('Seeds', seedEntries, 'No seeds yet.', y, 'Crop');
        y += FARM_SECTION_GAP / 2;

        // The one further, explicit separation a font/color change alone doesn't give — see
        // FARM_SECTION_DIVIDER_*'s own doc. Full contentArea width (BODY_WIDTH already has
        // BODY_CONTENT_MARGIN baked in on both sides — see that constant's own doc).
        const divider = new PIXI.Graphics();
        divider.beginFill(FARM_SECTION_DIVIDER_COLOR, FARM_SECTION_DIVIDER_ALPHA)
            .drawRect(0, y, CONTENT_WIDTH, FARM_SECTION_DIVIDER_HEIGHT)
            .endFill();
        this.contentArea.addChild(divider);
        y += FARM_SECTION_GAP / 2;

        this.renderFarmSection('Crops', cropEntries, 'No crops harvested yet.', y, 'Crop');
    }

    /** One labeled sub-section of the Farm tab — a header (FARM_SECTION_HEADER_STYLE — see that constant's own doc for why it's NOT TextStyleRegistry.Inventory like every other label in this popup) followed by its own icon grid, stacked starting at `startY` so renderFarmTab() can lay Seeds directly above Crops without either one needing to know the other's height ahead of time. Returns the total vertical space this section actually used (header + grid, whatever the grid's own empty-state/row-count ends up being) so the caller can stack the next section right after it. */
    private renderFarmSection(title: string, entries: { texture: PIXI.Texture; count: number }[], emptyText: string, startY: number, style: IconSlotName): number {
        const header = new PIXI.Text(title.toUpperCase(), FARM_SECTION_HEADER_STYLE);
        header.position.set(0, startY);
        this.contentArea.addChild(header);

        const gridHeight = this.renderIconCountGrid(entries, emptyText, startY + FARM_SECTION_HEADER_HEIGHT, style);
        return FARM_SECTION_HEADER_HEIGHT + gridHeight;
    }

    /** Shared grid-of-icon-cells layout — same shape Resources/Farm both want (icon bg + icon + count label, RESOURCE_GRID_COLUMNS wide), just fed a pre-resolved (texture, count) list instead of each tab re-deriving its own source data inline. `startY` lets renderFarmSection() stack more than one of these vertically; Resources (only ever one grid, no sections) always passes 0. `style` picks the IconSlotRegistry preset for every cell's background — Resources passes 'Resource', both Farm sub-sections pass 'Crop' (see this file's own callers). Returns the vertical space actually used, same reason renderFarmSection() needs it. Empty-state text uses TextStyleRegistry.Inventory — same style as every other label in this popup (tab labels, tool names, farm section headers above), not TextStyleRegistry.Body, so "No X yet" never reads as a different UI language from the rest of the popup. */
    private renderIconCountGrid(entries: { texture: PIXI.Texture; count: number }[], emptyText: string, startY: number, style: IconSlotName): number {
        if (entries.length === 0) {
            const empty = new PIXI.Text(emptyText, TextStyleRegistry.Inventory);
            empty.position.set(0, startY);
            this.contentArea.addChild(empty);
            return empty.height;
        }

        entries.forEach(({ texture, count }, index) => {
            const col = index % RESOURCE_GRID_COLUMNS;
            const row = Math.floor(index / RESOURCE_GRID_COLUMNS);
            const cell = new PIXI.Container();
            cell.position.set(
                col * (RESOURCE_CELL_SIZE + RESOURCE_CELL_GAP),
                startY + row * (RESOURCE_CELL_SIZE + RESOURCE_CELL_GAP),
            );
            this.contentArea.addChild(cell);

            const iconBg = createIconSlotBackground(RESOURCE_CELL_SIZE, style);
            cell.addChild(iconBg);

            const icon = new PIXI.Sprite(texture);
            icon.anchor.set(0.5, 0.5);
            icon.width = RESOURCE_ICON_SIZE;
            icon.height = RESOURCE_ICON_SIZE;
            icon.position.set(RESOURCE_CELL_SIZE / 2, RESOURCE_CELL_SIZE / 2 - 4);
            cell.addChild(icon);

            const label = new PIXI.Text(count.toString(), { ...TextStyleRegistry.Body, fontSize: GRID_LAYOUT.label.fontSize });
            label.anchor.set(GRID_LAYOUT.label.anchor[0], GRID_LAYOUT.label.anchor[1]);
            label.position.set(RESOURCE_CELL_SIZE / 2 + GRID_LAYOUT.label.offset[0], RESOURCE_CELL_SIZE - GRID_LAYOUT.label.offset[1]);
            cell.addChild(label);
        });

        const rows = Math.ceil(entries.length / RESOURCE_GRID_COLUMNS);
        return rows * (RESOURCE_CELL_SIZE + RESOURCE_CELL_GAP) - RESOURCE_CELL_GAP;
    }
}
