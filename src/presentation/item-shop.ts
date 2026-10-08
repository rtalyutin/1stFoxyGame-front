import { canCraft, getItemDefinition, recipeCost, type EquipmentCatalog, type ItemDefinitionId, type Operation, type Profile, type Slot } from '../game/equipment';
import { goldText } from '../platform/profile';
import { findAppearance,committedAppearance } from './appearance';
import {SUPPLIES,isSupply,type SupplyId,type ShopGraphicId} from './supplies';
import { ShopSelection } from './shop-selection';
import { ItemShopScene, type DisplayItem } from './item-shop-scene';

type Action='craft'|'upgrade'|'equip'|'quick_slots';
const GROUPS:Record<Slot,string>={weapon:'Оружие',body:'Манжеты',legs:'Обувь',talisman:'Талисманы'};
function element<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string):HTMLElementTagNameMap[K] {
  const e=document.createElement(tag);if(text)e.textContent=text;return e;
}

/** DOM controls and Canvas share one selection; mutations use the existing queue. */
export class ItemShop {
  readonly selection=new ShopSelection();
  private scene:ItemShopScene|null=null;
  private profile:Profile|null=null;
  private catalog:EquipmentCatalog|null=null;
  private editable=false;
  private busy=false;
  private active=false;
  private group:Slot|'consumables'|'resources'='legs';
  private supply:SupplyId|null=null;
  private mode:'catalog'|'inventory'='catalog';
  private renderingKey='';
  private epoch=0;
  private inventoryPage=0;

  constructor(private root:HTMLElement,private canvas:HTMLCanvasElement,
    private operate:(type:Action,payload:Operation['payload'])=>Promise<boolean>,
    private describe:(id:ItemDefinitionId,level:number)=>string) {}

  update(profile:Profile,catalog:EquipmentCatalog,editable:boolean,busy:boolean):void {
    this.profile=profile;this.catalog=catalog;this.editable=editable;this.busy=busy;
    this.selection.reconcile(profile);this.render();
  }

  setActive(active:boolean):void {
    if(this.active===active)return;this.active=active;this.epoch++;
    this.root.hidden=!active;this.canvas.hidden=true;this.renderingKey='';
    if(!active){this.scene?.leave();this.selection.clear();return;}
    if(!this.scene)this.scene=new ItemShopScene(this.canvas,(id,instanceId)=>this.chooseDefinition(id,instanceId),()=>{this.renderingKey='';this.render();});
    this.scene.active=true;const epoch=this.epoch;
    void this.scene.load().catch(error=>console.error('Item shop loading failed',error)).finally(()=>{if(this.active&&this.epoch===epoch){this.canvas.hidden=!this.scene?.ready;this.renderingKey='';this.render();}});
    this.render();
  }

  private chooseDefinition(id:ShopGraphicId,instanceId?:string):void {
    if(!this.profile||!this.catalog)return;
    if(isSupply(id)){this.supply=id;this.group=id==='slow_dust'||id==='collector_vial'?'consumables':'resources';this.selection.clear();this.renderingKey='';this.render();return;}
    this.supply=null;
    this.group=getItemDefinition(id).slot;
    if(this.mode==='inventory') {
      const item=this.profile.items.find(i=>i.id===instanceId&&i.definitionId===id&&findAppearance(i));
      if(!item)return;this.selection.selectOwned(item.id,this.profile);
    }else this.selection.selectCatalog(id,this.catalog);
    this.renderingKey='';this.render();
  }

  private button(text:string,fn:()=>void,disabled=false,token?:string):HTMLButtonElement {
    const b=element('button',text);b.type='button';b.className='secondary';b.disabled=disabled;
    if(token)b.dataset.choice=token;b.addEventListener('click',fn);return b;
  }

  private render():void {
    if(!this.active||!this.profile||!this.catalog)return;
    const p=this.profile,c=this.catalog,selection=this.selection.selected;
    const key=JSON.stringify([p.accountId,p.revision,c,this.group,this.supply,this.mode,this.inventoryPage,selection,this.selection.previewing,this.editable,this.busy,this.scene?.ready,this.scene?.error]);
    if(key===this.renderingKey)return;this.renderingKey=key;
    const focused=(document.activeElement as HTMLElement|null)?.dataset.choice;
    this.root.replaceChildren();
    const tabs=element('div');tabs.className='shop-tabs';tabs.setAttribute('aria-label','Источник вещей');
    for(const [mode,label]of [['catalog','Витрина'],['inventory','Мои вещи']] as const) {
      const b=this.button(label,()=>{this.mode=mode;this.inventoryPage=0;this.selection.clear();this.supply=null;this.renderingKey='';this.render();},false,mode);
      b.setAttribute('aria-pressed',String(this.mode===mode));tabs.append(b);
    }
    this.root.append(tabs);
    const groups=element('div');groups.className='shop-tabs';groups.setAttribute('aria-label','Группы вещей');
    for(const [slot,label]of Object.entries({...GROUPS,consumables:'Расходники',resources:'Ресурсы'}) as [typeof this.group,string][]) {
      const b=this.button(label,()=>{this.group=slot;this.inventoryPage=0;this.selection.clear();this.supply=null;this.renderingKey='';this.render();},false,slot);
      b.setAttribute('aria-pressed',String(this.group===slot));groups.append(b);
    }
    this.root.append(groups);
    if(this.group==='consumables'||this.group==='resources'){this.renderSupplies(p,c);return;}
    const choices=element('div');choices.className='shop-choices';
    const visible:DisplayItem[]=[];
    if(this.mode==='catalog') {
      for(const item of c.items.filter(i=>i.slot===this.group&&findAppearance({definitionId:i.id,level:1}))) {
        visible.push({definitionId:item.id,level:1});
        const b=this.button(`${item.name} · ур. 1`,()=>{this.selection.selectCatalog(item.id,c);this.renderingKey='';this.render();},false,`catalog-${item.id}`);
        b.setAttribute('aria-pressed',String(selection?.mode==='catalog'&&selection.definitionId===item.id));choices.append(b);
      }
    } else {
      const owned=p.items.filter(i=>getItemDefinition(i.definitionId).slot===this.group&&findAppearance(i));
      this.inventoryPage=Math.min(this.inventoryPage,Math.max(0,Math.ceil(owned.length/3)-1));
      for(const item of owned.slice(this.inventoryPage*3,this.inventoryPage*3+3)) {
        visible.push({definitionId:item.definitionId,level:item.level,instanceId:item.id});
        const b=this.button(`${getItemDefinition(item.definitionId).name} · ур. ${item.level} · №${item.id.slice(-6)}`,()=>{this.selection.selectOwned(item.id,p);this.renderingKey='';this.render();},false,`inventory-${item.id}`);
        b.setAttribute('aria-pressed',String(selection?.instanceId===item.id));choices.append(b);
      }
      if(owned.length>3){
        choices.append(this.button('Предыдущие вещи',()=>{this.inventoryPage--;this.selection.clear();this.renderingKey='';this.render();},this.inventoryPage===0,'previous-items'));
        choices.append(this.button('Следующие вещи',()=>{this.inventoryPage++;this.selection.clear();this.renderingKey='';this.render();},(this.inventoryPage+1)*3>=owned.length,'next-items'));
      }
    }
    this.root.append(choices);
    if(!visible.length)this.root.append(element('p','В этой группе пока нет доступных вещей.'));
    const ready=Boolean(this.scene?.appearanceReady(selection));
    if(!ready){const status=element('p',this.scene?.error||'Открываем витрину…');status.setAttribute('role','status');this.root.append(status);}
    if(selection) {
      const definition=getItemDefinition(selection.definitionId),actualId=p.loadouts.pudge[definition.slot];
      const actual=p.items.find(i=>i.id===actualId);
      this.root.append(element('h3',`${definition.name} · уровень ${selection.level}`));
      const status=element('p',this.selection.previewing?'Примерка · имущество не изменено':'Реальная сборка');status.className='shop-preview-status';status.setAttribute('role','status');this.root.append(status);
      this.root.append(element('p',`Надето: ${actual?`${getItemDefinition(actual.definitionId).name} · ур. ${actual.level}`:'ничего'}`));
      this.root.append(this.button('Вернуть надетую сборку',()=>{this.selection.restoreCommitted();this.renderingKey='';this.render();},!this.selection.previewing,'restore'));
      const source=c.items.find(i=>i.id===selection.definitionId);
      const current=source?.levels.find(l=>l.level===selection.level);
      if(current)this.root.append(element('p',this.describe(selection.definitionId,selection.level)));
      const nextLevel=selection.mode==='catalog'?1:selection.level+1;
      const recipe=source?.levels.some(l=>l.level===nextLevel)?recipeCost(selection.definitionId,nextLevel-1,c):null;
      if(recipe) {
        this.root.append(element('p',`${goldText(recipe.goldMilli)} золота · сталь ${recipe.components.steel} · жар ${recipe.components.ember} · ядра ${recipe.components.core}`));
        const deficits:string[]=[];
        if(BigInt(p.goldMilli)<BigInt(recipe.goldMilli))deficits.push(`${goldText(String(BigInt(recipe.goldMilli)-BigInt(p.goldMilli)))} золота`);
        for(const [id,name]of [['steel','стали'],['ember','жара'],['core','ядер']]as const)if(p.components[id]<recipe.components[id])deficits.push(`${recipe.components[id]-p.components[id]} ${name}`);
        this.root.append(element('p',deficits.length?`Не хватает: ${deficits.join(', ')}`:'Ресурсы доступны'));
        const canImprove=selection.mode==='catalog'||Boolean(findAppearance({definitionId:selection.definitionId,level:selection.level+1}));
        const type=selection.mode==='catalog'?'craft':'upgrade';
        this.root.append(this.button(type==='craft'?'Создать вещь':'Улучшить вещь',()=>{
          void this.perform(type,type==='craft'?{definitionId:selection.definitionId}:{itemId:selection.instanceId!});
        },!ready||!this.editable||this.busy||!canCraft(p,recipe)||!canImprove,'mutate'));
      }else if(selection.mode==='inventory')this.root.append(element('p','Максимальный доступный уровень'));
      if(selection.mode==='inventory')this.root.append(this.button('Надеть выбранный экземпляр',()=>{
        void this.perform('equip',{slot:definition.slot,itemId:selection.instanceId!});
      },!ready||!this.editable||this.busy||actualId===selection.instanceId||!source,'equip'));
      this.root.append(this.button('Снять вещь из этого слота',()=>{void this.perform('equip',{slot:definition.slot,itemId:null});},!ready||!this.editable||this.busy||!actualId,'unequip'));
      this.root.append(element('p','Перетаскивай выбранную вещь на стойке, чтобы осмотреть её.'));
    }else this.root.append(element('p','Выбери вещь на витрине или кнопкой. Выбор только примеряет её.'));
    if(this.busy)this.root.append(element('p','Ожидаем подтверждения сервера.'));
    this.scene?.show(selection,this.selection.previewLoadout(p,c),visible);
    if(focused)this.root.querySelector<HTMLButtonElement>(`[data-choice="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
  }

  private renderSupplies(p:Profile,c:EquipmentCatalog):void{
    const ids:SupplyId[]=this.group==='consumables'?['slow_dust','collector_vial']:['gold','steel','ember','core'];
    const choices=element('div');choices.className='shop-choices';
    for(const id of ids){
      const count=id==='gold'?goldText(p.goldMilli):id==='slow_dust'||id==='collector_vial'?p.consumables[id]:p.components[id];
      const b=this.button(`${SUPPLIES[id].label} · ${count}`,()=>{this.supply=id;this.renderingKey='';this.render();},false,'supply-'+id);
      b.setAttribute('aria-pressed',String(this.supply===id));choices.append(b);
    }
    this.root.append(choices);
    const selected=this.supply?{definitionId:this.supply,level:1}:null;
    const ready=Boolean(this.scene?.appearanceReady(selected));
    if(!ready)this.root.append(element('p',this.scene?.error||'Открываем витрину…'));
    if(this.supply){
      this.root.append(element('h3',SUPPLIES[this.supply].label));
      const definition=c.consumables.find(d=>d.id===this.supply);
      if(definition){
        this.root.append(element('p',definition.effect.type==='slow'?`Замедление на ${definition.effect.durationSeconds} с · скорость ×${definition.effect.speedMultiplier}`:`Золото ×${definition.effect.goldMultiplierMilli/1000} за ${definition.effect.kills} убийств`));
        const recipe=definition.recipe;
        this.root.append(element('p',`${goldText(recipe.goldMilli)} золота · сталь ${recipe.components.steel} · жар ${recipe.components.ember} · ядра ${recipe.components.core}`));
        this.root.append(element('p',canCraft(p,recipe)?'Ресурсы доступны':'Недостаточно ресурсов для создания'));
        this.root.append(this.button('Создать расходник',()=>{void this.perform('craft',{definitionId:definition.id});},!ready||!this.editable||this.busy||!canCraft(p,recipe),'supply-craft'));
        for(const index of [0,1] as const)this.root.append(this.button(`Назначить в быстрый слот ${index+1}`,()=>{
          const slots=[...p.loadouts.pudge.quick] as typeof p.loadouts.pudge.quick;slots[index]=definition.id;void this.perform('quick_slots',{slots});
        },!ready||!this.editable||this.busy||p.consumables[definition.id]===0||p.loadouts.pudge.quick[index]===definition.id,'supply-quick-'+index));
      }else this.root.append(element('p','Добывается в забеге. На витрине можно осмотреть форму ресурса.'));
      this.root.append(element('p','Перетаскивай предмет на передней стойке для осмотра.'));
    }else this.root.append(element('p','Выбери настоящий предмет на витрине или кнопкой.'));
    this.scene?.show(selected,committedAppearance(p),ids.map(definitionId=>({definitionId,level:1})));
  }

  private async perform(type:Action,payload:Operation['payload']):Promise<void> {
    if(!this.scene?.appearanceReady(this.supply?{definitionId:this.supply,level:1}:this.selection.selected)||!this.editable||this.busy)return;
    const ok=await this.operate(type,payload);
    if(ok&&type==='equip')this.selection.restoreCommitted();
    this.renderingKey='';this.render();
  }
  renderFrame(delta:number):boolean{if(!this.active||!this.scene?.ready)return false;this.scene.render(delta);return true;}
  confirmOperation(id:string):void{this.scene?.confirmOperation(id);}
  dispose():void{this.scene?.dispose();}
}
