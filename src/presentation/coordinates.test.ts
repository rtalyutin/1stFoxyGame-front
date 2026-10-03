import { it, expect } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { toScenePoint, toCombatAim } from './coordinates';

it('gameplay right projects to screen right in the native GLB scene', () => {
  const engine = new NullEngine(); const scene = new Scene(engine); scene.useRightHandedSystem = true;
  const camera = new FreeCamera('test', new Vector3(0, 11, -15), scene);
  camera.setTarget(new Vector3(0, 0, 6)); scene.updateTransformMatrix();
  const viewport = camera.viewport.toGlobal(1440, 900);
  const project = (x: number) => Vector3.Project(toScenePoint({ x, z: 10 }, 10, 1), Matrix.Identity(), scene.getTransformMatrix(), viewport);
  expect(project(1).x).toBeGreaterThan(project(0).x);
  expect(project(-1).x).toBeLessThan(project(0).x);
  const aim = { x: 2, z: 30 };
  expect(toCombatAim(toScenePoint(aim, 10, 0.65), 10)).toEqual(aim);
  scene.dispose(); engine.dispose();
});
