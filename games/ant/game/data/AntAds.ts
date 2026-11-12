// AntAds.ts
//
// The ads: a commercial break between levels — none till the player's won ADS.from levels, then one every ADS.every level
// starts (NEXT, a retry, PLAY on the main screen alike: a retry doesn't bring one sooner; the platform may still skip
// one) — and a rewarded video for a power-up the player has none of (the belt's VIDEO badge). Gameplay's off while one
// plays; the platform mutes the sound round it itself (SoundManager.muteAllSounds / restoreSound, in PokiPlatform and
// YouTubePlayablePlatform: AntAudio plays through SoundManager). A failing or missing ad never stops the game.

import PlatformHandler from 'core/platforms/PlatformHandler';
import { AntEvents } from './AntEvents';
import { AntSave } from './AntSave';

/** Breaks: from when the player's won this many levels (AntSave.level: the furthest reached), then every this many
 *  level starts. */
const ADS = { from: 4, every: 2 };
/** Level starts since the last break (this session); the first once they're due comes at once. */
let sinceBreak = ADS.every;

export const AntAds = {
    /** A level starting (the screen covered): a commercial break when it's due (ADS), if the platform has one. */
    async between(): Promise<void> {
        if (AntSave.level < ADS.from) return;
        sinceBreak++;
        if (sinceBreak < ADS.every) return;
        sinceBreak = 0;
        AntEvents.playing(false);
        try {
            await PlatformHandler.instance.platform?.showCommercialBreak();
        } catch {
            // No ad: on we go.
        }
    },

    /** A rewarded video (`reward`: what it's for, for the platform); true if it was watched through. */
    async rewarded(reward: string): Promise<boolean> {
        AntEvents.playing(false);
        try {
            return (await PlatformHandler.instance.platform?.showRewardedVideo(reward)) === true;
        } catch {
            return false;
        }
    },
};
