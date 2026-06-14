import RAPIER from '@dimforge/rapier3d-compat'

export type PhysicsContext = {
  world: RAPIER.World
  step: () => void
}

export async function createPhysics(): Promise<PhysicsContext> {
  await RAPIER.init()

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })

  return {
    world,
    step: () => world.step(),
  }
}

export function addStaticGround(world: RAPIER.World): RAPIER.RigidBody {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  // Half-extents: 50 m wide/deep, 0.1 m tall → visual y ≈ -0.1 centre
  world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.1, 50), body)
  return body
}

export function addDynamicCube(
  world: RAPIER.World,
  pos: { x: number; y: number; z: number },
): RAPIER.RigidBody {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z),
  )
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5), body)
  return body
}
