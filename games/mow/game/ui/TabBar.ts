// TabBar.ts
//
// Tabs that look like tabs: a content block (a lighter inset area holding the panel's content) with a row of tabs
// along its top edge. The active tab is the block's own colour and runs into it seamlessly (a gold rim round its
// arch, bright label); the others are gold (white labels), a little lower, behind the block — so they read as
// buttons to tap ("other pages here"), not as background. Used by the wardrobe (COLORS / FACES / HATS) and the ATM (GEAR / BOOSTS).
//
// Art: the Layer Lab kit's tab arch (Menu_BottomBtn_TabFocus, rounded top / flat bottom) and its lit rim
// (Menu_BottomBtn_TabFocus_Light), white masks tinted here; the block is the kit's rounded frame
// (BorderFrame_Round20_White_Bg). All 9-sliced, so any size keeps crisp corners.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { UiKit } from './UiKit';
import { BakedShape } from './BakedShape';

const BLOCK_FILL = 0x3c4558;
/** Inactive tabs are gold, so the other pages read as buttons to tap rather than background. */
const TAB_IDLE = 0xd9971f;
const TAB_HOVER = 0xf0b23a;
const ACCENT = 0xffd23f;
/** Inactive tabs sit this much lower than the active one. */
const SINK = 6;
/** Tabs reach this far down into the block, so the active one joins it without a seam. */
const OVERLAP = 8;

export interface TabSpec {
    id: string;
    label: string;
    /** Something new to see there (an affordable boost): the kit's bobbing "!" on the tab's corner. */
    alert?: boolean;
    /** A short green tag on the tab's corner (the wardrobe's "FREE" for an unclaimed gift); it bobs like the alert. */
    badge?: string;
}

export interface TabBarOptions {
    /** The content block's size; y = 0 is its top edge (the tabs stand above it). */
    width: number;
    height: number;
    tabs: TabSpec[];
    active: string;
    tabWidth: number;
    tabHeight: number;
    onSelect: (id: string) => void;
}

/** A 9-sliced kit sprite, tinted, `width` x `height`, its top-left at (x, y). */
function sliced(frame: string, borders: [number, number, number, number], tint: number, x: number, y: number, width: number, height: number): PIXI.NineSlicePlane {
    const plane = new PIXI.NineSlicePlane(PIXI.Texture.from(frame), ...borders);
    plane.tint = tint;
    plane.position.set(x, y);
    plane.width = width;
    plane.height = height;
    return plane;
}

/** The block with its tabs; position it by the block's top-centre (the tabs are at negative y). */
export function tabbedBlock(options: TabBarOptions): PIXI.Container {
    const { width, height, tabs, active, tabWidth, tabHeight } = options;
    const root = new PIXI.Container();
    const gap = 8;
    const left = -width / 2 + 18;
    const tabX = (i: number) => left + i * (tabWidth + gap);

    // Inactive tabs first: the block is drawn over their bottoms.
    tabs.forEach((tab, i) => {
        if (tab.id === active) return;
        root.addChild(tabButton(tab, tabX(i), tabWidth, tabHeight - SINK, false, options.onSelect));
    });

    const block = sliced('BorderFrame_Round20_White_Bg', [20, 20, 20, 20], BLOCK_FILL, -width / 2, 0, width, height);
    // Content taps must not fall through to the movement joystick underneath.
    block.eventMode = 'static';
    block.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
    root.addChild(block);

    const index = tabs.findIndex((tab) => tab.id === active);
    if (index >= 0) root.addChild(tabButton(tabs[index], tabX(index), tabWidth, tabHeight, true, options.onSelect));
    return root;
}

/** One tab, standing on y = 0 (the block's top) and reaching OVERLAP into it. */
function tabButton(tab: TabSpec, x: number, width: number, height: number, active: boolean, onSelect: (id: string) => void): PIXI.Container {
    const button = new PIXI.Container();
    button.x = x;
    const shape = sliced('Menu_BottomBtn_TabFocus', [22, 22, 22, 2], active ? BLOCK_FILL : TAB_IDLE, 0, -height, width, height + OVERLAP);
    button.addChild(shape);
    if (active) {
        // The kit's lit rim round the arch, in gold: "this one".
        button.addChild(sliced('Menu_BottomBtn_TabFocus_Light', [16, 22, 16, 2], ACCENT, 0, -height, width, height));
    }
    const label = UiKit.fit(UiKit.text('wardrobe', 'tabLabel', { text: tab.label }), width - 24);
    label.anchor.set(0.5);
    label.position.set(width / 2, -height / 2 + 3);
    button.addChild(label);
    if (tab.alert && !active) {
        // On the corner, like the HUD's achievements "!"; its bob dies with the panel (UiAnim.kill on the parent).
        const alert = PIXI.Sprite.from(UiKit.imageName('hud', 'alert'));
        alert.anchor.set(0.5);
        alert.scale.set(30 / Math.max(alert.texture.width, alert.texture.height, 1));
        alert.position.set(width - 10, -height + 4);
        gsap.to(alert, { y: alert.y - 6, duration: 0.45, ease: 'sine.inOut', yoyo: true, repeat: -1 });
        button.addChild(alert);
    }
    if (tab.badge) button.addChild(tagBadge(tab.badge, width - 8, -height - 2));
    if (!active) {
        button.eventMode = 'static';
        button.cursor = 'pointer';
        button.hitArea = new PIXI.Rectangle(0, -height, width, height);
        button.on('pointerover', () => (shape.tint = TAB_HOVER));
        button.on('pointerout', () => (shape.tint = TAB_IDLE));
        button.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        button.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            onSelect(tab.id);
        });
    }
    return button;
}

/** A green rounded tag with a short word ("FREE"), centred on (x, y), tilted and bobbing; also used on cards. */
export function tagBadge(text: string, x: number, y: number): PIXI.Container {
    const tag = new PIXI.Container();
    tag.eventMode = 'none';
    const label = UiKit.fit(UiKit.text('wardrobe', 'tabLabel', { text }), 90);
    label.anchor.set(0.5);
    const w = label.width + 22;
    const h = label.height + 8;
    tag.addChild(new BakedShape(Math.ceil(w), Math.ceil(h), h / 2, { fill: 0x3fd15a, rim: 0x1f6b2c, rimWidth: 3 }), label);
    tag.position.set(x, y);
    tag.rotation = 0.12;
    gsap.to(tag, { y: y - 5, duration: 0.45, ease: 'sine.inOut', yoyo: true, repeat: -1 });
    return tag;
}
