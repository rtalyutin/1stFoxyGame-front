import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameInput } from './input';
class Element extends EventTarget {
  style = {transform:''}; classList = {add:vi.fn(),remove:vi.fn()}; setPointerCapture = vi.fn(); formControl = false;
  closest(): unknown { return this.formControl ? this : null; }
}
function setup() {
  const target = new EventTarget(); vi.stubGlobal('window',target); vi.stubGlobal('HTMLElement',Element);
  const canvas = new Element(), move = new Element(), thumb = new Element();
  const callbacks = {aim:vi.fn(() => ({x:3,z:20})),cast:vi.fn(),ready:vi.fn(() => true),unavailable:vi.fn(),pause:vi.fn(),enterShop:vi.fn(),consume:vi.fn()};
  const input = new GameInput(canvas as unknown as HTMLCanvasElement,move as unknown as HTMLElement,thumb as unknown as HTMLElement,callbacks); input.setEnabled(true);
  const key = (code:string,repeat=false) => { const event = new Event('keydown',{cancelable:true}); Object.assign(event,{code,repeat}); target.dispatchEvent(event); };
  const pointer = (kind:string,props:Record<string,unknown>) => { const event = new Event(kind,{cancelable:true}); Object.assign(event,props); canvas.dispatchEvent(event); };
  return {target,canvas,move,thumb,callbacks,input,key,pointer};
}
afterEach(() => vi.unstubAllGlobals());
describe('input boundaries around server operations', () => {
  it('offers shop and two consumable shortcuts only while running, without key repeats', () => {
    const s=setup(); s.key('KeyE'); s.key('Digit1'); s.key('Digit2'); s.key('Digit2',true);
    expect(s.callbacks.enterShop).toHaveBeenCalledTimes(1); expect(s.callbacks.consume.mock.calls).toEqual([[0],[1]]);
    s.input.setEnabled(false); s.key('KeyE'); s.key('Digit1'); expect(s.callbacks.consume).toHaveBeenCalledTimes(2); expect(s.callbacks.cast).not.toHaveBeenCalled();
    s.input.dispose();
  });
  it('resets held movement and a touch cast when pause, shop or takeover disables input', () => {
    const s=setup(); s.key('KeyD'); expect(s.input.axis).toBe(1); s.pointer('pointerdown',{button:0,pointerId:7,pointerType:'touch',clientX:50,clientY:60});
    s.input.setEnabled(false); s.pointer('pointerup',{button:0,pointerId:7,pointerType:'touch',clientX:50,clientY:60});
    s.input.setEnabled(true); expect(s.input.axis).toBe(0); expect(s.callbacks.cast).not.toHaveBeenCalled(); s.input.dispose();
  });
  it('keeps mouse clicks and completed touch aim as one manual cast each', () => {
    const s=setup(); s.pointer('pointerdown',{button:0,pointerId:1,pointerType:'mouse',clientX:50,clientY:60});
    s.pointer('pointerdown',{button:0,pointerId:2,pointerType:'touch',clientX:50,clientY:60}); s.pointer('pointerup',{button:0,pointerId:2,pointerType:'touch',clientX:70,clientY:60});
    expect(s.callbacks.cast).toHaveBeenCalledTimes(2); expect(s.callbacks.cast).toHaveBeenLastCalledWith({x:3,z:20}); s.input.dispose();
  });
  it('leaves form controls alone instead of treating input in login/select as combat keys', () => {
    const s=setup(), field=new Element(); field.formControl=true;
    const event = new Event('keydown',{cancelable:true}); Object.defineProperty(event,'target',{value:field}); Object.assign(event,{code:'Digit1',repeat:false}); s.target.dispatchEvent(event);
    expect(s.callbacks.consume).not.toHaveBeenCalled(); s.input.dispose();
  });
});
