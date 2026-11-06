// AntAds.ts
//
// The ads: a commercial break between levels (after each one: the platform — Poki — decides how often one really
// plays) and a rewarded video for a power-up the player has none of (the belt's VIDEO badge). Gameplay's off and every
// sound silent while one plays; a failing or missing ad never stops the game.

import PlatformHandler from 'core/platforms/PlatformHandler';
import { AntAudio } from '../audio/AntAudio';
import { AntEvents } from './AntEvents';

export const AntAds = {
    /** Between levels (the screen covered): a commercial break, if the platform has one to show. */
    async between(): Promise<void> {
        AntEvents.playing(false);
        AntAudio.silence(true);
        try {
            await PlatformHandler.instance.platform?.showCommercialBreak();
        } catch {
            // No ad: on we go.
        } finally {
            AntAudio.silence(false);
        }
    },

    /** A rewarded video (`reward`: what it's for, for the platform); true if it was watched through. */
    async rewarded(reward: string): Promise<boolean> {
        AntEvents.playing(false);
        AntAudio.silence(true);
        try {
            return (await PlatformHandler.instance.platform?.showRewardedVideo(reward)) === true;
        } catch {
            return false;
        } finally {
            AntAudio.silence(false);
        }
    },
};
