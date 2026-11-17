// Dibujo 3D con three.js: cancha, red, estadio, jugadores, pelota y cámara detrás del jugador local.
import * as THREE from '../vendor/three.module.min.js';
import { C, ST, BS, PH, K, T, predictLanding, netH } from './sim.js';
import { Figure } from './figure.js';

export const COURTS = [
  { name: 'Dura', inn: '#2c6db8', alley: '#27609f', out: '#2f8f63', ground: '#256b4b', wall: '#12305c', accent: '#d7f531' },
  { name: 'Polvo de ladrillo', inn: '#c9673d', alley: '#bd5d35', out: '#b3552f', ground: '#7d4a2e', wall: '#234a35', accent: '#ffffff' },
  { name: 'Césped', inn: '#4d9a3b', alley: '#458f35', out: '#3f8631', ground: '#2f6b2a', wall: '#1d3a24', accent: '#ffe14d' },
];

const TEAM = [
  { shirt: 0xe23a3a, shorts: 0xffffff, cap: 0xffffff, skin: 0xdba77f, hair: 0x2b1d14, racket: 0xf2d21f },
  { shirt: 0x2f86e8, shorts: 0x1b2a4a, cap: 0x1b2a4a, skin: 0xb9825a, hair: 0x141414, racket: 0xffffff },
];

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function tex(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

export class Renderer {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    const r = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, powerPreference: 'high-performance', alpha: false });
    this.r = r;
    this.maxPR = 2;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxPR));
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(36, 16 / 9, 0.5, 200);
    this.courtType = -1;
    this.me = 0;
    this.camX = 0;
    this.idleA = 0.6;
    this.frameMs = 16; this.slow = 0;
    this.w = 0; this.h = 0;
    this._v = new THREE.Vector3();

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x4a5a66, 2.1));
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
    sun.position.set(9, 22, 7);
    this.scene.add(sun);

    this._buildSky();
    this.courtGroup = new THREE.Group();
    this.scene.add(this.courtGroup);
    this._buildNet();
    this._buildActors();
    this.setCourt(0);
    this.resize();
  }

  _buildSky() {
    const c = canvas(4, 256), g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#2f78d0'); gr.addColorStop(0.55, '#8cc2f2'); gr.addColorStop(1, '#dbeeff');
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
    this.scene.background = tex(c);
  }

  setCourt(type) {
    type = ((type | 0) % COURTS.length + COURTS.length) % COURTS.length;
    if (type === this.courtType) return;
    this.courtType = type;
    const k = COURTS[type];
    const grp = this.courtGroup;
    while (grp.children.length) {
      const o = grp.children.pop();
      o.traverse((m) => { if (m.geometry) m.geometry.dispose(); if (m.material) { if (m.material.map) m.material.map.dispose(); m.material.dispose(); } });
    }
    // --- superficie con líneas (textura) ---
    const W = 18, L = 36, pxm = 1024 / W;
    const cv = canvas(1024, 2048), g = cv.getContext('2d');
    const X = (x) => (x + W / 2) * pxm, Z = (z) => (z + L / 2) * pxm;
    g.fillStyle = k.out; g.fillRect(0, 0, 1024, 2048);
    g.fillStyle = k.alley; g.fillRect(X(-C.HWD), Z(-C.HL), 2 * C.HWD * pxm, 2 * C.HL * pxm);
    g.fillStyle = k.inn; g.fillRect(X(-C.HW), Z(-C.HL), 2 * C.HW * pxm, 2 * C.HL * pxm);
    // textura sutil
    if (type === 2) {
      for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.04)'; g.fillRect(0, (i * 2048) / 12, 1024, 2048 / 12); }
    }
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.04)';
      g.fillRect(Math.random() * 1024, Math.random() * 2048, 2 + Math.random() * 4, 2 + Math.random() * 4);
    }
    g.strokeStyle = '#ffffff'; g.lineCap = 'butt';
    const line = (x1, z1, x2, z2, wd) => { g.lineWidth = wd * pxm; g.beginPath(); g.moveTo(X(x1), Z(z1)); g.lineTo(X(x2), Z(z2)); g.stroke(); };
    const lw = 0.075;
    line(-C.HWD, -C.HL, C.HWD, -C.HL, 0.11); line(-C.HWD, C.HL, C.HWD, C.HL, 0.11);
    line(-C.HWD, -C.HL - 0.05, -C.HWD, C.HL + 0.05, lw); line(C.HWD, -C.HL - 0.05, C.HWD, C.HL + 0.05, lw);
    line(-C.HW, -C.HL, -C.HW, C.HL, lw); line(C.HW, -C.HL, C.HW, C.HL, lw);
    line(-C.HW, -C.SVC, C.HW, -C.SVC, lw); line(-C.HW, C.SVC, C.HW, C.SVC, lw);
    line(0, -C.SVC, 0, C.SVC, lw);
    line(0, -C.HL, 0, -C.HL + 0.25, lw); line(0, C.HL, 0, C.HL - 0.25, lw);
    const court = new THREE.Mesh(new THREE.PlaneGeometry(W, L), new THREE.MeshBasicMaterial({ map: tex(cv) }));
    court.material.map.anisotropy = 8;
    court.rotation.x = -Math.PI / 2;
    grp.add(court);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 110), new THREE.MeshBasicMaterial({ color: k.ground }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02;
    grp.add(ground);

    // --- muros con el logo del juego ---
    const wc = canvas(1024, 128), wg = wc.getContext('2d');
    wg.fillStyle = k.wall; wg.fillRect(0, 0, 1024, 128);
    wg.fillStyle = 'rgba(255,255,255,0.10)'; wg.fillRect(0, 0, 1024, 10); wg.fillRect(0, 118, 1024, 10);
    wg.font = 'italic 900 58px "Segoe UI", Roboto, Arial, sans-serif'; wg.textBaseline = 'middle';
    for (let i = 0; i < 2; i++) {
      const x0 = i * 512 + 40;
      wg.fillStyle = k.accent; wg.beginPath(); wg.arc(x0 + 30, 64, 26, 0, Math.PI * 2); wg.fill();
      wg.strokeStyle = k.wall; wg.lineWidth = 4; wg.beginPath(); wg.arc(x0 + 2, 64, 26, -0.9, 0.9); wg.stroke(); wg.beginPath(); wg.arc(x0 + 58, 64, 26, Math.PI - 0.9, Math.PI + 0.9); wg.stroke();
      wg.fillStyle = '#ffffff'; wg.fillText('DUELO', x0 + 72, 66);
      wg.fillStyle = k.accent; wg.fillText('TENIS', x0 + 268, 66);
    }
    const wallMat = (rep) => new THREE.MeshBasicMaterial({ map: tex(wc, [rep, 1]) });
    const wallH = 1.25, WX = C.WALL_X + 0.15, WZ = C.WALL_Z + 0.15;
    const mkWall = (len, rep, x, z, ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, wallH), wallMat(rep));
      m.position.set(x, wallH / 2, z); m.rotation.y = ry;
      grp.add(m);
    };
    mkWall(WX * 2, 2, 0, -WZ, 0); mkWall(WX * 2, 2, 0, WZ, Math.PI);
    mkWall(WZ * 2, 4, -WX, 0, Math.PI / 2); mkWall(WZ * 2, 4, WX, 0, -Math.PI / 2);

    // --- tribunas con público ---
    const cc = canvas(512, 256), cg = cc.getContext('2d');
    cg.fillStyle = '#1a2233'; cg.fillRect(0, 0, 512, 256);
    const pal = ['#e9eef5', '#f2c94c', '#eb5757', '#56ccf2', '#6fcf97', '#bb6bd9', '#f2994a', '#d9d9d9', '#2d9cdb', '#ffffff'];
    const skins = ['#e8b98f', '#c98f62', '#a86f47', '#f1cdaa', '#7c4a2a'];
    for (let row = 0; row < 12; row++) {
      const y = 10 + row * 21;
      cg.fillStyle = 'rgba(255,255,255,0.05)'; cg.fillRect(0, y + 9, 512, 3);
      for (let x = 6 + (row % 2) * 7; x < 512; x += 14) {
        if (Math.random() < 0.1) continue;
        cg.fillStyle = pal[(Math.random() * pal.length) | 0];
        cg.fillRect(x - 5, y, 10, 9);
        cg.fillStyle = skins[(Math.random() * skins.length) | 0];
        cg.beginPath(); cg.arc(x, y - 3, 3.6, 0, Math.PI * 2); cg.fill();
      }
    }
    const standMat = (rep) => new THREE.MeshBasicMaterial({ map: tex(cc, [rep, 1]) });
    const mkStand = (len, rep, depth, rise, x, z, ry) => {
      const geo = new THREE.PlaneGeometry(len, Math.hypot(depth, rise));
      const m = new THREE.Mesh(geo, standMat(rep));
      const hold = new THREE.Group();
      m.rotation.x = -Math.atan2(depth, rise);
      m.position.set(0, wallH + rise / 2, -depth / 2);
      hold.add(m);
      hold.position.set(x, 0, z); hold.rotation.y = ry;
      grp.add(hold);
      // borde superior
      const top = new THREE.Mesh(new THREE.BoxGeometry(len, 2.2, 0.6), new THREE.MeshBasicMaterial({ color: 0x101826 }));
      top.position.set(0, wallH + rise + 1.1, -depth - 0.3);
      hold.add(top);
    };
    mkStand(62, 7, 11, 9, 0, -WZ, 0); mkStand(62, 7, 11, 9, 0, WZ, Math.PI);
    mkStand(64, 7, 10, 8, -WX, 0, Math.PI / 2); mkStand(64, 7, 10, 8, WX, 0, -Math.PI / 2);

    // --- silla del juez y bancos ---
    const dark = new THREE.MeshLambertMaterial({ color: 0x24313f }), white = new THREE.MeshLambertMaterial({ color: 0xf0f0f0 });
    const chair = new THREE.Group();
    for (const [dx, dz] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.9, 6), dark);
      leg.position.set(dx, 0.95, dz); chair.add(leg);
    }
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.1, 0.85), white); seat.position.y = 1.9; chair.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 0.85), white); back.position.set(-0.4, 2.25, 0); chair.add(back);
    const ump = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.45, 3, 8), new THREE.MeshLambertMaterial({ color: 0x1f3a5f })); ump.position.set(-0.05, 2.35, 0); chair.add(ump);
    const umpH = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshLambertMaterial({ color: 0xd9a37a })); umpH.position.set(-0.02, 2.85, 0); chair.add(umpH);
    chair.position.set(-(C.POST_X + 1.25), 0, 0);
    grp.add(chair);
    for (const z of [-4.2, 4.2]) {
      const bench = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 2.2), new THREE.MeshLambertMaterial({ color: 0xe9eef5 }));
      bench.position.set(-(C.POST_X + 1.4), 0.25, z);
      grp.add(bench);
    }
  }

  _buildNet() {
    const g = new THREE.Group();
    const N = 24, pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const x = -C.POST_X + (2 * C.POST_X * i) / N, h = netH(x);
      pos.push(x, 0.02, 0, x, h, 0);
      uv.push(x * 3.2, 0, x * 3.2, h * 3.2);
      if (i < N) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const nc = canvas(32, 32), ng = nc.getContext('2d');
    ng.clearRect(0, 0, 32, 32);
    ng.fillStyle = 'rgba(8,12,18,0.42)'; ng.fillRect(0, 0, 32, 32);
    ng.strokeStyle = 'rgba(10,14,20,0.95)'; ng.lineWidth = 5;
    ng.strokeRect(0, 0, 32, 32);
    const nt = tex(nc); nt.wrapS = nt.wrapT = THREE.RepeatWrapping;
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: nt, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    mesh.renderOrder = 2;
    g.add(mesh);
    // cinta superior
    const tp = [], ti = [];
    for (let i = 0; i <= N; i++) {
      const x = -C.POST_X + (2 * C.POST_X * i) / N, h = netH(x);
      tp.push(x, h - 0.075, 0, x, h + 0.012, 0);
      if (i < N) { const a = i * 2; ti.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const tgeo = new THREE.BufferGeometry();
    tgeo.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
    tgeo.setIndex(ti);
    const tape = new THREE.Mesh(tgeo, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    tape.renderOrder = 3;
    g.add(tape);
    const strap = new THREE.Mesh(new THREE.PlaneGeometry(0.06, C.NET_H), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    strap.position.set(0, C.NET_H / 2, 0); strap.renderOrder = 3;
    g.add(strap);
    const postM = new THREE.MeshLambertMaterial({ color: 0x1d2b22 });
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, C.NET_HP + 0.03, 8), postM);
      p.position.set(sx * C.POST_X, (C.NET_HP + 0.03) / 2, 0);
      g.add(p);
    }
    this.scene.add(g);
  }

  _buildActors() {
    this.fig = [new Figure(TEAM[0]), new Figure(TEAM[1])];
    this.fig[0].setFacing(0); this.fig[1].setFacing(Math.PI);
    const blob = () => {
      const c = canvas(64, 64), g = c.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 4, 32, 32, 30);
      gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return tex(c);
    };
    const blobT = blob();
    const flat = (size, opacity) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: blobT, transparent: true, opacity, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.renderOrder = 1;
      return m;
    };
    this.pShadow = [flat(1.5, 0.75), flat(1.5, 0.75)];
    for (let i = 0; i < 2; i++) { this.scene.add(this.fig[i].root); this.pShadow[i].position.y = 0.015; this.scene.add(this.pShadow[i]); }

    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10), new THREE.MeshLambertMaterial({ color: 0xe9ff3d, emissive: 0x7d8f12 }));
    this.scene.add(this.ball);
    this.bShadow = flat(0.5, 0.85);
    this.bShadow.position.y = 0.02;
    this.scene.add(this.bShadow);
    // estela
    this.trail = [];
    this.trailPos = [];
    const tg = new THREE.SphereGeometry(0.075, 8, 6);
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0xf4ff9a, transparent: true, opacity: 0.32 * (1 - i / 7), depthWrite: false }));
      m.visible = false; m.renderOrder = 1;
      this.scene.add(m); this.trail.push(m);
    }
    // marcador de bote previsto
    this.mark = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.3, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
    this.mark.rotation.x = -Math.PI / 2; this.mark.position.y = 0.025; this.mark.visible = false; this.mark.renderOrder = 1;
    this.scene.add(this.mark);
    // anillo de carga bajo el jugador local
    this.charge = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.74, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    this.charge.rotation.x = -Math.PI / 2; this.charge.position.y = 0.03; this.charge.visible = false; this.charge.renderOrder = 1;
    this.scene.add(this.charge);
    // marcas de bote
    this.marks = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.1, 12), new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.y = 0.022; m.visible = false; m.renderOrder = 1;
      this.scene.add(m); this.marks.push({ m, life: 0 });
    }
    this.markIdx = 0;
    // destello de golpe
    const fc = canvas(64, 64), fg = fc.getContext('2d');
    const fgr = fg.createRadialGradient(32, 32, 2, 32, 32, 30);
    fgr.addColorStop(0, 'rgba(255,255,255,1)'); fgr.addColorStop(0.4, 'rgba(255,255,200,0.7)'); fgr.addColorStop(1, 'rgba(255,255,255,0)');
    fg.fillStyle = fgr; fg.fillRect(0, 0, 64, 64);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(fc), transparent: true, depthWrite: false, depthTest: false }));
    this.flash.visible = false; this.flashLife = 0;
    this.scene.add(this.flash);
  }

  bounceMark(x, z, good) {
    const o = this.marks[this.markIdx++ % this.marks.length];
    o.m.position.x = x; o.m.position.z = z;
    o.m.material.color.setHex(good ? 0x101010 : 0xd01818);
    o.m.visible = true; o.life = 2.6;
  }
  hitFlash(x, y, z, strength) {
    this.flash.position.set(x, y, z);
    this.flash.visible = true; this.flashLife = 0.14; this.flashSize = 0.5 + strength * 0.9;
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.r.setSize(w, h, false);
    this.cam.aspect = w / Math.max(1, h);
    this._fit();
  }

  // Calcula la cámara (en coordenadas locales del jugador) para que entre toda la cancha.
  _fit() {
    const H = 8.4, D = C.HL + 11.2;
    const bot = { y: 0, z: C.HL + 3.9 }, top = { y: 2.9, z: -(C.HL + 2.8) };
    const eb = Math.atan2(bot.y - H, D - bot.z), et = Math.atan2(top.y - H, D - top.z);
    const pitch = (eb + et) / 2;
    this.camH = H; this.camD = D;
    this.lookZ = D - H / Math.tan(-pitch);
    let fov = THREE.MathUtils.radToDeg(et - eb) * 1.05;
    const cam = this.cam;
    const pts = [[C.HW + 3.4, 0, C.HL + 1.2], [-(C.HW + 3.4), 0, C.HL + 1.2], [C.HWD + 1.2, 1.5, -C.HL], [0, 0, C.HL + 3.9], [0, 2.9, -(C.HL + 2.8)]];
    for (let it = 0; it < 60; it++) {
      cam.fov = fov;
      cam.position.set(0, H, D); cam.lookAt(0, 0, this.lookZ);
      cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
      let ok = true;
      for (const p of pts) {
        this._v.set(p[0], p[1], p[2]).project(cam);
        if (Math.abs(this._v.x) > 0.965 || Math.abs(this._v.y) > 0.985) { ok = false; break; }
      }
      if (ok || fov > 78) break;
      fov *= 1.025;
    }
    this.fov = fov;
  }

  _quality(dtMs) {
    this.frameMs += (dtMs - this.frameMs) * 0.05;
    if (this.frameMs > 21) this.slow++; else this.slow = Math.max(0, this.slow - 2);
    if (this.slow > 150 && this.maxPR > 1) {
      this.maxPR = Math.max(1, this.maxPR - 0.25);
      this.r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxPR));
      this.r.setSize(this.w, this.h, false);
      this.slow = 0; this.frameMs = 16;
    }
  }

  // Menús: cámara girando despacio alrededor de la cancha.
  renderIdle(dt) {
    this.resize();
    this._quality(dt * 1000);
    this.idleA += dt * 0.07;
    const a = this.idleA;
    this.cam.fov = 46; this.cam.updateProjectionMatrix();
    this.cam.position.set(Math.sin(a) * 13.5, 7.2, Math.cos(a) * 21);
    this.cam.lookAt(0, 0.6, 0);
    const idle = (i, x, z) => ({ x, z, vx: 0, vz: 0, st: ST.FREE, t: 0, side: 1, kind: 0, mood: 0, dur: 0, eta: -1 });
    this.fig[0].update(idle(0, 1.2, C.HL + 0.3), dt, {});
    this.fig[1].update(idle(1, -1.2, -(C.HL + 0.3)), dt, {});
    for (let i = 0; i < 2; i++) { this.pShadow[i].position.x = this.fig[i].root.position.x; this.pShadow[i].position.z = this.fig[i].root.position.z; }
    this.ball.visible = false; this.bShadow.visible = false; this.mark.visible = false; this.charge.visible = false;
    for (const t of this.trail) t.visible = false;
    this._fx(dt);
    this.r.render(this.scene, this.cam);
  }

  _fx(dt) {
    for (const o of this.marks) {
      if (o.life > 0) { o.life -= dt; o.m.material.opacity = Math.max(0, Math.min(0.55, o.life * 0.5)); if (o.life <= 0) o.m.visible = false; }
    }
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      const u = Math.max(0, this.flashLife / 0.14);
      this.flash.scale.setScalar(this.flashSize * (1.6 - u));
      this.flash.material.opacity = u;
      if (this.flashLife <= 0) this.flash.visible = false;
    }
  }

  // view: instantánea interpolada. me: 0/1 (lado de la cámara). own: {x,z} posición predicha del jugador local (opcional).
  render(view, me, dt, own) {
    this.resize();
    this._quality(dt * 1000);
    this.me = me;
    const s = me === 0 ? 1 : -1;
    const b = view.b;
    const serving = view.ph === PH.SERVE || view.ph === PH.INTRO;
    const relaxed = view.ph === PH.POINT || view.ph === PH.OVER || view.ph === PH.INTRO;

    for (let i = 0; i < 2; i++) {
      let p = view.p[i];
      if (i === me && own) p = { ...p, x: own.x, z: own.z, vx: own.vx, vz: own.vz };
      const li = i === 0 ? 1 : -1;
      const volley = !b.bn && li * p.z < 8.5 && p.kind !== K.SMASH;
      this.fig[i].update(p, dt, { volley: p.st === ST.PREP && volley, relaxed: relaxed || (serving && view.sv !== i && false) });
      this.pShadow[i].position.x = p.x; this.pShadow[i].position.z = p.z;
    }

    // pelota
    this.ball.visible = true;
    this.ball.position.set(b.x, Math.max(b.y, C.R) + 0.04, b.z);
    const dist = this._v.copy(this.ball.position).sub(this.cam.position).length();
    this.ball.scale.setScalar(Math.max(1, 0.72 + dist * 0.021));
    this.bShadow.visible = true;
    this.bShadow.position.x = b.x; this.bShadow.position.z = b.z;
    const hs = Math.max(0.35, 1 - b.y * 0.11);
    this.bShadow.scale.setScalar(hs * (0.9 + dist * 0.012));
    this.bShadow.material.opacity = 0.85 * hs;
    // estela (solo en vuelo rápido)
    const fast = b.st === BS.FLY && Math.hypot(b.vx, b.vz) > 14;
    this.trailPos.unshift([this.ball.position.x, this.ball.position.y, this.ball.position.z, this.ball.scale.x]);
    if (this.trailPos.length > 16) this.trailPos.length = 16;
    for (let i = 0; i < this.trail.length; i++) {
      const tp = this.trailPos[(i + 1) * 2];
      const m = this.trail[i];
      if (fast && tp) { m.visible = true; m.position.set(tp[0], tp[1], tp[2]); m.scale.setScalar(tp[3] * (0.95 - i * 0.09)); }
      else m.visible = false;
    }
    if (!fast && this.trailPos.length > 2) this.trailPos.length = 2;

    // marcador de bote para la pelota que viene hacia mí
    let showMark = false;
    if (b.st === BS.FLY && b.live && b.last === 1 - me && b.bn === 0 && !view.paused) {
      const land = predictLanding(b);
      if (land && s * land.z > 0) {
        showMark = true;
        this.mark.position.x = land.x; this.mark.position.z = land.z;
        const k = Math.min(1, Math.max(0.25, 1 - land.t * 0.8));
        this.mark.material.opacity = 0.25 + 0.55 * k;
        this.mark.scale.setScalar(1 + land.t * 0.9);
      }
    }
    this.mark.visible = showMark;

    // anillo de carga del jugador local
    const mp = view.p[me];
    if (mp.st === ST.PREP) {
      const c = Math.min(1, mp.t / T.CHARGE);
      this.charge.visible = true;
      const px = own ? own.x : mp.x, pz = own ? own.z : mp.z;
      this.charge.position.x = px; this.charge.position.z = pz;
      this.charge.scale.setScalar(0.55 + 0.45 * c + (c >= 1 ? 0.05 * Math.sin(performance.now() / 60) : 0));
      this.charge.material.color.setRGB(1, 1 - 0.45 * c, 1 - c);
      this.charge.material.opacity = 0.45 + 0.5 * c;
    } else this.charge.visible = false;

    this._fx(dt);

    // cámara detrás del jugador local
    const myX = s * (own ? own.x : mp.x), bx = s * b.x;
    const want = Math.max(-1.7, Math.min(1.7, myX * 0.2 + (b.st === BS.FLY ? bx * 0.07 : 0)));
    this.camX += (want - this.camX) * Math.min(1, 3 * dt);
    this.cam.fov = this.fov; this.cam.updateProjectionMatrix();
    this.cam.position.set(s * this.camX, this.camH, s * this.camD);
    this.cam.lookAt(s * this.camX * 0.6, 0, s * this.lookZ);
    this.r.render(this.scene, this.cam);
  }

  // Solo depuración: dibuja la figura 0 en una pose/estado concreto, vista de cerca.
  renderPose(p, dt) {
    this.resize();
    for (let i = 0; i < (p.steps || 40); i++) this.fig[0].update(p, 1 / 60, p.opts || {});
    this.fig[1].root.visible = false; this.pShadow[1].visible = false;
    this.pShadow[0].position.x = p.x; this.pShadow[0].position.z = p.z;
    this.ball.visible = false; this.bShadow.visible = false; this.mark.visible = false; this.charge.visible = false;
    for (const t of this.trail) t.visible = false;
    this.cam.fov = 30; this.cam.updateProjectionMatrix();
    this.cam.position.set(p.x + (p.cx === undefined ? 2.2 : p.cx), p.cy === undefined ? 1.7 : p.cy, p.z + (p.cz === undefined ? -4.6 : p.cz));
    this.cam.lookAt(p.x, 1.0, p.z);
    this.r.render(this.scene, this.cam);
  }

  // Proyecta un punto del mundo a píxeles CSS (para textos flotantes).
  project(x, y, z) {
    this._v.set(x, y, z).project(this.cam);
    return { x: (this._v.x * 0.5 + 0.5) * this.w, y: (-this._v.y * 0.5 + 0.5) * this.h, behind: this._v.z > 1 };
  }
}
