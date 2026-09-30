import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';

export default class ModelLoaderManager {
  private static _instance: ModelLoaderManager;
  /**
   * Keyed by the model's full PATH (query string dropped) — never by `id`. Model ids are just
   * file basenames and are NOT unique across folders (pirate/crate.glb and restaurant/crate.gltf
   * are both "crate"), so keying by id handed whichever loaded first to every model sharing that
   * name — e.g. every storage turning into a pirate crate once one was placed on the map.
   */
  private _cache: Map<string, THREE.Object3D> = new Map();
  private _inflight: Map<string, Promise<THREE.Object3D>> = new Map();
  /** id -> the path(s) loaded under it, for the id-based getModel()/clearCache() lookups. */
  private _pathsById: Map<string, Set<string>> = new Map();

  private _gltfLoader = new GLTFLoader();
  private _fbxLoader = new FBXLoader();
  private _mtlLoader = new MTLLoader();

  private constructor() { }

  public static get instance(): ModelLoaderManager {
    if (!ModelLoaderManager._instance) {
      ModelLoaderManager._instance = new ModelLoaderManager();
    }
    return ModelLoaderManager._instance;
  }

  /**
   * Loads a model from a path or returns a clone from cache.
   * param path The full URL/path to the model file — also the cache key (see _cache).
   * param id Optional name to look the model up by later (getModel()/clearCache()). If not
   * provided, the filename is used. Only an alias: two models with the same id but different
   * paths are cached separately.
   */
  public async loadModel(path: string, id?: string): Promise<THREE.Object3D> {
    const cacheId = path.split('?')[0];
    const alias = id || cacheId.split('/').pop() || cacheId;
    let aliasPaths = this._pathsById.get(alias);
    if (!aliasPaths) {
      aliasPaths = new Set();
      this._pathsById.set(alias, aliasPaths);
    }
    aliasPaths.add(cacheId);

    // 1. Return from cache if exists
    if (this._cache.has(cacheId)) {
      return this._cache.get(cacheId)!.clone(true);
    }

    // 2. Join an in-flight load if one is already underway, so concurrent
    // requests for the same model don't each trigger their own fetch.
    if (this._inflight.has(cacheId)) {
      const loadedObject = await this._inflight.get(cacheId)!;
      return loadedObject.clone(true);
    }

    // 3. Determine extension
    const extension = path.split('.').pop()?.toLowerCase();

    const loadPromise = (async (): Promise<THREE.Object3D> => {
      switch (extension) {
        case 'glb':
        case 'gltf': {
          const gltf = await this._gltfLoader.loadAsync(path);
          return gltf.scene;
        }
        case 'fbx':
          return await this._fbxLoader.loadAsync(path);
        case 'obj': {
          // A fresh OBJLoader per load (not a shared instance field, unlike the other loaders
          // above) — OBJLoader.setMaterials() is stateful on the instance, and this manager's
          // loads run concurrently/are cached across completely unrelated models, so a shared
          // instance would leak one obj's materials into the next obj-with-no-mtl load.
          const objLoader = new OBJLoader();

          // Wavefront .obj conventionally ships with a sibling .mtl of the same base name —
          // same directory, same filename, just the extension swapped (confirmed: the asset
          // pipeline's copyFolderSync() in tools/models/build-models.mjs already copies every
          // file in a model's folder to the public output, .mtl included — it just was never
          // being LOADED). Probing for it here means no registry/codegen change is needed: any
          // existing or future .obj either has one next to it or doesn't, and this reacts to
          // whichever is actually there instead of requiring it to be declared up front.
          const mtlPath = path.replace(/\.obj(\?.*)?$/i, '.mtl$1');
          try {
            const materials = await this._mtlLoader.loadAsync(mtlPath);
            materials.preload();
            objLoader.setMaterials(materials);
          } catch {
            // No sibling .mtl (404) — falls back to OBJLoader's own default material, same
            // flat/white result as before this fix. Not every .obj is expected to ship one.
          }

          return await objLoader.loadAsync(path);
        }
        default:
          throw new Error(`Unknown format for path: ${path}`);
      }
    })();

    this._inflight.set(cacheId, loadPromise);

    try {
      const loadedObject = await loadPromise;

      // 4. Cache the original
      this._cache.set(cacheId, loadedObject);

      // 5. Return a clone
      return loadedObject.clone(true);
    } catch (error) {
      console.error(`❌ ModelLoaderManager: Error loading [${path}]`, error);
      throw error;
    } finally {
      this._inflight.delete(cacheId);
    }
  }

  /**
 * Finds an object by name, checking both the standard name property 
 * and the userData.name property (where original names are often kept).
 */
  public findNode(root: THREE.Object3D, nodeName: string): THREE.Object3D | undefined {
    let found: THREE.Object3D | undefined;

    root.traverse((child) => {
      if (found) return; // Stop if already found
      if (child.name === nodeName || child.userData.name === nodeName) {
        found = child;
      }
    });

    return found;
  }
  /**
   * Retrieves a previously loaded model by its path, or by its id — an id shared by several
   * loaded paths is ambiguous, so it returns null (and warns) rather than guessing one.
   */
  public getModel(idOrPath: string): THREE.Object3D | null {
    const direct = this._cache.get(idOrPath.split('?')[0]);
    if (direct) {
      return direct.clone(true);
    }
    const paths = [...(this._pathsById.get(idOrPath) ?? [])].filter(path => this._cache.has(path));
    if (paths.length > 1) {
      console.warn(`ModelLoaderManager: "${idOrPath}" names ${paths.length} different models (${paths.join(', ')}) — look it up by path instead`);
      return null;
    }
    const cached = paths.length === 1 ? this._cache.get(paths[0]) : undefined;
    return cached ? cached.clone(true) : null;
  }

  /**
   * Clears a specific model (by path, or every path loaded under an id) or the whole cache
   */
  public clearCache(idOrPath?: string): void {
    if (!idOrPath) {
      this._cache.clear();
      this._pathsById.clear();
      return;
    }
    this._cache.delete(idOrPath.split('?')[0]);
    for (const path of this._pathsById.get(idOrPath) ?? []) {
      this._cache.delete(path);
    }
    this._pathsById.delete(idOrPath);
  }
}