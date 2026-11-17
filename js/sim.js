// Duelo Tenis — simulación (lógica pura, sin DOM).
// Unidades: metros y segundos. El anfitrión corre esta simulación a 60 Hz.
// Mundo: x = ancho, y = altura, z = largo. El jugador 0 juega en z > 0 y el 1 en z < 0.
// "Local" = coordenadas vistas desde un jugador: su campo es z > 0 y su derecha es x > 0.

export const TICK = 1 / 60;

export const C = Object.freeze({
  HL: 11.885,   // red -> línea de fondo
  HW: 4.115,    // medio ancho de individuales
  HWD: 5.485,   // medio ancho de dobles (solo dibujo)
  SVC: 6.4,     // red -> línea de saque
  NET_H: 0.914, NET_HP: 1.07, POST_X: 5.03,
  R: 0.045,     // radio físico de la pelota
  X_LIM: 8.4, Z_MIN: 0.75, Z_MAX: 17.0, // límites de movimiento del jugador (local)
  WALL_X: 10.5, WALL_Z: 19.5,
});

export const PH = Object.freeze({ INTRO: 0, SERVE: 1, RALLY: 2, POINT: 3, OVER: 4 });
export const ST = Object.freeze({ FREE: 0, PREP: 1, SWING: 2, SREADY: 3, TOSS: 4 });
export const BS = Object.freeze({ HELD: 0, TOSS: 1, FLY: 2, DEAD: 3 });
export const BTN = Object.freeze({ TOP: 0, SLICE: 1, LOB: 2, DROP: 3 });
export const K = Object.freeze({ TOP: 0, SLICE: 1, LOB: 2, DROP: 3, VOLLEY: 4, SMASH: 5, STRETCH: 6, SERVE: 7, WHIFF: 8 });
export const EV = Object.freeze({ HIT: 1, BOUNCE: 2, NET: 3, POINT: 4, FAULT: 5, TOSS: 6, WHIFF: 7, START: 8, OVER: 9, CATCH: 10 });
export const RS = Object.freeze({ OUT: 1, NET: 2, WIN: 3, ACE: 4, DFAULT: 5 });

// Parámetros de juego (ajustados con partidos de prueba entre bots).
export const T = {
  RUN: 6.0, ACCEL: 24, DECEL: 36, AUTO: 3.4,
  REACH: 1.6, STRETCH: 2.45, IDEAL: 0.85, PLANE: 0.45, ZONE: 1.3,
  Y_MIN: 0.1, Y_MAX: 3.05, SMASH_Y: 2.0,
  CHARGE: 0.45,
  SWING_T: 0.34, WHIFF_T: 0.38, SERVE_SWING_T: 0.42, SMASH_T: 0.40, STRETCH_T: 0.72,
  TOSS_Y0: 1.35, TOSS_V: 6.45, TOSS_G: 10.4, // ápice ~3.35 m a los 0.62 s
  TOSS_MIN: 0.12,
  POINT_PAUSE: 2.8, FAULT_PAUSE: 1.6, INTRO_T: 2.8, SERVE_CLOCK: 15,
  WALK: 4.6,
};
export const TOSS_APEX = T.TOSS_V / T.TOSS_G;

// Tipos de golpe: v0..v1 velocidad horizontal (m/s) según calidad; g gravedad efectiva (efecto);
// e rebote vertical; f conservación de velocidad horizontal al botar; clr margen mínimo sobre la red.
export const SHOTS = {
  [K.TOP]:     { v0: 21, v1: 40, g: 15.5, e: 0.78, f: 0.80, clr: 0.40 },
  [K.SLICE]:   { v0: 17, v1: 27, g: 9.2, e: 0.56, f: 0.70, clr: 0.22 },
  [K.LOB]:     { T0: 1.75, T1: 2.05, g: 10.5, e: 0.70, f: 0.62, clr: 1.0 },
  [K.DROP]:    { T0: 1.05, T1: 1.18, g: 9.81, e: 0.45, f: 0.32, clr: 0.30 },
  [K.VOLLEY]:  { v0: 21, v1: 32, g: 11, e: 0.70, f: 0.74, clr: 0.18 },
  [K.SMASH]:   { v0: 36, v1: 48, g: 11, e: 0.74, f: 0.76, clr: 0.12 },
  [K.STRETCH]: { v0: 15.5, v1: 17, g: 9.81, e: 0.70, f: 0.70, clr: 0.9 },
};
export const SERVE1 = { v0: 29, v1: 46, g: 12.5, e: 0.74, f: 0.80, clr: 0.10 };
export const SERVE2 = { v0: 25, v1: 33, g: 14.5, e: 0.80, f: 0.80, clr: 0.25 };

const sgn = (i) => (i === 0 ? 1 : -1);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
export const netH = (x) => C.NET_H + (C.NET_HP - C.NET_H) * Math.min(1, Math.abs(x) / C.POST_X);
export const tossY = (t) => T.TOSS_Y0 + T.TOSS_V * t - 0.5 * T.TOSS_G * t * t;

// ---------- azar reproducible ----------
function rnd(G) {
  let t = (G.seed = (G.seed + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function gauss(G) {
  let u = 0;
  while (u < 1e-9) u = rnd(G);
  const v = rnd(G);
  return clamp(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v), -2.2, 2.2);
}

// ---------- marcador ----------
export function newScore() {
  return { pts: [0, 0], games: [0, 0], sets: [0, 0], hist: [], tb: false };
}
export function cloneScore(sc) {
  return { pts: [sc.pts[0], sc.pts[1]], games: [sc.games[0], sc.games[1]], sets: [sc.sets[0], sc.sets[1]], hist: sc.hist.map((h) => h.slice()), tb: sc.tb };
}
// Suma un punto a w. Devuelve 0 = punto, 1 = juego, 2 = set, 3 = partido.
export function scorePoint(sc, cfg, w) {
  const l = 1 - w;
  sc.pts[w]++;
  const need = sc.tb ? 7 : 4;
  if (!(sc.pts[w] >= need && sc.pts[w] - sc.pts[l] >= 2)) return 0;
  const wasTb = sc.tb;
  sc.pts[0] = sc.pts[1] = 0;
  sc.games[w]++;
  let setWon;
  if (wasTb) setWon = true;
  else if (cfg.games >= 6) {
    setWon = sc.games[w] >= cfg.games && sc.games[w] - sc.games[l] >= 2;
    if (!setWon && sc.games[w] === cfg.games && sc.games[l] === cfg.games) sc.tb = true;
  } else setWon = sc.games[w] >= cfg.games;
  if (!setWon) return 1;
  sc.hist.push([sc.games[0], sc.games[1]]);
  sc.games[0] = sc.games[1] = 0;
  sc.tb = false;
  sc.sets[w]++;
  return sc.sets[w] > cfg.sets / 2 ? 3 : 2;
}
// Texto de los puntos del juego en curso para cada jugador.
export function pointLabels(sc) {
  const a = sc.pts[0], b = sc.pts[1];
  if (sc.tb) return [String(a), String(b)];
  const n = ['0', '15', '30', '40'];
  if (a >= 3 && b >= 3) {
    if (a === b) return ['40', '40'];
    return a > b ? ['AD', ''] : ['', 'AD'];
  }
  return [n[Math.min(a, 3)], n[Math.min(b, 3)]];
}
// ¿Qué se juega en el próximo punto? { who, what } con what: 3 partido, 2 set, 1 quiebre; o null.
export function pointStakes(sc, cfg, server) {
  let best = null;
  for (let w = 0; w < 2; w++) {
    const c = cloneScore(sc);
    const r = scorePoint(c, cfg, w);
    let what = 0;
    if (r === 3) what = 3;
    else if (r === 2) what = 2;
    else if (r === 1 && w !== server && !sc.tb) what = 1;
    if (what && (!best || what > best.what)) best = { who: w, what };
  }
  return best;
}

// ---------- estado ----------
function newPlayer() {
  return { x: 0, z: 0, vx: 0, vz: 0, st: ST.FREE, t: 0, shot: 0, side: 1, kind: 0, dur: 0, mood: 0, rel: null, q: 0, eta: -1 };
}

export function newGame(cfg = {}, seed = 1) {
  const G = {
    tick: 0,
    cfg: { games: cfg.games || 6, sets: cfg.sets || 1, court: cfg.court || 0 },
    seed: (seed >>> 0) || 1,
    phase: PH.INTRO, pt: 0, paused: false, pw: 0,
    server: 0, serveNum: 1, side: 1, auto: false, flt: false,
    tbActive: false, tbFirst: 0,
    sc: newScore(),
    ball: { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, g: 9.81, e: 0.7, f: 0.7, st: BS.HELD, live: false, last: -1, bounces: 0, serve: false, net: false, kind: 0, roll: false },
    bp: { x: 0, y: 0, z: 0 },
    pl: [newPlayer(), newPlayer()],
    rally: 0, rt: 0, lastW: -1, lastR: 0, lastWhat: 0, winner: -1,
    ev: [], evId: 0, nx: null,
  };
  G.server = cfg.firstServer === 0 || cfg.firstServer === 1 ? cfg.firstServer : rnd(G) < 0.5 ? 0 : 1;
  G.firstServer = G.server;
  placeForServe(G);
  emit(G, EV.START, G.server, 0, 0, 0);
  return G;
}

function emit(G, type, a = 0, b = 0, c = 0, d = 0) {
  G.ev.push({ id: ++G.evId, tk: G.tick, type, a, b, c, d });
  if (G.ev.length > 24) G.ev.shift();
}

// Posiciones (mundo) de ambos jugadores para el saque de `server` desde el lado `side`.
export function servePositions(server, side) {
  const out = [null, null];
  const s = sgn(server), r = 1 - server, sr = sgn(r);
  out[server] = { x: s * side * 1.3, z: s * (C.HL + 0.45) };
  out[r] = { x: sr * side * 3.0, z: sr * (C.HL + 0.9) };
  return out;
}
function nextSide(G) {
  return (G.sc.pts[0] + G.sc.pts[1]) % 2 === 0 ? 1 : -1;
}
function holdBall(G) {
  const p = G.pl[G.server], b = G.ball, s = sgn(G.server);
  b.x = p.x - s * 0.28; b.y = 1.05; b.z = p.z - s * 0.25;
  b.vx = b.vy = b.vz = 0;
}
function placeForServe(G) {
  G.side = nextSide(G);
  const pos = servePositions(G.server, G.side);
  for (let i = 0; i < 2; i++) {
    const p = G.pl[i];
    p.x = pos[i].x; p.z = pos[i].z; p.vx = p.vz = 0;
    p.st = ST.FREE; p.t = 0; p.mood = 0; p.rel = null; p.kind = 0; p.eta = -1;
  }
  const b = G.ball;
  b.st = BS.HELD; b.live = false; b.last = -1; b.bounces = 0; b.serve = false; b.net = false; b.roll = false;
  holdBall(G);
  G.rally = 0; G.auto = false; G.flt = false;
}
function startServe(G) {
  placeForServe(G);
  G.phase = PH.SERVE; G.pt = 0;
  G.pl[G.server].st = ST.SREADY;
}

// ---------- física de la pelota ----------
// Avanza la pelota dt. Devuelve banderas: 1 = botó (out.bx, out.bz), 2 = tocó la red, 4 = pared.
export function ballStep(b, dt, out) {
  const px = b.x, py = b.y, pz = b.z;
  if (b.roll) {
    b.x += b.vx * dt; b.z += b.vz * dt; b.y = C.R; b.vy = 0;
    const k = Math.max(0, 1 - 2.2 * dt);
    b.vx *= k; b.vz *= k;
  } else {
    b.x += b.vx * dt; b.z += b.vz * dt;
    b.y += b.vy * dt - 0.5 * b.g * dt * dt;
    b.vy -= b.g * dt;
  }
  let fl = 0;
  // red (plano z = 0)
  if (pz !== 0 && (pz > 0) !== (b.z > 0)) {
    const a = pz / (pz - b.z);
    const xc = px + (b.x - px) * a, yc = py + (b.y - py) * a;
    if (Math.abs(xc) <= C.POST_X + 0.1 && yc < netH(xc) + C.R * 0.5) {
      fl |= 2;
      b.x = xc; b.y = Math.max(yc, C.R); b.z = (pz > 0 ? 1 : -1) * 0.08;
      b.vz = -b.vz * 0.1; b.vx *= 0.3; b.vy = Math.min(b.vy, 0) * 0.4;
    }
  }
  // suelo
  if (!b.roll && b.y <= C.R) {
    if (b.vy < 0) {
      const a = py > C.R && py > b.y ? clamp((py - C.R) / (py - b.y), 0, 1) : 0;
      out.bx = fl & 2 ? b.x : px + (b.x - px) * a;
      out.bz = fl & 2 ? b.z : pz + (b.z - pz) * a;
      b.y = C.R;
      b.vy = -b.vy * b.e;
      b.vx *= b.f; b.vz *= b.f;
      if (b.vy < 0.9) { b.vy = 0; b.roll = true; }
      fl |= 1;
    } else b.y = C.R;
  }
  // paredes del estadio
  if (Math.abs(b.x) > C.WALL_X) { b.x = Math.sign(b.x) * C.WALL_X; b.vx = -b.vx * 0.3; b.vz *= 0.6; fl |= 4; }
  if (Math.abs(b.z) > C.WALL_Z) { b.z = Math.sign(b.z) * C.WALL_Z; b.vz = -b.vz * 0.3; b.vx *= 0.6; fl |= 4; }
  return fl;
}

function cloneBall(b) {
  return { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, g: b.g, e: b.e, f: b.f, roll: b.roll };
}

// Dónde y cuándo cruzará la pelota el "plano de golpe" del jugador i (coordenadas locales de i).
// null = no llega (red / se aleja). { none:true } = muere (2º bote) antes de llegar.
export function predictCross(G, i) {
  const b0 = G.ball;
  if (b0.st !== BS.FLY) return null;
  const s = sgn(i), p = G.pl[i];
  const plane = s * p.z - T.PLANE;
  const b = cloneBall(b0);
  let rel = s * b.z - plane;
  if (rel >= 0) return { now: true, t: 0, x: s * b.x, y: b.y, vy: b.vy, bounced: b0.bounces > 0, nb: b0.bounces };
  const out = { bx: 0, bz: 0 };
  let nb = b0.bounces;
  for (let n = 1; n <= 170; n++) {
    const px = b.x, py = b.y;
    const fl = ballStep(b, TICK, out);
    if (fl & 2) return null;
    if (fl & 1) {
      nb++;
      if (nb >= 2) return { none: true, t: n * TICK, x: s * out.bx, z: s * out.bz, y: C.R, vy: 0, bounced: true, nb };
    }
    const r = s * b.z - plane;
    if (r >= 0) {
      const a = rel / (rel - r);
      return { t: (n - 1 + a) * TICK, x: s * (px + (b.x - px) * a), y: py + (b.y - py) * a, vy: b.vy, bounced: nb > 0, nb };
    }
    rel = r;
  }
  return null;
}

// Punto del próximo bote de la pelota (mundo) o null.
export function predictLanding(b0) {
  if (b0.st !== BS.FLY || b0.roll) return null;
  const b = cloneBall(b0);
  const out = { bx: 0, bz: 0 };
  for (let n = 1; n <= 240; n++) {
    const fl = ballStep(b, TICK, out);
    if (fl & 2) return null;
    if (fl & 1) return { x: out.bx, z: out.bz, t: n * TICK };
  }
  return null;
}

// Lanza la pelota desde (x0,y0,z0) para que bote en (tx,tz) tras ~Tf segundos, pasando la red con margen.
function launch(b, x0, y0, z0, tx, tz, Tf, g, clr) {
  let vx = 0, vy = 0, vz = 0;
  const crosses = (z0 > 0) !== (tz > 0);
  for (let it = 0; it < 26; it++) {
    vx = (tx - x0) / Tf; vz = (tz - z0) / Tf;
    vy = (C.R - y0) / Tf + 0.5 * g * Tf;
    if (!crosses || vz === 0) break;
    const tn = -z0 / vz;
    const yn = y0 + vy * tn - 0.5 * g * tn * tn;
    const xn = x0 + vx * tn;
    if (yn >= netH(xn) + clr + C.R) break;
    Tf *= 1.06;
  }
  b.x = x0; b.y = y0; b.z = z0; b.vx = vx; b.vy = vy; b.vz = vz; b.g = g; b.roll = false;
}

// ---------- movimiento ----------
function accelTo(p, tvx, tvz, dt) {
  const dvx = tvx - p.vx, dvz = tvz - p.vz;
  const d = Math.hypot(dvx, dvz);
  if (d < 1e-9) return;
  const moving = tvx !== 0 || tvz !== 0;
  const a = !moving || p.vx * tvx + p.vz * tvz < 0 ? T.DECEL : T.ACCEL;
  const m = Math.min(d, a * dt);
  p.vx += (dvx / d) * m; p.vz += (dvz / d) * m;
}
function integrate(p, i, dt, xmin = -C.X_LIM, xmax = C.X_LIM, zmin = C.Z_MIN, zmax = C.Z_MAX) {
  const s = sgn(i);
  let lx = s * (p.x + p.vx * dt), lz = s * (p.z + p.vz * dt);
  if (lx < xmin) { lx = xmin; p.vx = 0; } else if (lx > xmax) { lx = xmax; p.vx = 0; }
  if (lz < zmin) { lz = zmin; p.vz = 0; } else if (lz > zmax) { lz = zmax; p.vz = 0; }
  p.x = s * lx; p.z = s * lz;
}
// Movimiento libre con la cruceta. Exportado: el invitado lo reutiliza para predecir su propio jugador.
export function moveFree(p, i, dx, dz, dt) {
  const s = sgn(i);
  let tvx = 0, tvz = 0;
  if (dx || dz) {
    const n = dx && dz ? Math.SQRT1_2 : 1;
    tvx = s * dx * n * T.RUN; tvz = -s * dz * n * T.RUN;
  }
  accelTo(p, tvx, tvz, dt);
  integrate(p, i, dt);
}
// Movimiento lateral del sacador antes de lanzar la pelota.
export function moveServer(p, i, side, dx, dt) {
  const s = sgn(i);
  accelTo(p, s * dx * T.RUN * 0.45, 0, dt);
  p.vz = 0;
  const a = side > 0 ? 0.3 : -(C.HW - 0.2), b = side > 0 ? C.HW - 0.2 : -0.3;
  integrate(p, i, dt, a, b, C.HL + 0.45, C.HL + 0.45);
}
function coast(p, i, dt, k = 0.8) {
  p.vx *= k; p.vz *= k;
  integrate(p, i, dt);
}
function walkTo(p, i, tx, tz, dt, speed) {
  const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
  if (d < 0.05) { p.vx = p.vz = 0; p.x = tx; p.z = tz; return true; }
  const v = Math.min(speed, d / dt);
  p.vx = (dx / d) * v; p.vz = (dz / d) * v;
  p.x += p.vx * dt; p.z += p.vz * dt;
  return false;
}

const firstPress = (inp) => {
  const m = inp.pr | 0;
  if (!m) return -1;
  return m & 1 ? 0 : m & 2 ? 1 : m & 4 ? 2 : 3;
};
const NOINP = Object.freeze({ dx: 0, dz: 0, pr: 0, vt: -1 });

// ---------- bucle principal ----------
export function step(G, inputs) {
  G.tick++;
  if (G.paused) return;
  const dt = TICK;
  G.pt += dt;
  const in0 = inputs[0] || NOINP, in1 = inputs[1] || NOINP;
  switch (G.phase) {
    case PH.INTRO:
      holdBall(G);
      if (G.pt >= T.INTRO_T) startServe(G);
      break;
    case PH.SERVE: stepServe(G, in0, in1, dt); break;
    case PH.RALLY: stepRally(G, in0, in1, dt); break;
    case PH.POINT: stepPause(G, dt); break;
    case PH.OVER:
      stepDeadBall(G, dt);
      for (let i = 0; i < 2; i++) { G.pl[i].t += dt; coast(G.pl[i], i, dt); }
      break;
  }
}

function stepServe(G, in0, in1, dt) {
  const sv = G.server, rc = 1 - sv;
  const ps = G.pl[sv], pr = G.pl[rc];
  const inS = sv === 0 ? in0 : in1, inR = sv === 0 ? in1 : in0;
  pr.t += dt;
  moveFree(pr, rc, inR.dx, inR.dz, dt);
  ps.t += dt;
  const b = G.ball;
  if (ps.st === ST.SREADY) {
    moveServer(ps, sv, G.side, inS.dx, dt);
    holdBall(G);
    const pressed = firstPress(inS) >= 0;
    if (pressed || G.pt >= T.SERVE_CLOCK) {
      ps.st = ST.TOSS; ps.t = 0; ps.vx = ps.vz = 0;
      G.auto = !pressed;
      const s = sgn(sv);
      b.st = BS.TOSS; b.x = ps.x + s * 0.12; b.z = ps.z - s * 0.3; b.y = T.TOSS_Y0;
      b.vx = b.vz = 0; b.vy = T.TOSS_V;
      emit(G, EV.TOSS, sv);
    }
  } else if (ps.st === ST.TOSS) {
    b.y = tossY(ps.t); b.vy = T.TOSS_V - T.TOSS_G * ps.t;
    let q = -1;
    if (ps.t >= T.TOSS_MIN && firstPress(inS) >= 0) {
      // Compensa el retardo de red: se evalúa el momento que el jugador estaba viendo.
      const lag = inS.vt >= 0 ? clamp((G.tick - inS.vt) * TICK, 0, 0.3) : 0;
      q = serveQuality(Math.max(0, ps.t - lag));
    } else if (G.auto && ps.t >= TOSS_APEX + 0.1) q = 0.45;
    if (q >= 0) doServe(G, inS, q);
    else if (ps.t > 0.3 && b.y <= T.TOSS_Y0) {
      // no le pegó: atrapa la pelota y repite (sin falta)
      ps.st = ST.SREADY; ps.t = 0; b.st = BS.HELD; holdBall(G);
      G.pt = Math.min(G.pt, T.SERVE_CLOCK - 4);
      emit(G, EV.CATCH, sv);
    }
  }
}

// Calidad del saque según el instante (s desde el lanzamiento) en que se golpea. 1 = en el ápice.
export function serveQuality(t) {
  const e = Math.abs(t - TOSS_APEX);
  if (e <= 0.07) return 1;
  return clamp(1 - ((e - 0.07) / 0.36) * 0.8, 0.15, 1);
}

function doServe(G, inp, q) {
  const sv = G.server, s = sgn(sv), p = G.pl[sv], b = G.ball;
  const first = G.serveNum === 1;
  const prm = first ? SERVE1 : SERVE2;
  const m = first ? lerp(0.8, 0.3, q) : lerp(1.3, 0.95, q);
  const md = first ? lerp(1.15, 0.6, q) : lerp(1.8, 1.25, q);
  const cx = (-G.side * C.HW) / 2;
  let lx = cx + clamp(inp.dx, -1, 1) * (C.HW / 2 - m);
  let lz = -(C.SVC - md);
  const sig = (first ? 1 : 0.5) * (0.16 + 0.85 * Math.pow(1 - q, 1.6));
  lx += gauss(G) * sig; lz += gauss(G) * sig * 1.1;
  const v = lerp(prm.v0, prm.v1, q);
  const x0 = p.x + s * 0.2, y0 = 2.75, z0 = p.z - s * 0.3;
  const tx = s * lx, tz = s * lz;
  const dist = Math.hypot(tx - x0, tz - z0);
  launch(b, x0, y0, z0, tx, tz, dist / v, prm.g, prm.clr);
  b.e = prm.e; b.f = prm.f;
  b.st = BS.FLY; b.live = true; b.last = sv; b.bounces = 0; b.serve = true; b.net = false; b.kind = K.SERVE;
  G.bp.x = b.x; G.bp.y = b.y; G.bp.z = b.z;
  p.st = ST.SWING; p.t = 0; p.kind = K.SERVE; p.dur = T.SERVE_SWING_T; p.side = 1; p.q = q;
  G.pl[0].rel = null; G.pl[1].rel = null;
  G.phase = PH.RALLY; G.pt = 0; G.rally = 1; G.rt = 0;
  emit(G, EV.HIT, sv, K.SERVE, q, Math.round(Math.hypot(b.vx, b.vz) * 3.6 * 1.17));
}

function incoming(G, i) {
  const b = G.ball;
  return b.st === BS.FLY && b.live && b.last === 1 - i && b.bounces < 2;
}

function stepRally(G, in0, in1, dt) {
  updatePlayer(G, 0, in0, dt);
  updatePlayer(G, 1, in1, dt);
  const b = G.ball;
  if (b.live) {
    G.bp.x = b.x; G.bp.y = b.y; G.bp.z = b.z;
    const out = { bx: 0, bz: 0 };
    const fl = ballStep(b, dt, out);
    if (fl & 2) { b.net = true; emit(G, EV.NET, b.last, 0, b.x, b.y); }
    if (fl & 1) onBounce(G, out.bx, out.bz);
    else if (fl & 4 && b.live) {
      // se fue contra la pared: sin bote dentro = fuera; con un bote bueno = punto del que pegó
      if (b.bounces === 0) { if (b.serve) fault(G, RS.OUT); else endPoint(G, 1 - b.last, RS.OUT); }
      else endPoint(G, b.last, b.serve ? RS.ACE : RS.WIN);
    }
    // pelota buena que queda rodando (o punto eterno por seguridad): ya no se puede devolver
    G.rt += dt;
    if (G.phase === PH.RALLY && b.live && (b.roll || G.rt > 12)) endPoint(G, b.last, b.serve ? RS.ACE : RS.WIN);
  }
  if (G.phase !== PH.RALLY) return;
  checkHit(G, 0, in0);
  if (G.phase === PH.RALLY) checkHit(G, 1, in1);
}

function updatePlayer(G, i, inp, dt) {
  const p = G.pl[i];
  p.t += dt;
  const btn = firstPress(inp);
  switch (p.st) {
    case ST.FREE:
      if (btn >= 0 && incoming(G, i) && (p.rel === null || p.rel <= T.ZONE)) {
        // Compensa el retardo de red: la preparación cuenta desde el momento que el jugador estaba viendo.
        p.st = ST.PREP; p.t = inp.vt >= 0 ? clamp((G.tick - inp.vt) * TICK, 0, 0.25) : 0; p.shot = btn;
        autoAdjust(G, i, dt);
      } else moveFree(p, i, inp.dx, inp.dz, dt);
      break;
    case ST.PREP:
      if (btn >= 0) p.shot = btn;
      if (!incoming(G, i)) { p.st = ST.FREE; p.t = 0; p.eta = -1; moveFree(p, i, inp.dx, inp.dz, dt); }
      else autoAdjust(G, i, dt);
      break;
    case ST.SWING:
      coast(p, i, dt);
      if (p.t >= p.dur) { p.st = ST.FREE; p.t = 0; }
      break;
    default:
      p.st = ST.FREE; p.t = 0;
  }
}

// Paso de ajuste automático mientras se prepara el golpe.
function autoAdjust(G, i, dt) {
  const p = G.pl[i], s = sgn(i);
  const pr = predictCross(G, i);
  const lx = s * p.x, lz = s * p.z;
  let vxl = 0, vzl = 0;
  p.eta = pr && !pr.none ? pr.t : -1; // tiempo previsto hasta el golpe (para la animación)
  if (pr && !pr.now) {
    const d = pr.x - lx;
    if (Math.abs(d) > 0.12) p.side = d > 0 ? 1 : -1;
    const ex = pr.x - p.side * T.IDEAL - lx;
    vxl = clamp(ex * 7, -T.AUTO, T.AUTO);
    if (pr.none) vzl = -T.AUTO;
    else if (G.ball.serve && pr.nb < 1) vzl = T.AUTO * 0.7;
    else if (pr.y < 0.42) vzl = pr.bounced && pr.vy > 0 ? T.AUTO * 0.6 : -T.AUTO * 0.6;
    else if (pr.y > 2.7) vzl = T.AUTO * 0.8;
  }
  const k = Math.min(1, 16 * dt);
  p.vx += (s * vxl - p.vx) * k; p.vz += (s * vzl - p.vz) * k;
  integrate(p, i, dt);
}

function whiff(G, i) {
  const p = G.pl[i];
  p.st = ST.SWING; p.t = 0; p.kind = K.WHIFF; p.dur = T.WHIFF_T; p.eta = -1;
  emit(G, EV.WHIFF, i);
}

function checkHit(G, i, inp) {
  const b = G.ball, p = G.pl[i], s = sgn(i);
  const lx = s * p.x, lz = s * p.z;
  const rel = s * b.z - (lz - T.PLANE);
  const prev = p.rel;
  p.rel = rel;
  if (p.st !== ST.PREP) return;
  if (!(b.st === BS.FLY && b.live && b.last !== i)) return;
  if (rel < 0) return;
  if (rel > T.ZONE) { whiff(G, i); return; }
  if (b.serve && b.bounces < 1) return; // el saque tiene que botar
  let cx = b.x, cy = b.y, cz = b.z, late = rel;
  if (prev !== null && prev < 0) {
    const a = prev / (prev - rel);
    cx = G.bp.x + (b.x - G.bp.x) * a; cy = G.bp.y + (b.y - G.bp.y) * a; cz = G.bp.z + (b.z - G.bp.z) * a;
    if (cy < C.R) cy = C.R;
    late = 0;
  }
  const dxl = s * cx - lx;
  if (Math.abs(dxl) > T.STRETCH || cy < T.Y_MIN || cy > T.Y_MAX) return; // aún fuera de alcance
  doHit(G, i, inp, cx, cy, cz, dxl, late);
}

function doHit(G, i, inp, cx, cy, cz, dxl, late) {
  const p = G.pl[i], b = G.ball, s = sgn(i);
  const ad = Math.abs(dxl);
  const c = clamp(p.t / T.CHARGE, 0, 1);
  const stretch = ad > T.REACH;
  const e = Math.abs(ad - T.IDEAL);
  let fo = 1;
  if (stretch) fo = 0.2;
  else if (e > 0.45) fo = lerp(1, 0.5, clamp((e - 0.45) / 0.45, 0, 1));
  const fh = cy < 0.35 ? 0.6 : 1;
  const fl = late > 0 ? lerp(0.8, 0.45, clamp(late / T.ZONE, 0, 1)) : 1;
  const Q = clamp((0.3 + 0.7 * c) * fo * fh * fl, 0.08, 1);
  const volley = b.bounces === 0;
  const lcz = s * cz, lcx = s * cx;
  let k;
  if (stretch) k = K.STRETCH;
  else if (cy >= T.SMASH_Y && (p.shot === BTN.TOP || p.shot === BTN.SLICE)) k = K.SMASH;
  else if (p.shot === BTN.LOB) k = K.LOB;
  else if (p.shot === BTN.DROP) k = K.DROP;
  else if (volley && lcz < 8.5) k = K.VOLLEY;
  else k = p.shot === BTN.SLICE ? K.SLICE : K.TOP;
  const prm = SHOTS[k];
  const ax = clamp(inp.dx, -1, 1), az = clamp(inp.dz, -1, 1);
  let tx, depth, Tf = 0, spd = 0, sig = lerp(1.35, 0.1, Math.pow(Q, 0.8));
  switch (k) {
    case K.LOB:
      tx = ax * (C.HW - lerp(2.2, 1.3, Q));
      depth = C.HL - lerp(2.6, 1.1, Q) - (az < 0 ? 2.0 : 0);
      Tf = lerp(prm.T0, prm.T1, clamp((lcz + depth) / 24, 0, 1));
      sig *= 0.8;
      break;
    case K.DROP:
      tx = ax * (C.HW - lerp(2.0, 1.1, Q));
      depth = (az > 0 ? 3.2 : az < 0 ? 1.5 : 2.2) + lerp(1.4, 0, Q);
      Tf = lerp(prm.T0, prm.T1, clamp((lcz + depth) / 14, 0, 1));
      sig *= 0.6;
      break;
    case K.STRETCH:
      tx = clamp(ax * 1.5 + 0.2 * lcx, -2, 2);
      depth = C.HL * 0.6;
      spd = lerp(prm.v0, prm.v1, c);
      sig = 0.9;
      break;
    default: {
      const mLat = lerp(1.7, 0.55, Q);
      tx = ax !== 0 ? ax * (C.HW - mLat) : clamp(0.3 * lcx, -1.2, 1.2);
      if (az > 0) depth = C.HL - lerp(2.3, 0.85, Q);
      else if (az < 0) depth = k === K.VOLLEY ? 4.5 : 6.3;
      else depth = C.HL * (k === K.SLICE ? 0.68 : k === K.SMASH ? 0.62 : 0.74);
      spd = lerp(prm.v0, prm.v1, Q);
    }
  }
  tx += gauss(G) * sig; depth += gauss(G) * sig * 1.1;
  if (depth < 0.9) depth = 0.9;
  const wx = s * tx, wz = -s * depth;
  if (!Tf) Tf = Math.hypot(wx - cx, wz - cz) / spd;
  launch(b, cx, cy, cz, wx, wz, Tf, prm.g, prm.clr);
  // Golpes muy forzados: a veces se quedan en la red.
  if (Q < 0.32 && b.vz !== 0 && rnd(G) < 0.09 * clamp((0.32 - Q) / 0.24, 0, 1)) {
    const tn = -cz / b.vz;
    if (tn > 0.02) {
      const yt = netH(cx + b.vx * tn) - 0.12 - rnd(G) * 0.25;
      b.vy = (yt - cy + 0.5 * prm.g * tn * tn) / tn;
    }
  }
  b.e = prm.e; b.f = prm.f; b.last = i; b.bounces = 0; b.serve = false; b.net = false; b.kind = k;
  G.bp.x = b.x; G.bp.y = b.y; G.bp.z = b.z;
  G.rally++; G.rt = 0;
  p.st = ST.SWING; p.t = 0; p.kind = k; p.q = Q; p.eta = -1;
  p.dur = k === K.SMASH ? T.SMASH_T : k === K.STRETCH ? T.STRETCH_T : T.SWING_T;
  p.side = dxl >= 0 ? 1 : -1;
  G.pl[0].rel = null; G.pl[1].rel = null;
  emit(G, EV.HIT, i, k, Q, Math.round(Math.hypot(b.vx, b.vz) * 3.6 * 1.17));
}

function onBounce(G, bx, bz) {
  const b = G.ball;
  b.bounces++;
  const h = b.last, s = sgn(h);
  const lx = s * bx, lz = s * bz;
  if (b.bounces === 1) {
    const tol = C.R;
    let inn;
    if (b.serve) {
      inn = lz < 0 && lz >= -C.SVC - tol && (G.side > 0 ? lx >= -C.HW - tol && lx <= tol : lx >= -tol && lx <= C.HW + tol);
    } else inn = lz < 0 && lz >= -C.HL - tol && Math.abs(lx) <= C.HW + tol;
    emit(G, EV.BOUNCE, inn ? 1 : 0, 1, bx, bz);
    if (!inn) {
      const why = b.net ? RS.NET : RS.OUT;
      if (b.serve) fault(G, why); else endPoint(G, 1 - h, why);
    }
  } else {
    emit(G, EV.BOUNCE, 1, 2, bx, bz);
    endPoint(G, h, b.serve ? RS.ACE : RS.WIN);
  }
}

function fault(G, why) {
  const b = G.ball;
  b.live = false; b.st = BS.DEAD;
  if (G.serveNum === 1) {
    G.serveNum = 2;
    G.phase = PH.POINT; G.pt = 0; G.flt = true;
    G.nx = servePositions(G.server, G.side);
    for (let i = 0; i < 2; i++) { const p = G.pl[i]; if (p.st === ST.PREP) { p.st = ST.FREE; p.t = 0; p.eta = -1; } }
    emit(G, EV.FAULT, why, 1);
  } else {
    emit(G, EV.FAULT, why, 2);
    endPoint(G, 1 - G.server, RS.DFAULT);
  }
}

function endPoint(G, w, why) {
  const b = G.ball;
  b.live = false; b.st = BS.DEAD;
  G.phase = PH.POINT; G.pt = 0; G.flt = false;
  const what = scorePoint(G.sc, G.cfg, w);
  G.lastW = w; G.lastR = why; G.lastWhat = what;
  // rotación del saque
  if (what >= 1) {
    if (G.tbActive) { G.server = 1 - G.tbFirst; G.tbActive = false; }
    else G.server = 1 - G.server;
    if (G.sc.tb) { G.tbActive = true; G.tbFirst = G.server; }
  } else if (G.sc.tb) {
    const tot = G.sc.pts[0] + G.sc.pts[1];
    G.server = Math.floor((tot + 1) / 2) % 2 === 0 ? G.tbFirst : 1 - G.tbFirst;
  }
  G.serveNum = 1;
  for (let i = 0; i < 2; i++) {
    const p = G.pl[i];
    p.mood = i === w ? 1 : 2;
    if (p.st === ST.PREP) { p.st = ST.FREE; p.t = 0; p.eta = -1; }
  }
  if (what === 3) { G.winner = w; G.nx = null; }
  else G.nx = servePositions(G.server, nextSide(G));
  emit(G, EV.POINT, w, why, what, G.rally);
}

function stepDeadBall(G, dt) {
  const b = G.ball;
  if (b.st !== BS.DEAD) return;
  const out = { bx: 0, bz: 0 };
  const fl = ballStep(b, dt, out);
  if (fl & 1) emit(G, EV.BOUNCE, 1, 3, out.bx, out.bz);
}

function stepPause(G, dt) {
  stepDeadBall(G, dt);
  const wait = G.flt ? 0.45 : 1.0;
  let arrived = true;
  for (let i = 0; i < 2; i++) {
    const p = G.pl[i];
    p.t += dt;
    if (p.st === ST.SWING) {
      coast(p, i, dt);
      if (p.t >= p.dur) { p.st = ST.FREE; p.t = 0; }
      arrived = false;
    } else if (G.pt < wait || !G.nx) {
      coast(p, i, dt, 0.85);
      if (G.nx) arrived = false;
    } else {
      if (p.mood && G.pt > wait + 0.25) p.mood = 0;
      if (!walkTo(p, i, G.nx[i].x, G.nx[i].z, dt, T.WALK)) arrived = false;
    }
  }
  const base = G.flt ? T.FAULT_PAUSE : T.POINT_PAUSE;
  if (G.winner >= 0) {
    if (G.pt >= base) { G.phase = PH.OVER; G.pt = 0; emit(G, EV.OVER, G.winner); }
    return;
  }
  if ((G.pt >= base && arrived) || G.pt >= base + 2.2) startServe(G);
}

// Solo para pruebas: adjudica un punto directamente.
export function debugPoint(G, w) {
  if (G.phase === PH.OVER || G.winner >= 0) return;
  endPoint(G, w, RS.WIN);
}
