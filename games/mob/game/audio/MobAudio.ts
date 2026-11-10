// MobAudio.ts
//
// Mob's sounds: short effects for the cannon, gates, clashes, the base, giants, a won or lost battle and the buttons,
// and a soundtrack ("High Class" by Benjamin Andrews, from library3d/sounds) looping quietly under it all. Files:
// raw-assets/audio (`npm run audio` packs them into public/mob/audio, listed in manifests/audio.json); the effects come
// from the ant, dig and down games.
//
// Everything plays through core's SoundManager (as Ant's sounds do), so the platforms' own handling reaches it: the
// ads mute it, a platform mute silences it, and it goes quiet while the platform pauses the game. Each effect has its
// volume and the least time between two plays — hundreds of mobs clash, and only a few of those should sound.

import { Howler } from 'howler';
import SoundLoadManager from 'core/audio/SoundLoaderManager';
import SoundManager from 'core/audio/SoundManager';
import PlatformHandler from 'core/platforms/PlatformHandler';
import audioManifest from '../../manifests/audio.json';

export type Sfx = 'shot' | 'gate' | 'clash' | 'energyEmpty' | 'energyFull' | 'cardWon' | 'confirm' | 'baseHit' | 'blockHit' | 'bigHit' | 'crumble' | 'giant' | 'explosion' | 'win' | 'applause' | 'lose' | 'click' | 'whoosh' | 'coins';

/** Each effect's sound(s) (one is picked at random), its volume, and the least time between two plays (seconds). */
const SFX: Record<Sfx, { files: string[]; volume: number; gap?: number }> = {
    shot: { files: ['tap'], volume: 0.1, gap: 0.09 },
    gate: { files: ['bubbles'], volume: 0.18, gap: 0.1 },
    clash: { files: ['drop-1', 'drop-2', 'drop-3', 'drop-4', 'drop-5'], volume: 0.3, gap: 0.05 },
    // The cannon's energy run dry (a power-down: it's locked till full), and full again (a rising zap).
    energyEmpty: { files: ['energy-empty'], volume: 0.4, gap: 0.5 },
    energyFull: { files: ['energy-full'], volume: 0.3, gap: 0.5 },
    // A mob punching a building; a mob chipping a breakable; a giant's heavy hit; a breakable or a PUSH block giving way.
    baseHit: { files: ['hit-1', 'hit-2', 'hit-3'], volume: 0.26, gap: 0.06 },
    blockHit: { files: ['block-1', 'block-2'], volume: 0.26, gap: 0.06 },
    bigHit: { files: ['big-hit-1', 'big-hit-2'], volume: 0.34, gap: 0.15 },
    crumble: { files: ['crumble'], volume: 0.38, gap: 0.2 },
    // A unit landing on the field (a giant, truck, car or UFO): a heavy thump.
    giant: { files: ['spawn'], volume: 0.4 },
    explosion: { files: ['explosion'], volume: 0.6 },
    win: { files: ['ui-complete'], volume: 0.45 },
    // A new card's face shown (a fanfare), and a choice confirmed (a new card taken).
    cardWon: { files: ['card-won'], volume: 0.45 },
    confirm: { files: ['confirm'], volume: 0.45, gap: 0.1 },
    applause: { files: ['applause'], volume: 0.4 },
    lose: { files: ['lose'], volume: 0.5 },
    click: { files: ['tap'], volume: 0.4 },
    whoosh: { files: ['whoosh'], volume: 0.4 },
    coins: { files: ['coins-1'], volume: 0.4, gap: 0.08 },
};
/** One knob for every effect. */
const SFX_LEVEL = 0.8;
/** The soundtracks: the calm one (music) low on the main screen, "Derp Nugget" in battles. Each on its own layer, so
 *  one fades out while the other fades in. ("Derp Nugget" Kevin MacLeod (incompetech.com), CC BY 4.0: CREDITS.md.) */
export type Track = 'menu' | 'battle';
const MUSIC: Record<Track, { sound: string; layer: string; volume: number }> = {
    menu: { sound: 'music', layer: 'music-menu', volume: 0.1 },
    battle: { sound: 'derp-nugget', layer: 'music-battle', volume: 0.18 },
};
const MUSIC_FADE_MS = 1500;

const lastPlayed = new Map<Sfx, number>();
/** The track wanted, and the one playing (none until the first input unlocks audio). */
let wantedTrack: Track = 'menu';
let playingTrack: Track | null = null;
let unlocked = false;

/** The wanted track, faded in over the other one (once audio's unlocked). */
function syncMusic(): void {
    if (!unlocked || playingTrack === wantedTrack) return;
    if (playingTrack) SoundManager.instance.stopLayer(MUSIC[playingTrack].layer, MUSIC_FADE_MS);
    playingTrack = wantedTrack;
    const { sound, layer } = MUSIC[wantedTrack];
    void SoundManager.instance.playBackgroundSound(sound, MUSIC_FADE_MS, layer).catch(() => undefined);
}
/** The platform's paused the game: everything silent until it resumes. */
let platformPaused = false;

/** Paused: by the platform, or the tab is hidden (unless the platform does its own pausing, as YouTube Playables). */
const isPaused = (): boolean => platformPaused || (PlatformHandler.instance.platform?.usesPageVisibilityApi !== false && document.hidden);

/** Silent while paused (the game's updates stop with a hidden tab too: core/Game.ts), back to full when not. */
function syncPause(): void {
    Howler.volume(isPaused() ? 0 : 1);
}

export const MobAudio = {
    /** Call once at boot (`gameFolder`: where public/<game>/audio is): the sounds are listed, then loaded in the background. */
    initialize(gameFolder: string): void {
        const manifest = structuredClone(audioManifest);
        for (const bundle of manifest.bundles) {
            for (const asset of bundle.assets) asset.src = asset.src.map((src) => `./${gameFolder}/audio/${src}`);
        }
        SoundLoadManager.instance.setUpManifests([manifest], ['default']);
        for (const { files } of Object.values(SFX)) for (const file of files) SoundLoadManager.instance.loadInBackground(file);
        for (const { layer, volume } of Object.values(MUSIC)) SoundManager.instance.setLayerVolume(layer, volume);
        // Any first input (on the main screen as in a battle) unlocks audio.
        window.addEventListener('pointerdown', () => MobAudio.unlock(), { once: true, capture: true });
        document.addEventListener('visibilitychange', syncPause);
        PlatformHandler.instance.onPause.add(() => {
            platformPaused = true;
            syncPause();
        });
        PlatformHandler.instance.onResume.add(() => {
            platformPaused = false;
            syncPause();
        });
        syncPause();
    },

    /** An effect, a little higher or lower with `rate`. */
    play(name: Sfx, rate = 1): void {
        if (isPaused()) return;
        const { files, volume, gap } = SFX[name];
        const now = performance.now() / 1000;
        if (gap && now - (lastPlayed.get(name) ?? -Infinity) < gap) return;
        lastPlayed.set(name, now);
        const file = files[Math.floor(Math.random() * files.length)];
        void SoundManager.instance.playSoundById(file, { volume: volume * SFX_LEVEL * SoundManager.instance.sfxVolume, pitch: rate }).catch(() => undefined);
    },

    /** Audio can start (the first input): wakes the audio context and fades the soundtrack in. */
    unlock(): void {
        const context = Howler.ctx as AudioContext | undefined;
        if (context?.state === 'suspended') void context.resume();
        unlocked = true;
        syncMusic();
    },

    /** The soundtrack for where the player is: the main screen's (calm, low) or the battles'. */
    music(track: Track): void {
        wantedTrack = track;
        syncMusic();
    },
};
