import { Howler } from 'howler';
import SoundManager, { SoundAsset } from 'core/audio/SoundManager';
import SoundLoadManager from 'core/audio/SoundLoaderManager';
import PlatformHandler from 'core/platforms/PlatformHandler';
import audioManifest from '../../manifests/audio.json';

// Heist set: ka-ching cash, bell chimes, police siren and spotted sting are synthesised by
// scripts/bandit-synth-sounds.mjs; footsteps, cheers and bonus stings come from the shared library.
const SOUNDS = {
    tap: { soundId: 'ui-tap', volumeMinMax: 0.25 },
    pickup: { soundId: 'cash', volumeMinMax: 0.32, pitchMinMax: [0.96, 1.06] },
    cashFly: { soundId: 'cash-tick', volumeMinMax: 0.22, pitchMinMax: [0.95, 1.12] },
    footstep: { soundId: ['footstep-wood-0', 'footstep-wood-1', 'footstep-wood-2', 'footstep-wood-3', 'footstep-wood-4'], volumeMinMax: [0.18, 0.24], pitchMinMax: [0.92, 1.08] },
    checkpoint: { soundId: 'checkpoint', volumeMinMax: 0.35 },
    start: { soundId: 'whoosh', volumeMinMax: 0.22, pitchMinMax: [0.95, 1.05] },
    victory: { soundId: 'victory', volumeMinMax: 0.3 },
    cheer: { soundId: ['yay-1', 'yay-2', 'yay-3', 'yay-4'], volumeMinMax: 0.32 },
    applause: { soundId: 'applause', volumeMinMax: 0.22 },
    busted: { soundId: 'siren', volumeMinMax: 0.32 },
    lose: { soundId: 'lose', volumeMinMax: 0.3 },
    spotted: { soundId: 'spotted', volumeMinMax: 0.3 },
    blocked: { soundId: 'busted', volumeMinMax: 0.18, pitchMinMax: 1.4 },
    equip: { soundId: 'pickup-1', volumeMinMax: 0.25, pitchMinMax: 1.3 },
    bonus: { soundId: 'bonus-claim', volumeMinMax: 0.35 },
    needle: { soundId: 'bonus-needle', volumeMinMax: 0.3 },
    panel: { soundId: 'panel-open', volumeMinMax: 0.25 },
    complete: { soundId: 'level-complete', volumeMinMax: 0.28 },
    star1: { soundId: 'star', volumeMinMax: 0.3, pitchMinMax: 1 },
    star2: { soundId: 'star', volumeMinMax: 0.32, pitchMinMax: 1.12 },
    star3: { soundId: 'star', volumeMinMax: 0.34, pitchMinMax: 1.26 },
} satisfies Record<string, SoundAsset>;

type Cue = keyof typeof SOUNDS;
const MUSIC_LAYER = 'bandit-music';

export class GameAudio {
    private static ready = false;
    private static musicStarted = false;
    private static platformPaused = false;
    private static volumeBeforePause: number | undefined;
    private static readonly lastPlayed = new Map<Cue, number>();

    public static async initialize(folderPath: string): Promise<void> {
        const manifest = structuredClone(audioManifest);
        for (const bundle of manifest.bundles) {
            for (const asset of bundle.assets) {
                asset.src = asset.src.map((src) => `./${folderPath}/audio/${src}`);
            }
        }
        SoundLoadManager.instance.setUpManifests([manifest], ['default']);
        const ids = manifest.bundles.flatMap((bundle) => bundle.assets.map((asset) => asset.alias[0].replace(/\.[^.]+$/, '')));
        await Promise.all(ids.filter((id) => id !== 'heist-music').map((id) => SoundLoadManager.instance.loadSoundByName(id)));
        this.ready = true;
        SoundManager.instance.setLayerVolume(MUSIC_LAYER, 0.055);
        window.addEventListener('pointerup', this.onGesture, true);
        window.addEventListener('keydown', this.onGesture, true);
        document.addEventListener('visibilitychange', this.syncPause);
        PlatformHandler.instance.onPause.add(this.onPause);
        PlatformHandler.instance.onResume.add(this.onResume);
        this.syncPause();
    }

    public static play(cue: Cue): void {
        if (!this.ready || this.isPaused() || SoundManager.instance.isMuted) {
            return;
        }
        const now = performance.now();
        const cooldown = cue === 'footstep' ? 100 : 65;
        if (now - (this.lastPlayed.get(cue) ?? -Infinity) < cooldown) {
            return;
        }
        this.lastPlayed.set(cue, now);
        SoundManager.instance.tryToPlaySound(SOUNDS[cue]);
    }

    public static setScene(scene: string): void {
        SoundManager.instance.setLayerVolume(MUSIC_LAYER, scene === 'home' ? 0.055 : 0.035, 400);
    }

    private static readonly onGesture = (): void => {
        if (this.musicStarted || this.isPaused()) {
            return;
        }
        this.musicStarted = true;
        window.removeEventListener('pointerup', this.onGesture, true);
        window.removeEventListener('keydown', this.onGesture, true);
        void SoundManager.instance.playBackgroundSound('heist-music', 600, MUSIC_LAYER)
            .catch((error) => {
                this.musicStarted = false;
                console.error('[GameAudio] Could not start background music', error);
                window.addEventListener('pointerup', this.onGesture, true);
                window.addEventListener('keydown', this.onGesture, true);
            });
    };

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
            if (this.volumeBeforePause === undefined) {
                this.volumeBeforePause = Howler.volume();
            }
            Howler.volume(0);
        } else if (this.volumeBeforePause !== undefined) {
            Howler.volume(this.volumeBeforePause);
            this.volumeBeforePause = undefined;
        }
    };

    private static isPaused(): boolean {
        return this.platformPaused
            || (PlatformHandler.instance.platform.usesPageVisibilityApi !== false && document.hidden);
    }
}
