// LevelBadgeStyle.ts
//
// Which Label_Badge01_* texture represents a given 1-indexed tool/upgrade
// level — same "registry of reusable named presets" shape as UpgradeStyle.ts
// (that file's own badge lookup, just keyed by tier number instead of
// NotificationRarity). Five tiers, gray -> green -> purple -> red -> yellow,
// climbing in the exact same rarity order UpgradeStyle.BADGE_TEXTURE already
// uses for Common -> Legendary — reused here so "yellow reads as the best
// tier" stays consistent everywhere a badge shows up, not just notifications.
// Any level past 5 clamps to the yellow (top) tier rather than erroring —
// there's no 6th asset, and "still the best tier" is the correct reading for
// an even-higher level anyway.

const BADGE_TEXTURE_BY_TIER: readonly string[] = [
    'Label_Badge01_Gey', // tier 1 — filename typo in the source asset itself, not here.
    'Label_Badge01_Green',
    'Label_Badge01_Purple',
    'Label_Badge01_Red',
    'Label_Badge01_Yellow',
];

export class LevelBadgeStyle {
    /** Texture alias inside the packed 'images' bundle for a 1-indexed `level`'s badge — clamped into [1, 5] (see this file's own doc). */
    public static badgeTextureForLevel(level: number): string {
        const tier = Math.min(Math.max(Math.round(level), 1), BADGE_TEXTURE_BY_TIER.length);
        return BADGE_TEXTURE_BY_TIER[tier - 1];
    }
}
