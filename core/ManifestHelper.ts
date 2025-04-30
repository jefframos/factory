import { AssetsManifest } from "pixi.js";

export class ManifestHelper {
    /**
     * Adjusts all asset paths in the manifest by prepending a base path (like /game1).
     * This ensures PixiJS loads assets from the correct folder.
     * 
     * @param manifest The manifest object
     * @param basePath Path prefix (e.g. "/game1")
     * @returns A new manifest with adjusted paths
     */
    static patchPaths(manifest: AssetsManifest, basePath: string): AssetsManifest {
        const patched = structuredClone(manifest); // avoid mutating original

        patched.bundles.forEach(bundle => {
            bundle.assets.forEach(asset => {
                if (typeof asset.srcs === 'string') {
                    asset.srcs = `${basePath}/${asset.srcs}`;
                } else if (Array.isArray(asset.srcs)) {
                    asset.srcs = asset.srcs.map(src => `${basePath}/${src}`);
                }
            });
        });

        return patched;
    }
}
