import {createAuthClient} from 'better-auth/client';
export const auth=createAuthClient({baseURL:typeof location==='undefined'?'http://localhost':location.origin,basePath:'/api/syezzhaem/auth'});
export interface SessionUser{id:string;email:string;emailVerified:boolean;name:string}
export class CloudError extends Error{constructor(public code:string,message:string,public details?:unknown){super(message);}}
const messages:Record<string,string>={REVISION_CONFLICT:'На другом устройстве сохранена другая версия.',ACTIVE_RUN_EXISTS:'Сначала продолжи или заверши активный забег.',CLIENT_UPDATE_REQUIRED:'Для нового забега нужна свежая версия игры.',CONTENT_INCOMPATIBLE:'Нужна совместимая версия игры.',RUN_TERMINAL:'Этот забег уже завершён на сервере.',NOT_FOUND:'Забег не найден в этом аккаунте.',VALIDATION_FAILED:'Сервер не принял снимок.',IDEMPOTENCY_MISMATCH:'Ключ запроса уже принят с другим содержимым.',RATE_LIMITED:'Слишком частые запросы. Очередь сохранена.',AUTH_REQUIRED:'Войди снова, чтобы отправить сохранения.'};
export async function rpc<T=any>(operation:string,body:unknown={},expectedOwner?:string):Promise<T>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await fetch(`/api/syezzhaem/v1/rpc/${operation}`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',...(expectedOwner?{'X-Syezzhaem-Expected-User':expectedOwner}:{})},body:JSON.stringify(body),signal:controller.signal});
    if(response.status===401||response.status===403)throw new CloudError('AUTH_REQUIRED',messages.AUTH_REQUIRED);
    const value=await response.json();
    if(!response.ok&&!value.error)throw new CloudError('TRANSPORT_ERROR','Сервер временно недоступен.');
    if(!value.ok){const error=value.error??{};throw new CloudError(error.code??'SERVER_ERROR',messages[error.code]??error.message??'Ошибка сервера.',error);}
    return value.data as T;
  }catch(error){if(error instanceof CloudError)throw error;throw new CloudError('OFFLINE','Нет подтверждения сервера. Снимок остаётся на устройстве.');}
  finally{clearTimeout(timer);}
}
export async function getUser():Promise<SessionUser|null>{const result=await auth.getSession();if(result.error)throw new CloudError('OFFLINE','Не удалось проверить вход. Повтори подключение.');return result.data?.user as SessionUser??null;}
