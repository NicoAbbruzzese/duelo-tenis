// Pruebas de la simulación: reglas de marcador + partidos completos entre bots con invariantes.
import assert from 'node:assert/strict';
import * as S from '../js/sim.js';
import { makeBot } from './bot.js';

const { C, T, PH, ST, BS, EV, RS, K, TICK } = S;
let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ok  ' + name); }
  catch (e) { failures++; console.log('FALLA ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n      ') : e)); }
}

// ---------- marcador ----------
function play(sc, cfg, seq) { let r = 0; for (const w of seq) r = S.scorePoint(sc, cfg, w); return r; }
const rep = (w, n) => Array(n).fill(w);

test('juego a cero', () => {
  const sc = S.newScore(), cfg = { games: 6, sets: 1 };
  assert.equal(play(sc, cfg, rep(0, 3)), 0);
  assert.deepEqual(S.pointLabels(sc), ['40', '0']);
  assert.equal(S.scorePoint(sc, cfg, 0), 1);
  assert.deepEqual(sc.games, [1, 0]); assert.deepEqual(sc.pts, [0, 0]);
});
test('iguales y ventaja', () => {
  const sc = S.newScore(), cfg = { games: 6, sets: 1 };
  play(sc, cfg, [0, 0, 0, 1, 1, 1]);
  assert.deepEqual(S.pointLabels(sc), ['40', '40']);
  assert.equal(S.scorePoint(sc, cfg, 1), 0);
  assert.deepEqual(S.pointLabels(sc), ['', 'AD']);
  assert.equal(S.scorePoint(sc, cfg, 0), 0);
  assert.deepEqual(S.pointLabels(sc), ['40', '40']);
  assert.equal(S.scorePoint(sc, cfg, 0), 0);
  assert.deepEqual(S.pointLabels(sc), ['AD', '']);
  assert.equal(S.scorePoint(sc, cfg, 0), 1);
  assert.deepEqual(sc.games, [1, 0]);
});
test('set 6-0 gana el partido a 1 set', () => {
  const sc = S.newScore(), cfg = { games: 6, sets: 1 };
  let r = 0;
  for (let g = 0; g < 6; g++) r = play(sc, cfg, rep(1, 4));
  assert.equal(r, 3); assert.deepEqual(sc.sets, [0, 1]); assert.deepEqual(sc.hist, [[0, 6]]);
});
test('set necesita diferencia de 2 (7-5)', () => {
  const sc = S.newScore(), cfg = { games: 6, sets: 3 };
  for (let g = 0; g < 5; g++) { play(sc, cfg, rep(0, 4)); play(sc, cfg, rep(1, 4)); }
  assert.deepEqual(sc.games, [5, 5]);
  assert.equal(play(sc, cfg, rep(0, 4)), 1); assert.deepEqual(sc.games, [6, 5]);
  assert.equal(play(sc, cfg, rep(0, 4)), 2); assert.deepEqual(sc.hist, [[7, 5]]); assert.deepEqual(sc.sets, [1, 0]);
});
test('tie-break en 6-6 a 7 puntos con diferencia de 2', () => {
  const sc = S.newScore(), cfg = { games: 6, sets: 1 };
  for (let g = 0; g < 6; g++) { play(sc, cfg, rep(0, 4)); play(sc, cfg, rep(1, 4)); }
  assert.deepEqual(sc.games, [6, 6]); assert.equal(sc.tb, true);
  play(sc, cfg, [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(sc.pts, [6, 6]); assert.deepEqual(S.pointLabels(sc), ['6', '6']);
  assert.equal(S.scorePoint(sc, cfg, 1), 0);
  assert.equal(S.scorePoint(sc, cfg, 1), 3);
  assert.deepEqual(sc.hist, [[6, 7]]); assert.equal(sc.tb, false);
});
test('al mejor de 3 sets', () => {
  const sc = S.newScore(), cfg = { games: 6, sets: 3 };
  let r = 0;
  for (let g = 0; g < 6; g++) r = play(sc, cfg, rep(0, 4));
  assert.equal(r, 2);
  for (let g = 0; g < 6; g++) r = play(sc, cfg, rep(1, 4));
  assert.equal(r, 2); assert.deepEqual(sc.sets, [1, 1]);
  for (let g = 0; g < 6; g++) r = play(sc, cfg, rep(0, 4));
  assert.equal(r, 3); assert.deepEqual(sc.sets, [2, 1]);
});
test('formato corto: primero a 3 juegos', () => {
  const sc = S.newScore(), cfg = { games: 3, sets: 1 };
  play(sc, cfg, rep(0, 4)); play(sc, cfg, rep(0, 4)); play(sc, cfg, rep(1, 4)); play(sc, cfg, rep(1, 4));
  assert.deepEqual(sc.games, [2, 2]);
  assert.equal(play(sc, cfg, rep(1, 4)), 3);
  assert.deepEqual(sc.hist, [[2, 3]]);
});
test('pointStakes: quiebre, set y partido', () => {
  const cfg = { games: 6, sets: 1 };
  let sc = S.newScore(); play(sc, cfg, [1, 1, 1]);
  assert.deepEqual(S.pointStakes(sc, cfg, 0), { who: 1, what: 1 });
  assert.equal(S.pointStakes(sc, cfg, 1), null);
  sc = S.newScore(); for (let g = 0; g < 5; g++) play(sc, cfg, rep(0, 4)); play(sc, cfg, [0, 0, 0]);
  assert.deepEqual(S.pointStakes(sc, cfg, 0), { who: 0, what: 3 });
  const cfg3 = { games: 6, sets: 3 };
  assert.deepEqual(S.pointStakes(sc, cfg3, 0), { who: 0, what: 2 });
});

// ---------- física ----------
test('la pelota lanzada cae en el objetivo', () => {
  const G = S.newGame({ games: 6, sets: 1 }, 5);
  const b = G.ball;
  // tiro parabólico exacto: comprobar el punto de bote previsto
  Object.assign(b, { x: 1, y: 1, z: 10, vx: -2, vy: 4, vz: -22, g: 15.5, e: 0.78, f: 0.8, st: BS.FLY, roll: false });
  const land = S.predictLanding(b);
  const tt = (4 + Math.sqrt(16 + 2 * 15.5 * (1 - C.R))) / 15.5;
  assert.ok(Math.abs(land.z - (10 - 22 * tt)) < 0.02, 'z ' + land.z);
  assert.ok(Math.abs(land.x - (1 - 2 * tt)) < 0.02, 'x ' + land.x);
});
test('la red detiene las pelotas bajas', () => {
  const b = { x: 0, y: 0.5, z: 0.3, vx: 0, vy: 0, vz: -20, g: 9.8, e: 0.7, f: 0.7, roll: false };
  const out = {};
  let fl = 0;
  for (let n = 0; n < 5 && !(fl & 2); n++) fl = S.ballStep(b, TICK, out);
  assert.ok(fl & 2); assert.ok(b.z > 0, 'queda del lado del que pegó');
});

// ---------- partidos entre bots ----------
function finite(...v) { return v.every((x) => Number.isFinite(x)); }

const HUMAN = { react: 0.33, posErr: 0.3, pressMin: 0.7, wrong: 0.08, net: 0.3 };
function runMatch(seed, cfg, botOpts = [HUMAN, HUMAN], maxTicks = 60 * 60 * 240) {
  const G = S.newGame(cfg, seed);
  const bots = [makeBot({ seed: seed * 3 + 1, ...botOpts[0] }), makeBot({ seed: seed * 7 + 2, ...botOpts[1] })];
  const st = { points: 0, rally: 0, rallies: [], reasons: {}, faults: 0, serves: 0, ticks: 0, kinds: {}, whiffs: 0, maxRally: 0, serverSeq: [], tbPoints: 0, wins: [0, 0], svWon: 0, speeds: [] };
  let lastEv = 0, lastPhase = -1, stuck = 0, lastEvId = -1;
  while (G.phase !== PH.OVER && G.tick < maxTicks) {
    const inputs = [bots[0](G, 0), bots[1](G, 1)];
    const before = G.phase, svBefore = G.server;
    S.step(G, inputs);
    // invariantes
    const b = G.ball;
    if (!finite(b.x, b.y, b.z, b.vx, b.vy, b.vz)) throw new Error('pelota NaN en tick ' + G.tick);
    for (let i = 0; i < 2; i++) {
      const p = G.pl[i], s = i === 0 ? 1 : -1;
      if (!finite(p.x, p.z, p.vx, p.vz, p.t)) throw new Error('jugador NaN');
      if (s * p.z < C.Z_MIN - 1e-6 || s * p.z > C.Z_MAX + 1e-6 || Math.abs(p.x) > C.X_LIM + 1e-6) throw new Error(`jugador ${i} fuera de límites: ${p.x},${p.z} fase ${G.phase}`);
    }
    if (b.y < C.R - 1e-6) throw new Error('pelota bajo el suelo');
    if (G.phase === lastPhase && G.evId === lastEvId) { stuck++; if (stuck > 60 * 25) throw new Error('fase atascada ' + G.phase + ' rally ' + G.rally); } else { stuck = 0; lastPhase = G.phase; lastEvId = G.evId; }
    if (G.phase === PH.SERVE && before !== PH.SERVE) st.serverSeq.push({ sv: G.server, side: G.side, n: G.serveNum, tb: G.sc.tb, tot: G.sc.pts[0] + G.sc.pts[1], g: G.sc.games[0] + G.sc.games[1] });
    for (const e of G.ev) {
      if (e.id <= lastEv) continue;
      lastEv = e.id;
      if (e.type === EV.POINT) {
        st.points++; st.rallies.push(e.d); st.maxRally = Math.max(st.maxRally, e.d);
        st.reasons[e.b] = (st.reasons[e.b] || 0) + 1;
        if (e.a === svBefore) st.svWon++;
      } else if (e.type === EV.FAULT) st.faults++;
      else if (e.type === EV.HIT) { st.kinds[e.b] = (st.kinds[e.b] || 0) + 1; if (e.b === K.SERVE) { st.serves++; st.speeds.push(e.d); } }
      else if (e.type === EV.WHIFF) st.whiffs++;
    }
  }
  st.ticks = G.tick; st.over = G.phase === PH.OVER; st.G = G;
  return st;
}

test('partido completo (1 set a 6) termina y respeta invariantes', () => {
  const st = runMatch(11, { games: 6, sets: 1 });
  assert.ok(st.over, 'el partido no terminó');
  const G = st.G;
  assert.ok(G.winner === 0 || G.winner === 1);
  assert.equal(G.sc.sets[G.winner], 1);
  const h = G.sc.hist[0];
  assert.ok(Math.max(h[0], h[1]) >= 6);
});

test('rotación de saque y lados correctos', () => {
  for (const seed of [3, 4, 5, 6]) {
    const st = runMatch(seed, { games: 6, sets: 3 });
    assert.ok(st.over);
    let prev = null;
    for (const s of st.serverSeq) {
      assert.equal(s.side, s.tot % 2 === 0 ? 1 : -1, 'lado de saque');
      if (prev && !s.tb && !prev.tb) {
        if (s.g === prev.g) assert.equal(s.sv, prev.sv, 'mismo sacador dentro del juego');
        else if (s.g === prev.g + 1) assert.equal(s.sv, 1 - prev.sv, 'alterna sacador por juego');
      }
      if (prev && s.tb && prev.tb && s.n === 1 && prev.n === 1 && s.tot === prev.tot + 1) {
        // en el tie-break cambia el sacador cuando el total de puntos es impar
        if (s.tot % 2 === 1) assert.equal(s.sv, 1 - prev.sv, 'tie-break: cambia sacador');
        else assert.equal(s.sv, prev.sv, 'tie-break: mantiene sacador');
      }
      prev = s;
    }
  }
});

let agg = null;
test('muchos partidos: estadísticas razonables', () => {
  agg = { points: 0, rallies: [], reasons: {}, faults: 0, serves: 0, ticks: 0, kinds: {}, whiffs: 0, matches: 0, maxRally: 0, svWon: 0, speeds: [] };
  for (let seed = 100; seed < 140; seed++) {
    const st = runMatch(seed, { games: seed % 2 ? 6 : 3, sets: 1 });
    assert.ok(st.over, 'partido ' + seed + ' no terminó');
    agg.matches++; agg.points += st.points; agg.rallies.push(...st.rallies); agg.faults += st.faults; agg.serves += st.serves; agg.ticks += st.ticks; agg.whiffs += st.whiffs; agg.svWon += st.svWon;
    agg.maxRally = Math.max(agg.maxRally, st.maxRally); agg.speeds.push(...st.speeds);
    for (const k in st.reasons) agg.reasons[k] = (agg.reasons[k] || 0) + st.reasons[k];
    for (const k in st.kinds) agg.kinds[k] = (agg.kinds[k] || 0) + st.kinds[k];
  }
  const avg = agg.rallies.reduce((a, b) => a + b, 0) / agg.rallies.length;
  assert.ok(avg > 2 && avg < 14, 'peloteo medio ' + avg);
});

test('bot fuerte vence casi siempre a bot débil', () => {
  let w = 0;
  for (let seed = 200; seed < 212; seed++) {
    const st = runMatch(seed, { games: 3, sets: 1 }, [{ react: 0.18, skill: 0.95 }, { react: 0.55, skill: 0.3 }]);
    if (st.G.winner === 0) w++;
  }
  assert.ok(w >= 8, 'ganó solo ' + w + ' de 12');
});

if (agg) {
  const names = { [RS.OUT]: 'fuera', [RS.NET]: 'red', [RS.WIN]: 'winner', [RS.ACE]: 'ace', [RS.DFAULT]: 'doble falta' };
  const kn = Object.fromEntries(Object.entries(K).map(([k, v]) => [v, k]));
  const avg = agg.rallies.reduce((a, b) => a + b, 0) / agg.rallies.length;
  const sorted = agg.rallies.slice().sort((a, b) => a - b);
  console.log('\n--- estadísticas (' + agg.matches + ' partidos, ' + agg.points + ' puntos) ---');
  console.log('golpes por punto: media ' + avg.toFixed(2) + ', mediana ' + sorted[sorted.length >> 1] + ', p90 ' + sorted[Math.floor(sorted.length * 0.9)] + ', máx ' + agg.maxRally);
  console.log('segundos por punto (incl. pausas): ' + (agg.ticks * TICK / agg.points).toFixed(1));
  console.log('fin de punto: ' + Object.entries(agg.reasons).map(([k, v]) => names[k] + ' ' + (100 * v / agg.points).toFixed(1) + '%').join(', '));
  console.log('saques: ' + agg.serves + ', faltas ' + (100 * agg.faults / agg.serves).toFixed(1) + '%, puntos ganados por el sacador ' + (100 * agg.svWon / agg.points).toFixed(1) + '%');
  const sp = agg.speeds.slice().sort((a, b) => a - b);
  console.log('velocidad saque km/h: mediana ' + sp[sp.length >> 1] + ', máx ' + sp[sp.length - 1]);
  console.log('golpes: ' + Object.entries(agg.kinds).map(([k, v]) => kn[k] + ' ' + v).join(', ') + ', al aire ' + agg.whiffs);
}
console.log(failures ? `\n${failures} prueba(s) con fallas` : '\nTodas las pruebas pasaron');
process.exit(failures ? 1 : 0);
