import {rulesFor, type Snapshot, type Target, type ActionResult} from './contracts';
import {targetAt, canTake, canPlace, take, place} from './core';

export interface TutorialGuide {
  phase: 'take'|'place'|'wait'|'ride';
  target: Target|null;
  action: 'take'|'place';
  title: string;
  instruction: string;
  filled: number;
}

/** Progress comes from the saved world, so refresh and another device keep the same step. */
export function tutorialGuide(s: Snapshot): TutorialGuide|null {
  if(s.contentVersion!=='r1-map-2'||s.outcome!=='playing')return null;
  const rules=rulesFor(s);
  const cells=Array.from({length:rules.gapEnd-rules.gapStart+1},(_,i)=>targetAt(s,'world',rules.gapStart+i,0));
  const filled=cells.filter(cell=>cell.blockId!==null).length, missing=cells.find(cell=>cell.blockId===null);
  if(!missing)return {phase:'ride',target:null,action:'take',filled,title:'Мост готов! Дом едет к порталу.',instruction:'Оставайся на полу дома. A / D или кнопки слева — идти; пробел или ↥ — прыгать.'};
  if(s.inventory.wood>0){
    const ready=canPlace(s,missing).ok;
    return {phase:ready?'place':'wait',target:missing,action:'place',filled,
      title:ready?`Поставь блок в отмеченную клетку · мост ${filled}/2`:'Дом подъезжает к следующей клетке.',
      instruction:ready?'Выбран режим «СТРОИТЬ». Нажми на отметку и отпусти. ПКМ тоже ставит блок.':'Подожди на полу дома. Как только клетка станет доступна, появится подсказка «Поставь».'};
  }
  const safe=s.blocks.filter(b=>b.space==='house'&&b.portable&&b.id!==s.player.support?.blockId)
    .sort((a,b)=>Number(b.x===7)-Number(a.x===7)||a.y-b.y);
  const selected=safe.map(b=>targetAt(s,b.space,b.x,b.y)).find(t=>canTake(s,t).ok)??null;
  return {phase:'take',target:selected,action:'take',filled,
    title:filled===0?'1. Возьми подсвеченный блок стены.':'Ещё один блок — и мост готов.',
    instruction:filled===0?'Дом ждёт. Нажми на зелёный блок и отпусти — он попадёт в рюкзак.':'Нажми на зелёный блок стены. Пол под персонажем оставь на месте.'};
}

export function tutorialAction(s:Snapshot, action:'take'|'place', selected:Target):ActionResult {
  const guide=tutorialGuide(s);
  if(guide&&guide.phase!=='ride'){
    if(guide.phase==='wait')return {ok:false,reason:guide.title};
    if(action!==guide.action||!guide.target||selected.space!==guide.target.space||selected.x!==guide.target.x||selected.y!==guide.target.y||selected.blockId!==guide.target.blockId)
      return {ok:false,reason:guide.action==='take'?'Сначала возьми зелёный блок стены.':'Теперь поставь блок в голубую клетку моста.'};
  }
  return (action==='take'?take:place)(s,selected);
}
