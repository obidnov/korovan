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
  // Collider centre at y=-0.1 so top sits at y=0, matching the visual mesh top (mesh at y=-0.1 centre, height 0.2)
  world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.1, 50).setTranslation(0, -0.1, 0), body)
  return body
}

export function addStaticBox(
  world: RAPIER.World,
  pos: { x: number; y: number; z: number },
  halfExtents: { x: number; y: number; z: number },
): RAPIER.RigidBody {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z).setTranslation(pos.x, pos.y, pos.z),
    body,
  )
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
