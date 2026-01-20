import { Signal } from "signals";
import SoundLoadManager from "./SoundLoaderManager";

export interface SoundProperties {
	volume?: number;
	pitch?: number;
	loop?: boolean;
}

export default class SoundManager {
	private static _instance: SoundManager | null = null;
	private masterSfxVolume: number = 1;
	private masterAmbientVolume: number = 1;
	private currentBackgroundSound?: Howl;
	private activeSounds: Set<string> = new Set();
	private soundEndListeners: Map<string, boolean> = new Map();

	public onMuteChange: Signal = new Signal();

	// New State variables
	private _isMuted: boolean = false;

	private previousMasterSfxVolume: number | null = null;
	private previousMasterAmbientVolume: number | null = null;

	private constructor() {
		// Load saved state (defaults to false if not found)
		const savedMute = localStorage.getItem("muted") === "true";
		this.setMuted(savedMute);
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
		localStorage.setItem("muted", String(mute));

		this.onMuteChange.dispatch(this._isMuted);
	}
	// --- Existing Methods Updated/Maintained ---

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

	public async playBackgroundSound(name: string, transitionDuration: number = 0): Promise<void> {
		const soundLoadManager = SoundLoadManager.instance;
		const oldSound = this.currentBackgroundSound;

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
			this.currentBackgroundSound = newSound;

			newSound.loop(true);

			if (transitionDuration > 0) {
				newSound.fade(0, this.masterAmbientVolume, transitionDuration);
			} else {
				newSound.volume(this.masterAmbientVolume);
			}

			newSound.play();
		}
	}

	public setMasterSfxVolume(volume: number): void {
		this.masterSfxVolume = volume;
		// Note: We don't set Howler.volume() here because that affects everything.
		// We update the local variable used when playing new SFX.
	}

	public setMasterAmbientVolume(volume: number): void {
		this.masterAmbientVolume = volume;
		if (this.currentBackgroundSound) {
			this.currentBackgroundSound.volume(this.masterAmbientVolume);
		}
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
		if (this.previousMasterAmbientVolume === null) this.previousMasterAmbientVolume = this.masterAmbientVolume;

		this.setMasterSfxVolume(0);
		this.setMasterAmbientVolume(0);
		// Optional: Howler.stop() if you want total silence during ads
	}

	public restoreSound(): void {
		if (this.previousMasterSfxVolume !== null) {
			this.setMasterSfxVolume(this.previousMasterSfxVolume);
			this.previousMasterSfxVolume = null;
		}
		if (this.previousMasterAmbientVolume !== null) {
			this.setMasterAmbientVolume(this.previousMasterAmbientVolume);
			this.previousMasterAmbientVolume = null;
		}
	}
}