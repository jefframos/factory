// DigAudio.ts
//
// Every sound in the game, by cue (bandit-controller's GameAudio pattern): digging from there-is-rope (stone / metal /
// gem hits — the stone one de-boomed and trimmed with ffmpeg into dig-hit — a short rock crackle on a break, stone / metal / gem pickups landing in the backpack, stone
// footsteps, the build sting, the UI set), wooden hub footsteps from pizza, the celebration set from down (cheers,
// applause, sparkle, whoosh, the reveal sting) and bandit-controller's purchase set (ka-ching, fanfare, shine, star). Files: raw-assets/audio (`npm run audio` packs them).
// Respects mute (SoundManager) and goes quiet while the page or platform is paused.

import { Howler } from 'howler';
import SoundManager, { SoundAsset } from 'core/audio/SoundManager';
import SoundLoadManager from 'core/audio/SoundLoaderManager';
import PlatformHandler from 'core/platforms/PlatformHandler';
import audioManifest from '../../manifests/audio.json';

const five = (name: string) => [1, 2, 3, 4, 5].map((i) => `${name}-${i}`);

const SOUNDS = {
    // digging
    // dig-hit = there-is-rope's stone hit with the low boom cut and the tail trimmed (a crisp tick, not a pound);
    // the pickaxe and up play it higher (sharper), the shovel lower (duller).
    hitPick: { soundId: five('dig-hit'), volumeMinMax: [0.2, 0.26], pitchMinMax: [1.08, 1.22] },
    hitStone: { soundId: five('dig-hit'), volumeMinMax: [0.22, 0.28], pitchMinMax: [0.88, 1.0] },
    // Soft ground (dirt, gravel): a low, gritty crunch instead of the stone tick. Placeholder: the stone footsteps
    // pitched down. To use real dirt-dig sounds, add dig-dirt-1..5 to raw-assets/audio (`npm run audio`) and switch
    // soundId to five('dig-dirt').
    hitDirt: { soundId: five('step-stone'), volumeMinMax: [0.3, 0.36], pitchMinMax: [0.68, 0.8] },
    hitMetal: { soundId: five('hit-metal'), volumeMinMax: [0.22, 0.28], pitchMinMax: [0.94, 1.08] },
    hitGem: { soundId: five('hit-gem'), volumeMinMax: [0.22, 0.28], pitchMinMax: [0.95, 1.1] },
    // Obsidian: volcanic glass — the gem hit and the break pitched well down, a deep glassy crack instead of the
    // rock tick (which, sped up by the drills and the tractor, turned into a harsh rattle).
    hitObsidian: { soundId: five('hit-gem'), volumeMinMax: [0.18, 0.22], pitchMinMax: [0.5, 0.62] },
    breakObsidian: { soundId: ['break-1', 'break-2', 'break-3'], volumeMinMax: [0.32, 0.38], pitchMinMax: [0.62, 0.72] },
    break: { soundId: ['break-1', 'break-2', 'break-3'], volumeMinMax: [0.3, 0.36], pitchMinMax: [0.92, 1.08] },
    collectStone: { soundId: five('collect-stone'), volumeMinMax: [0.14, 0.18], pitchMinMax: [0.95, 1.12] },
    collectMetal: { soundId: five('collect-metal'), volumeMinMax: [0.18, 0.22], pitchMinMax: [0.95, 1.1] },
    collectGem: { soundId: five('collect-gem'), volumeMinMax: [0.2, 0.24], pitchMinMax: [0.95, 1.1] },
    // walking
    stepStone: { soundId: five('step-stone'), volumeMinMax: [0.12, 0.16], pitchMinMax: [0.92, 1.08] },
    stepWood: { soundId: [0, 1, 2, 3, 4].map((i) => `step-wood-${i}`), volumeMinMax: [0.16, 0.2], pitchMinMax: [0.92, 1.08] },
    // money
    coins: { soundId: ['coins-1', 'coins-2'], volumeMinMax: [0.18, 0.22], pitchMinMax: [0.95, 1.12] },
    // ui
    click: { soundId: ['ui-click-1', 'ui-click-2', 'ui-click-3'], volumeMinMax: 0.3 },
    open: { soundId: 'ui-open', volumeMinMax: 0.28 },
    close: { soundId: 'ui-close', volumeMinMax: 0.28 },
    tab: { soundId: 'ui-tab', volumeMinMax: 0.28 },
    error: { soundId: 'ui-error', volumeMinMax: 0.3 },
    confirm: { soundId: 'ui-confirm', volumeMinMax: 0.3 },
    toggle: { soundId: 'ui-toggle', volumeMinMax: 0.28 },
    quest: { soundId: 'ui-quest', volumeMinMax: 0.26 },
    item: { soundId: 'ui-item', volumeMinMax: 0.3 },
    complete: { soundId: 'ui-complete', volumeMinMax: 0.32 },
    // progress & celebration
    // purchases (bandit-controller's set): a cash-register ka-ching under every buy, a victory fanfare on upgrades
    // (plus a sparkle for tools), a star chime for wardrobe looks
    buyCash: { soundId: 'buy-cash', volumeMinMax: 0.4 },
    buyFanfare: { soundId: 'buy-fanfare', volumeMinMax: 0.34 },
    buyShine: { soundId: 'buy-shine', volumeMinMax: 0.26 },
    buyStar: { soundId: 'buy-star', volumeMinMax: 0.3 },
    build: { soundId: five('build'), volumeMinMax: 0.34, pitchMinMax: [0.95, 1.05] },
    sparkle: { soundId: 'sparkle', volumeMinMax: 0.3 },
    cheer: { soundId: ['yay-1', 'yay-2', 'yay-3', 'yay-4'], volumeMinMax: 0.3 },
    applause: { soundId: 'applause', volumeMinMax: 0.22 },
    reveal: { soundId: 'reveal', volumeMinMax: 0.3 },
    whoosh: { soundId: 'whoosh', volumeMinMax: 0.24, pitchMinMax: [0.92, 1.05] },
} satisfies Record<string, SoundAsset>;

export type Cue = keyof typeof SOUNDS;

/** Repeats closer than this are dropped (a burst of pickups or coins doesn't stack into noise). */
const COOLDOWN_MS: Partial<Record<Cue, number>> = { stepStone: 120, stepWood: 120, coins: 55, collectStone: 45, collectMetal: 45, collectGem: 45 };
const DEFAULT_COOLDOWN_MS = 60;

export class DigAudio {
    private static ready = false;
    private static platformPaused = false;
    private static volumeBeforePause: number | undefined;
    private static readonly lastPlayed = new Map<Cue, number>();

    /**
     * Registers every sound of the packed manifest (call once at boot) without downloading any: the loading screen
     * doesn't wait for audio. loadInBackground() fetches them all once the game is in; a cue asked for before its
     * file has arrived starts its download and is skipped (see play()).
     */
    public static async initialize(folderPath: string): Promise<void> {
        const manifest = structuredClone(audioManifest);
        for (const bundle of manifest.bundles) {
            for (const asset of bundle.assets) {
                asset.src = asset.src.map((src) => `./${folderPath}/audio/${src}`);
            }
        }
        SoundLoadManager.instance.setUpManifests([manifest], ['default']);
        this.ready = true;
        document.addEventListener('visibilitychange', this.syncPause);
        PlatformHandler.instance.onPause.add(this.onPause);
        PlatformHandler.instance.onResume.add(this.onResume);
        this.syncPause();
    }

    /** Downloads every sound, a few at a time behind the game (call once the game is in: the loading screen is gone). */
    public static loadInBackground(): void {
        void SoundLoadManager.instance.loadAllSoundsBackground();
    }

    /**
     * Plays a cue, picking among its variants that have loaded. One with none loaded yet starts their download and
     * stays silent this time: a sound arriving late would play out of step (and a burst of them all at once).
     */
    public static play(cue: Cue): void {
        if (!this.ready || this.isPaused() || SoundManager.instance.isMuted) return;
        const now = performance.now();
        if (now - (this.lastPlayed.get(cue) ?? -Infinity) < (COOLDOWN_MS[cue] ?? DEFAULT_COOLDOWN_MS)) return;
        const sound: SoundAsset = SOUNDS[cue];
        const variants = [sound.soundId].flat();
        // getSound() starts a missing one's download.
        const loaded = variants.filter((id) => SoundLoadManager.instance.getSound(id)?.isLoaded);
        if (!loaded.length) return;
        this.lastPlayed.set(cue, now);
        SoundManager.instance.tryToPlaySound({ ...sound, soundId: loaded });
    }

    private static readonly onPause = (): void => {
        this.platformPaused = true;
        this.syncPause();
    };

    private static readonly onResume = (): void => {
        this.platformPaused = false;
        this.syncPause();
    };

    private static readonly syncPause = (): void => {
        if (this.isPaused()) {
            if (this.volumeBeforePause === undefined) this.volumeBeforePause = Howler.volume();
            Howler.volume(0);
        } else if (this.volumeBeforePause !== undefined) {
            Howler.volume(this.volumeBeforePause);
            this.volumeBeforePause = undefined;
        }
    };

    private static isPaused(): boolean {
        return this.platformPaused || (PlatformHandler.instance.platform.usesPageVisibilityApi !== false && document.hidden);
    }
}
