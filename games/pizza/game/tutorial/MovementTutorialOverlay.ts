// MovementTutorialOverlay.ts
//
// The very first thing a fresh game shows: a screen-fixed hand icon ("tutorial_hand_2") looping
// around a drawn infinity/figure-8 path, teaching "you can move the character" before anything
// else happens. Only shows while the player is standing in zone 0 AND hasn't yet activated
// "walkTutorialTrigger" — the SAME trigger id ZoneTutorialTypes.ts's zone-0 seed data uses for
// its own single tutorial step, so a fresh player walking to/through that trigger both advances
// the zone-0 tutorial AND retires this movement lesson for good in one action. Once
// TriggerStorage marks that id activated, this tears itself down permanently — TriggerStorage's
// own persistence (see that file's own doc) is what keeps it from ever coming back on a later
// session; no separate "has the player seen this" flag needed.
//
// Fixed screen-center overlay, NOT anchored to any 3D world position — same Game.overlayScreenData
// convention UIService's own panels use (see that file's own positionBackpackUi() etc.), added
// straight to game.uiLayer rather than folded into UIService itself, since this is zone/trigger-
// gated tutorial logic, not a persistent HUD panel — same "own small class, constructed directly
// by PizzaScene" precedent ZoneTutorialController already sets.

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import { Game } from 'core/Game';
import { TriggerStorage } from '../data/TriggerStorage';
import ZoneVisibilityManager from '../world/ZoneVisibilityManager';

/** The one trigger id that both advances zone 0's own ZoneTutorialConfig step (see ZoneTutorialTypes.ts) AND retires this overlay for good — the same "walk through it" action teaches two things at once. */
const GATING_TRIGGER_ID = 'walkTutorialTrigger';
/** Only zone 0 ever shows this — the very first movement lesson a fresh game gets. */
const GATING_ZONE_NUMBER = 0;

/** Half-width of the drawn figure-8, in screen pixels — see infinityPoint()'s own doc for the curve itself. */
const PATH_HALF_WIDTH = 100;
/** Top-lobe/bottom-lobe half-heights — asymmetric on purpose (bottom lobe bigger) rather than the plain symmetric lemniscate, per art direction. */
const PATH_HALF_HEIGHT_TOP = 55;
const PATH_HALF_HEIGHT_BOTTOM = 85;
/** Seconds for the hand to complete one full lap of the figure-8. */
const HAND_LOOP_SEC = 3.5;
/** How finely the static dashed trace samples the curve — purely a rendering fidelity knob, not read anywhere else. */
const PATH_SAMPLE_COUNT = 120;
/** Every other 4-sample run alternates draw/skip — a fixed-step dash rather than true arc-length dashing (the curve's own point density already varies with sin/cos slope), plenty for a small decorative trace. */
const DASH_RUN_SAMPLES = 3;
const PATH_LINE_WIDTH = 4;
const PATH_COLOR = 0xffffff;
const PATH_ALPHA = 0.6;
const HAND_SIZE = 64;

/**
 * Lemniscate of Gerono — the classic figure-8/infinity curve lying on its side — sampled at
 * parameter `t` in [0, 2π). Shared by both the static dashed trace (buildDashedPath()) and the
 * hand's own live position (update()), so the hand always rides exactly the line drawn for it.
 * The plain formula (y = B sin(t) cos(t)) draws a top/bottom-symmetric 8; PIXI's y axis grows
 * DOWNWARD, so a positive raw y is the bottom lobe — scaling that half by
 * PATH_HALF_HEIGHT_BOTTOM instead of the top lobe's own (smaller) scale gives the bigger-bottom
 * asymmetry, with no discontinuity at the zero-crossings (t = 0, π/2, π, 3π/2) since y is
 * exactly 0 there regardless of which scale would apply.
 */
function infinityPoint(t: number, out: PIXI.Point): PIXI.Point {
    const rawY = Math.sin(t) * Math.cos(t);
    const scaleY = rawY > 0 ? PATH_HALF_HEIGHT_BOTTOM : PATH_HALF_HEIGHT_TOP;
    return out.set(PATH_HALF_WIDTH * Math.cos(t), rawY * scaleY);
}

export default class MovementTutorialOverlay {
    private readonly container: PIXI.Container;
    private readonly hand: PIXI.Sprite;
    private readonly getPlayerPosition: () => THREE.Vector3;
    private readonly zoneVisibility: ZoneVisibilityManager;

    private elapsedSec = 0;
    private destroyed = false;
    /** Scratch — avoids allocating a new PIXI.Point every frame in update(). */
    private readonly scratchPoint = new PIXI.Point();

    private readonly handleTriggerActivate = (id: string): void => {
        if (id === GATING_TRIGGER_ID) {
            this.destroy();
        }
    };

    public constructor(game: Game, getPlayerPosition: () => THREE.Vector3, zoneVisibility: ZoneVisibilityManager) {
        this.getPlayerPosition = getPlayerPosition;
        this.zoneVisibility = zoneVisibility;

        this.container = new PIXI.Container();
        this.container.visible = false;
        this.container.addChild(this.buildDashedPath());

        this.hand = new PIXI.Sprite(PIXI.Texture.from('tutorial_hand_2'));
        // (0.1, 0.1), not centered — tutorial_hand_2's own art has its fingertip near the
        // sprite's top-left corner, not its middle; anchoring there is what puts the fingertip
        // (not the sprite's bounding-box center) right on the drawn path.
        this.hand.anchor.set(0.1, 0.1);
        this.hand.width = HAND_SIZE;
        this.hand.height = HAND_SIZE;
        this.container.addChild(this.hand);

        game.uiLayer.addChild(this.container);

        if (TriggerStorage.isActivated(GATING_TRIGGER_ID)) {
            // Already done in an earlier session — never show at all, not even for one frame.
            this.destroy();
            return;
        }
        TriggerStorage.onActivate.add(this.handleTriggerActivate);
    }

    private buildDashedPath(): PIXI.Graphics {
        const graphics = new PIXI.Graphics();
        graphics.lineStyle(PATH_LINE_WIDTH, PATH_COLOR, PATH_ALPHA);

        const point = new PIXI.Point();
        let drawing = true;

        for (let i = 0; i <= PATH_SAMPLE_COUNT; i++) {
            infinityPoint((i / PATH_SAMPLE_COUNT) * Math.PI * 2, point);

            // Always establish the initial path position with moveTo().
            // Otherwise Pixi starts at (0, 0), creating an unwanted
            // straight line from the center to the first point.
            if (i === 0) {
                graphics.moveTo(point.x, point.y);
            } else if (drawing) {
                graphics.lineTo(point.x, point.y);
            } else {
                graphics.moveTo(point.x, point.y);
            }

            if (i % DASH_RUN_SAMPLES === DASH_RUN_SAMPLES - 1) {
                drawing = !drawing;
            }
        }

        return graphics;
    }

    /** Call once per render frame (see PizzaScene.update()) — re-checks the zone/trigger gate every call (cheap: one Map lookup) so the overlay appears/disappears the instant the player crosses in/out of zone 0, not just once at construction. No-op once destroy()'d. */
    public update(delta: number): void {
        if (this.destroyed) {
            return;
        }

        const visible = this.isInGatingZone();
        this.container.visible = visible;
        if (!visible) {
            return;
        }

        const screen = Game.overlayScreenData;
        if (screen) {
            this.container.position.set(screen.center.x, screen.bottomLeft.y - 150);
        }

        this.elapsedSec += delta;
        const t = (this.elapsedSec / HAND_LOOP_SEC) * Math.PI * 2;
        infinityPoint(t, this.scratchPoint);
        this.hand.position.set(this.scratchPoint.x, this.scratchPoint.y);
    }

    private isInGatingZone(): boolean {
        const position = this.getPlayerPosition();
        return this.zoneVisibility.getZoneForPosition(position.x, position.z) === GATING_ZONE_NUMBER;
    }

    /** Tears this down for good — called either once TriggerStorage confirms GATING_TRIGGER_ID already/just activated, or from PizzaScene's own teardown. Safe to call more than once. */
    public destroy(): void {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        TriggerStorage.onActivate.remove(this.handleTriggerActivate);
        this.container.destroy({ children: true });
    }
}
