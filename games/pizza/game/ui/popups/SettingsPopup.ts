// SettingsPopup.ts
//
// Settings panel content for SettingsButton (see ../SettingsUIService) —
// just Clear Data for now. Extends Popup (see that file's own doc) so this
// only has to describe ITS OWN content via buildContent(); the title/close
// button/panel chrome/transition are all handled generically.

import * as PIXI from 'pixi.js';
import Popup from './Popup';
import { createPopupButton, POPUP_BUTTON_WIDTH } from './PopupButtonStyles';
import { GlobalResourceStorage } from '../../data/GlobalResourceStorage';
import { BackpackStorage } from '../../data/BackpackStorage';
import { BuildingStorage } from '../../data/BuildingStorage';
import { GateStorage } from '../../data/GateStorage';
import { QueueStorage } from '../../data/QueueStorage';
import { EconomyStorage } from '../../data/EconomyStorage';
import { ShopUpgradeStorage } from '../../shop/ShopUpgradeStorage';
import { ShopStorage } from '../../data/ShopStorage';
import { HighScoreStorage } from '../../data/HighScoreStorage';

export default class SettingsPopup extends Popup {
    public constructor() {
        super('Settings', { contentWidth: POPUP_BUTTON_WIDTH });
    }

    protected buildContent(content: PIXI.Container, contentWidth: number): void {
        // The one action this popup has right now — see createPopupButton's own doc for how to
        // add a second one at a different emphasis level (role: 'secondary'/'accent').
        const clearDataButton = createPopupButton('Clear Data', 'primary', () => this.handleClearData());
        clearDataButton.position.set((contentWidth - POPUP_BUTTON_WIDTH) / 2, 0);
        content.addChild(clearDataButton);
    }

    /** Same storage list PizzaScene's own dev "Reset Everything" button clears, plus ShopStorage/HighScoreStorage (which that dev button doesn't touch but genuinely should for a PLAYER-facing clear). Reloads afterward so a fresh boot picks up the cleared state exactly like a first-ever visit would, rather than trying to reset every in-memory cache/UI by hand. */
    private handleClearData(): void {
        void Promise.all([
            GlobalResourceStorage.clearAll(),
            BackpackStorage.clearAll(),
            BuildingStorage.clearAll(),
            GateStorage.clearAll(),
            QueueStorage.clearAll(),
            EconomyStorage.clearAll(),
            ShopUpgradeStorage.clearAll(),
            ShopStorage.clearAll(),
            HighScoreStorage.clearAll(),
        ]).then(() => window.location.reload());
    }
}
