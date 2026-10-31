// core/platforms/PlatformFactory.ts
import { IPlatformConnection } from "./IPlatformConnection";

/**
 * The platform the build was made for (tools/build/build-platforms.mjs sets VITE_PLATFORM per build). Vite writes it
 * into the code as a literal, so the switch below folds to that one case and the build only carries its own SDK
 * module — a Poki build has no CrazyGames / YouTube / ... code in it (nor the mock's). Unset (dev server, the default / cached build):
 * `name` picks at runtime and every module stays available.
 */
const BUILT_FOR: string | undefined = import.meta.env.VITE_PLATFORM;

export async function getPlatformInstance(name: string): Promise<IPlatformConnection> {
    // An if chain, not a switch: the bundler drops an `if` it knows is false (with its dynamic import), not a case.
    const platform = BUILT_FOR || name;
    if (platform === 'poki') return new (await import('./PokiPlatform')).default();
    if (platform === 'crazygames' || platform === 'crazygames-no-ads') return new (await import('./CrazyGamesPlatform')).default();
    if (platform === 'gamedis') return new (await import('./GameDistributionPlatform')).default();
    if (platform === 'gamepix') return new (await import('./GamePixPlatform')).default();
    if (platform === 'youtube') return new (await import('./YouTubePlayablePlatform')).default();
    // Local runs ('local'), cached/demo builds ('default'), 'mock' and anything unnamed: no SDK, every call logged, ads
    // simulated (MockPlatform). Real platform builds name theirs above.
    return new (await import('./MockPlatform')).default();
}
