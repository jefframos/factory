// UiParts.ts
//
// Shared Layer Lab library pieces (corner buttons, popup panel, title ribbon, close button)
// so the HUD, home screen and modals all draw from the same atlas art.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { UiKit } from './UiKit';

export const CORNER_BUTTON_SIZE = 64;

/** Fits a sprite inside a `size` box, keeping its aspect ratio. */
function fit(sprite: PIXI.Sprite, size: number): void {
    sprite.scale.set(size / Math.max(sprite.texture.width, sprite.texture.height));
}

/** Dark rounded square with a centered icon (settings, sound). Returns the icon so callers can swap textures. */
export function cornerButton(iconFrame: string, iconSize = 38, onTap?: () => void): { button: PIXI.Container; icon: PIXI.Sprite } {
    const button = new PIXI.Container();
    const body = new PIXI.Container();
    const bg = PIXI.Sprite.from('Button_Round03_Dark');
    bg.anchor.set(0.5);
    fit(bg, CORNER_BUTTON_SIZE);
    const icon = PIXI.Sprite.from(iconFrame);
    icon.anchor.set(0.5);
    fit(icon, iconSize);
    // The frame's lip sits at the bottom, so the visual face is slightly above centre.
    icon.y = -2;
    body.addChild(bg, icon);
    button.addChild(body);
    button.eventMode = 'static';
    button.cursor = 'pointer';
    button.hitArea = new PIXI.Rectangle(-CORNER_BUTTON_SIZE / 2 - 4, -CORNER_BUTTON_SIZE / 2 - 4, CORNER_BUTTON_SIZE + 8, CORNER_BUTTON_SIZE + 8);
    pressFeedback(button, body);
    if (onTap) {
        button.on('pointertap', onTap);
    }
    return { button, icon };
}

export function setIcon(icon: PIXI.Sprite, frame: string, size: number): void {
    icon.texture = PIXI.Texture.from(frame);
    fit(icon, size);
}

function pressFeedback(button: PIXI.Container, body: PIXI.Container): void {
    const release = (): void => {
        gsap.killTweensOf(body.scale);
        gsap.to(body.scale, { x: 1, y: 1, duration: 0.2, ease: 'back.out(3)' });
    };
    button.on('pointerdown', () => {
        gsap.killTweensOf(body.scale);
        body.scale.set(0.9);
    });
    button.on('pointerup', release);
    button.on('pointerupoutside', release);
    button.on('destroyed', () => gsap.killTweensOf(body.scale));
}

/** Rounded blue popup panel (nine-sliced), centered on the origin. */
export function popupPanel(width: number, height: number): PIXI.NineSlicePlane {
    const panel = new PIXI.NineSlicePlane(PIXI.Texture.from('Popup01_Basic_Single'), 50, 50, 50, 56);
    panel.width = width;
    panel.height = height;
    panel.position.set(-width / 2, -height / 2);
    panel.eventMode = 'static';
    return panel;
}

const RIBBON_SCALE = 0.62;

/** Red title banner whose centre band stretches to fit the text. */
export function titleRibbon(text: string, fontSize = 30): PIXI.Container {
    const holder = new PIXI.Container();
    const title = new PIXI.Text(text, {
        fontFamily: UiKit.fontFamily('primary'),
        fontSize,
        fill: 0xffffff,
        stroke: 0x5a0d1c,
        strokeThickness: Math.max(4, Math.round(fontSize / 6)),
        align: 'center',
    });
    title.anchor.set(0.5);
    const texture = PIXI.Texture.from('Title_Ribbon02_Red');
    // Slice through the middle column so only the centre band (and the gap under it) stretches.
    const plane = new PIXI.NineSlicePlane(texture, 88, 0, 89, 0);
    plane.width = Math.max(texture.width, (title.width + 130) / RIBBON_SCALE);
    plane.height = texture.height;
    plane.scale.set(RIBBON_SCALE);
    plane.position.set((-plane.width * RIBBON_SCALE) / 2, (-texture.height * RIBBON_SCALE) / 2);
    // Band centre is ~6px (texture space) above the texture centre.
    title.y = -6 * RIBBON_SCALE - 2;
    holder.addChild(plane, title);
    return holder;
}

/** Red square close button with a white X, as in the library's popup previews. */
export function closeButton(onTap: () => void, size = 52): PIXI.Container {
    const button = new PIXI.Container();
    const body = new PIXI.Container();
    const bg = PIXI.Sprite.from('Button_Round06_Red');
    bg.anchor.set(0.5);
    fit(bg, size);
    const cross = PIXI.Sprite.from('Icon_Close02');
    cross.anchor.set(0.5);
    fit(cross, size * 0.56);
    cross.y = -2;
    body.addChild(bg, cross);
    button.addChild(body);
    button.name = 'close-button';
    button.eventMode = 'static';
    button.cursor = 'pointer';
    button.hitArea = new PIXI.Circle(0, 0, size / 2 + 8);
    pressFeedback(button, body);
    button.on('pointertap', onTap);
    return button;
}
