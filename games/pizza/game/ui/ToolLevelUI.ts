// ToolLevelUI.ts
//
// Bottom-right HUD panel listing every tool in ToolRegistry.TOOL_LIBRARY
// alongside its current shop-upgrade level — a quick "what am I holding,
// how upgraded is it" readout independent of standing at any particular
// ShopZone. A tool's level is read off whichever SHOP_CONFIG_BY_ID entry
// upgrades it (ShopConfig.tool) — a tool with no shop targeting it at all
// just always reads Lv.0, same "nothing to show, show the honest default"
// convention as everything else here.
//
// Rows are laid out BOTTOM-UP: the first tool in TOOL_LIBRARY sits at the
// very bottom (y=0, closest to the screen edge once UIService anchors this
// panel), each next one stacking upward above it — so the panel's own
// bottom edge stays pinned to the screen regardless of how many tools exist,
// rather than the list "hanging" off a fixed top edge that might drift as
// rows are added.
//
// Subscribes to ShopUpgradeStorage.onChange ONCE and repaints only when a
// level actually changes — no per-frame polling, same convention as
// EconomyUI/GlobalResourcesUI.

import * as PIXI from 'pixi.js';
import { TextStyleRegistry } from './TextStyleRegistry';
import AutoFitFrame, { uniformFitPadding } from './AutoFitFrame';
import { ShopUpgradeStorage } from '../shop/ShopUpgradeStorage';
import { SHOP_CONFIG_BY_ID } from '../shop/ShopTypes';
import { getToolIcon, ToolId, TOOL_LIBRARY } from '../actions/ToolRegistry';

const ROW_ICON_SIZE = 32;
const ROW_HEIGHT = 40;
const ROW_GAP = 6;
const ROW_ICON_TEXT_GAP = 8;
const PANEL_PADDING = uniformFitPadding(12);

/** Every tool id this panel lists, in a fixed order — Object.keys() on a `satisfies Record<...>` object preserves declaration order, so this is just "however TOOL_LIBRARY declares them" (axe, then pickaxe). */
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

export default class ToolLevelUI extends AutoFitFrame {
    private readonly column: PIXI.Container;
    /** One label per tool, in TOOL_IDS order — refreshed in place rather than rebuilt, so the icons never flicker/reload on a level change. */
    private readonly levelLabels = new Map<ToolId, PIXI.Text>();

    private readonly handleShopChanged = (): void => {
        this.refresh();
    };

    public constructor() {
        const column = new PIXI.Container();
        super(PANEL_PADDING, 'Main', column);
        this.column = column;

        this.buildRows();
        this.refresh();

        ShopUpgradeStorage.onChange.add(this.handleShopChanged);
    }

    /** Builds one icon+label row per tool, ONCE — bottom-up (see this file's own doc): row 0 sits at local y=0, each subsequent row stacks ABOVE it (negative y). */
    private buildRows(): void {
        TOOL_IDS.forEach((toolId, index) => {
            const row = new PIXI.Container();
            row.position.set(0, -index * (ROW_HEIGHT + ROW_GAP));

            const icon = new PIXI.Sprite(getToolIcon(toolId));
            icon.anchor.set(0, 0.5);
            icon.width = ROW_ICON_SIZE;
            icon.height = ROW_ICON_SIZE;
            icon.position.set(0, -ROW_HEIGHT / 2);
            row.addChild(icon);

            const levelLabel = new PIXI.Text('', TextStyleRegistry.Body);
            levelLabel.anchor.set(0, 0.5);
            levelLabel.position.set(ROW_ICON_SIZE + ROW_ICON_TEXT_GAP, -ROW_HEIGHT / 2);
            row.addChild(levelLabel);
            this.levelLabels.set(toolId, levelLabel);

            this.column.addChild(row);
        });
    }

    /** Rewrites every row's level text from ShopUpgradeStorage's current state and re-fits the frame — cheap enough to just redo every row rather than track which shop id changed. */
    private refresh(): void {
        for (const toolId of TOOL_IDS) {
            const shopId = shopIdForTool(toolId);
            const level = shopId ? ShopUpgradeStorage.getLevel(shopId) : 0;
            this.levelLabels.get(toolId)!.text = `Lv.${level}`;
        }

        this.fit();
    }

    public override destroy(options?: Parameters<PIXI.Container['destroy']>[0]): void {
        ShopUpgradeStorage.onChange.remove(this.handleShopChanged);
        super.destroy(options);
    }
}
