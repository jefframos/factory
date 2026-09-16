// MovementTutorialOverlay.ts
//
// The very first thing a fresh game shows: a screen-fixed hand icon ("tutorial_hand_2") looping
// in a circle, above a short text prompt, teaching "you can move the character" before anything
// else happens. Only shows while the player is standing in zone 0 AND hasn't yet activated
// "walkTutorialTrigger" — the SAME trigger id ZoneTutorialTypes.ts's zone-0 seed data uses for
// its own single tutorial step. Once TriggerStorage marks that id activated (the player actually
// walked into the placed trigger volume — a Trigger entity elsewhere calls
// TriggerStorage.activate() itself, this file never does), this fades out and tears itself down
// permanently — TriggerStorage's own persistence (see that file's own doc) is what keeps it from
// ever coming back on a later session; no separate "has the player seen this" flag needed.
//
// IMPORTANT: this file must NEVER call TriggerStorage.activate(GATING_TRIGGER_ID) itself — that
// same id is a real MilestoneRequirement elsewhere (zone 0's own "unlock zone 1" requirement,
// see ZoneTutorialTypes.ts/ZoneTypes.ts), so activating it from here would unlock the next zone
// just from the player moving around, without them ever having reached the actual placed
// trigger. (This bug happened once already — see update()'s own doc on the movement check for
// what it's allowed to do instead: dismiss THIS OVERLAY early as a courtesy once the lesson is
// obviously learned, entirely independent of, and with zero effect on, real zone progression.)
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
import { TextStyleRegistry } from '../ui/TextStyleRegistry';
import AutoFitFrame, { uniformFitPadding } from '../ui/AutoFitFrame';
import { Localization } from '../i18n/Localization';

/** The one trigger id that both advances zone 0's own ZoneTutorialConfig step (see ZoneTutorialTypes.ts) AND retires this overlay for good — the same "walk through it" action teaches two things at once. */
const GATING_TRIGGER_ID = 'walkTutorialTrigger';
/** Only zone 0 ever shows this — the very first movement lesson a fresh game gets. */
const GATING_ZONE_NUMBER = 0;

/** Radius of the hand's looping circle, in screen pixels. */
const CIRCLE_RADIUS = 55;
/** Seconds for the hand to complete one full lap of the circle — quick enough to read as "keep moving," not a slow decorative loop. */
const HAND_LOOP_SEC = 1.8;
/** How far above the bottom-center anchor point (see update()) the circle's own center sits. */
const HAND_CENTER_Y_OFFSET = -220;
/** How far above the bottom-center anchor point the prompt text sits — BELOW the hand (see HAND_CENTER_Y_OFFSET), same "animation above, explanation below" layout the player feedback asked for. */
const PROMPT_Y_OFFSET = -80;
/**
 * Movement is actually different per platform — mobile has no keyboard and moves by dragging
 * anywhere on screen (see AnalogInput.ts), desktop can do the same drag OR WASD/arrow keys (see
 * PlayerMovementController.ts's own awake()) — so the prompt has to say the right thing for
 * whichever one the player is actually on, same `PIXI.isMobile.any` check + separate locale
 * string per platform that MovementHint.ts (a DOM tutorial hint elsewhere) already uses; see
 * this project's i18n/locales/en.json for both strings (movementTutorialHint{Touch,Mouse}) and
 * Localization.ts's own doc for why a one-shot getString() is right here rather than bindLabel()
 * (that's DOM-element-only; this is a PIXI.Text).
 */
function resolvePromptText(): string {
    return Localization.getString(PIXI.isMobile.any ? 'movementTutorialHintTouch' : 'movementTutorialHintMouse');
}

/** Padding between the prompt text's own bounds and its background frame's edge — see PROMPT_FRAME_TINT/PROMPT_FRAME_ALPHA below for the rest of the look. */
const PROMPT_FRAME_PADDING = uniformFitPadding(14);
/** Plain black backdrop, not the frame texture's own color — see FrameComponent.setTint()'s own doc for why this needs the plane tinted directly rather than a Container-level property. */
const PROMPT_FRAME_TINT = 0x000000;
const PROMPT_FRAME_ALPHA = 0.35;
const HAND_SIZE = 64;
/**
 * Total world-space distance (x/z, ground plane) the player needs to have walked while this
 * overlay has been showing before the lesson counts as learned on its own, independent of the
 * placed trigger volume (see this file's own top-of-file doc on the two completion paths) — a
 * hand-tuned "clearly moved with intent" distance, not derived from anything else. Revisit by
 * feel if playtesting says it fires too early/late.
 */
const MOVE_DISTANCE_TO_COMPLETE = 6;
/** Seconds the background frame takes to fade to fully transparent once a completion path fires, before actually tearing everything down — an instant pop-out read as jarring; see beginFadeOut(). Only the frame animates (see update()'s own doc); the hand/prompt stay fully visible until teardown. */
const FADE_OUT_SEC = 0.5;

/** A point on the hand's looping circle at parameter `t` (radians) — trivial, but keeping it as its own function mirrors the previous figure-8 path's shape and gives update() one clear call site if the loop shape ever changes again. */
function circlePoint(t: number, out: PIXI.Point): PIXI.Point {
    return out.set(Math.cos(t) * CIRCLE_RADIUS, Math.sin(t) * CIRCLE_RADIUS);
}

export default class MovementTutorialOverlay {
    private readonly container: PIXI.Container;
    private readonly hand: PIXI.Sprite;
    private readonly prompt: PIXI.Text;
    private readonly promptFrame: AutoFitFrame;
    private readonly getPlayerPosition: () => THREE.Vector3;
    private readonly zoneVisibility: ZoneVisibilityManager;

    private elapsedSec = 0;
    private destroyed = false;
    /** Scratch — avoids allocating a new PIXI.Point every frame in update(). */
    private readonly scratchPoint = new PIXI.Point();

    /** True once beginFadeOut() has been called (either from the real trigger activating, or trackMovement()'s own courtesy dismissal — see that method's own doc) — update() spends this time fading ONLY the background frame out (see update()'s own doc on why the hand/text don't fade with it) instead of animating the hand, then calls the real teardown. */
    private fading = false;
    private fadeElapsedSec = 0;

    /** Cumulative x/z distance walked while this overlay has been visible — see MOVE_DISTANCE_TO_COMPLETE's own doc. Reset (via lastPlayerPosition below going undefined) any time the overlay isn't currently showing, so a teleport-like jump across a zone re-entry is never counted as "movement." */
    private distanceMovedWhileVisible = 0;
    private lastPlayerPosition?: THREE.Vector3;

    /** The ONLY thing that's allowed to mean "the real lesson — reaching the placed trigger volume — is done": starts the fade-out, same as trackMovement()'s own courtesy dismissal does, but this is the one call site actually tied to TriggerStorage (i.e. to real zone progression). */
    private readonly handleTriggerActivate = (id: string): void => {
        if (id === GATING_TRIGGER_ID) {
            this.beginFadeOut();
        }
    };

    /** Re-resolves the prompt text and re-fits its frame around the new size — see Localization.bindLabel()'s own doc for why a live-bound piece of text needs this; `prompt` is a PIXI.Text, not an HTMLElement, so it can't use bindLabel() itself and has to redo that in miniature here. */
    private readonly handleLocaleChange = (): void => {
        this.prompt.text = resolvePromptText();
        this.promptFrame.fit();
    };

    public constructor(game: Game, getPlayerPosition: () => THREE.Vector3, zoneVisibility: ZoneVisibilityManager) {
        this.getPlayerPosition = getPlayerPosition;
        this.zoneVisibility = zoneVisibility;

        this.container = new PIXI.Container();
        this.container.visible = false;

        this.hand = new PIXI.Sprite(PIXI.Texture.from('tutorial_hand_2'));
        // (0.1, 0.1), not centered — tutorial_hand_2's own art has its fingertip near the
        // sprite's top-left corner, not its middle; anchoring there is what puts the fingertip
        // (not the sprite's bounding-box center) right on the drawn circle.
        this.hand.anchor.set(0.1, 0.1);
        this.hand.width = HAND_SIZE;
        this.hand.height = HAND_SIZE;
        this.hand.position.y = HAND_CENTER_Y_OFFSET;
        this.container.addChild(this.hand);

        // Below the hand's own circle (see HAND_CENTER_Y_OFFSET/PROMPT_Y_OFFSET) — the looping
        // animation reads first, the explanation sits right under it. The text stays centered on
        // its OWN local origin (no y offset here) — AutoFitFrame sizes/centers the frame around
        // whatever local bounds `prompt` already has, so the y offset instead goes on the
        // wrapping frame itself, just below.
        this.prompt = new PIXI.Text(resolvePromptText(), { ...TextStyleRegistry.Info, align: 'center' } as PIXI.TextStyle);
        this.prompt.anchor.set(0.5, 0.5);

        this.promptFrame = new AutoFitFrame(PROMPT_FRAME_PADDING, 'PromptBg', this.prompt);
        this.promptFrame.setTint(PROMPT_FRAME_TINT);
        this.promptFrame.setAlpha(PROMPT_FRAME_ALPHA);
        this.promptFrame.position.y = PROMPT_Y_OFFSET;
        this.container.addChild(this.promptFrame);

        game.uiLayer.addChild(this.container);

        if (TriggerStorage.isActivated(GATING_TRIGGER_ID)) {
            // Already done in an earlier session — never show at all, not even for one frame.
            this.destroy();
            return;
        }
        TriggerStorage.onActivate.add(this.handleTriggerActivate);
        // Unlikely mid-tutorial (this overlay only lives seconds), but cheap to keep correct —
        // same reasoning Localization.bindLabel() gives for every other live UI label.
        Localization.onLocaleChange.add(this.handleLocaleChange);
    }

    /** Call once per render frame (see PizzaScene.update()) — re-checks the zone/trigger gate every call (cheap: one Map lookup) so the overlay appears/disappears the instant the player crosses in/out of zone 0, not just once at construction. No-op once destroy()'d. */
    public update(delta: number): void {
        if (this.destroyed) {
            return;
        }

        if (this.fading) {
            this.fadeElapsedSec += delta;
            // Only the background frame fades — the hand/prompt stay at full opacity right up
            // until teardown, so the readable content never visibly washes out, just the
            // decorative backing panel dissolving under it.
            const fadeFactor = Math.max(0, 1 - this.fadeElapsedSec / FADE_OUT_SEC);
            this.promptFrame.setAlpha(PROMPT_FRAME_ALPHA * fadeFactor);
            if (this.fadeElapsedSec >= FADE_OUT_SEC) {
                this.destroy();
            }
            return;
        }

        const visible = this.isInGatingZone();
        this.container.visible = visible;
        if (!visible) {
            // Not currently showing — don't let a re-entry elsewhere on the map read as a big
            // "movement" jump the instant this comes back on screen.
            this.lastPlayerPosition = undefined;
            return;
        }

        const screen = Game.overlayScreenData;
        if (screen) {
            this.container.position.set(screen.center.x, screen.bottomLeft.y);
        }

        this.elapsedSec += delta;
        const t = (this.elapsedSec / HAND_LOOP_SEC) * Math.PI * 2;
        circlePoint(t, this.scratchPoint);
        this.hand.position.set(this.scratchPoint.x, HAND_CENTER_Y_OFFSET + this.scratchPoint.y);

        this.trackMovement();
    }

    /**
     * The bespoke "did the player actually move" check this specific tutorial gets (see this
     * file's own top-of-file doc on why this doesn't live in the generic per-zone step system) —
     * accumulates real ground-plane distance walked while this overlay has been visible, and
     * dismisses THIS OVERLAY on its own once MOVE_DISTANCE_TO_COMPLETE is reached, as a courtesy
     * once the lesson is obviously already learned.
     *
     * Deliberately does NOT call TriggerStorage.activate(GATING_TRIGGER_ID) — that would also
     * unlock zone 1 (a real MilestoneRequirement elsewhere is keyed off that same trigger id)
     * just from moving around, without the player ever having reached the actual placed trigger
     * volume. Zone progression stays gated purely on the real trigger; this only ever affects
     * whether THIS hand/prompt is still on screen.
     */
    private trackMovement(): void {
        const position = this.getPlayerPosition();
        if (this.lastPlayerPosition) {
            const dx = position.x - this.lastPlayerPosition.x;
            const dz = position.z - this.lastPlayerPosition.z;
            this.distanceMovedWhileVisible += Math.hypot(dx, dz);
        }
        this.lastPlayerPosition = (this.lastPlayerPosition ?? new THREE.Vector3()).copy(position);

        if (this.distanceMovedWhileVisible >= MOVE_DISTANCE_TO_COMPLETE) {
            this.beginFadeOut();
        }
    }

    private isInGatingZone(): boolean {
        const position = this.getPlayerPosition();
        return this.zoneVisibility.getZoneForPosition(position.x, position.z) === GATING_ZONE_NUMBER;
    }

    /** Starts the fade-out (see FADE_OUT_SEC) rather than tearing down instantly — an abrupt pop-out read as jarring during playtesting feedback. No-op if already fading/destroyed. */
    private beginFadeOut(): void {
        if (this.fading || this.destroyed) {
            return;
        }
        this.fading = true;
        this.fadeElapsedSec = 0;
    }

    /** Tears this down for good — called once the fade-out above finishes, or directly from PizzaScene's own teardown (skipping the fade entirely, since the scene itself is going away). Safe to call more than once. */
    public destroy(): void {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        TriggerStorage.onActivate.remove(this.handleTriggerActivate);
        Localization.onLocaleChange.remove(this.handleLocaleChange);
        this.container.destroy({ children: true });
    }
}
