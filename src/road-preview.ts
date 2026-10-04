import { WorldView } from './presentation/world';
import { RunSimulation, type Command } from './game/simulation';
import { FIXED_STEP } from './game/config';
const world = new WorldView(document.querySelector<HTMLCanvasElement>('#game')!);
let sim = new RunSimulation('local-road-preview', 421);
let playing = true, last = performance.now(), accumulator = 0;
const pending: Command[] = [];
await world.loadAssets();
await world.scene.whenReadyAsync();
document.querySelector('#status')!.textContent = 'Собственные материалы земли, камня и мха';
document.querySelector('#pause')!.addEventListener('click', () => {
  playing = !playing; document.querySelector('#pause')!.textContent = playing ? 'Пауза' : 'Продолжить';
});
document.querySelector('#cast')!.addEventListener('click', () => pending.push({ type: 'cast', aim: { x: 1, z: sim.state.hero.z + 18 } }));
world.engine.runRenderLoop(() => {
  const now = performance.now(), delta = Math.min((now - last) / 1000, 0.1); last = now;
  if (playing) {
    accumulator += delta;
    while (accumulator >= FIXED_STEP) {
      if (sim.state.phase === 'gameOver') sim = new RunSimulation('local-road-preview', 421);
      sim.step(pending.splice(0)); accumulator -= FIXED_STEP;
    }
  }
  world.render(sim, { x: 1, z: sim.state.hero.z + 18 }, playing ? delta : 0);
});
// Local verification surface: it drives the same WorldView used by the client.
const debug = {
  world,
  freezeAt(distance: number, x = 0) { playing = false; sim.state.hero.z = distance; sim.state.hero.x = x; sim.state.enemies = []; sim.state.projectiles = []; sim.state.phase = 'running'; world.render(sim, { x: 1, z: distance + 18 }, 0); },
  snapshot() {
    return { meshes: world.scene.meshes.length, materials: world.scene.materials.length, textures: world.scene.textures.length,
      shadersReady: world.scene.isReady(), sections: world.scene.transformNodes.filter(n => n.name.startsWith('section-')).map(n => ({name:n.name,z:n.position.z})),
      terrain: world.scene.meshes.filter(m => /^(road-|shoulder_|rock-|grass-)/.test(m.name)).map(m => ({ name:m.name,triangles:m.getTotalIndices()/3,material:m.material?.getClassName() })) };
  }
};
(window as unknown as {roadPreview: typeof debug}).roadPreview = debug;
