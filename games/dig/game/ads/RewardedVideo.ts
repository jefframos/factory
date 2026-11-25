// RewardedVideo.ts
//
// A rewarded video, the same way everywhere (SELL x2, locked chests, special skins): gameplay stops for it (Gameplay),
// the platform plays it, and the answer is whether it was watched. Without video ads (a local build) it counts as
// watched, so the reward can be tried out; a closed or failed video is false (nothing is given).

import PlatformHandler from 'core/platforms/PlatformHandler';
import { Gameplay } from '../data/Gameplay';

export async function watchRewardedVideo(what: string): Promise<boolean> {
    if (!PlatformHandler.ENABLE_VIDEO_ADS) return true;
    try {
        Gameplay.stop();
        return (await PlatformHandler.instance.platform.showRewardedVideo()) !== false;
    } catch (error) {
        console.warn(`[RewardedVideo] ${what} failed`, error);
        return false;
    }
}
