import type { Point } from '../game/simulation';

export interface InputCallbacks {
  aim(clientX: number, clientY: number): Point;
  cast(aim: Point): void;
  ready(): boolean;
  unavailable(): void;
  pause(): void;
}

export class GameInput {
  enabled = false;
  aimPoint: Point = { x: 0, z: 20 };
  private keys = new Set<string>();
  private moveId: number | null = null;
  private aimId: number | null = null;
  private startX = 0;
  private touchAxis = 0;
  private pointerPosition: { x: number; y: number } | null = null;
  private cleanups: Array<() => void> = [];

  constructor(private canvas: HTMLCanvasElement, private moveZone: HTMLElement,
    private thumb: HTMLElement, private callbacks: InputCallbacks) {
    this.on(window, 'keydown', this.keyDown);
    this.on(window, 'keyup', this.keyUp);
    this.on(canvas, 'pointerdown', this.pointerDown);
    this.on(canvas, 'pointermove', this.pointerMove);
    this.on(canvas, 'pointerup', this.pointerUp);
    this.on(canvas, 'pointercancel', this.pointerCancel);
    this.on(canvas, 'lostpointercapture', this.pointerCancel);
    this.on(canvas, 'contextmenu', (event) => event.preventDefault());
    this.on(moveZone, 'pointerdown', this.moveDown);
    this.on(moveZone, 'pointermove', this.moveMove);
    this.on(moveZone, 'pointerup', this.moveEnd);
    this.on(moveZone, 'pointercancel', this.moveEnd);
    this.on(moveZone, 'lostpointercapture', this.moveEnd);
  }

  private on(target: EventTarget, type: string, handler: (e: any) => void): void {
    target.addEventListener(type, handler);
    this.cleanups.push(() => target.removeEventListener(type, handler));
  }

  get axis(): number {
    if (!this.enabled) return 0;
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    return Math.max(-1, Math.min(1, Number(right) - Number(left) + this.touchAxis));
  }

  setEnabled(enabled: boolean): void {
    this.clear();
    this.enabled = enabled;
  }

  clear(): void {
    this.keys.clear();
    this.moveId = null;
    this.aimId = null;
    this.touchAxis = 0;
    this.thumb.style.transform = '';
    this.moveZone.classList.remove('active');
    this.canvas.classList.remove('aiming');
  }

  private keyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape' && !event.repeat) { this.callbacks.pause(); return; }
    if (!this.enabled || event.repeat) return;
    if (['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
      event.preventDefault();
      this.keys.add(event.code);
    }
  };
  private keyUp = (event: KeyboardEvent): void => { this.keys.delete(event.code); };
  private updateAim = (event: PointerEvent): void => {
    this.pointerPosition = { x: event.clientX, y: event.clientY };
    this.aimPoint = this.callbacks.aim(event.clientX, event.clientY);
  };
  refreshAim(fallback: Point): void {
    this.aimPoint = this.pointerPosition
      ? this.callbacks.aim(this.pointerPosition.x, this.pointerPosition.y) : fallback;
  }
  private pointerDown = (event: PointerEvent): void => {
    if (!this.enabled || event.button !== 0) return;
    event.preventDefault();
    this.updateAim(event);
    if (!this.callbacks.ready()) { this.callbacks.unavailable(); return; }
    if (event.pointerType === 'mouse') {
      this.callbacks.cast({ ...this.aimPoint });
    } else if (this.aimId === null) {
      this.aimId = event.pointerId;
      this.canvas.setPointerCapture(event.pointerId);
      this.canvas.classList.add('aiming');
    }
  };
  private pointerMove = (event: PointerEvent): void => {
    if (!this.enabled) return;
    if (event.pointerType === 'mouse' || event.pointerId === this.aimId) this.updateAim(event);
  };
  private pointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.aimId) return;
    this.aimId = null;
    this.canvas.classList.remove('aiming');
    if (this.enabled) {
      this.updateAim(event);
      this.callbacks.cast({ ...this.aimPoint });
    }
  };
  private pointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === this.aimId) {
      this.aimId = null;
      this.canvas.classList.remove('aiming');
    }
  };
  private moveDown = (event: PointerEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (!this.enabled || this.moveId !== null) return;
    this.moveId = event.pointerId;
    this.startX = event.clientX;
    this.moveZone.setPointerCapture(event.pointerId);
    this.moveZone.classList.add('active');
  };
  private moveMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.moveId || !this.enabled) return;
    event.preventDefault();
    const offset = Math.max(-44, Math.min(44, event.clientX - this.startX));
    this.touchAxis = offset / 44;
    this.thumb.style.transform = `translateX(${offset}px)`;
  };
  private moveEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.moveId) return;
    this.moveId = null;
    this.touchAxis = 0;
    this.thumb.style.transform = '';
    this.moveZone.classList.remove('active');
  };
  dispose(): void { this.clear(); this.cleanups.forEach((remove) => remove()); }
}
