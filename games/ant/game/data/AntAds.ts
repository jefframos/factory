// AntAds.ts
//
// The ads: a commercial break between levels (after each one: the platform — Poki — decides how often one really
// plays) and a rewarded video for a power-up the player has none of (the belt's VIDEO badge). Gameplay's off while one
// plays; the platform mutes the sound round it itself (SoundManager.muteAllSounds / restoreSound, in PokiPlatform and
// YouTubePlayablePlatform: AntAudio plays through SoundManager). A failing or missing ad never stops the game.

import PlatformHandler from 'core/platforms/PlatformHandler';
import { AntEvents } from './AntEvents';

export const AntAds = {
    /** Between levels (the screen covered): a commercial break, if the platform has one to show. */
    async between(): Promise<void> {
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
