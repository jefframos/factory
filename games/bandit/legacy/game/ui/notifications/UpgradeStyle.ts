// UpgradeStyle.ts
//
// Which ribbon texture a NotificationType uses, and which badge texture a
// NotificationRarity uses — same "registry of reusable named presets" shape
// as FrameRegistry.ts, just split into two independent lookups since WHAT
// KIND of event this is (ribbon) and HOW RARE the upgrade is (badge) don't
// depend on each other. Every ribbon variant shares the exact same size/
// padding (see UpgradeNotificationView.ts's RIBBON_NATURAL_SIZE/
// RIBBON_PADDING_X) — only which color art gets used changes here, so
// nothing about layout ever needs to touch this file.
//
// Ribbon ids below: Upgrade -> Title_Ribbon01_Blue is the one actually
// requested/used so far (see ShopZone.ts). Unlockable/BuildingUpgrade are
// PLACEHOLDERS (Green/Purple, picked from whatever's already in the 'ui'
// atlas — see public/pizza/images/ui.webp.json) pending real ids — swap the
// values here once those are provided; nothing else needs to change.
//
// Badge ids are all four real, already-confirmed atlas entries — no
// placeholders on that side.

import { NotificationRarity, NotificationType } from './NotificationTypes';

export class UpgradeStyle {
    private static readonly RIBBON_TEXTURE: Record<NotificationType, string> = {
        [NotificationType.Upgrade]: 'Title_Ribbon01_Blue',
        [NotificationType.Unlockable]: 'Title_Ribbon01_Green',
        [NotificationType.BuildingUpgrade]: 'Title_Ribbon01_Purple',
        [NotificationType.NewTool]: 'Title_Ribbon01_Red',
    };

    private static readonly BADGE_TEXTURE: Record<NotificationRarity, string> = {
        [NotificationRarity.Common]: 'Label_Badge01_Green',
        [NotificationRarity.Rare]: 'Label_Badge01_Purple',
        [NotificationRarity.Epic]: 'Label_Badge01_Red',
        [NotificationRarity.Legendary]: 'Label_Badge01_Yellow',
    };

    /** Texture alias inside the packed 'images' bundle (see FrameRegistry.textureKey's own doc) for `type`'s ribbon. */
    public static ribbonTextureFor(type: NotificationType): string {
        return this.RIBBON_TEXTURE[type];
    }

    /** Texture alias inside the packed 'images' bundle for `rarity`'s badge. */
    public static badgeTextureFor(rarity: NotificationRarity): string {
        return this.BADGE_TEXTURE[rarity];
    }
}
