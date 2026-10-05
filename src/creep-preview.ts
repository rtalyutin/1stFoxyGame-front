import { WorldView } from './presentation/world';
import { RunSimulation, type Command, type EnemyKind } from './game/simulation';
import { FIXED_STEP } from './game/config';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';

const world = new WorldView(document.querySelector<HTMLCanvasElement>('#game')!);
const camera = world.scene.activeCamera as FreeCamera;
const gameCamera = camera.position.clone();
let sim: RunSimulation;
let playing = false, mode = '', accumulator = 0, last = performance.now(), sequence = 0;
const pending: Command[] = [];
const status = document.querySelector('#status')!;
await world.loadAssets();
await world.scene.whenReadyAsync();

function scenario(next: string): void {
  mode = next; pending.length = 0; accumulator = 0; playing = next === 'run';
  const lineup = [{ id: 'normal', kind: 'normal' as EnemyKind, x: -2.7, z: 11 },
    { id: 'strong', kind: 'strong' as EnemyKind, x: 0, z: 11 }, { id: 'boss', kind: 'boss' as EnemyKind, x: 2.7, z: 11 }];
  const enemies = next === 'stress' ? Array.from({ length: 11 }, (_, i) => ({ id: `stress-${i}`, kind: (i === 10 ? 'boss' : i > 7 ? 'strong' : 'normal') as EnemyKind, x: (i % 3 - 1) * 2.7, z: 8 + Math.floor(i / 3) * 5 }))
    : ['closeup', 'capture', 'impact'].includes(next) ? [{ id: 'normal', kind: 'normal' as EnemyKind, x: 0, z: 11 }] : lineup;
  sim = new RunSimulation(`wood-review-${++sequence}`, 421, next === 'run' ? {} : {
    config: { spawning: false, heroSpeed: 0, enemySpeed: 0, bossEnemySpeed: 0, shooterInterval: 1000, bossInterval: 1000 }, initialEnemies: enemies,
  });
  sim.state.time = .3;
  if (next === 'impact' || next === 'capture') {
    sim.state.events = [{ type: 'hit', at: 0, enemyId: 'normal' }];
    if (next === 'capture') {
      sim.state.time = .85; sim.state.enemies[0].status = 'captured';
      sim.state.hook = { x: 0, z: 8, castId: 'review-cast', phase: 'returning', direction: { x: 0, z: 1 }, traveled: 11,
        capturedEnemyId: 'normal', capturedEnemyIds: ['normal'], hitEnemyIds: ['normal'], outboundHits: 1, returnHits: 0,
        config: { range: 30, outboundSpeed: 35, returnSpeed: 45, cooldown: 2, radius: .35, pierceTargets: 1, returnHitTargets: 0, goldMultiplierMilli: 1000 } };
    }
  }
  if (['closeup', 'impact', 'capture'].includes(next)) {
    camera.position.set(3.3, 3.5, next === 'capture' ? 3 : 5.5);
    camera.setTarget(new Vector3(0, .7, next === 'capture' ? 8 : 11)); camera.fov = .55;
  } else {
    camera.position.copyFrom(gameCamera); camera.setTarget(new Vector3(0, 0, 10)); camera.fov = .85;
  }
  document.querySelector('#pause')!.textContent = playing ? 'Пауза' : 'Продолжить';
  world.render(sim, { x: 0, z: sim.state.hero.z + 18 }, 0);
}
for (const name of ['lineup', 'closeup', 'impact', 'capture', 'stress', 'run']) document.querySelector(`#${name}`)!.addEventListener('click', () => scenario(name));
document.querySelector('#pause')!.addEventListener('click', () => { playing = !playing; document.querySelector('#pause')!.textContent = playing ? 'Пауза' : 'Продолжить'; });
document.querySelector('#cast')!.addEventListener('click', () => { pending.push({ type: 'cast', aim: { x: 0, z: sim.state.hero.z + 25 } }); playing = true; document.querySelector('#pause')!.textContent = 'Пауза'; });
scenario('lineup');
let lastStats = 0;
world.engine.runRenderLoop(() => {
  const now = performance.now(), delta = Math.min((now - last) / 1000, .1); last = now;
  if (playing) {
    accumulator += delta;
    while (accumulator >= FIXED_STEP) { sim.step(pending.splice(0)); world.observe(sim.state); accumulator -= FIXED_STEP; }
  }
  world.render(sim, { x: 0, z: sim.state.hero.z + 25 }, playing ? delta : 0);
  if (now - lastStats > 300) {
    const enemies = sim.state.enemies;
    status.textContent = `${mode} · ${enemies.length} крипов · ${sim.state.phase} · ${sim.state.time.toFixed(2)} с · ${world.engine.getFps().toFixed(0)} FPS · ${world.scene.isReady() ? 'Материалы готовы' : 'Загрузка шейдеров'}`;
    lastStats = now;
  }
});
// Read-only diagnostics, also rendered in the page status. Scenario controls use
// actual WorldView; the gameplay button advances the unmodified RunSimulation.
const diagnostics = () => {
  const skinned = world.scene.meshes.filter(mesh => mesh instanceof Mesh && mesh.skeleton && !mesh.name.startsWith('hero:'));
  const material = skinned[0]?.material;
  const socketNodes = world.scene.transformNodes.filter(node => node.name.endsWith(':socket_creep_capture'));
  for (const node of socketNodes) node.computeWorldMatrix(true);
  const hookNode = world.scene.transformNodes.find(node => node.name === 'hook:socket_target_hook');
  hookNode?.computeWorldMatrix(true);
  return { mode, phase: sim.state.phase, time: sim.state.time, enemies: sim.state.enemies.map(enemy => ({ id: enemy.id, kind: enemy.kind, status: enemy.status, hitsRemaining: enemy.hitsRemaining })),
    ready: world.scene.isReady(), fps: world.engine.getFps(), meshCount: world.scene.meshes.length, materials: world.scene.materials.length, textures: world.scene.textures.length,
    creepMeshes: skinned.map(mesh => ({ name: mesh.name, enabled: mesh.isEnabled(), triangles: mesh.getTotalIndices() / 3, material: mesh.material?.getClassName(), materialName: mesh.material?.name })),
    creepMaterial: material ? { name: material.name, type: material.getClassName(), textures: material.getActiveTextures().map(texture => ({ name: texture.name, ready: texture.isReady() })) } : null,
    sockets: socketNodes.map(node => ({ name: node.name, position: node.getAbsolutePosition().asArray() })), hook: hookNode?.getAbsolutePosition().asArray(),
    kills: sim.state.kills, hookPhase: sim.state.hook?.phase, events: sim.state.events };
};
(window as unknown as { creepPreview: { snapshot: typeof diagnostics } }).creepPreview = { snapshot: diagnostics };
