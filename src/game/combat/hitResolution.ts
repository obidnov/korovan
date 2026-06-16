/**
 * Compute the center of the melee hit-sphere from the player's position and
 * the camera's orbit yaw (radians). The camera sits at (sin(yaw), cos(yaw))
 * relative to the player, so the player aims in the opposite direction:
 * fwd = (-sin(yaw), -cos(yaw)).
 *
 * This ensures the hit sphere tracks where the player is *looking* (camera aim),
 * not the direction the mesh last moved.
 */
export function computeHitCenter(
  playerPos: { x: number; y: number; z: number },
  cameraYaw: number,
  reach: number,
): { x: number; y: number; z: number } {
  // Player aims opposite to camera orbit position — negate sin/cos.
  const fwdX = -Math.sin(cameraYaw)
  const fwdZ = -Math.cos(cameraYaw)
  return {
    x: playerPos.x + fwdX * reach,
    y: playerPos.y,
    z: playerPos.z + fwdZ * reach,
  }
}
