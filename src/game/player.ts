import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { playerConfig as cfg } from './playerConfig'

export type InputState = {
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
  jump: boolean
  /** True while left mouse button is held (pointer-lock only). */
  attack: boolean
  /** True while E key is held — interact with world objects. */
  interact: boolean
}

export type PlayerController = {
  mesh: THREE.Object3D
  /** Position of the capsule centre (bottom-centre of the capsule + half-height). */
  getPosition(): THREE.Vector3
  /** Call once per physics step with current input + camera yaw. */
  update(dt: number, input: InputState, cameraYaw: number): void
  /** Instantly move the physics body (and mesh) to the given world position. */
  teleport(position: { x: number; y: number; z: number }): void
  dispose(): void
}

const _tmpVec3 = new THREE.Vector3()
const _moveVec = new THREE.Vector3()

export function createPlayerController(
  world: RAPIER.World,
  scene: THREE.Scene,
  mesh: THREE.Object3D,
): PlayerController {
  // --- Physics capsule (kinematic position-based) ---
  const halfHeight = cfg.capsuleHeight / 2 - cfg.capsuleRadius
  const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 2, 0)
  const body = world.createRigidBody(bodyDesc)
  const collider = world.createCollider(
    RAPIER.ColliderDesc.capsule(halfHeight, cfg.capsuleRadius),
    body,
  )

  // character controller handles stepping up stairs + slopes + depenetration
  const controller = world.createCharacterController(0.01)
  controller.setApplyImpulsesToDynamicBodies(true)
  controller.enableAutostep(0.4, 0.1, true)
  controller.enableSnapToGround(0.4)

  scene.add(mesh)

  let verticalVelocity = 0
  let jumpCooldownRemaining = 0
  let coyoteRemaining = 0
  let wasOnGround = false

  const pos = new THREE.Vector3(0, 2, 0)

  function getPosition(): THREE.Vector3 {
    return pos.clone()
  }

  function update(dt: number, input: InputState, cameraYaw: number): void {
    const onGround = controller.computedGrounded()

    // coyote-time tracking
    if (wasOnGround && !onGround) {
      coyoteRemaining = cfg.coyoteTime
    }
    const canJump = onGround || coyoteRemaining > 0

    // vertical velocity
    if (onGround && verticalVelocity < 0) {
      verticalVelocity = 0
    }
    if (input.jump && canJump && jumpCooldownRemaining <= 0) {
      verticalVelocity = cfg.jumpImpulse
      jumpCooldownRemaining = cfg.jumpCooldown
      coyoteRemaining = 0
    }
    verticalVelocity -= 9.81 * dt

    jumpCooldownRemaining = Math.max(0, jumpCooldownRemaining - dt)
    coyoteRemaining = Math.max(0, coyoteRemaining - dt)

    // horizontal movement relative to camera yaw
    _moveVec.set(0, 0, 0)
    if (input.forward) _moveVec.z -= 1
    if (input.backward) _moveVec.z += 1
    if (input.left) _moveVec.x -= 1
    if (input.right) _moveVec.x += 1

    if (_moveVec.lengthSq() > 0) {
      _moveVec.normalize().multiplyScalar(cfg.moveSpeed * dt)
      // rotate horizontal movement to align with camera yaw
      _moveVec.applyEuler(new THREE.Euler(0, cameraYaw, 0))
    }

    const desiredMovement = {
      x: _moveVec.x,
      y: verticalVelocity * dt,
      z: _moveVec.z,
    }

    controller.computeColliderMovement(collider, desiredMovement)

    const computed = controller.computedMovement()
    const t = body.translation()
    body.setNextKinematicTranslation({
      x: t.x + computed.x,
      y: t.y + computed.y,
      z: t.z + computed.z,
    })

    // sync Three.js mesh — pivot at capsule bottom
    const tr = body.translation()
    pos.set(tr.x, tr.y, tr.z)
    const meshY = tr.y - cfg.capsuleHeight / 2
    mesh.position.set(tr.x, meshY, tr.z)

    // rotate mesh to face movement direction
    if (_moveVec.x !== 0 || _moveVec.z !== 0) {
      _tmpVec3.set(_moveVec.x, 0, _moveVec.z).normalize()
      const angle = Math.atan2(_tmpVec3.x, _tmpVec3.z)
      mesh.rotation.y = angle
    }

    wasOnGround = onGround
  }

  function teleport(position: { x: number; y: number; z: number }): void {
    body.setTranslation(position, true)
    body.setNextKinematicTranslation(position)
    pos.set(position.x, position.y, position.z)
    const meshY = position.y - cfg.capsuleHeight / 2
    mesh.position.set(position.x, meshY, position.z)
    verticalVelocity = 0
  }

  function dispose(): void {
    scene.remove(mesh)
    world.removeCharacterController(controller)
    world.removeCollider(collider, false)
    world.removeRigidBody(body)
  }

  return { mesh, getPosition, update, teleport, dispose }
}

/** Build a placeholder capsule mesh for when the GLB is not yet loaded. */
export function buildCapsuleMesh(): THREE.Object3D {
  const group = new THREE.Group()

  const mat = new THREE.MeshStandardMaterial({ color: 0x4dabf7, roughness: 0.5, metalness: 0.1 })

  // body cylinder
  const cylinder = new THREE.Mesh(
    new THREE.CylinderGeometry(
      cfg.capsuleRadius,
      cfg.capsuleRadius,
      cfg.capsuleHeight - 2 * cfg.capsuleRadius,
      16,
    ),
    mat,
  )
  cylinder.castShadow = true
  group.add(cylinder)

  // top hemisphere
  const topCap = new THREE.Mesh(new THREE.SphereGeometry(cfg.capsuleRadius, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat)
  topCap.position.y = (cfg.capsuleHeight - 2 * cfg.capsuleRadius) / 2
  topCap.castShadow = true
  group.add(topCap)

  // bottom hemisphere
  const botCap = new THREE.Mesh(new THREE.SphereGeometry(cfg.capsuleRadius, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat)
  botCap.position.y = -(cfg.capsuleHeight - 2 * cfg.capsuleRadius) / 2
  botCap.castShadow = true
  group.add(botCap)

  // centred at capsule bottom → shift up by half-height
  group.position.y = cfg.capsuleHeight / 2
  return group
}
