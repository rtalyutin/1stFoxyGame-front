import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {importModel,ModelLibrary,modelPath} from './models';
import {PresentationTimeline} from './timeline';
import {RunSimulation} from '../game/simulation';

it('loads the separate R2 shooter and boss, samples their clips and uses the native projectile attachment',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
 for(const name of ['enemy_shooter','enemy_boss']as const){
  const container=await importModel(name,readFileSync(new URL('../../public/'+modelPath(name),import.meta.url)),scene);
  const library=new ModelLibrary(new Map([[name,container]]),scene),actor=library.create(name,'qa-'+name);
  for(const group of actor.entries.animationGroups){const clip=group.name.slice(('qa-'+name).length+1),seconds=actor.clipDuration(clip);
   expect(seconds).toBeGreaterThan(0);actor.pose(clip,seconds*.5,false);
   for(const socket of ['socket_projectile','socket_creep_capture','socket_weapon'])expect(actor.socket(socket).asArray().every(Number.isFinite)).toBe(true);
  }
  actor.dispose();library.dispose();
 }
 scene.dispose();engine.dispose();
});

it('follows simulation telegraph/shot/hit events and keeps restored captures finite',()=>{
 const sim=new RunSimulation('enemy-poses',1,{config:{spawning:false},initialEnemies:[{id:'boss',kind:'boss',x:0,z:12}]});
 const enemy=sim.state.enemies[0],timeline=new PresentationTimeline(),duration=()=>1;
 enemy.shooting={phase:'telegraph',remaining:.5,directions:[{x:0,z:-1},{x:0,z:-1},{x:0,z:-1}]};timeline.observe(sim.state);
 expect(timeline.enemy(enemy,0,1,duration)).toEqual({clip:'shoot_prepare',seconds:.5,loop:false});
 sim.state.tick++;sim.state.time=.5;sim.state.events=[{type:'shoot',at:.5,enemyId:'boss',kind:'boss'}];enemy.shooting={phase:'cooldown',remaining:2,directions:[]};timeline.observe(sim.state);
 expect(timeline.enemy(enemy,.5,1,duration).clip).toBe('shoot');
 sim.state.tick++;sim.state.time=.6;sim.state.events=[{type:'hit',at:.6,enemyId:'boss',kind:'boss',lethal:false}];timeline.observe(sim.state);
 expect(timeline.enemy(enemy,.6,1,duration).clip).toBe('hit_recover');expect(timeline.enemy(enemy,1.7,1,duration).clip).toBe('break_free');
 timeline.reset();enemy.status='captured';expect(timeline.enemy(enemy,4,1,duration)).toEqual({clip:'death_capture',seconds:0,loop:false});
});
