import { Signal } from "signals";
import SoundLoadManager from "./SoundLoaderManager";
import PlatformHandler from "core/platforms/PlatformHandler";

export interface SoundProperties {
	volume?: number;
	pitch?: number;
	loop?: boolean;
}

/** One-shot SFX definition: a sound (or pool of variants to pick from at random) plus optional volume/pitch jitter ranges. Used with SoundManager.tryToPlaySound — see e.g. games/clog/Assets.ts for how a game's static sound registry is typed against this. */
export interface SoundAsset {
	soundId: string | string[];
	volumeMinMax?: [number, number] | number;
	pitchMinMax?: [number, number] | number;
}

export default class SoundManager {
	static STORAGE_ID = "gameName";
	private static _instance: SoundManager | null = null;
	private masterSfxVolume: number = 1;
	/** Backward-compat mirror of layerVolumes.get("default") — see setMasterAmbientVolume. */
	private masterAmbientVolume: number = 1;
	/**
	 * Looping background sounds, keyed by an arbitrary layer name so more than
	 * one can play at once — e.g. a persistent music bed on a "music" layer
	 * ducked (not stopped) under a gameplay "ambient" layer, rather than one
	 * hard-swapping the other. Games that only ever call playBackgroundSound
	 * with the default layer keep the old single-track behavior for free.
	 */
	private backgroundLayers: Map<string, Howl> = new Map();
	/** Target volume per layer — reapplied by setLayerVolume/restoreSound even while nothing is currently loaded into that layer. */
	private layerVolumes: Map<string, number> = new Map();
	private activeSounds: Set<string> = new Set();
	private soundEndListeners: Map<string, boolean> = new Map();

	public onMuteChange: Signal = new Signal();

	// New State variables
	private _isMuted: boolean = false;

	private previousMasterSfxVolume: number | null = null;
	private previousLayerVolumes: Map<string, number> | null = null;

	private constructor() {
		// Load saved state (defaults to false if not found)
		void this.loadMutedState();
	}

	private async loadMutedState(): Promise<void> {
		const key = SoundManager.STORAGE_ID + "muted";
		try {
			const platform = (PlatformHandler.instance as any).platform;
			if (platform?.getItem) {
				const savedMute = await platform.getItem(key);
				this._isMuted = savedMute === "true";
				Howler.mute(this._isMuted);
				this.onMuteChange.dispatch(this._isMuted);
				return;
			}
		} catch (error) {
			console.warn("SoundManager: platform mute read failed, falling back to localStorage", error);
		}

		const storage = this.getSafeLocalStorage();
		const savedMute = storage?.getItem(key) === "true";
		this._isMuted = savedMute;
		Howler.mute(this._isMuted);
		this.onMuteChange.dispatch(this._isMuted);
	}

	private getSafeLocalStorage(): Storage | null {
		try {
			return window.localStorage ?? null;
		} catch {
			return null;
		}
	}

	private persistMutedState(mute: boolean): void {
		const key = SoundManager.STORAGE_ID + "muted";

		try {
			const platform = (PlatformHandler.instance as any).platform;
			if (platform?.setItem) {
				void platform.setItem(key, String(mute));
				return;
			}
		} catch (error) {
			console.warn("SoundManager: platform mute write failed, falling back to localStorage", error);
		}

		this.getSafeLocalStorage()?.setItem(key, String(mute));
	}

	public static get instance(): SoundManager {
		if (!SoundManager._instance) {
			SoundManager._instance = new SoundManager();
		}
		return SoundManager._instance;
	}

	// --- New Toggle and State Methods ---

	/**
	 * Returns current mute status
	 */
	public get isMuted(): boolean {
		return this._isMuted;
	}

	/**
	 * Toggles the mute state and triggers the signal
	 */
	public toggleMute(): void {
		this.setMuted(!this._isMuted);
	}

	/**
	 * Directly set mute state
	 */
	public setMuted(mute: boolean): void {
		if (this._isMuted === mute) return;

		this._isMuted = mute;
		Howler.mute(mute);

		// Persist the choice
		this.persistMutedState(mute);

		this.onMuteChange.dispatch(this._isMuted);
	}
	// --- Existing Methods Updated/Maintained ---

	/**
	 * Resolves a SoundAsset (picking a random variant and rolling volume/pitch
	 * within their ranges) and plays it as a one-shot SFX. No-op if soundId is
	 * undefined/empty. This is the shared implementation every game's static
	 * Assets registry used to duplicate as `tryToPlaySound`/`getRange`/`getRandom`.
	 */
	public tryToPlaySound(soundAsset: SoundAsset): void {
		const id = this.pickVariant(soundAsset.soundId);
		if (!id) return;

		void this.playSoundById(id, {
			volume: SoundManager.resolveRange(soundAsset.volumeMinMax),
			pitch: SoundManager.resolveRange(soundAsset.pitchMinMax),
		});
	}

	private pickVariant(value?: string | string[]): string | undefined {
		if (value === undefined) return undefined;
		if (typeof value === "string") return value;
		return value[Math.floor(Math.random() * value.length)];
	}

	private static resolveRange(value?: number | [number, number]): number {
		if (value === undefined) return 1;
		if (typeof value === "number") return value;

		const [min, max] = value;
		return Math.random() * (max - min) + min;
	}

	public async playSoundById(name: string, properties: SoundProperties = {}): Promise<void> {
		const soundLoadManager = SoundLoadManager.instance;
		let audioAsset = soundLoadManager.getSound(name);

		if (!audioAsset?.isLoaded) {
			await soundLoadManager.loadSoundByName(name);
			audioAsset = soundLoadManager.getSound(name);
		}

		if (audioAsset?.howlInstance) {
			const howl = audioAsset.howlInstance;
			howl.volume(properties.volume !== undefined ? properties.volume : this.masterSfxVolume);
			howl.loop(properties.loop !== undefined ? properties.loop : false);
			howl.rate(properties.pitch !== undefined ? properties.pitch : 1);
			howl.play();
		}
	}

	public async playSoundByIdUnique(name: string, properties: SoundProperties = {}): Promise<void> {
		if (this.activeSounds.has(name)) return;

		this.activeSounds.add(name);
		await this.playSoundById(name, properties);

		const audioAsset = SoundLoadManager.instance.getSound(name);
		if (audioAsset?.howlInstance && !this.soundEndListeners.has(name)) {
			audioAsset.howlInstance.on("end", () => {
				this.activeSounds.delete(name);
			});
			this.soundEndListeners.set(name, true);
		}
	}

	/**
	 * Starts a looping background sound on `layer` (default: "default"),
	 * fading out/stopping whatever was already playing on that same layer.
	 * Other layers are untouched — e.g. a "music" layer can keep playing
	 * straight through a "ambient" layer starting up alongside it. Starts at
	 * that layer's last volume set via setLayerVolume/setMasterAmbientVolume
	 * (1 if never set).
	 */
	public async playBackgroundSound(name: string, transitionDuration: number = 0, layer: string = "default"): Promise<void> {
		const soundLoadManager = SoundLoadManager.instance;
		const oldSound = this.backgroundLayers.get(layer);

		// 1. Handle Fading Out the old sound
		if (oldSound) {
			if (transitionDuration > 0) {
				oldSound.fade(oldSound.volume(), 0, transitionDuration);
				// Crucial: Stop and clean up once the fade finishes
				oldSound.once('fade', () => {
					oldSound.stop();
				});
			} else {
				oldSound.stop();
			}
		}

		// 2. Load and Prepare the new sound
		await soundLoadManager.loadSoundByName(name);
		const audioAsset = soundLoadManager.getSound(name);

		if (audioAsset?.howlInstance) {
			const newSound = audioAsset.howlInstance;
			this.backgroundLayers.set(layer, newSound);
			const targetVolume = this.layerVolumes.get(layer) ?? 1;

			newSound.loop(true);

			if (transitionDuration > 0) {
				newSound.fade(0, targetVolume, transitionDuration);
			} else {
				newSound.volume(targetVolume);
			}

			newSound.play();
		}
	}

	/**
	 * Sets (and optionally fades to) a background layer's volume — the way to
	 * duck a persistent music layer under a gameplay ambient layer without
	 * stopping either. Remembered even if nothing is currently loaded into
	 * that layer yet, so it applies as soon as playBackgroundSound starts one.
	 */
	public setLayerVolume(layer: string, volume: number, fadeDuration: number = 0): void {
		this.layerVolumes.set(layer, volume);
		if (layer === "default") this.masterAmbientVolume = volume;

		const sound = this.backgroundLayers.get(layer);
		if (!sound) return;

		if (fadeDuration > 0) {
			sound.fade(sound.volume(), volume, fadeDuration);
		} else {
			sound.volume(volume);
		}
	}

	/** Fades out (or stops outright) and clears whatever is playing on `layer`. */
	public stopLayer(layer: string, fadeDuration: number = 0): void {
		const sound = this.backgroundLayers.get(layer);
		if (!sound) return;

		if (fadeDuration > 0) {
			sound.fade(sound.volume(), 0, fadeDuration);
			sound.once('fade', () => sound.stop());
		} else {
			sound.stop();
		}
		this.backgroundLayers.delete(layer);
	}

	public setMasterSfxVolume(volume: number): void {
		this.masterSfxVolume = volume;
		// Note: We don't set Howler.volume() here because that affects everything.
		// We update the local variable used when playing new SFX.
	}

	/** Sugar for setLayerVolume("default", volume) — the single-track API every game used before background layers existed. */
	public setMasterAmbientVolume(volume: number): void {
		this.setLayerVolume("default", volume);
	}

	public stopAllSounds(): void {
		Howler.stop();
		this.activeSounds.clear();
		this.soundEndListeners.clear();
	}

	/**
	 * Used for Ads: Stops audio but allows for restoration later.
	 * If you want to "Pause" instead of "Stop" for ads, change .stop() to .pause().
	 */
	public muteAllSounds(): void {
		if (this.previousMasterSfxVolume === null) this.previousMasterSfxVolume = this.masterSfxVolume;
		if (this.previousLayerVolumes === null) this.previousLayerVolumes = new Map(this.layerVolumes);

		this.setMasterSfxVolume(0);
		for (const layer of this.layerVolumes.keys()) this.setLayerVolume(layer, 0);
		// Optional: Howler.stop() if you want total silence during ads
	}

	public restoreSound(): void {
		if (this.previousMasterSfxVolume !== null) {
			this.setMasterSfxVolume(this.previousMasterSfxVolume);
			this.previousMasterSfxVolume = null;
		}
		if (this.previousLayerVolumes !== null) {
			for (const [layer, volume] of this.previousLayerVolumes) this.setLayerVolume(layer, volume);
			this.previousLayerVolumes = null;
		}
	}
}