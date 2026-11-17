// Predicción del jugador propio en el invitado (lógica pura, probada en tests/netsim.test.js).
// Parte del último estado confirmado por el anfitrión y vuelve a aplicar las entradas que el
// anfitrión todavía no procesó, así el jugador responde al instante aunque haya retardo de red.
import { TICK, PH, ST, BS, moveFree, moveServer } from './sim.js';

// own: { x, z, vx, vz, init } (se modifica y se devuelve)
// latest: última instantánea recibida · pending: [{ seq, dx, dz, pr }] · me: índice del jugador local
// frac: fracción de tick acumulada (s) · dt: tiempo de cuadro (s) · age: antigüedad de `latest` (s)
export function predictOwn(own, latest, pending, me, frac, dt, age, enabled = true) {
  const p0 = latest.p[me];
  const p = { x: p0.x, z: p0.z, vx: p0.vx, vz: p0.vz };
  const ph = latest.ph;
  const free = !latest.paused && p0.st === ST.FREE && (ph === PH.RALLY || ph === PH.SERVE);
  const serve = !latest.paused && p0.st === ST.SREADY && ph === PH.SERVE;
  if (enabled && (free || serve)) {
    const b = latest.b;
    const incoming = ph === PH.RALLY && b.st === BS.FLY && b.live && b.last === 1 - me && b.bn < 2;
    let stopped = false;
    for (let i = 0; i < pending.length; i++) {
      const inp = pending[i];
      if (inp.seq <= latest.ack) continue;
      if (inp.pr && (serve || incoming)) { stopped = true; break; } // va a preparar el golpe / lanzar: deja de correr
      if (free) moveFree(p, me, inp.dx, inp.dz, TICK); else moveServer(p, me, latest.side, inp.dx, TICK);
    }
    if (stopped) { p.vx = 0; p.vz = 0; }
    else { p.x += p.vx * frac; p.z += p.vz * frac; }
  } else if (!latest.paused) {
    const a = Math.min(0.12, Math.max(0, age));
    p.x += p.vx * a; p.z += p.vz * a;
  }
  const far = Math.abs(p.x - own.x) + Math.abs(p.z - own.z) > 2.5;
  if (!own.init || far) { own.x = p.x; own.z = p.z; own.init = true; }
  else {
    const k = 1 - Math.exp(-dt / 0.035);
    own.x += (p.x - own.x) * k; own.z += (p.z - own.z) * k;
  }
  own.vx = p.vx; own.vz = p.vz;
  return own;
}
