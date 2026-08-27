// ToolListUI.ts
//
// Alternative to ToolLevelUI.ts — same ItemStorage/ShopUpgradeStorage data
// (see games/pizza/game/crafting/ItemStorage.ts and
// games/pizza/game/shop/ShopUpgradeStorage.ts), rendered as a bare vertical
// list instead of a framed AutoFitFrame panel. No panel frame wraps the
// list — just an icon + "Lv.N" label per row — but each icon still gets the
// same square backing (see ICON_BG_* below) BackpackListUI.ts already tints
// behind its own resource icons, so tool icons read clearly against the
// busy 3D map instead of floating with nothing but their own alpha edge.
// Pinned top-left, directly under the settings/mute button row
// (SettingsUIService.ts) — see UIService.ts's own positioning code. Kept as
// its own file (rather than editing ToolLevelUI.ts in place) so the old
// bottom-right framed panel stays available to switch back to — see
// UIService.ts's own comment on which one is actually wired up.
//
// Laid out TOP-DOWN (row 0 at y=0, each next tool stacking downward) — the
// opposite of ToolLevelUI's bottom-up order — since this panel hangs off a
// fixed top-left anchor and grows away from it, same "grows away from its
// own anchor" reasoning BackpackListUI.ts's top-down row list already uses.
//
// Rows are rebuilt wholesale (not diffed) whenever ItemStorage's owned set
// actually changes — same "only a couple of rows, so a full rebuild is
// simplest" reasoning as ToolLevelUI.refresh()'s own doc, since BOTH the
// owned SET and each row's level number can change.
//
// Subscribes to ItemStorage.onChange (crafting a new tool) AND
// ShopUpgradeStorage.onChange (upgrading an already-owned one) — either can
// change what this panel should show.

import * as PIXI from 'pixi.js';
import { TextStyleRegistry } from './TextStyleRegistry';
import { ShopUpgradeStorage } from '../shop/ShopUpgradeStorage';
import { SHOP_CONFIG_BY_ID } from '../shop/ShopTypes';
import { getToolIcon, ToolId, TOOL_LIBRARY } from '../actions/ToolRegistry';
import { ItemStorage } from '../crafting/ItemStorage';
import { ItemType } from '../crafting/ItemTypes';

export interface ToolListUiConfig {
    rowHeight: number;
    rowGap: number;
    iconSize: number;
    /** Gap between the icon's right edge and the level label. */
    labelGap: number;
}

const DEFAULT_CONFIG: ToolListUiConfig = {
    rowHeight: 44,
    rowGap: 8,
    iconSize: 44,
    labelGap: 8,
};

/** Same square backing BackpackListUI.ts tints behind every resource icon (see that file's own ICON_BG_* constants) — reused here so tool icons contrast the same way against the 3D map instead of floating with no backing at all. */
const ICON_BG_TEXTURE_KEY = 'BorderFrame_Squrare_Bg';
const ICON_BG_TINT = 0x000000;
const ICON_BG_ALPHA = 0.5;
/** Gap left between the icon's own edge and its background square's edge. */
const ICON_PADDING = 4;

/** Every tool id in TOOL_LIBRARY's own declaration order (axe, then pickaxe) — refresh() filters this down to whichever ones ItemStorage says the player actually owns. ToolId and ItemType share the exact same string values (see ItemTypes.ts's own doc), so casting one to the other below is safe. */
const TOOL_IDS = Object.keys(TOOL_LIBRARY) as ToolId[];

/** The shop id that upgrades `toolId`, if any — a tool can only ever be upgraded by exactly one shop in practice (see ShopConfig.tool), so the first match is the only one that matters. */
function shopIdForTool(toolId: ToolId): string | undefined {
    for (const [id, config] of Object.entries(SHOP_CONFIG_BY_ID)) {
        if (config?.tool === toolId) {
            return id;
        }
    }
    return undefined;
}

export default class ToolListUI extends PIXI.Container {
    private readonly config: ToolListUiConfig;
    private readonly column: PIXI.Container;

    private readonly handleChanged = (): void => {
        this.refresh();
    };

    /** The list's own footprint, in its local space (top-left at (0,0)) — recomputed by refresh() every time the owned-tool set changes. Same "re-read every frame" reasoning as BackpackListUI.panelWidth/panelHeight — UIService anchors this without it drifting as the list grows. */
    public panelWidth = 0;
    public panelHeight = 0;

    public constructor(config: Partial<ToolListUiConfig> = {}) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };

        this.column = new PIXI.Container();
        this.addChild(this.column);

        this.refresh();

        ItemStorage.onChange.add(this.handleChanged);
        ShopUpgradeStorage.onChange.add(this.handleChanged);
    }

    /**
     * Rebuilds every row from scratch, top-down (see this file's own doc), from whichever
     * TOOL_IDS entries ItemStorage.hasCount() confirms the player actually owns right now.
     */
    private refresh(): void {
        this.column.removeChildren().forEach(child => child.destroy({ children: true }));

        const { rowHeight, rowGap, iconSize, labelGap } = this.config;
        const ownedToolIds = TOOL_IDS.filter(toolId => ItemStorage.hasCount(toolId as ItemType, 1));

        // Nothing owned yet — hide the panel entirely rather than showing an empty list.
        this.visible = ownedToolIds.length > 0;

        ownedToolIds.forEach((toolId, index) => {
            const row = new PIXI.Container();
            row.position.set(0, index * (rowHeight + rowGap));
            this.column.addChild(row);

            const iconBg = new PIXI.Sprite(PIXI.Texture.from(ICON_BG_TEXTURE_KEY));
            iconBg.tint = ICON_BG_TINT;
            iconBg.alpha = ICON_BG_ALPHA;
            iconBg.anchor.set(0, 0.5);
            iconBg.width = iconSize;
            iconBg.height = iconSize;
            iconBg.position.set(0, rowHeight / 2);
            row.addChild(iconBg);

            // Centered ON the bg square (anchor 0.5 at its middle) — same reasoning as
            // BackpackListUI's own icon, sized smaller than the bg (iconSize - ICON_PADDING*2)
            // and centered rather than sharing the bg's own anchor point.
            const icon = new PIXI.Sprite(getToolIcon(toolId));
            icon.anchor.set(0.5, 0.5);
            icon.width = iconSize - ICON_PADDING * 2;
            icon.height = iconSize - ICON_PADDING * 2;
            icon.position.set(iconSize / 2, rowHeight / 2);
            row.addChild(icon);

            const shopId = shopIdForTool(toolId);
            const level = shopId ? ShopUpgradeStorage.getLevel(shopId) : 0;
            // +1 — same reasoning as ToolLevelUI's own doc: ShopUpgradeStorage.getLevel() is
            // 0-indexed internally, but owning the tool at all already puts a player at its
            // base tier, so this never reads "Lv.0" to the player.
            const levelLabel = new PIXI.Text(`Lv.${level + 1}`, TextStyleRegistry.Body);
            levelLabel.anchor.set(0, 0.5);
            levelLabel.position.set(iconSize + labelGap, rowHeight / 2);
            row.addChild(levelLabel);
        });

        this.panelWidth = ownedToolIds.length > 0
            ? iconSize + labelGap + 40 // 40px is a reasonable fixed width for "Lv.N" text — avoids measuring every label just to report a footprint nothing currently reads off panelWidth's exact value.
            : 0;
        this.panelHeight = ownedToolIds.length > 0
            ? ownedToolIds.length * rowHeight + (ownedToolIds.length - 1) * rowGap
            : 0;
    }

    public override destroy(options?: Parameters<PIXI.Container['destroy']>[0]): void {
        ItemStorage.onChange.remove(this.handleChanged);
        ShopUpgradeStorage.onChange.remove(this.handleChanged);
        super.destroy(options);
    }
}
