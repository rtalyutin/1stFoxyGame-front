import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Point } from '../game/simulation';

// A right-handed camera looking towards +Z has screen-right along -X.
// Keep gameplay +X as the player's right without mirroring GLB geometry.
export function toScenePoint(point: Point, distance: number, height = 0): Vector3 {
  return new Vector3(-point.x, height, point.z - distance);
}

export function toCombatAim(point: Vector3, distance: number): Point {
  return { x: Math.max(-35, Math.min(35, -point.x)), z: distance + Math.max(0.6, Math.min(60, point.z)) };
}
