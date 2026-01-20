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
// SoundLoadManager class for loading and managing audio assets
export default class SoundLoadManager {
  private static _instance: SoundLoadManager | null = null;
  private soundMap: { [key: string]: AudioAsset } = {};
  private loadingQueue: Promise<void>[] = [];
  private supportsOgg: string;

  private constructor() {
    // Check for OGG support
    const audio = document.createElement("audio");
    this.supportsOgg = audio.canPlayType('audio/ogg; codecs="vorbis"');
  }

  public static get instance(): SoundLoadManager {
    if (!SoundLoadManager._instance) {
      SoundLoadManager._instance = new SoundLoadManager();
    }
    return SoundLoadManager._instance;
  }

  removeExtension(fileName: string): string {
    const lastDotIndex = fileName.lastIndexOf(".");
    if (lastDotIndex === -1) {
      // If there's no dot in the fileName, return the fileName as is
      return fileName;
    }
    return fileName.substring(0, lastDotIndex);
  }

  // Setup manifests to map audio assets
  public setUpManifests(
    manifests: AudioManifest[],
    bundleNames: string[],
  ): void {
    manifests.forEach((manifest) => {
      manifest.bundles.forEach((bundle) => {
        if (bundleNames.includes(bundle.name)) {
          bundle.assets.forEach((asset) => {
            console.log(asset)
            const audioAsset: AudioAsset = {};

            asset.src.forEach((src) => {
              if (src.endsWith(".mp3")) {
                audioAsset.mp3Path = src;
              } else if (src.endsWith(".ogg")) {
                audioAsset.oggPath = src;
              }
            });

            audioAsset.bundleName = bundle.name;
            this.soundMap[this.removeExtension(asset.alias[0])] = audioAsset;
          });
        }
      });
    });
  }

  // Load sound by name asynchronously using Howler
  public async loadSoundByName(name: string): Promise<void> {
    const audioAsset = this.soundMap[name];
    if (!audioAsset || audioAsset.isLoaded) {
      return;
    }

    // Check for OGG support
    const soundFilePath = false//this.supportsOgg
      ? audioAsset.oggPath
      : audioAsset.mp3Path;

    if (!soundFilePath) {
      return;
    }
    return new Promise<void>((resolve) => {
      const howl = new Howl({
        src: [soundFilePath],
        onload: () => {
          audioAsset.isLoaded = true;
          audioAsset.howlInstance = howl;
          resolve();
        },
      });
    });
  }

  // Load all sounds in a bundle
  public async loadSoundsByBundle(bundleName: string): Promise<void> {
    const soundsToLoad = Object.keys(this.soundMap).filter(
      (key) => this.soundMap[key].bundleName === bundleName,
    );

    for (const sound of soundsToLoad) {
      await this.loadSoundByName(sound);
    }
  }

  // Load sound in the background
  public loadSoundInBackground(name: string): void {
    const loadPromise = this.loadSoundByName(name);
    this.loadingQueue.push(loadPromise);
  }

  // Wait for all background loads to complete
  public async waitForBackgroundLoads(): Promise<void> {
    await Promise.all(this.loadingQueue);
    this.loadingQueue = [];
  }

  // Retrieve sound by name
  public getSound(name: string): AudioAsset | undefined {
    if (!this.soundMap[name]) {
      console.warn("sound doesnt exist " + name);
      return;
    }
    this.loadSoundByName(name);
    return this.soundMap[name];
  }

  // Clear sound map
  public clearSounds(): void {
    this.soundMap = {};
  }
}
