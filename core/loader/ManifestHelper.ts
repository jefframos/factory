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
                if (typeof asset.src === 'string') {
                    asset.src = `${basePath}/${asset.src}`;
                } else if (Array.isArray(asset.src)) {
                    asset.src = asset.src.map(src => `${basePath}/${src}`);
                }
            });
        });

        return patched;
    }

    static getAliasesWithoutExtension(manifest: AssetsManifest): string[] {
        const aliases: string[] = [];

        manifest.bundles.forEach(bundle => {
            bundle.assets.forEach(asset => {
                const aliasField = (asset as any).alias;

                if (typeof aliasField === 'string') {
                    const id = ManifestHelper.removeExtension(aliasField)
                    if (!aliases.includes(id)) {
                        aliases.push(id);
                    }
                } else if (Array.isArray(aliasField)) {
                    aliasField.forEach((alias: string) => {

                        const id = ManifestHelper.removeExtension(alias)
                        if (!aliases.includes(id)) {
                            aliases.push(id);
                        }

                    });
                }
            });
        });

        return aliases;
    }

    private static removeExtension(alias: string): string {
        return alias.replace(/\.[^/.]+$/, '');
    }
}
