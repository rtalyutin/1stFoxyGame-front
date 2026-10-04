import {randomId} from './core';
/** Stable across served builds. Never erase another owner's records on login/logout. */
export const DATABASE_NAME='syezzhaem-r1';
let dbPromise: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  return dbPromise ??= new Promise((resolve,reject) => {
    const req = indexedDB.open(DATABASE_NAME,1);
    req.onupgradeneeded = () => {if(!req.result.objectStoreNames.contains('state'))req.result.createObjectStore('state');};
    req.onsuccess = () => {req.result.onversionchange=()=>{req.result.close();dbPromise=undefined;};resolve(req.result);};
    req.onerror = () => {dbPromise=undefined;reject(req.error ?? new Error('IndexedDB недоступна'));};
    req.onblocked = () => {dbPromise=undefined;reject(new Error('Закрой другую вкладку игры для сохранения'));};
  });
}
export async function read<T>(key: string): Promise<T | undefined> {
  const database = await db();
  return new Promise((resolve,reject)=>{
    const tx = database.transaction('state','readonly');
    const req = tx.objectStore('state').get(key);
    tx.oncomplete = ()=>resolve(req.result as T | undefined);
    tx.onerror = ()=>reject(tx.error);
    tx.onabort = ()=>reject(tx.error ?? new Error('Чтение прервано'));
  });
}
export async function writeMany(values:Array<[string,unknown]>,remove:string[]=[]): Promise<void> {
  const database = await db();
  return new Promise((resolve,reject)=>{
    const tx=database.transaction('state','readwrite');
    for(const[key,value]of values)tx.objectStore('state').put(value,key);
    for(const key of remove)tx.objectStore('state').delete(key);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error ?? new Error('Сохранение прервано'));
  });
}
export const write=(key:string,value:unknown)=>writeMany([[key,value]]);
export const remove=(key:string)=>writeMany([],[key]);
/** Read/modify/write is one IDB transaction, including the owner's resume index. */
export async function mutate<T>(key:string,update:(current:T|undefined)=>T,related:(value:T)=>Array<[string,unknown]>=()=>[]):Promise<T>{
  const database=await db();return new Promise((resolve,reject)=>{
    const tx=database.transaction('state','readwrite'),store=tx.objectStore('state'),req=store.get(key);let next:T;
    req.onsuccess=()=>{try{next=update(req.result as T|undefined);store.put(next,key);for(const[k,v]of related(next))store.put(v,k);}catch(error){tx.abort();reject(error);}};
    tx.oncomplete=()=>resolve(next);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('Сохранение прервано'));
  });
}
export async function list<T>(prefix:string):Promise<T[]>{
  const database=await db();return new Promise((resolve,reject)=>{
    const tx=database.transaction('state','readonly'),req=tx.objectStore('state').getAll(IDBKeyRange.bound(prefix,prefix+'\uffff'));
    tx.oncomplete=()=>resolve(req.result as T[]);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
export async function probeStorage():Promise<void>{const key='probe:'+randomId();await write(key,{at:Date.now()});await remove(key);}
