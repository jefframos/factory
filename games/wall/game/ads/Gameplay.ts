// Gameplay.ts
//
// What the platform's told about play: gameplayStart() on the player's first click, gameplayStop() while something's open over
// the wall or an ad's on, gameplayStart() again once nothing is. Each is sent once per change. And the ads: a commercial break
// (the platform decides if one's shown) and a rewarded video; the world holds still and quiet for them.

import PlatformHandler from 'core/platforms/PlatformHandler';
import { WallAudio } from '../audio/WallAudio';

type Block = 'wardrobe' | 'rewind' | 'ad';

const blocks = new Set<Block>();
let begun = false;
let active = false;
/** Ads on now. */
let ads = 0;

function refresh(): void {
    const on = begun && blocks.size === 0;
    if (on === active) return;
    active = on;
    PlatformHandler.instance.isGameplayActive = on;
    const { platform } = PlatformHandler.instance;
    void (on ? platform.gameplayStart() : platform.gameplayStop());
}

async function ad<T>(show: () => Promise<T>, failed: T): Promise<T> {
    ads++;
    blocks.add('ad');
    refresh();
    WallAudio.hush(true);
    try {
        return await show();
    } catch (error) {
        console.warn('[Gameplay] an ad failed', error);
        return failed;
    } finally {
        ads--;
        if (ads === 0) {
            blocks.delete('ad');
            WallAudio.hush(false);
            refresh();
        }
    }
}

export const Gameplay = {
    /** Told to the platform as on. */
    get active(): boolean {
        return active;
    },
    /** An ad's on: the world waits. */
    get paused(): boolean {
        return ads > 0;
    },

    /** The player's first click (or key). */
    begin(): void {
        begun = true;
        refresh();
    },

    /** Something's open over the wall, or not any more. */
    setBlocked(what: Block, on: boolean): void {
        if (on) blocks.add(what);
        else blocks.delete(what);
        refresh();
    },

    /** A natural break: an ad, if the platform thinks so. */
    async commercialBreak(): Promise<void> {
        if (ads > 0) return;
        await ad(() => PlatformHandler.instance.platform.showCommercialBreak(), undefined);
    },

    /** A rewarded video; whether it was watched. (Without video ads, a local build, it counts as watched.) */
    async watchVideo(): Promise<boolean> {
        if (!PlatformHandler.ENABLE_VIDEO_ADS) return true;
        if (ads > 0) return false;
        return ad(async () => (await PlatformHandler.instance.platform.showRewardedVideo()) !== false, false);
    },
};
