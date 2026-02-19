import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

export default class ModelLoaderManager {
  private static _instance: ModelLoaderManager;
  private _cache: Map<string, THREE.Object3D> = new Map();

  private _gltfLoader = new GLTFLoader();
  private _fbxLoader = new FBXLoader();
  private _objLoader = new OBJLoader();

  private constructor() { }

  public static get instance(): ModelLoaderManager {
    if (!ModelLoaderManager._instance) {
      ModelLoaderManager._instance = new ModelLoaderManager();
    }
    return ModelLoaderManager._instance;
  }

  /**
   * Loads a model from a path or returns a clone from cache.
   * @param path The full URL/path to the model file.
   * @param id Optional custom ID. If not provided, filename is used.
   */
  public async loadModel(path: string, id?: string): Promise<THREE.Object3D> {
    // Generate cache key: Use provided ID or extract filename from path
    const cacheId = id || path.split('/').pop()?.split('?')[0] || path;

    // 1. Return from cache if exists
    if (this._cache.has(cacheId)) {
      return this._cache.get(cacheId)!.clone(true);
    }

    // 2. Determine extension
    const extension = path.split('.').pop()?.toLowerCase();
    let loadedObject: THREE.Object3D;

    try {
      switch (extension) {
        case 'glb':
        case 'gltf':
          const gltf = await this._gltfLoader.loadAsync(path);
          loadedObject = gltf.scene;
          break;
        case 'fbx':
          loadedObject = await this._fbxLoader.loadAsync(path);
          break;
        case 'obj':
          loadedObject = await this._objLoader.loadAsync(path);
          break;
        default:
          throw new Error(`Unknown format for path: ${path}`);
      }

      // 3. Cache the original
      this._cache.set(cacheId, loadedObject);

      // 4. Return a clone
      return loadedObject.clone(true);
    } catch (error) {
      console.error(`❌ ModelLoaderManager: Error loading [${path}]`, error);
      throw error;
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
   * Retrieves a previously loaded model by its ID or Path-name
   */
  public getModel(id: string): THREE.Object3D | null {
    const cached = this._cache.get(id);
    return cached ? cached.clone(true) : null;
  }

  /**
   * Clears a specific model or the whole cache
   */
  public clearCache(id?: string): void {
    if (id) {
      this._cache.delete(id);
    } else {
      this._cache.clear();
    }
  }
}