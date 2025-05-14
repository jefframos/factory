import { Assets } from 'pixi.js';

export class BundleLoader {
    /**
     * Registers bundles from raw manifest JSON data.
     * @param manifestData The JSON object from the generated manifest.
     */
    static async registerBundles(manifestData: any, path: string) {
        if (!manifestData || !manifestData.bundles) {
            console.warn('No bundles found in manifest data.');
            return;
        }

        for (const bundle of manifestData.bundles) {
            const assets: Record<string, any> = {};

            for (const asset of bundle.assets) {
                assets[asset.name] = path + asset.src[0];
                //console.log(bundle.name, asset)
            }


            Assets.addBundle(bundle.name, assets);
        }

        console.log(Assets)

        console.log('✅ Bundles registered.');
    }

    /**
     * Loads a registered bundle asynchronously.
     * @param bundleName Name of the bundle to load.
     */
    static async loadBundle(bundleName: string): Promise<void> {
        console.log(`📦 Loading bundle: ${bundleName}`);
        await Assets.loadBundle(bundleName);
        console.log(`✅ Bundle loaded: ${bundleName}`);
    }
}
