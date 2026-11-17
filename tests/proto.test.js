// Ida y vuelta de instantáneas: capture -> pack -> JSON -> unpack debe conservar el estado.
import assert from 'node:assert/strict';
import * as S from '../js/sim.js';
import { capture, pack, unpack, validSnap, mix, SnapBuffer } from '../js/proto.js';
import { makeBot } from './bot.js';

const G = S.newGame({ games: 3, sets: 1 }, 42);
const bots = [makeBot({ seed: 1 }), makeBot({ seed: 2 })];
let checked = 0;
const buf = new SnapBuffer();
while (G.phase !== S.PH.OVER && G.tick < 60 * 60 * 20) {
  S.step(G, [bots[0](G, 0), bots[1](G, 1)]);
  const snap = capture(G, G.tick % 977);
  const wire = JSON.parse(JSON.stringify(pack(snap)));
  assert.ok(validSnap(wire), 'validSnap tick ' + G.tick);
  const back = unpack(wire);
  const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (tick ${G.tick})`);
  assert.equal(back.tick, snap.tick); assert.equal(back.ack, snap.ack); assert.equal(back.ph, snap.ph);
  assert.equal(back.sv, snap.sv); assert.equal(back.sn, snap.sn); assert.equal(back.side, snap.side); assert.equal(back.win, snap.win);
  assert.equal(back.paused, snap.paused); assert.equal(back.flt, snap.flt); assert.equal(back.pw, snap.pw);
  for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz']) near(back.b[k], snap.b[k], 0.0006, 'b.' + k);
  for (const k of ['st', 'last', 'kind', 'bn', 'live', 'serve', 'roll']) assert.equal(back.b[k], snap.b[k], 'b.' + k);
  for (let i = 0; i < 2; i++) {
    for (const k of ['x', 'z', 'vx', 'vz', 't', 'eta']) near(back.p[i][k], snap.p[i][k], 0.0006, 'p.' + k);
    for (const k of ['st', 'shot', 'side', 'kind', 'mood']) assert.equal(back.p[i][k], snap.p[i][k], 'p.' + k);
  }
  assert.deepEqual(back.sc, snap.sc);
  assert.equal(back.ev.length, snap.ev.length);
  buf.push(back, G.tick * 16.667);
  if (G.tick > 10 && G.tick % 7 === 0) {
    const m = buf.at(G.tick - 1.5);
    assert.ok(Number.isFinite(m.b.x) && Number.isFinite(m.p[0].x) && Number.isFinite(m.p[1].t), 'mix finito');
  }
  checked++;
}
assert.ok(G.phase === S.PH.OVER, 'partido terminado');
assert.ok(!validSnap(['s', 1, 2]), 'rechaza basura');
console.log('ok  proto: ' + checked + ' instantáneas verificadas, tamaño medio ' + JSON.stringify(pack(capture(G))).length + ' bytes');
