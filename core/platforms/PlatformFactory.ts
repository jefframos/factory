// @core/platforms/PlatformFactory.ts
import { IPlatformConnection } from "./IPlatformConnection";

// @core/platforms/PlatformFactory.ts
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
        default: {
            const module = await import('./PokiPlatform');
            return new module.default();
        }
    }
}