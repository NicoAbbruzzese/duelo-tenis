// Duelo Tenis — programa principal: salas, menús, bucle del partido y sincronización.
// El que crea la sala es el anfitrión: su dispositivo corre la simulación y envía el estado.
// El invitado envía sus controles y dibuja el estado recibido (con predicción de su propio jugador).
import * as S from './sim.js';
import { capture, pack, unpack, validSnap, SnapBuffer, PROTO } from './proto.js';
import { Link, makeCode, cleanCode } from './net.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { predictOwn } from './predict.js';

const { PH, ST, BS, EV, RS, K, TICK } = S;
const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const DEBUG = qs.has('debug');
const LENS = [{ games: 3, sets: 1 }, { games: 6, sets: 1 }, { games: 6, sets: 3 }];
const SCREENS = ['Menu', 'Host', 'Join', 'Lobby', 'Pause', 'Result', 'Help'];

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } },
};
const cleanName = (s, d) => {
  const v = String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);
  return v || d;
};
const clamp1 = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

const input = new Input();
const sfx = new Sfx();
const hud = new Hud();
const renderer = new Renderer($('gl'));

const app = {
  screen: 'Menu', role: null, me: 0, code: '', link: null,
  names: ['Jugador 1', 'Jugador 2'],
  len: Number(store.get('dt_len', 1)) || 0, court: Number(store.get('dt_court', 0)) || 0, cfg: { ...LENS[1], court: 0 },
  G: null, acc: 0, lastT: 0, lastFirst: undefined,
  buf: new SnapBuffer(), evQueue: [], evSeen: 0,
  remote: { seq: -1, dx: 0, dz: 0, c: null, vt: -1, at: 0 }, remoteLastC: null,
  userPause: [false, false], netPause: false,
  gseq: 0, gacc: 0, pending: [], gcount: [0, 0, 0, 0], lastSentTick: 0, lastSent: { dx: 0, dz: 0 },
  own: { x: 0, z: 0, vx: 0, vz: 0, init: false },
  inGame: false, synced: false, peerHello: false,
  overlay: null, helpBack: 'Menu', localMenu: false, resultShown: false, prevPh: -1, lastView: null,
  touch: matchMedia('(pointer: coarse)').matches, bot: null, pred: qs.get('pred') !== '0',
  lastPingUi: 0, rematchAsked: false,
};

// ---------- utilidades de interfaz ----------
function show(name) {
  for (const s of SCREENS) $('scr' + s).classList.toggle('hidden', s !== name);
  app.screen = name;
  const a = document.activeElement;
  if (a && a.blur && a.tagName !== 'BODY') a.blur();
  checkRotate();
}
function setStatus(id, text, cls = '') {
  const el = $(id);
  el.textContent = text;
  el.className = 'status ' + cls;
}
function checkRotate() {
  const portrait = window.innerHeight > window.innerWidth;
  const need = app.touch && portrait && (app.inGame || app.screen === 'Lobby');
  $('rotate').classList.toggle('hidden', !need);
}
async function goFull() {
  const el = document.documentElement;
  try { if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' }); } catch (e) { /* no disponible */ }
  try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch (e) { /* no disponible */ }
  checkRotate();
}
function toggleFull() {
  if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) { /* nada */ } }
  else goFull();
}
let wake = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wake) {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    }
  } catch (e) { wake = null; }
}
function shareUrl() { return location.origin + location.pathname + '?sala=' + app.code; }
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (e) { /* plan B */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) { return false; }
}
function myName() {
  const v = cleanName($('inName').value, '');
  if (v) store.set('dt_name', v);
  return v;
}

// ---------- salas ----------
function createRoom(forceCode) {
  stopLink(false);
  app.role = 'host'; app.me = 0; app.code = forceCode || makeCode();
  app.names = [myName() || 'Jugador 1', 'Rival'];
  app.peerHello = false; app.inGame = false; app.G = null; app.lastFirst = undefined;
  $('codeBig').textContent = app.code;
  $('shareUrl').textContent = shareUrl();
  setStatus('hostStatus', 'Creando sala…');
  show('Host');
  startLink();
}
function joinRoom(raw) {
  const code = cleanCode(raw);
  if (code.length !== 4) { setStatus('joinStatus', 'El código tiene 4 letras', 'bad'); return; }
  stopLink(false);
  app.role = 'guest'; app.me = 1; app.code = code;
  app.names = ['Rival', myName() || 'Jugador 2'];
  app.synced = false; app.inGame = false;
  $('inCode').value = code;
  $('btnJoinGo').disabled = true;
  setStatus('joinStatus', 'Conectando con la sala ' + code + '…');
  show('Join');
  startLink();
}
function startLink() {
  const link = new Link({
    role: app.role, code: app.code, mode: qs.get('net') || 'auto',
    sim: { lag: Number(qs.get('lag')) || 0, jit: Number(qs.get('jit')) || 0, loss: Number(qs.get('loss')) || 0 },
  });
  app.link = link;
  link.onup = () => { if (app.link === link) { sendHello(); connUi(); } };
  link.ondown = () => { if (app.link === link) { app.synced = false; app.peerHello = false; onLinkDown(); } };
  link.onmessage = (m) => { if (app.link === link) onMsg(m); };
  link.onchange = () => { if (app.link === link) connUi(); };
  link.onfatal = (c) => {
    if (app.link !== link) return;
    if (c === 'taken' && app.role === 'host' && !app.peerHello && !app.inGame) createRoom();
  };
  link.start();
}
function stopLink(sayBye = true) {
  const l = app.link;
  if (!l) return;
  app.link = null;
  if (sayBye) { try { l.send(['quit']); } catch (e) { /* nada */ } }
  // pequeño margen para que salga el aviso antes de cerrar
  setTimeout(() => l.stop(), sayBye ? 120 : 0);
}
function sendHello() {
  if (app.link && app.link.up) app.link.send(['hello', { v: PROTO, name: app.names[app.me] }]);
}
function sendLobby() {
  if (app.link && app.link.up) app.link.send(['lobby', { len: app.len, court: app.court, names: app.names }]);
}
function connText() {
  const l = app.link;
  if (!l || !l.up) return { t: 'Sin conexión', c: 'bad' };
  const ms = Math.round(l.rtt);
  const via = l.via === 'relay' ? 'Respaldo (lenta)' : l.kind === 'turn' ? 'Relé' : 'Directa';
  return { t: via + (ms ? ' · ' + ms + ' ms' : ''), c: l.via === 'relay' || ms > 180 ? 'bad' : ms > 90 ? 'slow' : '' };
}
function connUi() {
  const c = connText();
  if (app.screen === 'Lobby') setStatus('lbConn', 'Conexión: ' + c.t, c.c === 'bad' ? 'bad' : 'ok');
  if (app.inGame) hud.ping(c.t, c.c);
}
function onLinkDown() {
  if (app.role === 'host') {
    if (app.inGame) app.netPause = true;
    else if (app.screen === 'Lobby') { show('Host'); setStatus('hostStatus', 'El rival se desconectó. Esperando…'); }
  } else if (app.role === 'guest') {
    if (app.inGame) hud.net('Conexión perdida. Reconectando…');
    else if (app.screen === 'Lobby') { show('Join'); setStatus('joinStatus', 'Conexión perdida. Reconectando…'); }
  }
  connUi();
}
function renderLobby() {
  $('lbName0').textContent = app.names[0];
  $('lbName1').textContent = app.names[1];
  const host = app.role === 'host';
  for (const [id, val] of [['segLen', app.len], ['segCourt', app.court]]) {
    const seg = $(id);
    seg.classList.toggle('ro', !host);
    for (const b of seg.querySelectorAll('button')) b.classList.toggle('sel', Number(b.dataset.v) === val);
  }
  $('btnStart').classList.toggle('hidden', !host);
  $('lbWait').classList.toggle('hidden', host);
  if (!host) $('lbWait').textContent = 'Esperando a que ' + app.names[0] + ' empiece el partido…';
  connUi();
}
function leave(msg) {
  stopLink(true);
  leaveGame();
  app.role = null; app.synced = false; app.peerHello = false;
  $('btnJoinGo').disabled = false;
  show('Menu');
  if (msg) hud.toast(msg, 3600);
  if (!DEBUG) { try { history.replaceState(null, '', location.pathname); } catch (e) { /* nada */ } }
}

// ---------- mensajes de red ----------
function onMsg(m) {
  const d = m[1];
  switch (m[0]) {
    case 'hello': {
      if (!d || d.v !== PROTO) { hud.toast('Tienen versiones distintas del juego: recarguen la página los dos.', 6000); app.link.send(['ver', PROTO]); return; }
      app.names[1 - app.me] = cleanName(d.name, app.me === 0 ? 'Jugador 2' : 'Jugador 1');
      app.peerHello = true;
      if (app.role === 'host') {
        app.remote = { seq: -1, dx: 0, dz: 0, c: null, vt: -1, at: 0 }; app.remoteLastC = null;
        if (app.inGame && app.G) { app.link.send(['start', startPayload()]); app.netPause = false; hud.setNames(app.names, app.me); }
        else { if (app.screen !== 'Lobby') show('Lobby'); renderLobby(); sendLobby(); }
      }
      break;
    }
    case 'ver': hud.toast('Tienen versiones distintas del juego: recarguen la página los dos.', 6000); break;
    case 'lobby':
      if (app.role !== 'guest' || !d) break;
      app.len = Number(d.len) | 0; app.court = Number(d.court) | 0;
      if (Array.isArray(d.names)) app.names = [cleanName(d.names[0], 'Jugador 1'), app.names[1]];
      app.synced = true;
      if (app.inGame) leaveGame();
      if (app.screen !== 'Lobby') show('Lobby');
      renderLobby();
      break;
    case 'start':
      if (app.role !== 'guest' || !d || !d.cfg) break;
      app.cfg = { games: Number(d.cfg.games) || 6, sets: Number(d.cfg.sets) || 1, court: Number(d.cfg.court) | 0 };
      if (Array.isArray(d.names)) app.names = [cleanName(d.names[0], 'Jugador 1'), cleanName(d.names[1], 'Jugador 2')];
      app.synced = true;
      enterGame();
      break;
    case 's':
      if (app.role === 'guest' && app.inGame && validSnap(m)) onSnapshot(unpack(m));
      break;
    case 'i':
      if (app.role === 'host' && m.length >= 9) {
        const seq = m[1] | 0;
        if (seq > app.remote.seq || app.remote.seq - seq > 5000) {
          app.remote = { seq, dx: clamp1(m[2]), dz: clamp1(m[3]), c: [m[4] | 0, m[5] | 0, m[6] | 0, m[7] | 0], vt: Number.isFinite(m[8]) ? m[8] : -1, at: performance.now() };
        }
        if (app.netPause) app.netPause = false;
      }
      break;
    case 'pause':
      if (app.role === 'host') { if (d) app.userPause[1] = true; else app.userPause = [false, false]; }
      break;
    case 'rematch':
      if (app.role === 'host' && app.G && app.G.phase === PH.OVER) startMatch();
      break;
    case 'quit':
      if (app.role === 'host') {
        leaveGame(); app.peerHello = false;
        show('Host'); setStatus('hostStatus', 'Tu rival salió. La sala sigue abierta, esperando…');
      } else if (app.role === 'guest') leave('El anfitrión cerró la sala.');
      break;
    default:
  }
}

// ---------- partido ----------
function startPayload() { return { cfg: app.cfg, names: app.names }; }
function startMatch() {
  if (app.role !== 'host' || !app.link || !app.link.up) return;
  app.cfg = { ...LENS[app.len] || LENS[1], court: app.court };
  const first = app.lastFirst === undefined ? undefined : 1 - app.lastFirst;
  const G = S.newGame({ ...app.cfg, firstServer: first }, (Math.random() * 0xffffffff) >>> 0);
  app.lastFirst = G.firstServer;
  app.G = G;
  app.userPause = [false, false]; app.netPause = false;
  app.remoteLastC = null;
  app.link.send(['start', startPayload()]);
  enterGame();
  app.buf.push(capture(G, app.remote.seq), performance.now());
}
function enterGame() {
  app.inGame = true;
  app.buf.reset(); app.evQueue = []; app.evSeen = 0;
  app.acc = 0; app.gacc = 0; app.lastT = performance.now();
  app.pending = []; app.own.init = false;
  app.prevPh = -1; app.overlay = null; app.localMenu = false; app.resultShown = false; app.rematchAsked = false; app.lastView = null;
  renderer.setCourt(app.cfg.court);
  hud.reset(); hud.setNames(app.names, app.me);
  show(null);
  $('hud').classList.remove('hidden');
  $('touch').classList.toggle('hidden', !app.touch);
  const keys = $('keys');
  keys.classList.toggle('hidden', app.touch);
  keys.innerHTML = 'Mover: <b>W A S D</b> o flechas<br><b>J</b> golpe · <b>K</b> cortado · <b>L</b> globo · <b>I</b> dejada · <b>Esc</b> pausa';
  // la ayuda de teclas se retira sola a los 40 s (sigue disponible en Pausa > Cómo se juega)
  clearTimeout(app.keysTimer);
  app.keysTimer = setTimeout(() => keys.classList.add('hidden'), 40000);
  input.enabled = true;
  sfx.unlock(); sfx.ambience(true);
  keepAwake();
  connUi();
  checkRotate();
}
function leaveGame() {
  if (!app.inGame) return;
  app.inGame = false; app.G = null; app.overlay = null;
  $('hud').classList.add('hidden');
  hud.reset();
  sfx.ambience(false);
  input.releaseTouch();
}

// Entradas del invitado vistas por el anfitrión.
function remoteInput() {
  const r = app.remote;
  let pr = 0;
  if (r.c) {
    if (!app.remoteLastC) app.remoteLastC = r.c.slice();
    for (let b = 0; b < 4; b++) if (r.c[b] !== app.remoteLastC[b]) { pr |= 1 << b; app.remoteLastC[b] = r.c[b]; }
  }
  if (!app.link || !app.link.up || performance.now() - r.at > 450) return { dx: 0, dz: 0, pr, vt: -1 };
  return { dx: r.dx, dz: r.dz, pr, vt: r.vt };
}
function pseudoG(s) {
  return { phase: s.ph, pt: s.pt, server: s.sv, rally: s.rally, side: s.side, pl: s.p, ball: { ...s.b, bounces: s.b.bn } };
}

function hostAdvance(now) {
  let dt = (now - app.lastT) / 1000;
  app.lastT = now;
  if (!(dt > 0)) return;
  if (dt > 0.25) dt = 0.25;
  app.acc += dt;
  const G = app.G, link = app.link;
  let n = 0;
  while (app.acc >= TICK && n < 10) {
    app.acc -= TICK; n++;
    G.pw = (app.userPause[0] ? 1 : 0) | (app.userPause[1] ? 2 : 0) | (app.netPause ? 4 : 0);
    G.paused = G.pw !== 0;
    const mine = app.bot ? app.bot(G, 0) : input.sample();
    S.step(G, [mine, remoteInput()]);
    const snap = capture(G, app.remote.seq);
    app.buf.push(snap, now);
    queueEvents(snap);
    if (link && link.up) {
      const every = Math.max(1, Math.round(60 / link.hz));
      if (G.tick % every === 0) link.send(pack(snap));
    }
  }
  if (n >= 10) app.acc = 0;
}

function guestAdvance(now) {
  let dt = (now - app.lastT) / 1000;
  app.lastT = now;
  if (!(dt > 0)) return;
  if (dt > 0.25) dt = 0.25;
  app.gacc += dt;
  const link = app.link;
  let n = 0;
  while (app.gacc >= TICK && n < 10) {
    app.gacc -= TICK; n++;
    const latest = app.buf.latest();
    const inp = app.bot && latest ? app.bot(pseudoG(latest), 1) : input.sample();
    app.gseq++;
    for (let b = 0; b < 4; b++) if (inp.pr & (1 << b)) app.gcount[b] = (app.gcount[b] + 1) % 1000;
    app.pending.push({ seq: app.gseq, dx: inp.dx, dz: inp.dz, pr: inp.pr });
    if (app.pending.length > 240) app.pending.shift();
    if (link && link.up) {
      const every = Math.max(1, Math.round(60 / link.hz));
      const changed = inp.pr || inp.dx !== app.lastSent.dx || inp.dz !== app.lastSent.dz;
      const since = app.gseq - app.lastSentTick;
      if (since >= every || (changed && since >= Math.max(1, every >> 1))) {
        app.lastSentTick = app.gseq; app.lastSent.dx = inp.dx; app.lastSent.dz = inp.dz;
        link.send(['i', app.gseq, inp.dx, inp.dz, app.gcount[0], app.gcount[1], app.gcount[2], app.gcount[3], Math.floor(app.buf.rt)]);
      }
    }
  }
  if (n >= 10) app.gacc = 0;
}

function onSnapshot(sn) {
  if (!app.buf.push(sn, performance.now())) return;
  queueEvents(sn);
  if (sn.tick >= app.buf.newest) {
    while (app.pending.length && app.pending[0].seq <= sn.ack) app.pending.shift();
  }
  if (hud.netText && app.link && app.link.up) hud.net(null);
}
function queueEvents(sn) {
  for (const e of sn.ev) {
    if (e[0] > app.evSeen) { app.evSeen = e[0]; app.evQueue.push(e); }
  }
}

// Predicción del jugador propio en el invitado (ver js/predict.js).
function predictMine(dt, now) {
  const latest = app.buf.latest();
  if (!latest) return null;
  return predictOwn(app.own, latest, app.pending, app.me, app.gacc, dt, (now - app.buf.lastArrive) / 1000, app.pred);
}

// ---------- eventos del partido (sonidos y carteles) ----------
function scoreCall(sc) {
  const a = sc.pts[0], b = sc.pts[1], n = app.names;
  if (sc.tb) return n[0] + ' ' + a + ' – ' + b + ' ' + n[1];
  if (a >= 3 && b >= 3) return a === b ? 'Iguales' : 'Ventaja ' + n[a > b ? 0 : 1];
  const L = ['0', '15', '30', '40'];
  return n[0] + ' ' + L[a] + ' – ' + L[b] + ' ' + n[1];
}
function fireEvent(e, view) {
  const type = e[2], a = e[3], b = e[4], c = e[5], d = e[6];
  const me = app.me, n = app.names;
  switch (type) {
    case EV.START:
      hud.banner(n[0] + ' vs ' + n[1], '', 2300);
      hud.later(() => hud.subBanner('Saca ' + n[a], 2000), 500);
      break;
    case EV.HIT: {
      const soft = b === K.DROP || b === K.SLICE || b === K.STRETCH;
      const strength = b === K.SERVE ? 0.45 + 0.55 * c : b === K.SMASH ? 1 : c;
      sfx.hit(strength, soft);
      renderer.hitFlash(view.b.x, Math.max(0.5, view.b.y), view.b.z, strength);
      if (b === K.SERVE) hud.speed((c >= 0.999 ? '¡Saque perfecto!  ' : 'Saque  ') + Math.round(d) + ' km/h', 2300);
      else if (b === K.SMASH) hud.speed('¡Remate!  ' + Math.round(d) + ' km/h', 1700);
      if (a === me && app.touch && navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) { try { navigator.vibrate(b === K.SMASH || c > 0.85 ? 26 : 12); } catch (err) { /* nada */ } }
      break;
    }
    case EV.BOUNCE:
      sfx.bounce(b === 3 ? 0.3 : 0.75);
      if (b !== 3) renderer.bounceMark(c, d, a === 1);
      break;
    case EV.NET: sfx.net(); break;
    case EV.WHIFF: sfx.whoosh(); break;
    case EV.FAULT:
      if (b === 1) {
        hud.banner('Falta', 'bad', 1100);
        hud.subBanner((a === RS.NET ? 'A la red' : 'Fuera') + ' · segundo saque', 1400);
        sfx.beep(false, 0.2);
      }
      break;
    case EV.POINT: {
      const w = a, why = b, what = c, mine = w === me;
      const txt = why === RS.OUT ? '¡Fuera!' : why === RS.NET ? '¡Red!' : why === RS.ACE ? '¡Ace!' : why === RS.DFAULT ? 'Doble falta' : '¡Punto!';
      hud.banner(txt, mine ? 'good' : 'bad', what ? 950 : 1500);
      sfx.cheer(what >= 2 ? 1 : what === 1 ? 0.8 : d >= 9 ? 0.85 : 0.5);
      if (why === RS.OUT || why === RS.NET || why === RS.DFAULT) sfx.beep(false, 0.16);
      const L = app.buf.latest();
      const sc = L ? { pts: L.sc.pts.slice(), games: L.sc.games.slice(), sets: L.sc.sets.slice(), tb: L.sc.tb } : null;
      if (!sc) break;
      hud.later(() => {
        if (what === 0) hud.subBanner(scoreCall(sc), 1700);
        else {
          hud.banner((what === 3 ? 'Partido ' : what === 2 ? 'Set ' : 'Juego ') + n[w], mine ? 'good' : 'bad', 1500);
          if (what === 1) hud.subBanner('Juegos: ' + n[0] + ' ' + sc.games[0] + ' – ' + sc.games[1] + ' ' + n[1] + (sc.tb ? ' · Tie-break' : ''), 1700);
          else if (what === 2) hud.subBanner('Sets: ' + n[0] + ' ' + sc.sets[0] + ' – ' + sc.sets[1] + ' ' + n[1], 1700);
        }
      }, what ? 1000 : 500);
      break;
    }
    default:
  }
}
function processEvents(view) {
  const q = app.evQueue;
  while (q.length && q[0][1] <= view.tick + 0.01) fireEvent(q.shift(), view);
}

// ---------- interfaz durante el partido ----------
function openOverlay(name) { app.overlay = name; show(name); input.enabled = false; }
function closeOverlay() { app.overlay = null; app.localMenu = false; show(null); input.enabled = true; }
function showResult(view) {
  app.resultShown = true;
  const w = view.win, mine = w === app.me;
  const t = $('resTitle');
  t.textContent = mine ? '¡Ganaste!' : 'Ganó ' + app.names[w];
  t.className = mine ? 'win' : 'lose';
  $('resScore').textContent = view.sc.hist.map((h) => h[0] + '–' + h[1]).join('   ');
  $('resInfo').textContent = app.names[0] + '  vs  ' + app.names[1];
  $('btnRematch').disabled = false;
  $('btnRematch').textContent = 'Revancha';
  openOverlay('Result');
}
function togglePause(force) {
  if (!app.inGame) return;
  const v = app.lastView;
  if (!v || v.ph === PH.OVER) return;
  if (app.role === 'guest' && (!app.link || !app.link.up)) {
    // sin conexión: menú local para poder salir
    if (app.overlay) closeOverlay(); else { app.localMenu = true; openOverlay('Pause'); }
    return;
  }
  const want = force !== undefined ? force : !(v.pw & 3);
  if (app.role === 'host') { if (want) app.userPause[0] = true; else app.userPause = [false, false]; }
  else if (app.link) app.link.send(['pause', want ? 1 : 0]);
}
function updateHud(view, now) {
  const me = app.me, n = app.names;
  app.lastView = view;
  hud.board(view.sc, view.sv, app.cfg.sets > 1);

  // saque
  if (view.ph === PH.SERVE && !view.paused) {
    const p = view.p[view.sv];
    const second = view.sn === 2;
    if (view.sv === me) {
      if (p.st === ST.TOSS) hud.serve(3, p.t / (2 * S.TOSS_APEX), '¡Pulsa otra vez cuando la marca llegue al centro!');
      else hud.serve(2, 0, (second ? 'Segundo saque: ' : 'Tu saque: ') + (app.touch ? 'toca GOLPE para lanzar la pelota' : 'pulsa J o Espacio para lanzar la pelota'));
    } else hud.serve(1, 0, 'Saca ' + n[view.sv] + (second ? ' · segundo saque' : ''));
  } else hud.serve(0);

  // qué se juega en este punto
  if (view.ph !== app.prevPh) {
    if (view.ph === PH.SERVE && view.sn === 1) {
      const L = app.buf.latest() || view;
      const st = S.pointStakes(L.sc, app.cfg, L.sv);
      if (st) hud.subBanner(['', 'Punto de quiebre', 'Punto de set', 'Punto de partido'][st.what] + ' · ' + n[st.who], 2300);
    }
    app.prevPh = view.ph;
  }

  // pausa / desconexión
  const userPause = view.paused && (view.pw & 3) !== 0 && view.ph !== PH.OVER;
  if (userPause && app.overlay === null) { $('pauseTitle').textContent = 'Pausa'; openOverlay('Pause'); }
  else if (!userPause && !app.localMenu && (app.overlay === 'Pause' || (app.overlay === 'Help' && app.helpBack === 'Pause'))) closeOverlay();
  if (app.role === 'host') hud.net(view.pw & 4 ? 'Rival desconectado. Esperando que vuelva…' : null);

  // final
  if (view.ph === PH.OVER && !app.resultShown && view.pt > 1.4 && view.win >= 0) showResult(view);

  if (now - app.lastPingUi > 600) { app.lastPingUi = now; connUi(); }
}

// ---------- bucle ----------
function logic(now) {
  if (!app.inGame) return;
  if (app.role === 'host' && app.G) hostAdvance(now);
  else if (app.role === 'guest') guestAdvance(now);
}
let lastFrame = performance.now();
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  let dt = (now - lastFrame) / 1000;
  lastFrame = now;
  if (dt > 0.1) dt = 0.1;
  if (dt < 0) dt = 0;
  input.pollGamepad();
  if (DEBUG && app.poseTest) { renderer.renderPose(app.poseTest, dt); return; }
  let drawn = false;
  if (app.inGame) {
    logic(now);
    let view = null;
    if (app.role === 'host' && app.G) view = app.buf.at(app.G.tick - 1 + app.acc / TICK);
    else if (app.role === 'guest') view = app.buf.sample(now);
    if (view) {
      processEvents(view);
      const own = app.role === 'guest' ? predictMine(dt, now) : null;
      renderer.render(view, app.me, dt, own);
      updateHud(view, now);
      drawn = true;
    }
  }
  if (!drawn) renderer.renderIdle(dt);
}
// El navegador frena los cuadros (y los temporizadores normales) cuando la página no está a la vista.
// Un worker marca el ritmo para que la simulación y la red sigan a 60 Hz aunque no se esté dibujando.
try {
  const w = new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),8)'], { type: 'text/javascript' })));
  w.onmessage = () => logic(performance.now());
} catch (e) { /* sin workers: el ritmo lo marca solo el dibujo */ }

// Cada segundo: saludos pendientes y textos de estado.
setInterval(() => {
  const l = app.link;
  if (!l) return;
  if (l.up && ((app.role === 'guest' && !app.synced) || (app.role === 'host' && !app.peerHello))) sendHello();
  if (app.role === 'host' && app.screen === 'Host' && !l.up) {
    setStatus('hostStatus', l.ready ? 'Sala lista. Esperando a tu rival…' : 'Creando sala…', l.ready ? 'ok' : '');
  } else if (app.role === 'guest' && app.screen === 'Join' && !l.up) {
    const s = l.searching;
    setStatus('joinStatus', s > 12 ? 'Todavía no encuentro la sala ' + app.code + '. Revisa el código (sigo intentando)…' : 'Conectando con la sala ' + app.code + '…', s > 12 ? 'bad' : '');
  }
  if (app.inGame) keepAwake();
}, 1000);

// ---------- botones ----------
function on(id, fn) { $(id).addEventListener('click', (e) => { e.preventDefault(); sfx.unlock(); sfx.click(); fn(e); }); }
on('btnCreate', () => { if (app.touch) goFull(); createRoom(); });
on('btnJoin', () => { $('btnJoinGo').disabled = false; setStatus('joinStatus', ''); show('Join'); if (!app.touch) $('inCode').focus(); });
on('btnJoinGo', () => { if (app.touch) goFull(); joinRoom($('inCode').value); });
on('btnJoinCancel', () => leave());
on('btnHostCancel', () => leave());
on('btnLobbyExit', () => leave());
on('btnShare', async () => {
  const url = shareUrl();
  if (navigator.share) {
    try { await navigator.share({ title: 'Duelo Tenis', text: '¡Te reto a un partido de tenis! Entra a mi sala ' + app.code + ':', url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  hud.toast((await copyText(url)) ? 'Enlace copiado' : 'Copia el enlace a mano', 2200);
});
on('btnCopy', async () => { hud.toast((await copyText(shareUrl())) ? 'Enlace copiado' : 'Copia el enlace a mano', 2200); });
on('btnStart', () => startMatch());
for (const [id, key] of [['segLen', 'len'], ['segCourt', 'court']]) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || app.role !== 'host') return;
    sfx.unlock(); sfx.click();
    app[key] = Number(b.dataset.v) | 0;
    store.set('dt_' + key, String(app[key]));
    renderLobby(); sendLobby();
  });
}
on('btnHelp', () => { app.helpBack = 'Menu'; show('Help'); });
on('btnHelp2', () => { app.helpBack = 'Pause'; app.overlay = 'Help'; show('Help'); });
on('btnHelpBack', () => { if (app.helpBack === 'Pause') { app.overlay = 'Pause'; show('Pause'); } else show('Menu'); });
on('btnResume', () => { if (app.localMenu) closeOverlay(); else togglePause(false); });
on('btnSound', () => { sfx.setEnabled(!sfx.enabled); store.set('dt_snd', sfx.enabled ? '1' : '0'); $('btnSound').textContent = 'Sonido: ' + (sfx.enabled ? 'sí' : 'no'); });
on('btnFull', () => toggleFull());
on('btnQuit', () => leave());
on('btnResExit', () => leave());
on('btnRematch', () => {
  if (app.role === 'host') startMatch();
  else if (app.link && app.link.up) { app.link.send(['rematch']); $('btnRematch').disabled = true; $('btnRematch').textContent = 'Pidiendo revancha…'; }
});
on('btnRotate', () => goFull());
$('btnPause').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); sfx.unlock(); togglePause(); });
$('inCode').addEventListener('input', (e) => { e.target.value = cleanCode(e.target.value); });
$('inCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); joinRoom($('inCode').value); } });
$('inName').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

// ---------- arranque ----------
input.attachKeyboard();
input.attachTouch($('padZone'), $('dpad'), Array.from(document.querySelectorAll('#btns .tb')));
input.onpress = () => sfx.unlock();
input.onpause = () => {
  if (!app.inGame) return;
  if (app.overlay === 'Help') { app.overlay = 'Pause'; show('Pause'); return; }
  if (app.overlay === 'Result') return;
  if (app.localMenu) { closeOverlay(); return; }
  togglePause();
};
input.enabled = false;
window.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  if (e.pointerType === 'touch' && !app.touch) {
    app.touch = true;
    if (app.inGame) { $('touch').classList.remove('hidden'); $('keys').classList.add('hidden'); }
  }
}, true);
window.addEventListener('resize', checkRotate);
window.addEventListener('orientationchange', checkRotate);
document.addEventListener('fullscreenchange', checkRotate);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { lastFrame = performance.now(); if (app.inGame) keepAwake(); } });
document.addEventListener('contextmenu', (e) => { if (!/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) e.preventDefault(); });
document.addEventListener('gesturestart', (e) => e.preventDefault());

$('inName').value = cleanName(store.get('dt_name', ''), '');
sfx.setEnabled(store.get('dt_snd', '1') !== '0');
$('btnSound').textContent = 'Sonido: ' + (sfx.enabled ? 'sí' : 'no');
if (!(app.len >= 0 && app.len <= 2)) app.len = 1;
if (!(app.court >= 0 && app.court <= 2)) app.court = 0;
renderer.setCourt(app.court);

const sala = cleanCode(qs.get('sala') || '');
if (sala.length === 4 && qs.get('auto') !== 'host') {
  $('inCode').value = sala;
  $('btnJoinGo').textContent = 'Entrar a la sala ' + sala;
  show('Join');
} else show('Menu');

if (DEBUG) {
  window.__dt = {
    app, S, input, hud, renderer, sfx,
    async loadBot(opts) { const m = await import('../tests/bot.js'); app.bot = m.makeBot(opts || {}); return true; },
    point(w) { if (app.G) S.debugPoint(app.G, w); },
    startMatch, createRoom, joinRoom,
  };
  if (qs.get('name')) $('inName').value = cleanName(qs.get('name'), '');
  if (qs.has('touch')) app.touch = true;
  (async () => {
    if (qs.has('bot')) await window.__dt.loadBot({ seed: Number(qs.get('bot')) || 5, react: 0.3, posErr: 0.25, pressMin: 0.7, net: 0.3 });
    if (qs.get('auto') === 'host') {
      createRoom(sala.length === 4 ? sala : undefined);
      if (qs.has('autostart')) {
        const iv = setInterval(() => { if (app.screen === 'Lobby' && app.link && app.link.up) { clearInterval(iv); setTimeout(startMatch, 600); } }, 300);
      }
    } else if (qs.get('auto') === 'join' && sala.length === 4) joinRoom(sala);
  })();
}

requestAnimationFrame(frame);
