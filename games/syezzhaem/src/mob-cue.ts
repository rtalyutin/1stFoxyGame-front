/** Visual simulation owns the countdown; this optional sound never advances gameplay. */
export class MobCue {
  private context:AudioContext|null=null;
  private voices=new Set<OscillatorNode>();
  private buckets=new Map<string,number>();
  private played=0;
  status:'locked'|'running'|'blocked'|'unsupported'='locked';
  async unlock():Promise<void>{
    if(typeof AudioContext==='undefined'){this.status='unsupported';return;}
    try{this.context??=new AudioContext();if(this.context.state!=='running')await this.context.resume();this.status=this.context.state==='running'?'running':'blocked';}
    catch{this.status='blocked';}
  }
  update(run:string,mobs:Array<{key:string;fuseTicks:number}>,enabled:boolean,volume:number,paused:boolean){
    if(paused||!enabled||!this.context||this.context.state!=='running')return;
    for(const mob of mobs){
      if(mob.fuseTicks<=0)continue;
      const key=run+':'+mob.key,bucket=Math.ceil(mob.fuseTicks/18);
      if(this.buckets.get(key)===bucket)continue;
      this.buckets.set(key,bucket);
      try{
        const voice=this.context.createOscillator(),gain=this.context.createGain(),now=this.context.currentTime;
        voice.type='square';voice.frequency.value=mob.fuseTicks<30?780:520;
        gain.gain.setValueAtTime(Math.max(0,Math.min(1,volume))*.025,now);gain.gain.exponentialRampToValueAtTime(.0001,now+.055);
        voice.connect(gain);gain.connect(this.context.destination);this.voices.add(voice);
        voice.onended=()=>{this.voices.delete(voice);voice.disconnect();gain.disconnect();};voice.start(now);voice.stop(now+.06);this.played++;
      }catch{this.status='blocked';}
    }
  }
  silence(){for(const voice of this.voices){try{voice.stop();}catch{}}this.voices.clear();}
  stats(){return{status:this.status,played:this.played,contextState:this.context?.state??null};}
  dispose(){this.silence();void this.context?.close().catch(()=>{});this.context=null;}
}
