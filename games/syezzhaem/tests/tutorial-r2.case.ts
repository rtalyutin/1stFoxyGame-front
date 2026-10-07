import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitial,step,snapshot,targetAt} from '../src/core';
import {tutorialGuide,tutorialAction} from '../src/tutorial';

test('R2 guided start uses two real safe wall-to-world transfers while timers wait',()=>{
  const s=createInitial(crypto.randomUUID(),'r2-map-1'),before=snapshot(s);
  for(let i=0;i<300;i++)step(s,{left:false,right:true,jump:true});
  assert.deepEqual(s,before);
  let commands=0;
  while((s.tutorialPlacements??0)<2){
    const guide=tutorialGuide(s)!;assert.ok(guide.target);assert.notEqual(guide.target!.blockId,s.player.support?.blockId);assert.notEqual(guide.phase,'wait');
    assert.equal(tutorialAction(s,guide.action,guide.target!).ok,true);commands++;
    if((s.tutorialPlacements??0)<2){step(s);assert.equal(s.tick,0);assert.equal(s.lava!.x,before.lava!.x);}
  }
  assert.equal(commands,4);assert.equal(tutorialGuide(s),null);
  assert.deepEqual(s.blocks.filter(b=>b.space==='world'&&b.portable&&[9,10].includes(b.x)).map(b=>b.x).sort((a,b)=>a-b),[9,10]);
  step(s);assert.equal(s.tick,1);assert.ok(s.lava!.x>before.lava!.x);
});

test('disabling hints releases only the UI guard and never fabricates completed tutorial cells',()=>{
  const s=createInitial(crypto.randomUUID(),'r2-map-1'),before=snapshot(s);
  assert.equal(tutorialGuide(s,false),null);assert.deepEqual(s,before);
  const floor=targetAt(s,'house',4,0);assert.equal(tutorialAction(s,'take',floor,'wood',true).ok,false);assert.deepEqual(s,before);
  assert.equal(tutorialAction(s,'take',floor,'wood',false).ok,true);assert.equal(s.tutorialPlacements,0);assert.equal(s.player.support,null);
  step(s);assert.equal(s.tick,0);assert.equal(s.tutorialPlacements,0);
});
