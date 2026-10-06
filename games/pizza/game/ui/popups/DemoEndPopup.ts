// DemoEndPopup.ts
//
// "End of the demo" message (see DemoTypes.ts) — the config's title and message plus an OK
// button. Only the buttons close it (not a backdrop tap), so it can't be dismissed by accident.

import * as PIXI from 'pixi.js';
import Popup from './Popup';
import { createPopupButton, POPUP_BUTTON_WIDTH } from './PopupButtonStyles';
import { TextStyleRegistry } from '../TextStyleRegistry';

const CONTENT_WIDTH = 420;
const MESSAGE_BUTTON_GAP = 24;

export default class DemoEndPopup extends Popup {
    /** Popup's constructor calls buildContent() before a subclass field could be set — the message is handed over through here. */
    private static pendingMessage = '';

    public constructor(title: string, message: string) {
        DemoEndPopup.pendingMessage = message;
        super(title, { contentWidth: CONTENT_WIDTH, closeOnBackdropTap: false });
    }

    protected buildContent(content: PIXI.Container, contentWidth: number): void {
        const text = new PIXI.Text(DemoEndPopup.pendingMessage, {
            ...TextStyleRegistry.Info,
            wordWrap: true,
            wordWrapWidth: contentWidth,
            align: 'center',
        });
        text.anchor.set(0.5, 0);
        text.position.set(contentWidth / 2, 0);
        content.addChild(text);

        const okButton = createPopupButton('OK', 'primary', () => this.requestClose());
        okButton.position.set((contentWidth - POPUP_BUTTON_WIDTH) / 2, text.height + MESSAGE_BUTTON_GAP);
        content.addChild(okButton);
    }
}
