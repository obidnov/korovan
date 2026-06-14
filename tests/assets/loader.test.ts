import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stub GLTFLoader before importing the module under test
vi.mock('three/addons/loaders/GLTFLoader.js', () => {
  return {
    GLTFLoader: class MockGLTFLoader {
      load(
        url: string,
        onLoad: (gltf: { scene: string; animations: unknown[] }) => void,
        _onProgress: undefined,
        _onError: (e: Error) => void,
      ) {
        if (url.includes('__error__')) {
          _onError(new Error('load failed'))
        } else {
          onLoad({ scene: `scene:${url}`, animations: [`anim:${url}`] })
        }
      }
    },
  }
})

// Import after mock registration
const { loadGLTF, preloadGLTF, evictGLTF } = await import('../../src/assets/loader.js')

describe('loadGLTF', () => {
  beforeEach(() => {
    evictGLTF('/a.glb')
    evictGLTF('/b.glb')
    evictGLTF('/dup.glb')
    evictGLTF('/__error__.glb')
  })

  it('resolves with scene and animations', async () => {
    const result = await loadGLTF('/a.glb')
    expect(result.scene).toBe('scene:/a.glb')
    expect(result.animations).toEqual(['anim:/a.glb'])
  })

  it('returns the same Promise for concurrent calls (dedup)', () => {
    const p1 = loadGLTF('/dup.glb')
    const p2 = loadGLTF('/dup.glb')
    expect(p1).toBe(p2)
  })

  it('rejects when the loader fails', async () => {
    await expect(loadGLTF('/__error__.glb')).rejects.toThrow('load failed')
  })
})

describe('evictGLTF', () => {
  it('removes the url so the next call creates a fresh Promise', async () => {
    const p1 = loadGLTF('/a.glb')
    await p1
    evictGLTF('/a.glb')
    const p2 = loadGLTF('/a.glb')
    expect(p2).not.toBe(p1)
  })
})

describe('preloadGLTF', () => {
  it('resolves all urls in parallel', async () => {
    const results = await preloadGLTF(['/a.glb', '/b.glb'])
    expect(results).toHaveLength(2)
    expect(results[0].scene).toBe('scene:/a.glb')
    expect(results[1].scene).toBe('scene:/b.glb')
  })
})
