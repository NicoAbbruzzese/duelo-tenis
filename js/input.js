// Entradas: teclado (PC), cruceta + 4 botones táctiles (celular) y mando físico opcional.
// Todo se reduce a un mando digital: dirección de 8 vías y 4 botones.

const KEY_DIR = {
  ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd', ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r',
};
const KEY_BTN = {
  KeyJ: 0, KeyZ: 0, Space: 0, Enter: 0,
  KeyK: 1, KeyX: 1,
  KeyL: 2, KeyC: 2,
  KeyI: 3, KeyV: 3,
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.kHeld = 0; this.tHeld = 0; this.gHeld = 0;
    this.tdx = 0; this.tdz = 0;
    this.gdx = 0; this.gdz = 0;
    this.counts = [0, 0, 0, 0];
    this._last = [0, 0, 0, 0];
    this.enabled = true;
    this.onpress = null;   // (botón) cualquier pulsación: desbloquear audio, vibrar
    this.onpause = null;
    this.usedTouch = false; this.usedKeys = false; this.usedPad = false;
    this._padPrev = 0;
  }

  _press(b) {
    this.counts[b] = (this.counts[b] + 1) % 100000;
    if (this.onpress) this.onpress(b);
  }

  attachKeyboard(target = window) {
    target.addEventListener('keydown', (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.code === 'Escape' || e.code === 'KeyP') { if (!e.repeat && this.onpause) this.onpause(); return; }
      const isDir = e.code in KEY_DIR, isBtn = e.code in KEY_BTN;
      if (!isDir && !isBtn) return;
      if (!this.enabled) return;
      e.preventDefault();
      if (e.repeat) return;
      this.usedKeys = true;
      this.keys.add(e.code);
      if (isBtn) { const b = KEY_BTN[e.code]; this.kHeld |= 1 << b; this._press(b); }
    });
    target.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code in KEY_BTN) {
        const b = KEY_BTN[e.code];
        let still = false;
        for (const k of this.keys) if (KEY_BTN[k] === b) still = true;
        if (!still) this.kHeld &= ~(1 << b);
      }
    });
    const clear = () => { this.keys.clear(); this.kHeld = 0; this.releaseTouch(); };
    target.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
  }

  releaseTouch() {
    this.tdx = this.tdz = 0; this.tHeld = 0;
    if (this._dpadEl) this._dpadEl.dataset.dir = '';
    if (this._btnEls) for (const el of this._btnEls) el.classList.remove('on');
    if (this._dpadPtr !== undefined) this._dpadPtr = null;
  }

  // zone: área táctil amplia; dpad: el dibujo de la cruceta (su centro define las direcciones).
  attachTouch(zone, dpad, buttons) {
    this._dpadEl = dpad; this._btnEls = buttons; this._dpadPtr = null;
    const setDir = (e) => {
      const r = dpad.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const x = e.clientX - cx, y = e.clientY - cy;
      const d = Math.hypot(x, y), dead = r.width * 0.13;
      let dx = 0, dz = 0;
      if (d > dead) {
        const a = Math.atan2(-y, x); // 0 = derecha, pi/2 = arriba
        const oct = Math.round(a / (Math.PI / 4));
        const o = ((oct % 8) + 8) % 8;
        dx = [1, 1, 0, -1, -1, -1, 0, 1][o];
        dz = [0, 1, 1, 1, 0, -1, -1, -1][o];
      }
      this.tdx = dx; this.tdz = dz;
      dpad.dataset.dir = (dz > 0 ? 'u' : dz < 0 ? 'd' : '') + (dx < 0 ? 'l' : dx > 0 ? 'r' : '');
    };
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (!this.enabled) return;
      this.usedTouch = e.pointerType !== 'mouse' || this.usedTouch;
      this._dpadPtr = e.pointerId;
      try { zone.setPointerCapture(e.pointerId); } catch (err) { /* sin captura */ }
      setDir(e);
    });
    zone.addEventListener('pointermove', (e) => { if (e.pointerId === this._dpadPtr) { e.preventDefault(); setDir(e); } });
    const end = (e) => {
      if (e.pointerId !== this._dpadPtr) return;
      this._dpadPtr = null; this.tdx = this.tdz = 0; dpad.dataset.dir = '';
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);

    for (const el of buttons) {
      const b = Number(el.dataset.b);
      let ptr = null;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!this.enabled) return;
        this.usedTouch = e.pointerType !== 'mouse' || this.usedTouch;
        ptr = e.pointerId;
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* sin captura */ }
        this.tHeld |= 1 << b;
        el.classList.add('on');
        this._press(b);
      });
      const up = (e) => {
        if (e.pointerId !== ptr) return;
        ptr = null; this.tHeld &= ~(1 << b); el.classList.remove('on');
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
    }
    for (const el of [zone, ...buttons]) el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Mando físico (opcional). Llamar una vez por cuadro.
  pollGamepad() {
    let pad = null;
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) if (p && p.connected) { pad = p; break; }
    } catch (e) { pad = null; }
    if (!pad) { this.gdx = this.gdz = 0; this.gHeld = 0; this._padPrev = 0; return; }
    const B = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    let dx = 0, dz = 0;
    if (B(14)) dx = -1; else if (B(15)) dx = 1;
    if (B(12)) dz = 1; else if (B(13)) dz = -1;
    const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
    if (!dx && Math.abs(ax) > 0.5) dx = ax > 0 ? 1 : -1;
    if (!dz && Math.abs(ay) > 0.5) dz = ay > 0 ? -1 : 1;
    this.gdx = dx; this.gdz = dz;
    // 0 = abajo (golpe), 1 = derecha (cortado), 3 = arriba (globo), 2 = izquierda (dejada)
    const held = (B(0) ? 1 : 0) | (B(1) ? 2 : 0) | (B(3) ? 4 : 0) | (B(2) ? 8 : 0);
    const fresh = held & ~this._padPrev;
    this._padPrev = held;
    this.gHeld = this.enabled ? held : 0;
    if (this.enabled && fresh) {
      this.usedPad = true;
      for (let b = 0; b < 4; b++) if (fresh & (1 << b)) this._press(b);
    }
    if (B(9) && !this._padStart && this.onpause) this.onpause();
    this._padStart = B(9);
  }

  get dx() {
    if (!this.enabled) return 0;
    let v = 0;
    for (const k of this.keys) { const d = KEY_DIR[k]; if (d === 'l') v -= 1; else if (d === 'r') v += 1; }
    v += this.tdx + this.gdx;
    return v > 0 ? 1 : v < 0 ? -1 : 0;
  }
  get dz() {
    if (!this.enabled) return 0;
    let v = 0;
    for (const k of this.keys) { const d = KEY_DIR[k]; if (d === 'u') v += 1; else if (d === 'd') v -= 1; }
    v += this.tdz + this.gdz;
    return v > 0 ? 1 : v < 0 ? -1 : 0;
  }
  get held() { return this.enabled ? this.kHeld | this.tHeld | this.gHeld : 0; }

  // Una muestra por tick de juego: dirección actual + botones recién pulsados (máscara de bits).
  sample() {
    let pr = 0;
    for (let b = 0; b < 4; b++) {
      if (this.counts[b] !== this._last[b]) { pr |= 1 << b; this._last[b] = this.counts[b]; }
    }
    return { dx: this.dx, dz: this.dz, pr, vt: -1 };
  }
}
