# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-06-14

### Added
- Player capsule with Rapier kinematic character controller (`src/game/player.ts`)
- WASD movement (camera-yaw-relative) + space-bar jump with coyote-time (0.12 s) and cooldown (0.25 s)
- 3rd-person orbit camera with exponential-smooth follow and wall-clip avoidance via shadow-receiver raycast (`src/game/camera.ts`)
- Keyboard + pointer-lock mouse input handler (`src/game/input.ts`)
- All player/camera tunables in a single config (`src/game/playerConfig.ts`)
- Loads `player.glb` from asset pipeline; falls back to capsule primitive if missing
- 10 unit tests for camera follow math (`cameraIdealPosition` × 7, `wallClipDistance` × 3)

## [0.1.0] - 2026-06-14

### Added
- Vite + Three.js + Rapier3D project bootstrap
- Asset pipeline: glTF/GLB loader with preload/evict cache (`src/assets/loader.ts`)
- 5 CC0 placeholder assets (player, soldier, house-elf, tree, tree-billboard)
- `/dev/assets` preview page for asset inspection
- Smoke-test render loop with stats overlay
