// TextStyleRegistry.ts
//
// Shared PIXI.TextStyle presets for anything paired to the 3D world via
// ScreenAnchorComponent (damage numbers, zone nameplates, ...) plus general
// HUD text — same "base + named overrides" pattern as games/tower/Assets.ts's
// static TextStyles, kept in its own file since pizza's Assets.ts doesn't
// have an equivalent yet. Reuses Assets.MainFont/MainFontTitle's families so
// anything built here still matches the rest of the game's type without
// redeclaring a font per style.
//
// Add a new style by spreading Body and overriding only what differs — a
// shared tweak (stroke color/thickness, drop shadow) then only ever needs
// to change in one place.

import * as PIXI from 'pixi.js';
import Assets from '../../Assets';


const MainFont: Partial<PIXI.TextStyle> = {
    fontFamily: "Baloo2-ExtraBold",
    //fontFamily: "LEMONMILK-Regular",
    fontSize: 28,
    fontWeight: 'bold',
    fill: 0xffffff,
    stroke: "#1d1b1a",
    strokeThickness: 4,
    dropShadow: true,
    dropShadowAngle: Math.PI / 2,
    dropShadowDistance: 2,
    letterSpacing: 2,

    miterLimit: 1
};


/** Base every variant below builds on — plain HUD body text. */
const Body: Partial<PIXI.TextStyle> = {
    fontFamily: MainFont.fontFamily,
    fontWeight: 'bold',
    fill: 0xffffff,
    stroke: 0x000000,
    strokeThickness: 3,
    dropShadow: true,
    dropShadowAlpha: 0.7,
    dropShadowDistance: 2,
    dropShadowAngle: Math.PI / 2,
    fontSize: 18,
};

export const TextStyleRegistry = {
    Body,
    Inventory: { ...Body, fontSize: 22, strokeThickness: 4 } as Partial<PIXI.TextStyle>,
    /** Bigger heading variant of Body, using MainFontTitle's family — general section/panel titles. */
    Title: { ...Body, fontFamily: Assets.MainFontTitle.fontFamily, fontSize: 32, strokeThickness: 4 } as Partial<PIXI.TextStyle>,

    /** Generic combat/hit damage number — for future use (e.g. the player taking damage). */
    Damage: { ...Body, fill: '#FF4444', fontSize: 22, strokeThickness: 4 } as Partial<PIXI.TextStyle>,
    /** ResourceNode's gather-hit damage popup — see ResourceNode.showDamagePopup(). */
    ResourceDamage: { ...Body, fill: '#FF4444', fontSize: 22, strokeThickness: 4 } as Partial<PIXI.TextStyle>,
    /** A zone's floating nameplate — see DropZone's "Drop Zone" label. */
    ZoneTitle: { ...Body, fill: 0x33cc66, fontSize: 18, strokeThickness: 4 } as Partial<PIXI.TextStyle>,

    /** A short-lived toast/callout worth pausing on ("Level up!") — bigger and warmer than Info. */
    Notification: { ...Body, fill: 0xffe066, fontSize: 32, strokeThickness: 4 } as Partial<PIXI.TextStyle>,
    /** A calmer status readout — smaller than Notification, still louder than Body. */
    Info: { ...Body, fontSize: 20 } as Partial<PIXI.TextStyle>,
} as const;

export type TextStyleName = keyof typeof TextStyleRegistry;
