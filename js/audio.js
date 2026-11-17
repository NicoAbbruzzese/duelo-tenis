// Sonido sintetizado con WebAudio (sin archivos): golpes, botes, red, aplausos y avisos.

export class Sfx {
  constructor() {
    this.ctx = null; this.master = null; this.noise = null; this.clap = null;
    this.enabled = true; this.amb = null;
  }

  // Debe llamarse dentro de un gesto del usuario (toque o tecla).
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.enabled ? 0.9 : 0;
        this.master.connect(this.ctx.destination);
        this._buildBuffers();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) { this.ctx = null; }
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.9 : 0;
  }

  _buildBuffers() {
    const sr = this.ctx.sampleRate;
    const n = this.ctx.createBuffer(1, sr, sr);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = n;
    // aplauso: muchas palmadas cortas superpuestas
    const len = Math.floor(sr * 3.2);
    const c = this.ctx.createBuffer(1, len, sr);
    const cd = c.getChannelData(0);
    const claps = 900;
    for (let k = 0; k < claps; k++) {
      const u = Math.random();
      const t0 = Math.floor(Math.pow(u, 0.75) * (len - sr * 0.05));
      const env = Math.min(1, t0 / (sr * 0.25)) * Math.pow(1 - t0 / len, 1.3);
      const dur = Math.floor(sr * (0.006 + Math.random() * 0.012));
      const amp = (0.25 + Math.random() * 0.75) * env * 0.16;
      let lp = 0;
      for (let i = 0; i < dur && t0 + i < len; i++) {
        const w = Math.random() * 2 - 1;
        lp += (w - lp) * 0.55;
        cd[t0 + i] += lp * amp * Math.exp(-i / (dur * 0.35));
      }
    }
    this.clap = c;
  }

  _src(buffer, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer; s.playbackRate.value = rate;
    return s;
  }
  _ok() { return this.ctx && this.enabled && this.ctx.state === 'running'; }

  // Golpe de raqueta. strength 0..1, soft = toque suave (dejada / cortado)
  hit(strength = 0.6, soft = false) {
    if (!this._ok()) return;
    const c = this.ctx, t = c.currentTime;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime((soft ? 0.25 : 0.5) + strength * 0.5, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (soft ? 0.07 : 0.11));
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = soft ? 1300 : 1700 + strength * 900; f.Q.value = 0.9;
    const s = this._src(this.noise, 1 + strength * 0.4);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random() * 0.5, 0.15);
    const o = c.createOscillator(), og = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(soft ? 260 : 210 + strength * 90, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.09);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.35 + strength * 0.4, t + 0.005);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(og); og.connect(this.master);
    o.start(t); o.stop(t + 0.14);
  }

  bounce(vol = 0.6) {
    if (!this._ok()) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(330, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.07);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.12);
  }

  net() {
    if (!this._ok()) return;
    const c = this.ctx, t = c.currentTime;
    const g = c.createGain(), f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 500;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    const s = this._src(this.noise, 0.6);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random() * 0.5, 0.25);
  }

  whoosh() {
    if (!this._ok()) return;
    const c = this.ctx, t = c.currentTime;
    const g = c.createGain(), f = c.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(1800, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    const s = this._src(this.noise);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random() * 0.5, 0.25);
  }

  // Aplauso del público. level 0..1
  cheer(level = 0.6) {
    if (!this._ok()) return;
    const c = this.ctx, t = c.currentTime;
    const g = c.createGain(), f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.5;
    g.gain.value = 0.5 + level * 0.9;
    const s = this._src(this.clap, 0.92 + Math.random() * 0.16);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t);
  }

  // Aviso corto de dos tonos (falta, fuera, etc.). up = tono ascendente
  beep(up = true, vol = 0.25) {
    if (!this._ok()) return;
    const c = this.ctx, t = c.currentTime;
    const notes = up ? [660, 990] : [520, 390];
    notes.forEach((fq, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = fq;
      const t0 = t + i * 0.09;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      o.connect(g); g.connect(this.master);
      o.start(t0); o.stop(t0 + 0.14);
    });
  }

  click() {
    if (!this._ok()) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.06);
  }

  // Murmullo de fondo del estadio.
  ambience(on) {
    if (!this.ctx) return;
    if (on && !this.amb) {
      const c = this.ctx;
      const s = this._src(this.noise, 0.35);
      s.loop = true;
      const f = c.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 420;
      const g = c.createGain();
      g.gain.value = 0.05;
      s.connect(f); f.connect(g); g.connect(this.master);
      s.start();
      this.amb = { s, g };
    } else if (!on && this.amb) {
      try { this.amb.s.stop(); } catch (e) { /* ya parado */ }
      this.amb = null;
    }
  }
}
