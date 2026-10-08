// AlertIcon.ts
//
// A small bobbing "something needs you" icon — shared by the store's player prompts:
//   - 'exclamation': attention needed here (a client waiting to pay — on its bubble and over
//     the cashier counter, see StoreBubble.ts / StoreCashier.ts);
//   - 'question': a client can't find what it wants (its shelf is empty — StoreBubble.ts);
//   - 'trash': garbage on the floor the player should pick up (StoreGarbage.ts).
// The exclamation and trash are UI atlas icons; there's no question-mark icon, so that one is a
// drawn badge (yellow disc, outlined "?") sized to match.
//
// Returns a container whose CHILD bobs, so it can be handed to a ScreenAnchorComponent (which
// rewrites the container's own position/scale every frame). Call destroyAlertIcon() to stop the
// tween before destroying it.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { TextStyleRegistry } from './TextStyleRegistry';

export type AlertIconKind = 'exclamation' | 'question' | 'trash';

const EXCLAMATION_TEXTURE = 'Icon_Exclamation';
const TRASH_TEXTURE = 'trash-small';
const BOB_HEIGHT = 8;
const BOB_SEC = 0.45;
const QUESTION_FILL = 0xffc93c;
const QUESTION_OUTLINE = 0x1d1b1a;

function createQuestionBadge(size: number): PIXI.Container {
    const badge = new PIXI.Container();
    const disc = new PIXI.Graphics();
    disc.lineStyle(Math.max(2, size * 0.08), QUESTION_OUTLINE, 1);
    disc.beginFill(QUESTION_FILL);
    disc.drawCircle(0, 0, size / 2);
    disc.endFill();
    const mark = new PIXI.Text('?', { ...TextStyleRegistry.Title, fontSize: Math.round(size * 0.72) });
    mark.anchor.set(0.5, 0.52);
    badge.addChild(disc, mark);
    return badge;
}

/** A `size`-pixel `kind` icon, centered on (0, 0), bobbing up and down. */
export function createAlertIcon(kind: AlertIconKind, size = 44): PIXI.Container {
    const root = new PIXI.Container();
    let icon: PIXI.Container;
    if (kind === 'question') {
        icon = createQuestionBadge(size);
    } else {
        const sprite = new PIXI.Sprite(PIXI.Texture.from(kind === 'trash' ? TRASH_TEXTURE : EXCLAMATION_TEXTURE));
        sprite.anchor.set(0.5);
        // Fits inside a size x size box, keeping the texture's own aspect ratio (the '!' is tall and narrow).
        const fit = (): void => {
            const { width, height } = sprite.texture;
            sprite.scale.set(size / Math.max(1, width, height));
        };
        fit();
        // A texture that isn't loaded yet reports 1x1 — refit once it is.
        if (!sprite.texture.baseTexture.valid) {
            sprite.texture.baseTexture.once('loaded', fit);
        }
        icon = sprite;
    }
    root.addChild(icon);
    gsap.to(icon, { y: -BOB_HEIGHT, duration: BOB_SEC, ease: 'sine.inOut', yoyo: true, repeat: -1 });
    return root;
}

/** Stops the bob tween (the caller still destroys the container, or its owner does). */
export function destroyAlertIcon(root: PIXI.Container): void {
    root.children.forEach(child => gsap.killTweensOf(child));
}
