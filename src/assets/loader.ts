import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import type { AnimationClip, Group } from 'three'

export interface LoadedGLTF {
  scene: Group
  animations: AnimationClip[]
}

const _loader = new GLTFLoader()
const _cache = new Map<string, Promise<LoadedGLTF>>()

/** Load a glTF/GLB from `url`, returning scene root + animations.
 *  Repeated calls with the same URL return the same in-flight Promise (dedup cache). */
export function loadGLTF(url: string): Promise<LoadedGLTF> {
  const hit = _cache.get(url)
  if (hit) return hit

  const p = new Promise<LoadedGLTF>((resolve, reject) => {
    _loader.load(
      url,
      (gltf: GLTF) => resolve({ scene: gltf.scene, animations: gltf.animations }),
      undefined,
      reject,
    )
  })
  _cache.set(url, p)
  return p
}

/** Pre-warm multiple URLs in parallel. Useful for preloading level assets. */
export function preloadGLTF(urls: string[]): Promise<LoadedGLTF[]> {
  return Promise.all(urls.map(loadGLTF))
}

/** Evict a URL from the cache (e.g. after hot-reload or asset swap). */
export function evictGLTF(url: string): void {
  _cache.delete(url)
}
