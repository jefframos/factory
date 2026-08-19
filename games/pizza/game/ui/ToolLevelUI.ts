// ToolLevelUI.ts
//
// Bottom-right HUD panel listing every tool the player actually OWNS (see
// ItemStorage.ts) alongside its current shop-upgrade level — a quick "what
// am I holding, how upgraded is it" readout independent of standing at any
// particular ShopZone. A tool's level is read off whichever
// SHOP_CONFIG_BY_ID entry upgrades it (ShopConfig.tool) — a tool with no
// shop targeting it at all just always reads Lv.0, same "nothing to show,
// show the honest default" convention as everything else here.
//
// Rows are rebuilt wholesale (not diffed) whenever ItemStorage's owned set
// actually changes — see refresh()'s own doc for why a full rebuild is fine
// here despite BuildingZone/QueueZone's own "mutate in place" convention
// elsewhere. Laid out BOTTOM-UP: whichever owned tool comes first in
// TOOL_LIBRARY's own order sits at the very bottom (y=0, closest to the
// screen edge once UIService anchors this panel), each next one stacking
// upward above it — so the panel's own bottom edge stays pinned to the
// screen regardless of how many tools are currently owned.
//
// Subscribes to ItemStorage.onChange (crafting a new tool) AND
// ShopUpgradeStorage.onChange (upgrading an already-owned one) — either can
// change what this panel should show.

import * as PIXI from 'pixi.js';
import { TextStyleRegistry } from './TextStyleRegistry';
import AutoFitFrame, { uniformFitPadding } from './AutoFitFrame';
import { ShopUpgradeStorage } from '../shop/ShopUpgradeStorage';
import { SHOP_CONFIG_BY_ID } from '../shop/ShopTypes';
import { getToolIcon, ToolId, TOOL_LIBRARY } from '../actions/ToolRegistry';
import { ItemStorage } from '../crafting/ItemStorage';
import { ItemType } from '../crafting/ItemTypes';

const ROW_ICON_SIZE = 32;
const ROW_HEIGHT = 40;
const ROW_GAP = 6;
const ROW_ICON_TEXT_GAP = 8;
const PANEL_PADDING = uniformFitPadding(12);

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

export default class ToolLevelUI extends AutoFitFrame {
    private readonly column: PIXI.Container;

    private readonly handleChanged = (): void => {
        this.refresh();
    };

    public constructor() {
        const column = new PIXI.Container();
        super(PANEL_PADDING, 'Main', column);
        this.column = column;

        this.refresh();

        ItemStorage.onChange.add(this.handleChanged);
        ShopUpgradeStorage.onChange.add(this.handleChanged);
    }

    /**
     * Rebuilds every row from scratch, bottom-up (see this file's own doc), from whichever
     * TOOL_IDS entries ItemStorage.hasCount() confirms the player actually owns right now.
     * Rebuilding wholesale (rather than adding/removing individual rows in place) is fine
     * here — this panel only ever has a couple of rows, and a full rebuild is simplest given
     * BOTH the owned SET (not just one row's text) and each row's level number can change.
     */
    private refresh(): void {
        this.column.removeChildren().forEach(child => child.destroy({ children: true }));

        const ownedToolIds = TOOL_IDS.filter(toolId => ItemStorage.hasCount(toolId as ItemType, 1));

        ownedToolIds.forEach((toolId, index) => {
            const row = new PIXI.Container();
            row.position.set(0, -index * (ROW_HEIGHT + ROW_GAP));

            const icon = new PIXI.Sprite(getToolIcon(toolId));
            icon.anchor.set(0, 0.5);
            icon.width = ROW_ICON_SIZE;
            icon.height = ROW_ICON_SIZE;
            icon.position.set(0, -ROW_HEIGHT / 2);
            row.addChild(icon);

            const shopId = shopIdForTool(toolId);
            const level = shopId ? ShopUpgradeStorage.getLevel(shopId) : 0;
            const levelLabel = new PIXI.Text(`Lv.${level}`, TextStyleRegistry.Body);
            levelLabel.anchor.set(0, 0.5);
            levelLabel.position.set(ROW_ICON_SIZE + ROW_ICON_TEXT_GAP, -ROW_HEIGHT / 2);
            row.addChild(levelLabel);

            this.column.addChild(row);
        });

        this.fit();
    }

    public override destroy(options?: Parameters<PIXI.Container['destroy']>[0]): void {
        ItemStorage.onChange.remove(this.handleChanged);
        ShopUpgradeStorage.onChange.remove(this.handleChanged);
        super.destroy(options);
    }
}
