import { Howler } from 'howler';
import SoundManager, { SoundAsset } from 'core/audio/SoundManager';
import SoundLoadManager from 'core/audio/SoundLoaderManager';
import PlatformHandler from 'core/platforms/PlatformHandler';
import audioManifest from '../../manifests/audio.json';

const SOUNDS = {
    tap: { soundId: 'ui-tap', volumeMinMax: 0.25 },
    pickup: { soundId: ['pickup-1', 'pickup-2'], volumeMinMax: 0.3, pitchMinMax: [1, 1.15] },
    footstep: { soundId: ['footstep-1', 'footstep-2'], volumeMinMax: 0.16, pitchMinMax: [0.95, 1.1] },
    checkpoint: { soundId: 'checkpoint', volumeMinMax: 0.3 },
    start: { soundId: 'checkpoint', volumeMinMax: 0.16, pitchMinMax: 1.25 },
    victory: { soundId: 'victory', volumeMinMax: 0.3 },
    busted: { soundId: 'busted', volumeMinMax: 0.4 },
    blocked: { soundId: 'busted', volumeMinMax: 0.18, pitchMinMax: 1.4 },
    equip: { soundId: 'pickup-1', volumeMinMax: 0.25, pitchMinMax: 1.3 },
    bonus: { soundId: 'pickup-2', volumeMinMax: 0.35, pitchMinMax: 1.2 },
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
