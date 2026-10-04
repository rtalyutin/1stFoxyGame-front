import type {SnapshotV1,RunDto} from './r1-contracts';
import {read,writeMany,mutate} from './storage';
import {CloudError,rpc} from './cloud';
import {randomId} from './core';
export type SaveOperation='checkpoint_save_v1'|'run_finish_v1'|'run_abandon_v1';
export interface Pending{operation:SaveOperation;snapshot?:SnapshotV1;outcome?:'won'|'lost'}
export interface Command{operation:SaveOperation;request_id:string;base_revision:number;body:Record<string,unknown>;status:'inflight'}
export interface DurableRun{owner_id:string;run_id:string;lifecycle?:RunDto['lifecycle'];client_build_id:string;content_version:string;rules_version:string;api_version:1;revision:number;snapshot:SnapshotV1;updated_at:string;confirmed_at:string|null;confirmed_tick:number;inflight:Command|null;pending:Pending|null;conflict:boolean;terminal_ack:boolean}
export interface DurableStore{load:(key:string)=>Promise<DurableRun|undefined>;commit:(value:DurableRun)=>Promise<void>;update:(key:string,fn:(row:DurableRun)=>DurableRun)=>Promise<DurableRun>}
export const runKey=(owner:string,run:string)=>`run:${owner}:${run}`;
export function resumeMetadata(value:DurableRun){return{owner_id:value.owner_id,run_id:value.run_id,client_build_id:value.client_build_id,content_version:value.content_version,rules_version:value.rules_version,api_version:1,updated_at:value.updated_at};}
export function fromServer(owner:string,run:RunDto):DurableRun{return{owner_id:owner,run_id:run.run_id,lifecycle:run.lifecycle,client_build_id:run.checkpoint.client_build_id,content_version:run.checkpoint.content_version,rules_version:run.checkpoint.rules_version,api_version:1,revision:run.revision,snapshot:run.checkpoint,updated_at:run.updated_at,confirmed_at:run.updated_at,confirmed_tick:run.checkpoint.sim_tick,inflight:null,pending:null,conflict:false,terminal_ack:run.lifecycle!=='active'};}
export const browserStore:DurableStore={load:read,commit:value=>writeMany([[runKey(value.owner_id,value.run_id),value],[`resume:${value.owner_id}`,resumeMetadata(value)]]),update:(key,fn)=>mutate<DurableRun>(key,current=>{if(!current)throw new Error('Нет очереди забега');return fn(current);},value=>[[`resume:${value.owner_id}`,resumeMetadata(value)]])};
/** Mutations are serialized locally and atomic across tabs in IndexedDB. */
export class Outbox{
  private serial:Promise<unknown>=Promise.resolve();private sending=false;private allowed=true;
  constructor(public owner:string,public runId:string,private store:DurableStore=browserStore,private send:(operation:string,body:unknown)=>Promise<any>=rpc,private event:(type:string,value?:unknown)=>void=()=>{}){}
  private task<T>(fn:()=>Promise<T>):Promise<T>{const promise=this.serial.then(fn,fn);this.serial=promise.catch(()=>{});return promise;}
  private edit(fn:(row:DurableRun)=>DurableRun){return this.store.update(runKey(this.owner,this.runId),row=>{if(row.owner_id!==this.owner||row.run_id!==this.runId)throw new Error('Владелец очереди не совпадает');return fn(row);});}
  hold(){this.allowed=false;}allow(){this.allowed=true;}
  record(){return this.store.load(runKey(this.owner,this.runId));}
  async capture(snapshot:SnapshotV1):Promise<void>{await this.task(async()=>{const value=await this.edit(row=>{
    if(row.terminal_ack||row.pending?.operation==='run_finish_v1'||row.pending?.operation==='run_abandon_v1'||row.inflight?.operation==='run_finish_v1'||row.inflight?.operation==='run_abandon_v1')return row;
    row.snapshot=structuredClone(snapshot);row.updated_at=new Date().toISOString();row.pending=snapshot.outcome==='playing'?{operation:'checkpoint_save_v1',snapshot:row.snapshot}:{operation:'run_finish_v1',snapshot:row.snapshot,outcome:snapshot.outcome};return row;
  });this.event('durable',value);});}
  async abandon():Promise<void>{await this.task(()=>this.edit(row=>{if(row.snapshot.outcome!=='playing'||row.pending?.operation==='run_finish_v1'||row.inflight?.operation==='run_finish_v1')throw new Error('Сначала подтвердится результат завершённого забега');row.pending={operation:'run_abandon_v1'};return row;}));}
  async flush():Promise<void>{
    if(this.sending||!this.allowed)return;this.sending=true;
    try{while(this.allowed){
      const value=await this.task(async()=>{const found=await this.record();if(!found||found.conflict||found.terminal_ack)return null;return this.edit(row=>{
        if(row.conflict||row.terminal_ack)return row;
        if(!row.inflight&&row.pending){const pending=row.pending,request_id=randomId();row.inflight={operation:pending.operation,request_id,base_revision:row.revision,status:'inflight',body:{run_id:row.run_id,expected_revision:row.revision,request_id,...(pending.snapshot?{snapshot:pending.snapshot}:{}),...(pending.outcome?{outcome:pending.outcome}:{})}};row.pending=null;}return row;
      });});
      if(!this.allowed||!value?.inflight||value.conflict||value.terminal_ack)break;
      const command=structuredClone(value.inflight);this.event('sending',command);let ack:any;
      try{ack=await this.send(command.operation,command.body);}catch(error){
        if(error instanceof CloudError&&(error.code==='REVISION_CONFLICT'||error.code==='RUN_TERMINAL')){await this.task(()=>this.edit(row=>{if(row.inflight?.request_id===command.request_id)row.conflict=true;return row;}));this.hold();this.event('conflict',error);}
        else if(error instanceof CloudError&&error.code==='AUTH_REQUIRED'){this.hold();this.event('auth',error);}
        else if(error instanceof CloudError&&!['OFFLINE','TRANSPORT_ERROR','RATE_LIMITED'].includes(error.code)){this.hold();this.event('error',error);}
        else this.event('offline',error);break;
      }
      const row=await this.task(()=>this.edit(row=>{
        if(row.inflight?.request_id!==command.request_id)return row;
        if(!Number.isInteger(ack.revision)||ack.revision<=command.base_revision)throw new Error('Некорректное подтверждение revision');
        row.revision=ack.revision;row.confirmed_at=ack.saved_at??ack.updated_at??new Date().toISOString();row.confirmed_tick=(command.body.snapshot as SnapshotV1|undefined)?.sim_tick??row.confirmed_tick;row.inflight=null;
        if(command.operation!=='checkpoint_save_v1'){row.terminal_ack=true;row.lifecycle=command.operation==='run_abandon_v1'?'abandoned':command.body.outcome as 'won'|'lost';row.pending=null;}return row;
      }));this.event('ack',row);
    }}catch(error){this.hold();this.event('storage',error);}finally{this.sending=false;}
  }
  async replaceServer(run:RunDto):Promise<void>{await this.task(async()=>{const old=await this.record();if(old)await writeMany([[`conflict:${this.owner}:${this.runId}:${Date.now()}`,old]]);await this.store.update(runKey(this.owner,this.runId),()=>fromServer(this.owner,run));});this.allow();}
  /** Only after a separate confirmation. Definite conflicts have no committed effect. */
  async replaceLocal(run:RunDto):Promise<void>{if(run.lifecycle!=='active')throw new Error('Завершённый забег нельзя заменить');await this.task(()=>this.edit(row=>{row.revision=run.revision;row.inflight=null;row.conflict=false;row.pending=row.snapshot.outcome==='playing'?{operation:'checkpoint_save_v1',snapshot:row.snapshot}:{operation:'run_finish_v1',snapshot:row.snapshot,outcome:row.snapshot.outcome};return row;}));this.allow();}
}
