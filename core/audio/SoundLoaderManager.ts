import { Howl } from "howler";

// Interface to define audio assets
interface AudioAsset {
  mp3Path?: string;
  oggPath?: string;
  isLoaded?: boolean;
  howlInstance?: Howl;
  bundleName?: string;
}

interface AudioManifest {
  bundles: Array<{
    name: string;
    assets: Array<{
      alias: string[];
      src: string[];
    }>;
  }>;
}

export default class SoundLoadManager {
  private static _instance: SoundLoadManager | null = null;
  private soundMap: { [key: string]: AudioAsset } = {};

  /**
   * loadingPromises tracks sounds currently in flight.
   * This prevents multiple Howl instances from being created 
   * if a sound is requested twice before the first one finishes.
   */
  private loadingPromises: Map<string, Promise<void>> = new Map();
  private supportsOgg: boolean;

  private constructor() {
    // Check for OGG support
    const audio = document.createElement("audio");
    const canPlayOgg = audio.canPlayType('audio/ogg; codecs="vorbis"');
    this.supportsOgg = canPlayOgg === "probably" || canPlayOgg === "maybe";
  }

  public static get instance(): SoundLoadManager {
    if (!SoundLoadManager._instance) {
      SoundLoadManager._instance = new SoundLoadManager();
    }
    return SoundLoadManager._instance;
  }

  private removeExtension(fileName: string): string {
    const lastDotIndex = fileName.lastIndexOf(".");
    return lastDotIndex === -1 ? fileName : fileName.substring(0, lastDotIndex);
  }

  /**
   * Maps manifest data into the internal soundMap.
   */
  public setUpManifests(manifests: AudioManifest[], bundleNames: string[]): void {
    manifests.forEach((manifest) => {
      manifest.bundles.forEach((bundle) => {
        if (bundleNames.includes(bundle.name)) {
          bundle.assets.forEach((asset) => {
            const audioAsset: AudioAsset = {};

            asset.src.forEach((src) => {
              if (src.endsWith(".mp3")) {
                audioAsset.mp3Path = src;
              } else if (src.endsWith(".ogg")) {
                audioAsset.oggPath = src;
              }
            });

            audioAsset.bundleName = bundle.name;
            // Use the first alias as the key
            const key = this.removeExtension(asset.alias[0]);
            this.soundMap[key] = audioAsset;
          });
        }
      });
    });
  }

  /**
   * Core loading logic with duplicate prevention.
   */
  public async loadSoundByName(name: string): Promise<void> {
    const audioAsset = this.soundMap[name];

    if (!audioAsset) {
      console.warn(`SoundLoadManager: Sound "${name}" not found in manifest.`);
      return;
    }

    if (audioAsset.isLoaded) return;

    // If already loading, return the existing promise
    if (this.loadingPromises.has(name)) {
      return this.loadingPromises.get(name);
    }

    const soundFilePath = this.supportsOgg && audioAsset.oggPath
      ? audioAsset.oggPath
      : audioAsset.mp3Path;

    if (!soundFilePath) {
      console.error(`SoundLoadManager: No valid source path for "${name}"`);
      return;
    }

    const loadPromise = new Promise<void>((resolve, reject) => {
      const howl = new Howl({
        src: [soundFilePath],
        preload: true,
        onload: () => {
          audioAsset.isLoaded = true;
          audioAsset.howlInstance = howl;
          this.loadingPromises.delete(name);
          resolve();
        },
        onloaderror: (id, error) => {
          this.loadingPromises.delete(name);
          console.error(`SoundLoadManager: Failed to load "${name}"`, error);
          reject(error);
        }
      });
    });

    this.loadingPromises.set(name, loadPromise);
    return loadPromise;
  }

  /**
   * Loads all sounds defined in the map in the background.
   */
  public async loadAllSoundsBackground(): Promise<void> {
    const allKeys = Object.keys(this.soundMap);
    // Use allSettled so one 404 doesn't break the entire batch
    await Promise.allSettled(allKeys.map(key => this.loadSoundByName(key)));
    console.log("SoundLoadManager: All sounds in map have been processed.");
  }

  /**
   * Loads sounds belonging to a specific bundle.
   */
  public async loadSoundsByBundle(bundleName: string): Promise<void> {
    const soundsToLoad = Object.keys(this.soundMap).filter(
      (key) => this.soundMap[key].bundleName === bundleName,
    );

    await Promise.allSettled(soundsToLoad.map(key => this.loadSoundByName(key)));
  }

  /**
   * Synchronously kicks off a load without forcing the caller to await.
   */
  public loadInBackground(name: string): void {
    this.loadSoundByName(name).catch(() => {
      /* Error handled in loadSoundByName */
    });
  }

  /**
   * Safely retrieves a sound. If not loaded, it triggers a load.
   */
  public getSound(name: string): AudioAsset | undefined {
    const asset = this.soundMap[name];
    if (!asset) {
      console.warn("SoundLoadManager: Sound doesn't exist " + name);
      return undefined;
    }

    if (!asset.isLoaded) {
      this.loadInBackground(name);
    }

    return asset;
  }

  public clearSounds(): void {
    // Unload Howler instances to free memory
    Object.values(this.soundMap).forEach(asset => {
      asset.howlInstance?.unload();
    });
    this.soundMap = {};
    this.loadingPromises.clear();
  }
}