// Barrido de parámetros con bots (solo desarrollo): node tests/tune.js '{"T":{"RUN":6},"TOP":{"v1":36}}' ...
import * as S from '../js/sim.js';
import { makeBot } from './bot.js';
const { PH, EV, RS, K, TICK } = S;

const baseT = { ...S.T };
const baseShots = JSON.parse(JSON.stringify(S.SHOTS));
const baseS1 = { ...S.SERVE1 }, baseS2 = { ...S.SERVE2 };

function apply(o) {
  Object.assign(S.T, baseT, o.T || {});
  for (const k in baseShots) Object.assign(S.SHOTS[k], baseShots[k]);
  for (const name of Object.keys(K)) if (o[name] && S.SHOTS[K[name]]) Object.assign(S.SHOTS[K[name]], o[name]);
  Object.assign(S.SERVE1, baseS1, o.SERVE1 || {});
  Object.assign(S.SERVE2, baseS2, o.SERVE2 || {});
}

function run(o, matches = 14, bots = [{}, {}]) {
  apply(o);
  const a = { pts: 0, rallies: [], reasons: {}, faults: 0, serves: 0, ticks: 0, svWon: 0, unfinished: 0, stretch: 0, hits: 0 };
  for (let m = 0; m < matches; m++) {
    const G = S.newGame({ games: 3, sets: 1 }, 1000 + m);
    const b = [makeBot({ seed: m * 3 + 1, ...bots[0] }), makeBot({ seed: m * 7 + 2, ...bots[1] })];
    let last = 0;
    while (G.phase !== PH.OVER && G.tick < 60 * 60 * 30) {
      const sv = G.server;
      S.step(G, [b[0](G, 0), b[1](G, 1)]);
      for (const e of G.ev) {
        if (e.id <= last) continue; last = e.id;
        if (e.type === EV.POINT) { a.pts++; a.rallies.push(e.d); a.reasons[e.b] = (a.reasons[e.b] || 0) + 1; if (e.a === sv) a.svWon++; }
        else if (e.type === EV.FAULT) a.faults++;
        else if (e.type === EV.HIT) { a.hits++; if (e.b === K.SERVE) a.serves++; if (e.b === K.STRETCH) a.stretch++; }
      }
    }
    if (G.phase !== PH.OVER) a.unfinished++;
    a.ticks += G.tick;
  }
  const r = a.rallies.slice().sort((x, y) => x - y);
  const avg = r.reduce((x, y) => x + y, 0) / Math.max(1, r.length);
  const pc = (k) => ((100 * (a.reasons[k] || 0)) / Math.max(1, a.pts)).toFixed(0);
  return `golpes/pto ${avg.toFixed(1)} med ${r[r.length >> 1]} p90 ${r[Math.floor(r.length * 0.9)]} max ${r[r.length - 1]} | s/pto ${((a.ticks * TICK) / Math.max(1, a.pts)).toFixed(0)} | fuera ${pc(RS.OUT)} red ${pc(RS.NET)} win ${pc(RS.WIN)} ace ${pc(RS.ACE)} df ${pc(RS.DFAULT)} | faltas ${((100 * a.faults) / Math.max(1, a.serves)).toFixed(0)}% | sacador ${((100 * a.svWon) / Math.max(1, a.pts)).toFixed(0)}% | estirados ${((100 * a.stretch) / Math.max(1, a.hits)).toFixed(0)}% | sin terminar ${a.unfinished}`;
}

const args = process.argv.slice(2);
const sets = args.length ? args.map((x) => JSON.parse(x)) : [{}];
for (const o of sets) {
  const bots = o.bots || [{}, {}];
  console.log(JSON.stringify(o));
  console.log('   ' + run(o, o.n || 14, bots));
}
