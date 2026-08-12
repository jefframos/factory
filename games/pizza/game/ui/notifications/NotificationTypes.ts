// NotificationTypes.ts
//
// The two independent axes UpgradeStyle.ts (see that file's own doc) maps to
// actual textures: WHAT KIND of event this is (NotificationType — picks the
// ribbon) and HOW RARE the upgrade is (NotificationRarity — picks the
// badge). Kept as their own file, separate from UpgradeStyle's lookup
// tables, so UpgradeNotificationView/call sites (ShopZone.ts, ...) can
// import just the enums without pulling in the texture-id registry too.

export enum NotificationType {
    /** A tool upgrade (axe, pickaxe, ...) — see ShopZone.ts. */
    Upgrade = 'upgrade',
    /** A gate/world-expansion unlock — see Gate.ts (call site not wired up yet). */
    Unlockable = 'unlockable',
    /** A building leveling up — see BuildingZone.ts (call site not wired up yet). */
    BuildingUpgrade = 'buildingUpgrade',
}

export enum NotificationRarity {
    Common = 'common',
    Rare = 'rare',
    Epic = 'epic',
    Legendary = 'legendary',
}
