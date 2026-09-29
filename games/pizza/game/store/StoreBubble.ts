// StoreBubble.ts
//
// The popup floating over a store client's head: while shopping, one slot
// per item it still wants (icon + how many); while heading to / waiting at
// the cashier, the money icon + what it's about to pay. The item a client is
// currently stuck waiting on (its storage is empty) pulses so it's obvious
// what needs refilling. Every row starts with the client's mood face
// (STORE_MOOD_ICON); walking out, the bubble shows just that face. Same slot visual and frame as QueueZone's task panel
// (createResourceSlot + AutoFitFrame), rebuilt only when what it shows
// actually changes.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import AutoFitFrame, { uniformFitPadding } from '../ui/AutoFitFrame';
import { createResourceSlot } from '../ui/ResourceSlotVisual';
import { getIconLayout } from '../ui/LayoutRegistry';
import { TextStyleRegistry } from '../ui/TextStyleRegistry';
import { getAssetIcon } from '../world/AssetLibraryRegistry';
import { CURRENCY_CONFIG, CurrencyType } from '../data/EconomyTypes';
import { ResourceType } from '../actions/ResourceTypes';
import { STORE_MOOD_ICON, StoreClientMood } from './StoreTypes';

/** Whole bubble (frame, faces, slots, money) drawn at this fraction of its natural size. */
const BUBBLE_SCALE = 0.55;
const FRAME_PADDING = uniformFitPadding(12);
const SLOT_LAYOUT = getIconLayout('Requirement');
const MONEY_ICON_SIZE = 28;
const MONEY_TEXT_GAP = 6;
const PULSE_ALPHA = 0.35;
const PULSE_SEC = 0.45;
const MOOD_ICON_SIZE = SLOT_LAYOUT.slotSize;
const MOOD_GAP = SLOT_LAYOUT.gapToNeighbor;

/** The client's mood face (STORE_MOOD_ICON), sized to one resource slot. */
function createMoodFace(mood: StoreClientMood): PIXI.Sprite {
    const face = new PIXI.Sprite(PIXI.Texture.from(STORE_MOOD_ICON[mood]));
    face.width = MOOD_ICON_SIZE;
    face.height = MOOD_ICON_SIZE;
    return face;
}

export interface StoreBubbleWant {
    type: ResourceType;
    remaining: number;
}

export type StoreBubbleContent =
    | { kind: 'hidden' }
    | { kind: 'mood'; mood: StoreClientMood }
    | { kind: 'wants'; mood: StoreClientMood; wants: StoreBubbleWant[]; waitingFor?: ResourceType }
    | { kind: 'pay'; mood: StoreClientMood; amount: number };

export default class StoreBubble {
    /** Hand this to a ScreenAnchorComponent — see QueueZone.awake()'s own doc on why the frame sits inside a wrapper. */
    public readonly content = new PIXI.Container();
    private readonly body = new PIXI.Container();
    private readonly frame: AutoFitFrame;
    private currentKey = '';

    public constructor() {
        this.frame = new AutoFitFrame(FRAME_PADDING, 'QueueFrame', this.body);
        // On the frame, not `content` — ScreenAnchorComponent rewrites content.scale every frame for its distance scaling.
        this.frame.scale.set(BUBBLE_SCALE);
        this.content.addChild(this.frame);
        this.frame.visible = false;
    }

    public show(content: StoreBubbleContent): void {
        const key = JSON.stringify(content);
        if (key === this.currentKey) {
            return;
        }
        this.currentKey = key;

        this.body.removeChildren().forEach(child => {
            gsap.killTweensOf(child);
            child.destroy({ children: true });
        });

        if (content.kind === 'hidden') {
            this.frame.visible = false;
            return;
        }

        if (content.kind === 'wants') {
            this.buildWants(content.mood, content.wants, content.waitingFor);
        } else if (content.kind === 'pay') {
            this.buildPay(content.mood, content.amount);
        } else {
            const face = createMoodFace(content.mood);
            face.anchor.set(0.5, 1);
            this.body.addChild(face);
        }
        this.frame.visible = true;
        this.frame.fit();
    }

    /** Only stops the pulse tweens — `content` itself is destroyed by the ScreenAnchorComponent it was handed to. */
    public destroy(): void {
        this.body.children.forEach(child => gsap.killTweensOf(child));
    }

    /** Mood face, then the items — one centered row, bottom edge at y=0, same layout as QueueZone.refreshLabel()'s requirements row. */
    private buildWants(mood: StoreClientMood, wants: StoreBubbleWant[], waitingFor?: ResourceType): void {
        const size = SLOT_LAYOUT.slotSize;
        const gap = SLOT_LAYOUT.gapToNeighbor;
        const rowWidth = MOOD_ICON_SIZE + MOOD_GAP + wants.length * size + Math.max(0, wants.length - 1) * gap;
        const slotsX = -rowWidth / 2 + MOOD_ICON_SIZE + MOOD_GAP;
        let slotHeight = size;
        wants.forEach((want, index) => {
            const slot = createResourceSlot(want.type, size, `${want.remaining}`);
            slotHeight = slot.visualHeight;
            slot.container.position.set(slotsX + index * (size + gap), -slot.visualHeight);
            this.body.addChild(slot.container);
            if (want.type === waitingFor) {
                gsap.to(slot.container, { alpha: PULSE_ALPHA, duration: PULSE_SEC, yoyo: true, repeat: -1, ease: 'sine.inOut' });
            }
        });

        const face = createMoodFace(mood);
        face.anchor.set(0, 0.5);
        face.position.set(-rowWidth / 2, -slotHeight / 2);
        this.body.addChild(face);
    }

    private buildPay(mood: StoreClientMood, amount: number): void {
        const row = new PIXI.Container();
        const face = createMoodFace(mood);
        face.anchor.set(0, 0.5);
        row.addChild(face);
        const moneyX = MOOD_ICON_SIZE + MOOD_GAP;
        const icon = new PIXI.Sprite(getAssetIcon(CURRENCY_CONFIG[CurrencyType.Money].assetKey));
        icon.anchor.set(0, 0.5);
        icon.width = MONEY_ICON_SIZE;
        icon.height = MONEY_ICON_SIZE;
        icon.position.set(moneyX, 0);
        const text = new PIXI.Text(`${amount}`, TextStyleRegistry.Body);
        text.anchor.set(0, 0.5);
        text.position.set(moneyX + MONEY_ICON_SIZE + MONEY_TEXT_GAP, 0);
        row.addChild(icon, text);
        // Children are centered on y=0, so pivoting at +height/2 puts the row's bottom edge at y=0.
        row.pivot.set(row.width / 2, row.height / 2);
        this.body.addChild(row);
    }
}
