// SettingsPopup.ts
//
// Settings panel content for SettingsButton (see ../SettingsUIService) —
// just Clear Data for now. Extends Popup (see that file's own doc) so this
// only has to describe ITS OWN content via buildContent(); the title/close
// button/panel chrome/transition are all handled generically.

import * as PIXI from 'pixi.js';
import Popup from './Popup';
import { createPopupButton, POPUP_BUTTON_WIDTH } from './PopupButtonStyles';
import { clearAllPlayerData } from '../../data/PlayerDataReset';

export default class SettingsPopup extends Popup {
    public constructor() {
        super('Settings', { contentWidth: POPUP_BUTTON_WIDTH });
    }

    protected buildContent(content: PIXI.Container, contentWidth: number): void {
        // The one action this popup has right now — see createPopupButton's own doc for how to
        // add a second one at a different emphasis level (role: 'secondary'/'accent'). See
        // PlayerDataReset.ts's own doc for what this actually clears and why.
        const clearDataButton = createPopupButton('Clear Data', 'primary', () => clearAllPlayerData());
        clearDataButton.position.set((contentWidth - POPUP_BUTTON_WIDTH) / 2, 0);
        content.addChild(clearDataButton);
    }
}
