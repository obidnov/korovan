/**
 * Compute the center of the melee hit-sphere from the player's position and
 * the camera aim yaw (radians). Using camera yaw ensures the hit sphere
 * tracks where the player is *looking*, not the direction the mesh last moved.
 */
export function computeHitCenter(
  playerPos: { x: number; y: number; z: number },
  aimYaw: number,
  reach: number,
): { x: number; y: number; z: number } {
  const fwdX = Math.sin(aimYaw)
  const fwdZ = Math.cos(aimYaw)
  return {
    x: playerPos.x + fwdX * reach,
    y: playerPos.y,
    z: playerPos.z + fwdZ * reach,
  }
}
