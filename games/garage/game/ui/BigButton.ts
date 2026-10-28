// BigButton.ts
//
// The large pill button used for scene actions (RACE, BACK): a sliced button image and label from the
// UI kit's "garage" screen, with press feedback.

import * as PIXI from 'pixi.js';
import { UiKit } from './UiKit';
import { UiAnim } from './UiAnim';

export function bigButton(
    imageId: 'raceButton' | 'backButton',
    labelId: 'raceLabel' | 'backLabel',
    label: string,
    width: number,
    onTap: () => void,
): PIXI.Container {
    const button = new PIXI.Container();
    const background = UiKit.image('garage', imageId, width, 100);
    const text = UiKit.text('garage', labelId, { label });
    text.y = -4;
    button.addChild(background, text);
    button.eventMode = 'static';
    button.cursor = 'pointer';
    button.on('pointertap', () => {
        UiAnim.punch(button, 0.12);
        onTap();
    });
    return button;
}
