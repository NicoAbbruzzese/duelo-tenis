// Bot SOLO para pruebas automáticas (el juego publicado es únicamente jugador contra jugador).
// Genera las mismas entradas que un mando: { dx, dz, pr, vt }.
import { C, T, PH, ST, BS, BTN, TICK, TOSS_APEX, predictCross, predictLanding } from '../js/sim.js';

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeBot(opts = {}) {
  const o = { react: 0.24, jit: 0.3, skill: 0.75, posErr: 0, pressMin: 0.85, wrong: 0, net: 0, seed: 7, ...opts };
  const rnd = mulberry(o.seed);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const m = { rally: -1, reactAt: 0, time: 0, aimX: 0, aimZ: 0, shot: BTN.TOP, serveAt: 0, hitAt: 0, phase: -1, depth: 0, offX: 0, pressT: 0.85, wrongUntil: 0, attack: false };

  return function bot(G, i) {
    const s = i === 0 ? 1 : -1;
    const p = G.pl[i], opp = G.pl[1 - i], b = G.ball;
    const lx = s * p.x, lz = s * p.z;
    const inp = { dx: 0, dz: 0, pr: 0, vt: -1 };
    m.time += TICK;
    if (G.phase !== m.phase) {
      m.phase = G.phase;
      if (G.phase === PH.SERVE) {
        m.attack = false;
        m.serveAt = 0.4 + rnd() * 0.9;
        m.hitAt = TOSS_APEX + gauss() * 0.09 * (1.6 - o.skill);
        m.aimX = rnd() < 0.4 ? -1 : rnd() < 0.66 ? 1 : 0;
      }
    }
    const goTo = (tx, tz, tol = 0.25) => {
      const ex = tx - lx, ez = tz - lz;
      if (Math.abs(ex) > tol) inp.dx = ex > 0 ? 1 : -1;
      if (Math.abs(ez) > tol) inp.dz = ez > 0 ? -1 : 1; // dz +1 = hacia la red (z local menor)
    };

    if (G.phase === PH.SERVE) {
      if (G.server === i) {
        if (p.st === ST.SREADY) { if (G.pt >= m.serveAt) inp.pr = 1; }
        else if (p.st === ST.TOSS) { inp.dx = m.aimX; if (p.t >= m.hitAt) inp.pr = 1; }
      }
      return inp;
    }
    if (G.phase !== PH.RALLY) return inp;

    const mine = b.st === BS.FLY && b.live && b.last === 1 - i;
    if (!mine) {
      if (G.rally !== m.rally && b.last === i) {
        m.rally = G.rally;
        if (!m.attack) m.attack = p.q >= 0.7 && rnd() < o.net;
      }
      // recuperar el centro (o subir a la red si ataca)
      if (p.st === ST.FREE) { if (m.attack) goTo(0, 3.6, 0.4); else goTo(0, C.HL + 0.6, 0.4); }
      return inp;
    }
    if (G.rally !== m.rally) {
      m.rally = G.rally;
      m.reactAt = m.time + o.react * (1 - o.jit + 2 * o.jit * rnd());
      m.offX = gauss() * o.posErr;
      m.pressT = o.pressMin * (0.4 + 0.6 * rnd());
      m.wrongUntil = rnd() < o.wrong ? m.reactAt + 0.3 : 0;
      // plan de golpe
      const ox = s * opp.x; // posición del rival en mi marco local (x)
      const oz = -s * opp.z; // distancia del rival a la red
      const r = rnd();
      const open = ox > 0.4 ? -1 : ox < -0.4 ? 1 : rnd() < 0.5 ? -1 : 1;
      m.aimX = r < 0.68 ? open : r < 0.84 ? -open : 0;
      const r2 = rnd();
      m.aimZ = r2 < 0.42 ? 1 : r2 < 0.58 ? -1 : 0;
      const r3 = rnd();
      m.shot = BTN.TOP;
      if (oz < 6 && r3 < 0.45) m.shot = BTN.LOB;
      else if (oz > 11 && r3 < 0.07) m.shot = BTN.DROP;
      else if (r3 < 0.2) m.shot = BTN.SLICE;
      m.depth = 0;
    }
    if (p.st === ST.PREP || p.st === ST.SWING) {
      inp.dx = m.aimX; inp.dz = m.aimZ;
      return inp;
    }
    if (m.time < m.reactAt) return inp;

    const pr = predictCross(G, i);
    if (!pr) { goTo(0, C.HL + 0.6, 0.4); return inp; }
    if (pr.now) {
      if (Math.abs(pr.x - lx) < T.STRETCH) { inp.pr = 1 << m.shot; inp.dx = m.aimX; inp.dz = m.aimZ; }
      return inp;
    }
    // profundidad deseada
    let tz = lz;
    if (pr.none) tz = Math.max(C.Z_MIN + 0.2, pr.z - 0.2);
    else {
      const land = b.bounces === 0 ? predictLanding(b) : null;
      if (land) {
        const lzLand = s * land.z;
        if (lzLand > 0) {
          const want = Math.min(C.Z_MAX - 0.3, Math.max(lzLand + 2.0, C.HL - 1.0));
          if (lz < want - 0.4 && lzLand > lz - 2.2) tz = want; // demasiado cerca del bote
          else if (lzLand < C.SVC && lz > lzLand + 4.5) tz = lzLand + 2.5; // pelota corta: adelantarse
        }
      }
      if (pr.y > 2.6) tz = Math.min(C.Z_MAX - 0.3, lz + 1.5);
    }
    const side = pr.x - lx >= 0 ? 1 : -1;
    const wantX = pr.x - side * T.IDEAL + m.offX;
    const ex = wantX - lx;
    goTo(wantX, tz, 0.3);
    if (m.time < m.wrongUntil) inp.dx = -inp.dx;
    const closeX = Math.abs(ex) < 0.7;
    const closeZ = Math.abs(tz - lz) < 0.8;
    const press = (closeX && closeZ && pr.t < m.pressT) || (pr.t < 0.2 && Math.abs(pr.x - lx) < T.STRETCH) || (pr.none && closeX && pr.t < 0.5);
    if (press && !(b.serve && pr.nb < 1)) { inp.pr = 1 << m.shot; inp.dx = m.aimX; inp.dz = m.aimZ; }
    return inp;
  };
}
