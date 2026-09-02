// MartTypes.ts
//
// A MART is a general store — buy/sell as many units of a resource as you
// want, at any time — a totally different shape from ShopTypes.ts's own
// single-tool upgrade LADDER (buy exactly this tool's next level, once,
// waiting out a cooldown between purchases). Keeping this as its own
// file/registry rather than bolting a `type` discriminator onto ShopConfig
// (see that file's own doc: every existing shop entry is one uniform shape)
// means MartZone.ts/MartPopup.ts can be a completely independent
// buy-any-quantity-any-time interaction without ShopZone's own
// continuous-coin-drain-while-standing-in-trigger flow bleeding into it, or
// vice versa.
//
// Same "default + per-id override" shape as FarmTypes.ts's own
// DEFAULT_FARM_PLOT_CONFIG/FARM_PLOT_CONFIG_BY_ID (a "mart"-typed object
// drawn on the Tiled map's mapSettings layer, open-ended by id like
// shops/crafting/farms, not enum-backed) — getMartConfig() resolves the
// same way getFarmPlotConfig() does.
//
// A mart's own `offers` list is what it's willing to SELL TO the player
// (the Buy tab) — see MartOffer's own doc. What the player can SELL BACK is
// deliberately NOT scoped to `offers` at all: MartPopup's own Sell tab
// reads every ResourceType the player currently holds with a `sellable`
// price (see ResourceConfig.sellable's own doc) — a general store buys back
// anything sellable you bring it, not just the specific goods it happens to
// stock for sale itself.

import { ResourceType, RESOURCE_CONFIG } from '../actions/ResourceTypes';
import { MilestoneRequirement } from './MilestoneRequirement';

/** Flat 80% of a resource's own base ResourceConfig.price — see getMartSellPrice()'s own doc for why this never varies per-mart the way buying does. */
export const MART_SELL_PRICE_MULTIPLIER = 0.8;

export interface MartOffer {
    resourceType: ResourceType;
    /** Multiplies this resource's own base ResourceConfig.price for BUYING here — optional, defaults to 1 (buy at exactly the resource's own base price). Two marts can sell the same resource at different markups just by setting this differently; selling is unaffected either way (see MART_SELL_PRICE_MULTIPLIER's own doc). */
    priceMultiplier?: number;
}

export interface MartConfig {
    name: string;
    /** What this mart is willing to sell TO the player — see this file's own top doc for why selling BACK isn't scoped to this same list. A ResourceType with no ResourceConfig.price set here is simply never buyable, regardless of being listed. */
    offers: MartOffer[];
    /** Optional — when set, this mart isn't spawned at all until MilestoneRequirement.ts's isMilestoneRequirementMet() says this is satisfied, same shared shape/reasoning as FarmPlotConfig.appearRequirement/ShopConfig.appearRequirement. undefined (the default) means "always appears." */
    appearRequirement?: MilestoneRequirement;
    /** 0-1 fraction of this mart's own footprint that becomes a SOLID collider blocking the player while its appearRequirement isn't yet met — see SolidArea.ts's own doc for the shared 0/1/0.5 semantics every provider/building/shop/craft-table/queue/farm-plot's `solid` field uses. undefined/0 (the default) means no solid collider. */
    solid?: number;
    /** EntityViewRegistry.ts id for this mart's own real-mesh look — same "string key resolved via resolveEntityView()" join every other view field in this codebase uses. Undefined/an id with no models yet falls back to a placeholder box. */
    view?: string;
}

/** Applied to every discovered "mart" object unless MART_CONFIG_BY_ID has an override for its id — see this file's own doc. Empty offers by default; a level designer stocks it from the pizza web editor's Marts tab. */
export const DEFAULT_MART_CONFIG: MartConfig = {
    "name": "General Store",
    "offers": [
        {
            "resourceType": ResourceType.Cabbage
        },
        {
            "resourceType": ResourceType.Crystal
        }
    ]
};

/** Per-mart-id overrides — sparse: only marts a level designer has actually customized need an entry. */
export const MART_CONFIG_BY_ID: Partial<Record<string, MartConfig>> = {
    "farmShop": {
        "name": "Farm Shop",
        "offers": [
            {
                "resourceType": ResourceType.Cabbage
            },
            {
                "resourceType": ResourceType.Cauliflower
            }
        ],
        "solid": 0.5
    }
};

/** The config a mart with this id should use — its own override if MART_CONFIG_BY_ID has one, else DEFAULT_MART_CONFIG. */
export function getMartConfig(id: string): MartConfig {
    return MART_CONFIG_BY_ID[id] ?? DEFAULT_MART_CONFIG;
}

/** The price to BUY one unit of `resourceType` at a mart offering it at `priceMultiplier` (default 1) — undefined if this resource has no base ResourceConfig.price at all (never buyable anywhere, regardless of being offered). Rounded, floored at 1 so a fractional multiplier can never make something free. */
export function getMartBuyPrice(resourceType: ResourceType, priceMultiplier = 1): number | undefined {
    const basePrice = RESOURCE_CONFIG[resourceType].price;
    if (basePrice === undefined) {
        return undefined;
    }
    return Math.max(1, Math.round(basePrice * priceMultiplier));
}

/** The price to SELL one unit of `resourceType` BACK to any mart — undefined if it has no base price at all, or ResourceConfig.sellable is explicitly false. Always MART_SELL_PRICE_MULTIPLIER of the base price, regardless of which mart or what that mart's own buy-side priceMultiplier is (see this file's own top doc). Rounded, floored at 1. */
export function getMartSellPrice(resourceType: ResourceType): number | undefined {
    const config = RESOURCE_CONFIG[resourceType];
    if (config.price === undefined || config.sellable === false) {
        return undefined;
    }
    return Math.max(1, Math.round(config.price * MART_SELL_PRICE_MULTIPLIER));
}
