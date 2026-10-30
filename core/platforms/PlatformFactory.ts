// core/platforms/PlatformFactory.ts
import { IPlatformConnection } from "./IPlatformConnection";

// core/platforms/PlatformFactory.ts
export async function getPlatformInstance(name: string): Promise<IPlatformConnection> {
    switch (name) {
        case 'poki': {
            const module = await import('./PokiPlatform');
            return new module.default();
        }
        case 'crazygames': {
            const module = await import('./CrazyGamesPlatform');
            return new module.default();
        }
        case 'crazygames-no-ads': {
            const module = await import('./CrazyGamesPlatform');
            return new module.default();
        }
        case 'gamedis': {
            const module = await import('./GameDistributionPlatform');
            return new module.default();
        }
        case 'gamepix': {
            const module = await import('./GamePixPlatform');
            return new module.default();
        }
        case 'youtube': {
            const module = await import('./YouTubePlayablePlatform');
            return new module.default();
        }
        // Local runs ('local'), cached/demo builds ('default') and anything unnamed: no SDK, every call logged, ads
        // simulated (MockPlatform). Real platform builds name theirs above.
        case 'mock':
        default: {
            const module = await import('./MockPlatform');
            return new module.default();
        }
    }
}