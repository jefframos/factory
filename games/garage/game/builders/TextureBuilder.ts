import * as THREE from 'three';

export class TextureBuilder {
    private static pathCache = new Map<string, Promise<THREE.Texture>>();
    private static loader = new THREE.TextureLoader();

    /**
     * Loads a texture from a path once and caches it — a second call with the
     * same path returns the same in-flight/resolved load instead of loading
     * it again.
     */
    static load(path: string): Promise<THREE.Texture> {
        let promise = TextureBuilder.pathCache.get(path);
        if (!promise) {
            promise = TextureBuilder.loader.loadAsync(path);
            TextureBuilder.pathCache.set(path, promise);
        }
        return promise;
    }
}
