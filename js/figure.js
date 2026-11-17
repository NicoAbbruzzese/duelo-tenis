// Jugador 3D: figura articulada hecha con primitivas y animada por código (poses mezcladas).
// La figura mira hacia -Z cuando su giro es 0; su derecha es +X.
import * as THREE from '../vendor/three.module.min.js';
import { ST, K, T, TOSS_APEX } from './sim.js';

const lam = (color, extra) => new THREE.MeshLambertMaterial({ color, ...extra });

function limb(len, r0, r1, material, seg = 8) {
  const g = new THREE.CylinderGeometry(r0, r1, len, seg);
  g.translate(0, -len / 2, 0);
  return new THREE.Mesh(g, material);
}

const KEYS = ['lean', 'twist', 'tilt', 'yaw', 'hop', 'headX',
  'lHip', 'lHipZ', 'lKnee', 'rHip', 'rHipZ', 'rKnee',
  'lShX', 'lShZ', 'lEl', 'rShX', 'rShZ', 'rEl', 'rkX', 'rkZ'];
const pose = (o) => {
  const p = {};
  for (const k of KEYS) p[k] = o[k] || 0;
  return p;
};

const P = {
  idle: pose({ lean: 0.05, lHip: 0.05, lKnee: 0.1, rHip: 0.05, rKnee: 0.1, lHipZ: -0.05, rHipZ: 0.05, lShX: 0.1, lShZ: -0.1, lEl: 0.25, rShX: 0.2, rShZ: 0.12, rEl: 0.6, rkX: -0.5 }),
  ready: pose({ lean: 0.3, lHip: 0.45, lKnee: 0.75, rHip: 0.45, rKnee: 0.75, lHipZ: -0.16, rHipZ: 0.16, lShX: 0.6, lShZ: -0.1, lEl: 1.15, rShX: 0.6, rShZ: 0.1, rEl: 1.15, rkX: -0.9, rkZ: -0.5 }),
  fhPrep: pose({ twist: -1.0, lean: 0.18, lHip: 0.5, lKnee: 0.7, rHip: 0.2, rKnee: 0.55, lHipZ: -0.12, rHipZ: 0.18, rShX: -0.85, rShZ: 0.8, rEl: 0.75, rkX: -0.5, lShX: 0.95, lShZ: -0.3, lEl: 0.35 }),
  fhHit: pose({ twist: 0.05, lean: 0.22, lHip: 0.55, lKnee: 0.55, rHip: -0.15, rKnee: 0.35, lHipZ: -0.1, rHipZ: 0.15, rShX: 0.8, rShZ: 1.0, rEl: 0.12, rkX: 0.05, lShX: 0.25, lShZ: -0.55, lEl: 1.2 }),
  fhEnd: pose({ twist: 1.0, lean: 0.28, lHip: 0.3, lKnee: 0.4, rHip: 0.1, rKnee: 0.5, rShX: 1.95, rShZ: -0.65, rEl: 1.5, rkX: 0.3, lShX: -0.25, lShZ: -0.35, lEl: 1.0 }),
  bhPrep: pose({ twist: 1.1, lean: 0.2, lHip: 0.2, lKnee: 0.55, rHip: 0.5, rKnee: 0.7, lHipZ: -0.18, rHipZ: 0.12, rShX: 0.55, rShZ: -1.05, rEl: 1.5, rkX: -0.35, lShX: 0.65, lShZ: 0.45, lEl: 1.6 }),
  bhHit: pose({ twist: 0.05, lean: 0.22, lHip: -0.15, lKnee: 0.35, rHip: 0.55, rKnee: 0.55, lHipZ: -0.15, rHipZ: 0.1, rShX: 0.9, rShZ: -0.8, rEl: 0.2, rkX: 0.05, lShX: 0.6, lShZ: 0.1, lEl: 1.1 }),
  bhEnd: pose({ twist: -0.95, lean: 0.25, lHip: 0.1, lKnee: 0.45, rHip: 0.3, rKnee: 0.4, rShX: 1.65, rShZ: 0.95, rEl: 0.35, rkX: 0.2, lShX: -0.35, lShZ: -0.6, lEl: 0.5 }),
  fvPrep: pose({ twist: -0.5, lean: 0.25, lHip: 0.45, lKnee: 0.7, rHip: 0.3, rKnee: 0.6, lHipZ: -0.14, rHipZ: 0.16, rShX: 0.45, rShZ: 0.95, rEl: 1.0, rkX: -1.0, lShX: 0.7, lShZ: -0.2, lEl: 1.0 }),
  fvHit: pose({ twist: -0.05, lean: 0.3, lHip: 0.6, lKnee: 0.6, rHip: -0.1, rKnee: 0.4, rShX: 0.95, rShZ: 0.85, rEl: 0.35, rkX: -0.8, lShX: 0.3, lShZ: -0.4, lEl: 1.1 }),
  bvPrep: pose({ twist: 0.55, lean: 0.25, lHip: 0.3, lKnee: 0.6, rHip: 0.45, rKnee: 0.7, lHipZ: -0.16, rHipZ: 0.14, rShX: 0.6, rShZ: -0.85, rEl: 1.3, rkX: -0.9, lShX: 0.6, lShZ: 0.3, lEl: 1.4 }),
  bvHit: pose({ twist: 0.05, lean: 0.3, lHip: -0.1, lKnee: 0.4, rHip: 0.6, rKnee: 0.6, rShX: 0.95, rShZ: -0.65, rEl: 0.4, rkX: -0.7, lShX: 0.3, lShZ: -0.1, lEl: 0.9 }),
  svReady: pose({ yaw: -0.85, twist: 0.25, lean: 0.12, lHip: 0.15, lKnee: 0.25, rHip: 0.05, rKnee: 0.2, lHipZ: -0.1, rHipZ: 0.1, lShX: 0.95, lShZ: -0.1, lEl: 0.55, rShX: 0.35, rShZ: 0.15, rEl: 0.95, rkX: -0.7 }),
  svTrophy: pose({ yaw: -0.95, twist: -0.25, lean: -0.18, lHip: 0.35, lKnee: 0.8, rHip: 0.2, rKnee: 0.8, lHipZ: -0.1, rHipZ: 0.1, lShX: 2.95, lShZ: -0.1, lEl: 0.05, rShX: -0.2, rShZ: 1.5, rEl: 2.2, rkX: -0.4 }),
  svHit: pose({ yaw: -0.3, twist: 0.45, lean: 0.25, hop: 0.16, lHip: 0.1, lKnee: 0.1, rHip: -0.1, rKnee: 0.15, lShX: 0.6, lShZ: -0.2, lEl: 1.6, rShX: 2.85, rShZ: 0.15, rEl: 0.04, rkX: 0.2 }),
  svEnd: pose({ yaw: 0.15, twist: 1.0, lean: 0.6, lHip: 0.65, lKnee: 0.5, rHip: -0.35, rKnee: 0.65, lShX: 0.2, lShZ: -0.3, lEl: 1.4, rShX: 0.6, rShZ: -0.85, rEl: 0.5, rkX: 0.4 }),
  stretchR: pose({ tilt: -0.5, lean: 0.15, twist: -0.25, lHip: -0.2, lHipZ: -0.25, lKnee: 0.25, rHip: 0.35, rHipZ: 0.85, rKnee: 0.9, rShX: 0.35, rShZ: 1.6, rEl: 0.05, rkX: 0, lShX: 0.1, lShZ: -0.9, lEl: 0.3 }),
  stretchL: pose({ tilt: 0.5, lean: 0.15, twist: 0.35, rHip: -0.2, rHipZ: 0.25, rKnee: 0.25, lHip: 0.35, lHipZ: -0.85, lKnee: 0.9, rShX: 0.75, rShZ: -1.45, rEl: 0.05, rkX: 0, lShX: 0.1, lShZ: -0.5, lEl: 0.6 }),
  cheer: pose({ lean: -0.08, lHip: 0.05, lKnee: 0.15, rHip: 0.05, rKnee: 0.15, lShX: 2.7, lShZ: -0.25, lEl: 1.5, rShX: 0.5, rShZ: 0.3, rEl: 0.8, rkX: -0.4, headX: -0.15 }),
  sad: pose({ lean: 0.32, lHip: 0.1, lKnee: 0.15, rHip: 0.1, rKnee: 0.15, lShX: 0.05, lShZ: -0.08, lEl: 0.1, rShX: 0.1, rShZ: 0.08, rEl: 0.15, rkX: 0.2, headX: 0.55 }),
};

const tmp = pose({}), tmp2 = pose({});
function blend(out, a, b, t) {
  for (const k of KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
function wrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class Figure {
  constructor(colors) {
    const skin = lam(colors.skin), shirt = lam(colors.shirt), shorts = lam(colors.shorts);
    const shoe = lam(0xf4f4f4), hair = lam(colors.hair), cap = lam(colors.cap);
    const frame = lam(colors.racket), grip = lam(0x222222);

    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.hips = new THREE.Group();
    this.hips.position.y = 0.98;
    this.body.add(this.hips);
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.23), shorts);
    pelvis.position.y = -0.02;
    this.hips.add(pelvis);

    const mkLeg = (x) => {
      const hip = new THREE.Group();
      hip.position.set(x, -0.04, 0);
      hip.add(limb(0.46, 0.078, 0.06, skin));
      const sh = limb(0.24, 0.092, 0.085, shorts);
      hip.add(sh);
      const knee = new THREE.Group();
      knee.position.y = -0.46;
      knee.add(limb(0.44, 0.056, 0.042, skin));
      const sock = limb(0.1, 0.046, 0.046, shoe);
      sock.position.y = -0.36;
      knee.add(sock);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.075, 0.26), shoe);
      foot.position.set(0, -0.475, -0.055);
      knee.add(foot);
      hip.add(knee);
      this.hips.add(hip);
      return { hip, knee };
    };
    this.legL = mkLeg(-0.105);
    this.legR = mkLeg(0.105);

    this.spine = new THREE.Group();
    this.spine.position.y = 0.06;
    this.hips.add(this.spine);
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.165, 0.5, 10), shirt);
    torso.scale.z = 0.62;
    torso.position.y = 0.27;
    this.spine.add(torso);
    const sh = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), shirt);
    const shL = sh.clone();
    sh.position.set(0.225, 0.47, 0); shL.position.set(-0.225, 0.47, 0);
    this.spine.add(sh, shL);

    this.head = new THREE.Group();
    this.head.position.y = 0.56;
    this.spine.add(this.head);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 8), skin);
    neck.position.y = 0.02;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.125, 12, 10), skin);
    skull.position.y = 0.16;
    const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.131, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), hair);
    hairM.position.y = 0.16; hairM.rotation.x = 0.25;
    const capM = new THREE.Mesh(new THREE.SphereGeometry(0.137, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.42), cap);
    capM.position.y = 0.17;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.015, 0.12), cap);
    visor.position.set(0, 0.2, -0.16); visor.rotation.x = 0.12;
    this.head.add(neck, skull, hairM, capM, visor);

    const mkArm = (x) => {
      const shd = new THREE.Group();
      shd.position.set(x, 0.46, 0);
      const up = limb(0.29, 0.052, 0.043, skin);
      shd.add(up);
      const sleeve = limb(0.13, 0.064, 0.058, shirt);
      shd.add(sleeve);
      const el = new THREE.Group();
      el.position.y = -0.29;
      el.add(limb(0.26, 0.042, 0.034, skin));
      const hand = new THREE.Group();
      hand.position.y = -0.275;
      hand.add(new THREE.Mesh(new THREE.SphereGeometry(0.046, 8, 6), skin));
      el.add(hand);
      shd.add(el);
      this.spine.add(shd);
      return { shd, el, hand };
    };
    this.armL = mkArm(-0.245);
    this.armR = mkArm(0.245);
    const band = limb(0.05, 0.045, 0.043, cap);
    band.position.y = -0.2;
    this.armR.el.add(band);

    // raqueta en la mano derecha
    this.racket = new THREE.Group();
    const handle = limb(0.24, 0.017, 0.015, grip, 6);
    handle.position.y = 0.05;
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.013, 6, 16), frame);
    hoop.scale.y = 1.28; hoop.position.y = -0.34;
    const strings = new THREE.Mesh(new THREE.CircleGeometry(0.122, 14), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false }));
    strings.scale.y = 1.28; strings.position.y = -0.34;
    this.racket.add(handle, hoop, strings);
    this.armR.hand.add(this.racket);

    this.root.scale.setScalar(1.14);
    this.cur = pose(P.idle);
    this.phase = Math.random() * 6;
    this.yaw = 0;
    this.baseYaw = 0;
    this.time = Math.random() * 10;
  }

  setFacing(base) { this.baseYaw = base; this.yaw = base; this.root.rotation.y = base; }

  // p: jugador de la instantánea (x, z, vx, vz, st, t, side, kind, mood, dur, eta). tossT: tiempo de lanzamiento del saque.
  update(p, dt, opts = {}) {
    this.time += dt;
    const speed = Math.hypot(p.vx, p.vz);
    let target = P.ready, rate = 16, yawOff = 0, backpedal = false;
    const fh = p.side >= 0;

    if (p.st === ST.PREP) {
      const volley = opts.volley;
      const prep = volley ? (fh ? P.fvPrep : P.bvPrep) : fh ? P.fhPrep : P.bhPrep;
      const hit = volley ? (fh ? P.fvHit : P.bvHit) : fh ? P.fhHit : P.bhHit;
      if (p.eta >= 0 && p.eta < 0.14) { target = blend(tmp, prep, hit, smooth(1 - p.eta / 0.14)); rate = 42; }
      else { target = prep; rate = 18; }
    } else if (p.st === ST.SWING) {
      const u = p.dur > 0 ? Math.min(1, p.t / p.dur) : 1;
      let hit, end;
      switch (p.kind) {
        case K.SERVE: case K.SMASH: hit = P.svHit; end = P.svEnd; break;
        case K.VOLLEY: case K.DROP: hit = fh ? P.fvHit : P.bvHit; end = fh ? P.fvHit : P.bvHit; break;
        case K.STRETCH: hit = fh ? P.stretchR : P.stretchL; end = hit; break;
        default: hit = fh ? P.fhHit : P.bhHit; end = fh ? P.fhEnd : P.bhEnd;
      }
      if (u < 0.5) target = blend(tmp, hit, end, smooth(u / 0.5));
      else target = blend(tmp, end, P.ready, smooth((u - 0.5) / 0.5));
      rate = 40;
    } else if (p.st === ST.SREADY) {
      target = P.svReady; rate = 12;
    } else if (p.st === ST.TOSS) {
      target = blend(tmp, P.svReady, P.svTrophy, smooth(p.t / (TOSS_APEX * 0.8)));
      rate = 24;
    } else if (p.mood === 1 && speed < 1) {
      target = blend(tmp, P.cheer, P.cheer, 0);
      tmp.hop = Math.abs(Math.sin(this.time * 9)) * 0.12;
      target = tmp; rate = 14;
    } else if (p.mood === 2 && speed < 1) {
      target = P.sad; rate = 8;
    } else if (speed > 0.5) {
      // carrera: ciclo de piernas y brazos según la velocidad
      const a = Math.min(1, speed / T.RUN);
      let rel = wrap(Math.atan2(-p.vx, -p.vz) - this.baseYaw);
      if (Math.abs(rel) > 2.25) { backpedal = true; rel = 0; }
      yawOff = Math.max(-1.7, Math.min(1.7, rel)) * Math.min(1, speed / 2.5);
      this.phase += (backpedal ? -1 : 1) * dt * (5 + speed * 1.75);
      const s = Math.sin(this.phase), c = Math.cos(this.phase);
      const r = blend(tmp, P.ready, P.idle, 0.4);
      r.lean = 0.16 + 0.2 * a * (backpedal ? -0.3 : 1);
      r.lHip = 0.2 + 0.85 * a * s; r.rHip = 0.2 - 0.85 * a * s;
      r.lKnee = 0.3 + 0.95 * a * Math.max(0, -c); r.rKnee = 0.3 + 0.95 * a * Math.max(0, c);
      r.lHipZ = -0.04; r.rHipZ = 0.04;
      r.lShX = 0.15 - 0.75 * a * s; r.rShX = 0.35 + 0.45 * a * s;
      r.lEl = 1.25; r.rEl = 1.15;
      r.hop = 0.03 * a * Math.abs(c);
      target = r; rate = 26;
    } else if (opts.relaxed) {
      target = P.idle; rate = 8;
    } else {
      // listo para devolver: pequeño balanceo
      const r = blend(tmp, P.ready, P.ready, 0);
      r.hop = 0.012 * Math.sin(this.time * 6.5);
      target = r; rate = 14;
    }

    const k = Math.min(1, rate * dt);
    const c = this.cur;
    for (const key of KEYS) c[key] += (target[key] - c[key]) * k;

    // giro del cuerpo
    const wantYaw = this.baseYaw + (speed > 0.5 && p.st === ST.FREE ? yawOff : 0) + c.yaw;
    this.yaw += wrap(wantYaw - this.yaw) * Math.min(1, 12 * dt);
    this.root.rotation.y = this.yaw;
    this.root.position.set(p.x, 0, p.z);
    this.apply(c);
  }

  apply(c) {
    this.spine.rotation.set(-c.lean, c.twist, 0);
    this.head.rotation.set(c.headX, -c.twist * 0.55, 0);
    this.legL.hip.rotation.set(c.lHip, 0, c.lHipZ);
    this.legL.knee.rotation.x = -c.lKnee;
    this.legR.hip.rotation.set(c.rHip, 0, c.rHipZ);
    this.legR.knee.rotation.x = -c.rKnee;
    this.armL.shd.rotation.set(c.lShX, 0, c.lShZ);
    this.armL.el.rotation.x = c.lEl;
    this.armR.shd.rotation.set(c.rShX, 0, c.rShZ);
    this.armR.el.rotation.x = c.rEl;
    this.racket.rotation.set(c.rkX, 0, c.rkZ);
    this.body.rotation.z = c.tilt;
    // apoyo: baja la cadera lo necesario para que el pie más bajo toque el suelo
    const dl = 0.46 * Math.cos(c.lHip) * Math.cos(c.lHipZ) + 0.52 * Math.cos(c.lHip - c.lKnee) * Math.cos(c.lHipZ);
    const dr = 0.46 * Math.cos(c.rHip) * Math.cos(c.rHipZ) + 0.52 * Math.cos(c.rHip - c.rKnee) * Math.cos(c.rHipZ);
    const reach = Math.max(dl, dr) * Math.cos(c.tilt);
    this.body.position.y = reach + 0.04 - 0.98 + c.hop;
  }
}
