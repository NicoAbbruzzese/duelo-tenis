// Instantáneas del estado: captura, empaquetado para la red e interpolación para dibujar.
import { TICK, C, ST, BS, PH, ballStep } from './sim.js';

export const PROTO = 3; // versión del protocolo de red: ambos jugadores deben coincidir

const r3 = (v) => Math.round(v * 1000) / 1000;
const r2 = (v) => Math.round(v * 100) / 100;

// Copia compacta del estado de la simulación (lo que hace falta para dibujar y predecir).
export function capture(G, ack = 0) {
  const b = G.ball;
  const p = (q) => ({ x: q.x, z: q.z, vx: q.vx, vz: q.vz, st: q.st, t: q.t, shot: q.shot, side: q.side, kind: q.kind, mood: q.mood, q: q.q, dur: q.dur, eta: q.eta });
  const ev = [];
  for (const e of G.ev) if (e.tk > G.tick - 50) ev.push([e.id, e.tk, e.type, e.a, e.b, e.c, e.d]);
  return {
    tick: G.tick, ack, ph: G.phase, pt: G.pt, paused: G.paused, flt: G.flt,
    sv: G.server, sn: G.serveNum, side: G.side, rally: G.rally, win: G.winner,
    lw: G.lastW, lr: G.lastR, lwhat: G.lastWhat, pw: G.pw | 0,
    b: { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, st: b.st, g: b.g, e: b.e, f: b.f, last: b.last, kind: b.kind, bn: b.bounces, live: b.live, serve: b.serve, roll: b.roll },
    p: [p(G.pl[0]), p(G.pl[1])],
    sc: { pts: [G.sc.pts[0], G.sc.pts[1]], games: [G.sc.games[0], G.sc.games[1]], sets: [G.sc.sets[0], G.sc.sets[1]], hist: G.sc.hist.map((h) => [h[0], h[1]]), tb: G.sc.tb },
    ev,
  };
}

export function pack(s) {
  const b = s.b;
  const fl = (s.paused ? 1 : 0) | (s.flt ? 2 : 0) | (s.sc.tb ? 4 : 0) | (b.live ? 8 : 0) | (b.serve ? 16 : 0) | (b.roll ? 32 : 0);
  const a = ['s', s.tick, s.ack, s.ph, r2(s.pt), fl, s.sv, s.sn, s.side, s.rally, s.win, s.lw, s.lr, s.lwhat, s.pw | 0,
    r3(b.x), r3(b.y), r3(b.z), r3(b.vx), r3(b.vy), r3(b.vz), b.st, r2(b.g), r2(b.e), r2(b.f), b.last, b.kind, b.bn];
  for (let i = 0; i < 2; i++) {
    const p = s.p[i];
    a.push(r3(p.x), r3(p.z), r3(p.vx), r3(p.vz), p.st, r3(p.t), p.shot, p.side, p.kind, p.mood, r2(p.q), r2(p.dur), r3(p.eta));
  }
  a.push(s.sc.pts[0], s.sc.pts[1], s.sc.games[0], s.sc.games[1], s.sc.sets[0], s.sc.sets[1]);
  const h = [];
  for (const x of s.sc.hist) h.push(x[0], x[1]);
  a.push(h);
  a.push(s.ev.map((e) => [e[0], e[1], e[2], r3(e[3]), r3(e[4]), r3(e[5]), r3(e[6])]));
  return a;
}

export function unpack(a) {
  let i = 1;
  const s = { tick: a[i++], ack: a[i++], ph: a[i++], pt: a[i++] };
  const fl = a[i++];
  s.paused = !!(fl & 1); s.flt = !!(fl & 2);
  s.sv = a[i++]; s.sn = a[i++]; s.side = a[i++]; s.rally = a[i++]; s.win = a[i++]; s.lw = a[i++]; s.lr = a[i++]; s.lwhat = a[i++]; s.pw = a[i++];
  s.b = { x: a[i++], y: a[i++], z: a[i++], vx: a[i++], vy: a[i++], vz: a[i++], st: a[i++], g: a[i++], e: a[i++], f: a[i++], last: a[i++], kind: a[i++], bn: a[i++], live: !!(fl & 8), serve: !!(fl & 16), roll: !!(fl & 32) };
  s.p = [];
  for (let k = 0; k < 2; k++) s.p.push({ x: a[i++], z: a[i++], vx: a[i++], vz: a[i++], st: a[i++], t: a[i++], shot: a[i++], side: a[i++], kind: a[i++], mood: a[i++], q: a[i++], dur: a[i++], eta: a[i++] });
  s.sc = { pts: [a[i++], a[i++]], games: [a[i++], a[i++]], sets: [a[i++], a[i++]], hist: [], tb: !!(fl & 4) };
  const h = a[i++] || [];
  for (let k = 0; k + 1 < h.length; k += 2) s.sc.hist.push([h[k], h[k + 1]]);
  s.ev = a[i++] || [];
  return s;
}

export function validSnap(a) {
  if (!Array.isArray(a) || a.length < 62) return false;
  for (let i = 1; i < 60; i++) if (typeof a[i] !== 'number' || !Number.isFinite(a[i])) return false;
  return Array.isArray(a[60]) && Array.isArray(a[61]);
}

const lerp = (a, b, t) => a + (b - a) * t;

// Mezcla dos instantáneas (A anterior, B posterior) con factor t en [0,1].
export function mix(A, B, t) {
  if (!B || A === B || t <= 0) return A;
  const dT = (B.tick - A.tick) * TICK;
  const near = t < 0.5 ? A : B;
  const out = {
    tick: lerp(A.tick, B.tick, t), ack: near.ack, ph: near.ph, pt: near.ph === B.ph && A.ph === B.ph ? lerp(A.pt, B.pt, t) : near.pt,
    paused: near.paused, flt: near.flt, sv: near.sv, sn: near.sn, side: near.side, rally: near.rally, win: near.win,
    lw: near.lw, lr: near.lr, lwhat: near.lwhat, pw: near.pw, sc: near.sc, ev: B.ev, b: null, p: [null, null],
  };
  const a = A.b, b = B.b;
  // Si la pelota "salta" (nuevo saque), no se interpola la posición.
  const jump = a.st !== b.st && (b.st === BS.HELD || a.st === BS.HELD);
  out.b = jump ? near.b : { ...near.b, x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t), vx: lerp(a.vx, b.vx, t), vy: lerp(a.vy, b.vy, t), vz: lerp(a.vz, b.vz, t) };
  for (let i = 0; i < 2; i++) {
    const pa = A.p[i], pb = B.p[i];
    const far = Math.abs(pa.x - pb.x) + Math.abs(pa.z - pb.z) > 3;
    const same = pa.st === pb.st && pb.t >= pa.t;
    const base = same ? near : pb;
    const o = { ...base };
    if (far) { o.x = near.p[i].x; o.z = near.p[i].z; }
    else { o.x = lerp(pa.x, pb.x, t); o.z = lerp(pa.z, pb.z, t); }
    o.vx = lerp(pa.vx, pb.vx, t); o.vz = lerp(pa.vz, pb.vz, t);
    o.t = same ? lerp(pa.t, pb.t, t) : Math.max(0, pb.t - (1 - t) * dT);
    out.p[i] = o;
  }
  return out;
}

// Extrapola una instantánea dt segundos hacia adelante (cuando faltan datos nuevos).
export function extrapolate(S, dt) {
  if (dt <= 0) return S;
  dt = Math.min(dt, 0.2);
  const out = { ...S, tick: S.tick + dt / TICK, b: { ...S.b }, p: [{ ...S.p[0] }, { ...S.p[1] }] };
  if (S.paused) return out;
  const b = out.b;
  if ((b.st === BS.FLY || b.st === BS.DEAD) && S.ph !== PH.SERVE) {
    const o = {};
    let left = dt;
    while (left > 1e-6) { const h = Math.min(left, TICK); ballStep(b, h, o); left -= h; }
  }
  for (let i = 0; i < 2; i++) {
    const p = out.p[i];
    p.x += p.vx * dt; p.z += p.vz * dt; p.t += dt;
    p.x = Math.max(-C.X_LIM, Math.min(C.X_LIM, p.x));
  }
  return out;
}

// Búfer de instantáneas con reloj de reproducción suavizado (para el invitado) o directo (anfitrión).
export class SnapBuffer {
  constructor() { this.reset(); }
  reset() {
    this.list = [];
    this.rt = -1;            // tick de dibujo (fraccionario)
    this.newest = -1;
    this.lastArrive = 0;
    this.jitter = 0;         // ms, suavizado
    this.interval = 1;       // ticks entre instantáneas recibidas
    this.delay = 2.5;        // ticks de retraso deseado
    this.lastNow = 0;
    this.starved = 0;
  }
  // nowMs: instante de llegada (performance.now()). Devuelve false si es vieja/duplicada.
  push(s, nowMs) {
    if (s.tick <= this.newest) {
      // llegó desordenada: insertarla si todavía sirve
      if (this.list.length && s.tick > this.list[0].tick && !this.list.some((x) => x.tick === s.tick)) {
        this.list.push(s); this.list.sort((x, y) => x.tick - y.tick);
        return true;
      }
      return false;
    }
    if (this.newest >= 0 && s.tick - this.newest > 600) { this.list.length = 0; this.rt = -1; }
    if (this.newest >= 0 && this.lastArrive) {
      const gapTicks = s.tick - this.newest;
      this.interval += (Math.min(gapTicks, 8) - this.interval) * 0.1;
      const dev = Math.abs(nowMs - this.lastArrive - gapTicks * TICK * 1000);
      this.jitter += (dev - this.jitter) * (dev > this.jitter ? 0.25 : 0.03);
    }
    this.lastArrive = nowMs;
    this.newest = s.tick;
    this.list.push(s);
    if (this.list.length > 90) this.list.splice(0, this.list.length - 90);
    return true;
  }
  // Avanza el reloj de reproducción y devuelve el estado interpolado en ese instante.
  sample(nowMs) {
    const n = this.list.length;
    if (!n) return null;
    const want = Math.min(14, Math.max(1.6, this.interval + 0.6 + (this.jitter * 2.2 + this.starved) / (TICK * 1000)));
    this.delay += (want - this.delay) * 0.02;
    const target = this.newest - this.delay;
    if (this.rt < 0 || Math.abs(target - this.rt) > 18) this.rt = target;
    else {
      const dtMs = Math.min(100, nowMs - this.lastNow);
      const err = target - this.rt;
      const rate = 1 + Math.max(-0.2, Math.min(0.2, err * 0.06));
      this.rt += (dtMs / (TICK * 1000)) * rate;
    }
    this.lastNow = nowMs;
    this.starved *= 0.995;
    return this.at(this.rt, true);
  }
  // Estado en un tick concreto (interpolando o extrapolando).
  at(tick, countStarve = false) {
    const L = this.list, n = L.length;
    if (!n) return null;
    if (tick <= L[0].tick) return L[0];
    const last = L[n - 1];
    if (tick >= last.tick) {
      if (countStarve && tick > last.tick + 0.5) this.starved = Math.min(60, this.starved + 0.6);
      return extrapolate(last, (tick - last.tick) * TICK);
    }
    let i = n - 2;
    while (i > 0 && L[i].tick > tick) i--;
    const A = L[i], B = L[i + 1];
    return mix(A, B, (tick - A.tick) / (B.tick - A.tick));
  }
  latest() { return this.list.length ? this.list[this.list.length - 1] : null; }
}
