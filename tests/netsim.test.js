// Simulación de red en tiempo virtual: anfitrión + invitado con retardo, variación y pérdida de paquetes.
// Mide lo que no se puede "sentir" en una prueba automática: suavidad, predicción y entrega de eventos.
//   node tests/netsim.test.js
import assert from 'node:assert/strict';
import * as S from '../js/sim.js';
import { capture, pack, unpack, validSnap, SnapBuffer } from '../js/proto.js';
import { predictOwn } from '../js/predict.js';
import { makeBot } from './bot.js';

const { PH, ST, BS, TICK } = S;
const TMS = TICK * 1000;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pseudoG = (s) => ({ phase: s.ph, pt: s.pt, server: s.sv, rally: s.rally, side: s.side, pl: s.p, ball: { ...s.b, bounces: s.b.bn } });

function run(o) {
  const { lag = 0, jit = 0, loss = 0, hz = 60, seconds = 150, fps = 60, pred = true, seed = 1 } = o;
  const rnd = mulberry(seed * 977 + 13);
  const G = S.newGame({ games: 6, sets: 3 }, seed);
  const bots = [makeBot({ seed: seed + 1, react: 0.3, posErr: 0.25, pressMin: 0.7, net: 0.3 }), makeBot({ seed: seed + 2, react: 0.3, posErr: 0.25, pressMin: 0.7, net: 0.3 })];
  const toGuest = [], toHost = [];
  const send = (q, now, str, lossy) => { if (lossy && rnd() < loss) return; q.push({ at: now + lag + rnd() * jit, str }); };
  const every = Math.max(1, Math.round(60 / hz));

  // anfitrión
  let remote = { seq: -1, dx: 0, dz: 0, c: null, vt: -1, at: -1e9 }, remoteLastC = null;
  const hostHist = []; // posición real del jugador 1 por tick
  const hostEvIds = new Set();
  // invitado
  const buf = new SnapBuffer();
  let gseq = 0, pending = [], gcount = [0, 0, 0, 0], lastSentTick = 0, lastSent = { dx: 0, dz: 0 }, evSeen = 0, gacc = 0;
  const own = { x: 0, z: 0, vx: 0, vz: 0, init: false };
  const guestEvIds = new Set();
  const m = { frames: 0, ownJumps: 0, ballJumps: 0, ownErr: [], delay: [], maxStarve: 0, late: 0, backward: 0, pendMax: 0, stale: 0 };
  let prevOwn = null, prevBall = null, prevView = null;
  const frames = [];

  let hostNext = 0, guestNext = 7, frameNext = 3, lastFrameT = 0;
  const end = seconds * 1000;
  for (let now = 0; now < end; now++) {
    // entregas
    for (let i = toHost.length - 1; i >= 0; i--) if (toHost[i].at <= now) {
      const msg = JSON.parse(toHost[i].str); toHost.splice(i, 1);
      if (msg[0] === 'i' && (msg[1] > remote.seq)) remote = { seq: msg[1], dx: msg[2], dz: msg[3], c: [msg[4], msg[5], msg[6], msg[7]], vt: msg[8], at: now };
    }
    for (let i = toGuest.length - 1; i >= 0; i--) if (toGuest[i].at <= now) {
      const arr = JSON.parse(toGuest[i].str); toGuest.splice(i, 1);
      assert.ok(validSnap(arr));
      const sn = unpack(arr);
      if (buf.push(sn, now)) {
        for (const e of sn.ev) if (e[0] > evSeen) { evSeen = e[0]; guestEvIds.add(e[0]); }
        if (sn.tick >= buf.newest) while (pending.length && pending[0].seq <= sn.ack) pending.shift();
      }
    }
    // tick del anfitrión
    if (now >= hostNext) {
      hostNext += TMS;
      let pr = 0;
      if (remote.c) {
        if (!remoteLastC) remoteLastC = remote.c.slice();
        for (let b = 0; b < 4; b++) if (remote.c[b] !== remoteLastC[b]) { pr |= 1 << b; remoteLastC[b] = remote.c[b]; }
      }
      const stale = now - remote.at > 450;
      if (stale && G.phase === PH.RALLY) m.stale++;
      const rin = stale ? { dx: 0, dz: 0, pr, vt: -1 } : { dx: remote.dx, dz: remote.dz, pr, vt: remote.vt };
      S.step(G, [bots[0](G, 0), rin]);
      for (const e of G.ev) hostEvIds.add(e.id);
      hostHist[G.tick] = { t: now, x: G.pl[1].x, z: G.pl[1].z, st: G.pl[1].st, ph: G.phase };
      if (G.tick % every === 0) send(toGuest, now, JSON.stringify(pack(capture(G, remote.seq))), true);
    }
    // tick del invitado
    if (now >= guestNext) {
      guestNext += TMS;
      const latest = buf.latest();
      const inp = latest ? bots[1](pseudoG(latest), 1) : { dx: 0, dz: 0, pr: 0 };
      gseq++;
      for (let b = 0; b < 4; b++) if (inp.pr & (1 << b)) gcount[b] = (gcount[b] + 1) % 1000;
      pending.push({ seq: gseq, dx: inp.dx, dz: inp.dz, pr: inp.pr });
      if (pending.length > 240) pending.shift();
      m.pendMax = Math.max(m.pendMax, pending.length);
      const changed = inp.pr || inp.dx !== lastSent.dx || inp.dz !== lastSent.dz;
      const since = gseq - lastSentTick;
      if (since >= every || (changed && since >= Math.max(1, every >> 1))) {
        lastSentTick = gseq; lastSent = { dx: inp.dx, dz: inp.dz };
        send(toHost, now, JSON.stringify(['i', gseq, inp.dx, inp.dz, gcount[0], gcount[1], gcount[2], gcount[3], Math.floor(buf.rt)]), true);
      }
      gacc = 0;
    }
    // cuadro del invitado
    if (now >= frameNext) {
      frameNext += 1000 / fps;
      const dt = (now - lastFrameT) / 1000; lastFrameT = now;
      const view = buf.sample(now);
      if (!view) continue;
      gacc = Math.max(0, (now - (guestNext - TMS)) / 1000);
      const latest = buf.latest();
      const o = predictOwn(own, latest, pending, 1, Math.min(gacc, TICK), dt, (now - buf.lastArrive) / 1000, pred);
      m.frames++;
      m.delay.push(buf.newest - buf.rt);
      m.maxStarve = Math.max(m.maxStarve, buf.starved);
      if (prevView && view.tick < prevView.tick - 1e-6) m.backward++;
      // suavidad del jugador propio
      const playing = latest.ph === PH.RALLY || latest.ph === PH.SERVE;
      if (prevOwn && playing && prevOwn.playing && dt > 0) {
        const sp = Math.hypot(o.x - prevOwn.x, o.z - prevOwn.z) / dt;
        if (sp > S.T.RUN * 1.6 + 0.5) m.ownJumps++;
      }
      prevOwn = { x: o.x, z: o.z, playing };
      // continuidad de la pelota
      const b = view.b;
      if (prevBall && b.st === BS.FLY && prevBall.st === BS.FLY && view.ph === PH.RALLY && dt > 0) {
        const d = Math.hypot(b.x - prevBall.x, b.y - prevBall.y, b.z - prevBall.z);
        const vmax = Math.max(Math.hypot(b.vx, b.vy, b.vz), prevBall.v) + 6;
        if (d > vmax * dt * 2.2 + 0.25) m.ballJumps++;
      }
      prevBall = { x: b.x, y: b.y, z: b.z, st: b.st, v: Math.hypot(b.vx, b.vy, b.vz) };
      prevView = view;
      frames.push({ t: now, x: o.x, z: o.z, ack: latest.ack, free: latest.p[1].st === ST.FREE && latest.ph === PH.RALLY });
    }
  }
  // error de predicción: lo mostrado ahora vs. dónde estará de verdad el jugador cuando lleguen las entradas ya enviadas
  const up = lag + jit / 2 + TMS;
  let hi = 1;
  for (const f of frames) {
    if (!f.free) continue;
    const target = f.t + up;
    while (hi < hostHist.length - 1 && hostHist[hi] && hostHist[hi].t < target) hi++;
    const h = hostHist[hi];
    if (!h || h.ph !== PH.RALLY || h.st !== ST.FREE) continue;
    m.ownErr.push(Math.hypot(h.x - f.x, h.z - f.z));
  }
  const L = buf.latest();
  let missed = 0;
  for (const id of hostEvIds) if (!guestEvIds.has(id) && id <= evSeen) missed++;
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const pct = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length * q)] : 0; };
  return {
    points: G.sc.pts.join('-'), games: G.sc.games.join('-'), hostTick: G.tick,
    sameScore: JSON.stringify(L.sc) === JSON.stringify(capture(G).sc) || Math.abs(L.tick - G.tick) < 400,
    lagTicks: G.tick - L.tick,
    delayMs: +(avg(m.delay) * TMS).toFixed(1), delayP95: +(pct(m.delay, 0.95) * TMS).toFixed(1),
    starveMax: +m.maxStarve.toFixed(1), backward: m.backward,
    ownJumps: m.ownJumps, ballJumps: m.ballJumps, frames: m.frames,
    predErrAvg: +avg(m.ownErr).toFixed(3), predErrP95: +pct(m.ownErr, 0.95).toFixed(3), predN: m.ownErr.length,
    evHost: hostEvIds.size, evMissed: missed, pendMax: m.pendMax, staleTicks: m.stale,
  };
}

const cases = [
  { name: 'wifi local (2 ms)', lag: 2, jit: 2, loss: 0 },
  { name: 'internet buena (25 ms, var 8, 1% pérdida)', lag: 25, jit: 8, loss: 0.01 },
  { name: 'internet regular (60 ms, var 25, 3% pérdida)', lag: 60, jit: 25, loss: 0.03 },
  { name: 'relé lejano (140 ms, var 30, 2% pérdida)', lag: 140, jit: 30, loss: 0.02 },
  { name: 'respaldo MQTT (250 ms, var 40, 20 Hz)', lag: 250, jit: 40, loss: 0, hz: 20 },
  { name: 'respaldo MQTT lento (250 ms, 10 Hz)', lag: 250, jit: 40, loss: 0, hz: 10 },
  { name: 'pantalla de 120 Hz (25 ms)', lag: 25, jit: 8, loss: 0.01, fps: 120 },
  { name: 'sin predicción (60 ms) [referencia]', lag: 60, jit: 25, loss: 0.03, pred: false },
];
let bad = 0;
for (const c of cases) {
  const r = run({ ...c, seconds: c.seconds || 150 });
  console.log(c.name);
  console.log('   ' + JSON.stringify(r));
  try {
    assert.equal(r.evMissed, 0, 'eventos perdidos');
    assert.equal(r.backward, 0, 'el tiempo de dibujo retrocedió');
    assert.ok(r.ownJumps <= r.frames * (c.hz ? 0.012 : 0.002), 'saltos del jugador propio: ' + r.ownJumps);
    assert.ok(r.ballJumps <= r.frames * 0.004, 'saltos de la pelota: ' + r.ballJumps);
    assert.ok(Math.abs(r.lagTicks) < 60, 'invitado muy atrasado');
  } catch (e) { bad++; console.log('   FALLA: ' + e.message); }
}
console.log(bad ? `\n${bad} caso(s) con fallas` : '\nSimulación de red: todo bien');
process.exit(bad ? 1 : 0);
