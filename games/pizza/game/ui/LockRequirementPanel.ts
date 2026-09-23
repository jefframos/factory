// LockRequirementPanel.ts
//
// The "locked — here's what it takes" panel Gate.ts introduced, pulled out so
// any other locked thing (FarmZone's for-sale plot, ...) shows the EXACT same
// look instead of a near-copy: a padlock beside the requirement's own icon,
// an exclamation badge overlapping that icon's bottom-right corner while still
// missing, and an optional small text on its bottom-left corner (a "LvN" for a
// building level, a live "have/need" count for a deposit/price).
//
//   const panel = buildLockRequirementPanel(icon, { cornerText: '0/50' });
//   screenAnchor(panel.frame);
//   panel.setCornerText('10/50'); // keeps the frame fitted
//
// Returned pieces (lockIcon/badge) are exposed so an owner can play its own
// unlock beat on them — see Gate.playUnlockIconSequence(), which swaps them
// to LOCK_ICON_UNLOCKED/REQUIREMENT_BADGE_MET.

import * as PIXI from 'pixi.js';
import ViewUtils from 'core/utils/ViewUtils';
import AutoFitFrame, { uniformFitPadding } from './AutoFitFrame';
import { TextStyleRegistry } from './TextStyleRegistry';
import { FrameName } from './FrameRegistry';

const LABEL_FRAME_PADDING = uniformFitPadding(18);

export const LOCK_ICON_SIZE = 40;
const REQUIREMENT_ICON_SIZE = 40;
/** Gap between the lock icon and the requirement icon sitting beside it. */
const ICON_GAP = 10;
/** Size of the exclamation/check badge overlapping the requirement icon's bottom-right corner. */
export const REQUIREMENT_BADGE_SIZE = 18;
const REQUIREMENT_BADGE_INSET = -2;

/** Locked padlock. */
export const LOCK_ICON_LOCKED = 'Icon_Lock03';
/** Swap target once whatever this panel guards actually unlocks. */
export const LOCK_ICON_UNLOCKED = 'Icon_Lock02';
/** Badge shown on the requirement icon while the player doesn't have it yet. */
export const REQUIREMENT_BADGE_MISSING = 'Icon_Exclamation';
/** Swap target once the requirement is met. */
export const REQUIREMENT_BADGE_MET = 'Icon_Check03_s';

export interface LockRequirementPanelOptions {
    /** Small text on the requirement icon's bottom-left corner — omit for an icon-only panel. */
    cornerText?: string;
    /** FrameRegistry preset behind everything — defaults to the gate's own 'GateLock'. */
    frame?: FrameName;
    /** The "missing" exclamation badge on the requirement icon — default true. Turn off where the icon means "this goes here", not "you don't have this yet" (e.g. StorageZone's accepted-resource panel). */
    showBadge?: boolean;
}

export interface LockRequirementPanel {
    frame: AutoFitFrame;
    lockIcon: PIXI.Sprite;
    badge: PIXI.Sprite;
    /** undefined when no `cornerText` was passed at build time. */
    cornerLabel?: PIXI.Text;
    /** Rewrites cornerLabel (no-op without one) and re-fits the frame around the new bounds. */
    setCornerText(text: string): void;
}

export function buildLockRequirementPanel(requirementIcon: PIXI.Texture, options: LockRequirementPanelOptions = {}): LockRequirementPanel {
    const row = new PIXI.Container();

    const lockIcon = new PIXI.Sprite(PIXI.Texture.from(LOCK_ICON_LOCKED));
    lockIcon.anchor.set(0.5, 1);
    lockIcon.scale.set(ViewUtils.elementScaler(lockIcon, LOCK_ICON_SIZE));
    lockIcon.position.set(-(REQUIREMENT_ICON_SIZE / 2 + ICON_GAP / 2), 0);
    row.addChild(lockIcon);

    const requirementIconX = LOCK_ICON_SIZE / 2 + ICON_GAP / 2;
    const icon = new PIXI.Sprite(requirementIcon);
    icon.anchor.set(0.5, 1);
    icon.scale.set(ViewUtils.elementScaler(icon, REQUIREMENT_ICON_SIZE));
    icon.position.set(requirementIconX, 0);
    row.addChild(icon);

    const badge = new PIXI.Sprite(PIXI.Texture.from(REQUIREMENT_BADGE_MISSING));
    badge.anchor.set(1, 1);
    badge.scale.set(ViewUtils.elementScaler(badge, REQUIREMENT_BADGE_SIZE));
    badge.position.set(requirementIconX + REQUIREMENT_ICON_SIZE / 2 - REQUIREMENT_BADGE_INSET, -REQUIREMENT_BADGE_INSET);
    badge.visible = options.showBadge ?? true;
    row.addChild(badge);

    let cornerLabel: PIXI.Text | undefined;
    if (options.cornerText !== undefined) {
        cornerLabel = new PIXI.Text(options.cornerText, TextStyleRegistry.Body);
        cornerLabel.anchor.set(0, 1);
        cornerLabel.position.set(requirementIconX - REQUIREMENT_ICON_SIZE / 2 + REQUIREMENT_BADGE_INSET, -REQUIREMENT_BADGE_INSET);
        row.addChild(cornerLabel);
    }

    const frame = new AutoFitFrame(LABEL_FRAME_PADDING, options.frame ?? 'GateLock', row);

    return {
        frame,
        lockIcon,
        badge,
        cornerLabel,
        setCornerText(text: string): void {
            if (!cornerLabel) {
                return;
            }
            cornerLabel.text = text;
            frame.fit();
        },
    };
}
