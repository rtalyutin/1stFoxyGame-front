import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitial,step,snapshot,restore,targetAt} from '../src/core';
import {tutorialGuide,tutorialAction} from '../src/tutorial';
import {toSnapshotV1,fromSnapshotV1,CURRENT_BUILD_CONTEXT,BUILD_CONTEXT,validateSnapshotV1} from '../src/snapshot-v1';
import {rulesFor} from '../src/contracts';

test('first real wall-to-bridge transfer is untimed, safe, and survives a fresh snapshot load',()=>{
  let s=createInitial(crypto.randomUUID(),'r1-map-2');
  const original=snapshot(s);
  for(let i=0;i<600;i++)step(s,{left:false,right:true,jump:true});
  assert.deepEqual(s,original);
  assert.equal(tutorialAction(s,'take',targetAt(s,'house',4,0)).ok,false);
  assert.deepEqual(s,original);
  const g=tutorialGuide(s)!;
  assert.equal(g.target?.blockId,'original:7:1');
  assert.equal(tutorialAction(s,'take',g.target!).ok,true);
  assert.equal(s.player.support?.blockId,'original:4:0');
  s=fromSnapshotV1(toSnapshotV1(s,CURRENT_BUILD_CONTEXT));
  assert.equal(tutorialGuide(s)?.phase,'place');
  for(let i=0;i<600;i++)step(s);
  assert.equal(s.tick,0);
  assert.equal(tutorialAction(s,'place',tutorialGuide(s)!.target!).ok,true);
  step(s);
  assert.ok(s.house.x>2);
  assert.equal(s.tick,1);
  assert.equal(s.blocks.find(b=>b.space==='world'&&b.x===9&&b.y===0)?.originalId,null);
});

test('two guided blocks form a fixed bridge and carry the idle novice safely to the portal',()=>{
  let s=createInitial(crypto.randomUUID(),'r1-map-2');
  let commands=0,waited=false;
  for(let i=0;i<2400&&s.outcome==='playing';i++){
    const guide=tutorialGuide(s)!;
    if(guide.phase==='take'||guide.phase==='place'){
      assert.equal(tutorialAction(s,guide.action,guide.target!).ok,true);
      commands++;
      s=fromSnapshotV1(toSnapshotV1(s,CURRENT_BUILD_CONTEXT));
    }else if(guide.phase==='wait')waited=true;
    step(s);restore(s);
  }
  assert.equal(commands,4);assert.ok(waited);
  assert.equal(s.outcome,'won');assert.equal(s.player.hp,3);
  assert.equal(s.player.support?.blockId,'original:4:0');
  assert.deepEqual(s.blocks.filter(b=>b.space==='world'&&b.portable).map(b=>b.x).sort((a,b)=>a-b),[9,10]);
});

test('legacy content keeps its movement and 90-tick timer; mixed versions and relabeling are rejected',()=>{
  const old=createInitial(),current=createInitial(crypto.randomUUID(),'r1-map-2');
  step(old);assert.equal(old.tick,1);assert.ok(old.house.x>2);
  assert.equal(rulesFor(old).supportGrace,1.5);
  assert.equal(rulesFor(current).supportGrace,4);
  assert.deepEqual(fromSnapshotV1(toSnapshotV1(old,BUILD_CONTEXT)),old);
  assert.throws(()=>toSnapshotV1(old,CURRENT_BUILD_CONTEXT),/mismatch/);
  const encoded=toSnapshotV1(current,CURRENT_BUILD_CONTEXT);
  assert.throws(()=>fromSnapshotV1({...encoded,rules_version:'r1-rules-1'}),/incompatible/);
  assert.throws(()=>validateSnapshotV1(encoded,BUILD_CONTEXT),/pinned/);
});
