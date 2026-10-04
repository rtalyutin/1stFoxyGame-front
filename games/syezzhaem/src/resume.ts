import type {RunDto} from './r1-contracts';
import {CloudError} from './cloud';
import {fromServer,type DurableRun} from './outbox';
/** A launcher choice binds the run identity, independently of the latest local index. */
export async function chooseResume(owner:string,requestedId:string|null,local:DurableRun|null|undefined,active:RunDto|null,getRun:(id:string)=>Promise<RunDto>):Promise<{record:DurableRun;persist:boolean}|null>{
  const ownLocal=local?.owner_id===owner&&(!requestedId||local.run_id===requestedId)?local:null;
  if(ownLocal&&(ownLocal.inflight||ownLocal.pending||ownLocal.conflict||(!ownLocal.terminal_ack&&ownLocal.snapshot.outcome!=='playing')))return{record:ownLocal,persist:false};
  if(requestedId){
    if(active?.run_id===requestedId)return{record:fromServer(owner,active),persist:true};
    if(ownLocal)return{record:ownLocal,persist:false};
    const selected=await getRun(requestedId);
    if(selected.run_id!==requestedId)throw new CloudError('NOT_FOUND','Сервер вернул другой забег. Выбранная копия не заменена.');
    return{record:fromServer(owner,selected),persist:true};
  }
  if(active)return{record:fromServer(owner,active),persist:true};
  return ownLocal?{record:ownLocal,persist:false}:null;
}
