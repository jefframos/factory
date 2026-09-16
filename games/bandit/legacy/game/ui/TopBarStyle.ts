// TopBarStyle.ts
//
// Single place that defines how the currency topbar (EconomyUI.ts) looks and
// is laid out — which currencies show (and in what order), each pill's size,
// the frame that skins a pill, and the spacing around/between pills. Retune
// the whole topbar from here without touching EconomyUI's rendering code.

import { FrameName } from './FrameRegistry';
import { CurrencyType } from '../data/EconomyTypes';

export interface TopBarStyleConfig {
    /** Currencies shown on the topbar, left to right. */
    currencies: CurrencyType[];
    /** Width of a single pill's content (icon + amount label), NOT counting `pillPadding`. */
    pillContentWidth: number;
    pillHeight: number;
    /** Horizontal gap between adjacent pills. */
    pillGap: number;
    /** Which FrameRegistry entry skins each individual pill — see FrameRegistry.ts. */
    pillFrame: FrameName;
    /** Space between a pill's frame border and its icon/label. */
    pillPadding: number;
    /** Gap left between the icon's edge and the pill's own height (see ViewUtils.elementScaler() in EconomyUI). */
    iconPadding: number;
}

export const TOP_BAR_STYLE: TopBarStyleConfig = {
    currencies: [CurrencyType.Money, CurrencyType.Gem, CurrencyType.Energy],
    pillContentWidth: 64,
    pillHeight: 36,
    pillGap: 8,
    pillFrame: 'Info',
    pillPadding: 10,
    iconPadding: 4,
};
