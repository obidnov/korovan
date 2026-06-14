/** All tunable player + camera constants live here. */
export const playerConfig = {
  // Movement
  moveSpeed: 6, // m/s on ground

  // Jump
  jumpImpulse: 7, // m/s initial vertical velocity
  jumpCooldown: 0.25, // seconds between jumps
  coyoteTime: 0.12, // seconds of grace after leaving ground

  // Physics capsule
  capsuleHeight: 1.6, // total height
  capsuleRadius: 0.3,

  // Camera
  cameraDistance: 6, // preferred follow distance
  cameraMinDistance: 1.5, // clamp after wall-clip raycast
  cameraHeightOffset: 1.5, // look-at pivot above capsule base
  cameraYawSensitivity: 0.003, // radians per pixel
  cameraPitchSensitivity: 0.003,
  cameraPitchMin: -0.35, // ~-20°
  cameraPitchMax: 1.2, // ~70°
  cameraSmoothFactor: 8, // lerp speed (higher = snappier)
} as const
