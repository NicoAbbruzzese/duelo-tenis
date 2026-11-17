// Interfaz sobre el partido: marcador, carteles, barra de saque, avisos.
import { pointLabels } from './sim.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.rows = [0, 1].map((i) => {
      const el = $('row' + i);
      return { el, nm: el.querySelector('.nm'), sets: el.querySelector('.sets'), gm: el.querySelector('.gm'), pt: el.querySelector('.pt') };
    });
    this.main = $('bannerMain'); this.sub = $('bannerSub'); this.speedEl = $('speed');
    this.serveUI = $('serveUI'); this.gauge = $('gauge'); this.mark = $('gMark'); this.hintEl = $('hint');
    this.pingEl = $('ping'); this.netEl = $('netwarn'); this.toastEl = $('toast');
    this.sig = ''; this.timers = new Set(); this.tMain = 0; this.tSub = 0; this.tSpeed = 0; this.tToast = 0;
    this.hintText = ''; this.serveMode = -1; this.netText = null; this.pingText = '';
  }

  reset() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    clearTimeout(this.tMain); clearTimeout(this.tSub); clearTimeout(this.tSpeed);
    this.main.className = ''; this.sub.className = ''; this.speedEl.className = '';
    this.sig = ''; this.serve(0); this.net(null);
  }

  // Ejecuta fn más tarde, salvo que se reinicie la interfaz antes.
  later(fn, ms) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
  }

  setNames(names, me) {
    for (let i = 0; i < 2; i++) {
      this.rows[i].nm.textContent = names[i];
      this.rows[i].el.classList.toggle('me', i === me);
    }
  }

  board(sc, server, multiSet) {
    const lab = pointLabels(sc);
    const sig = sc.pts.join() + '|' + sc.games.join() + '|' + sc.sets.join() + '|' + server + '|' + sc.tb + '|' + sc.hist.length;
    if (sig === this.sig) return;
    this.sig = sig;
    for (let i = 0; i < 2; i++) {
      const r = this.rows[i];
      r.el.classList.toggle('serving', server === i);
      r.gm.textContent = sc.games[i];
      r.pt.textContent = lab[i] === '' ? '·' : lab[i];
      r.sets.textContent = multiSet ? sc.hist.map((h) => h[i]).join(' ') : '';
    }
  }

  banner(text, cls = '', ms = 1400) {
    clearTimeout(this.tMain);
    this.main.textContent = text;
    this.main.className = 'show ' + cls;
    this.tMain = setTimeout(() => { this.main.className = cls; }, ms);
  }
  subBanner(text, ms = 1800) {
    clearTimeout(this.tSub);
    this.sub.textContent = text;
    this.sub.className = 'show';
    this.tSub = setTimeout(() => { this.sub.className = ''; }, ms);
  }
  speed(text, ms = 2000) {
    clearTimeout(this.tSpeed);
    this.speedEl.textContent = text;
    this.speedEl.className = 'show';
    this.tSpeed = setTimeout(() => { this.speedEl.className = ''; }, ms);
  }

  // mode: 0 oculto · 1 solo texto · 2 barra en reposo + texto · 3 barra en marcha + texto
  serve(mode, frac = 0, hint = '') {
    if (mode !== this.serveMode) {
      this.serveMode = mode;
      this.serveUI.classList.toggle('hidden', mode === 0);
      this.gauge.classList.toggle('off', mode < 2);
    }
    if (mode === 0) return;
    if (hint !== this.hintText) { this.hintText = hint; this.hintEl.textContent = hint; }
    if (mode >= 2) this.mark.style.left = Math.max(0, Math.min(100, frac * 100)).toFixed(1) + '%';
  }

  ping(text, cls = '') {
    if (text === this.pingText) return;
    this.pingText = text;
    this.pingEl.textContent = text;
    this.pingEl.className = cls;
  }

  net(text) {
    if (text === this.netText) return;
    this.netText = text;
    this.netEl.classList.toggle('hidden', !text);
    if (text) this.netEl.textContent = text;
  }

  toast(text, ms = 2800) {
    clearTimeout(this.tToast);
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    this.tToast = setTimeout(() => this.toastEl.classList.add('hidden'), ms);
  }
}
