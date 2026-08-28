// FarmTypes.ts
//
// Data-driven definition of a farm PLOT — a "farm"-typed object on the Tiled
// map's "mapSettings" objectgroup layer (see WorldObjectRegistry.ts), the
// same discovery path GateTypes.ts/QueueTypes.ts/BuildingTypes.ts's own
// entities use. Like QueueTypes.ts (and unlike BuildingId/GateId's small
// hand-authored enums), a plot's id comes straight from whatever a level
// designer draws on the map — there's no fixed enum of plot ids to attach
// config to ahead of time. So FARM_PLOT_CONFIG_BY_ID is an OPTIONAL override
// map (empty by default): any plot id not listed there just gets
// DEFAULT_FARM_PLOT_CONFIG — see getFarmPlotConfig(), the one reader.
//
// A plot has three tile states under its own footprint: EMPTY (shown before
// the player has acquired it — the "for sale" state, marked by a dropper
// with `target` equal to this plot's own id, same dropper convention every
// other priced entity uses), PREPARED (bought, tilled, ready to plant), and
// whatever CropTypes.ts's own growth-stage ladder draws once something is
// actually planted. The first two are FARM_TILE_CONFIG below — a SINGLE,
// GAME-WIDE pair, not per-plot: every farm plot on the map looks the same
// before/right-after purchase (only price/unlock/allowed-crops vary plot to
// plot), so there is deliberately no per-id override for it, unlike every
// other field on FarmPlotConfig. A planted plot's per-stage tile is
// CropConfig's own concern (see that file's own doc), not duplicated here.
//
// Buying a plot is a straight currency purchase (`price`, CurrencyType/
// CURRENCY_CONFIG — see EconomyTypes.ts), a player ACTION taken on an
// already-standing plot, not a MilestoneRequirement gate. `appearRequirement`
// is the separate, optional "does this plot even show up to be bought at
// all" condition — same shared shape/reasoning as BuildingConfig.
// appearRequirement/QueueConfig.appearRequirement/CraftTableConfig.
// appearRequirement (see MilestoneRequirement.ts's own doc). On top of
// that, every farm plot is also drawn somewhere on the map that belongs to
// some fog-of-war zone (see ZoneVisibilityManager.ts) — a plot's own spawn
// gate must register with that system the exact same way a building/queue/
// craft-table's does (ZoneVisibilityManager.register()), so an otherwise-
// appearRequirement-satisfied plot still stays invisible/unspawned until
// its own zone is actually revealed. That registration is the RUNTIME
// consumer's job (whatever spawns a plot off WorldObjectRegistry.
// getAllOfType('farm')), not this file's — this file only carries the data
// half of "should this plot appear."

import { CurrencyType } from './EconomyTypes';
import { MilestoneRequirement } from './MilestoneRequirement';

export interface FarmPlotPrice {
    currency: CurrencyType;
    amount: number;
}

/**
 * EntityViewRegistry.ts ids for a plot's two pre-crop states — resolved into a real glb via
 * resolveEntityView(), the exact same join-by-string-id convention GateConfig.view/
 * BuildingLevelConfig.view already use (see that file's own doc), picked from the pizza web
 * editor's Tile Settings dropdown (sourced from the Entity Views tab, same as any other `view`
 * field) instead of hand-typed. Both optional: undefined/an id with no models yet means no
 * mesh — whatever spawns a plot (see FarmTypes.ts's own top doc on the runtime consumer) falls
 * back to bare ground, same "view id exists but has no glb yet" convention EntityViewConfig.
 * models' own doc describes. Game-wide (see FARM_TILE_CONFIG below), not per-plot.
 */
export interface FarmPlotTiles {
    /** Shown before any plot is acquired — pairs with the dropper marking its price/target. */
    empty?: string;
    /** Shown once a plot is acquired, before anything is planted. */
    prepared?: string;
    /** Bare texture-name string (packed 'images'/etc. bundle — same "icon" field shape used across this codebase, e.g. BuildingConfig.icon/ItemConfig-via-toolId), representing FARMING as a whole rather than any one plot's own look — shown in FarmZone's "Farm Unlocked!" notification (see UpgradeNotificationManager) the instant a plot is bought. Shared across every plot for the same reason empty/prepared are (see this file's own doc): there's no per-plot notification, just "a farm got unlocked." */
    icon?: string;
}

/** The SAME empty/prepared tile-view pair (plus the shared notification icon) used by every farm plot on the map — see this file's own doc for why this isn't per-plot. Edited once, from the top of the pizza web editor's Farms tab. Tiles default to EntityViewRegistry.ts's placeholder ground-patch views (farmEmptyView/farmPreparedView) until a designer picks something farm-specific; `icon` defaults to a placeholder ('medicinal-herbs', from the 'survive' bundle) until real farm art exists. */
export const FARM_TILE_CONFIG: FarmPlotTiles = {
    "empty": "farmEmptyView",
    "prepared": "farmPreparedView",
    "icon": "medicinal-herbs"
};

export interface FarmPlotConfig {
    price: FarmPlotPrice;
    /** Optional — when set, this plot isn't spawned at all until MilestoneRequirement.ts's isMilestoneRequirementMet() says this is satisfied, same shared shape/reasoning as BuildingConfig.appearRequirement/QueueConfig.appearRequirement. undefined (the default) means "always appears" (subject to its own zone still being revealed — see this file's own doc), unchanged from before this field existed. */
    appearRequirement?: MilestoneRequirement;
    /** CropTypes.ts CropIds this plot accepts — undefined means any crop can be planted here, the same "unrestricted unless a designer opts a plot out" default every optional allow-list in this codebase uses. */
    allowedCrops?: string[];
    /** 0-1 fraction of this plot's own footprint that becomes a SOLID collider blocking the player while still unacquired — see SolidArea.ts's own doc for the shared 0/1/0.5 semantics every provider/building/shop/craft-table/queue's `solid` field uses. undefined/0 (the default) means no solid collider — a for-sale plot is walkable, same as an unbought queue/shop today. */
    solid?: number;
}

/** Applied to every discovered "farm" object unless FARM_PLOT_CONFIG_BY_ID has an override for its id — see this file's own doc. */
export const DEFAULT_FARM_PLOT_CONFIG: FarmPlotConfig = {
    "price": {
        "currency": CurrencyType.Money,
        "amount": 50
    }
};

/** Per-plot-id overrides — e.g. FARM_PLOT_CONFIG_BY_ID['farm1'] = { price: {...} } for a plot that should cost/unlock/behave differently from every other one. Sparse: only plots a level designer has actually customized need an entry. */
export const FARM_PLOT_CONFIG_BY_ID: Partial<Record<string, FarmPlotConfig>> = {
    "farm1": {
        "price": {
            "currency": CurrencyType.Money,
            "amount": 10
        }
    }
};

/** The config a farm plot with this id should use — its own override if FARM_PLOT_CONFIG_BY_ID has one, else DEFAULT_FARM_PLOT_CONFIG. */
export function getFarmPlotConfig(id: string): FarmPlotConfig {
    return FARM_PLOT_CONFIG_BY_ID[id] ?? DEFAULT_FARM_PLOT_CONFIG;
}
