import * as THREE from 'three'

const COLOR_INNER = new THREE.Color(0x4a7c59) // forest green
const COLOR_OUTER = new THREE.Color(0x6b4e37) // earthy brown

/** Creates a 200×200 flat terrain plane centred at the world origin.
 *  Surface sits at y=0, matching the Rapier ground collider top.
 *  Vertex colours blend from green (centre) to brown (edges). */
export function createTerrain(scene: THREE.Scene): THREE.Mesh {
  const segments = 40
  const geo = new THREE.PlaneGeometry(200, 200, segments, segments)
  geo.rotateX(-Math.PI / 2)

  const count = geo.attributes.position.count
  const colors = new Float32Array(count * 3)

  for (let i = 0; i < count; i++) {
    const x = geo.attributes.position.getX(i)
    const z = geo.attributes.position.getZ(i)
    // Fade to brown beyond ~80 m from centre
    const t = Math.min(Math.sqrt(x * x + z * z) / 80, 1)
    const c = COLOR_INNER.clone().lerp(COLOR_OUTER, t)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
  })

  const mesh = new THREE.Mesh(geo, mat)
  mesh.receiveShadow = true
  scene.add(mesh)

  return mesh
}
