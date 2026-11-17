// Red: une a los dos jugadores con una "sala" (código de 4 letras).
//  1) Conexión directa WebRTC (PeerJS): la rápida. Sirve en la misma wifi y por internet.
//  2) Respaldo por brokers MQTT públicos: más lenta, solo si la directa no se logra.
// El objeto Link elige sola la mejor vía disponible y cambia si una se cae.
import { MqttLite } from './mqtt-lite.js';

const APP = 'duelotenis1';
const ICE = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
  ],
  sdpSemantics: 'unified-plan',
};
export const BROKERS = [
  { url: 'wss://test.mosquitto.org:8081/mqtt', hz: 20 },
  { url: 'wss://broker.hivemq.com:8884/mqtt', hz: 20 },
  { url: 'wss://broker.emqx.io:8084/mqtt', hz: 10 },
];

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export function makeCode() {
  let s = '';
  const rnd = new Uint32Array(4);
  (globalThis.crypto || { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 ** 32; } }).getRandomValues(rnd);
  for (let i = 0; i < 4; i++) s += LETTERS[rnd[i] % LETTERS.length];
  return s;
}
export function cleanCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ---------- vía directa (WebRTC con PeerJS) ----------
class PeerTransport {
  constructor(role, code) {
    this.name = 'p2p';
    this.role = role; this.code = code;
    this.hostId = APP + '-' + code;
    this.peer = null; this.conn = null;
    this.started = false; this.lastRx = 0;
    this.notFound = 0; this.sigUp = false; this.everOpen = false; this.dialing = null; this.orphan = null;
    this.timers = new Set();
    this.onopen = this.onclose = this.onmessage = this.onfatal = () => {};
  }
  _later(fn, ms) {
    const id = setTimeout(() => { this.timers.delete(id); if (this.started) fn(); }, ms);
    this.timers.add(id);
  }
  start() {
    if (this.started) return;
    this.started = true;
    this._mkPeer();
  }
  _mkPeer() {
    const Peer = globalThis.Peer;
    if (!Peer) { this.onfatal('nopeer'); return; }
    let peer;
    try {
      peer = this.role === 'host' ? new Peer(this.hostId, { debug: 0, config: ICE }) : new Peer({ debug: 0, config: ICE });
    } catch (e) { this._later(() => this._mkPeer(), 4000); return; }
    this.peer = peer;
    peer.on('open', () => { if (peer !== this.peer) return; this.sigUp = true; this.everOpen = true; if (this.role === 'guest') this._dial(); });
    peer.on('connection', (conn) => { if (peer === this.peer && this.role === 'host') this._adopt(conn); });
    const revive = (ms) => this._later(() => {
      if (peer !== this.peer) return;
      if (peer.destroyed) this._rebuild(0);
      else if (peer.disconnected) { try { peer.reconnect(); } catch (e) { this._rebuild(2000); } }
    }, ms);
    peer.on('disconnected', () => { if (peer !== this.peer) return; this.sigUp = false; revive(2000); });
    peer.on('close', () => { if (peer === this.peer) { this.sigUp = false; this._rebuild(3000); } });
    peer.on('error', (err) => {
      if (peer !== this.peer) return;
      const type = err && err.type;
      if (type === 'unavailable-id') {
        // Código ocupado: fatal solo si nunca llegamos a registrarlo; si ya era nuestro, se reintenta.
        if (this.everOpen) this._rebuild(5000); else this.onfatal('taken');
        return;
      }
      if (type === 'browser-incompatible') { this.onfatal('nowebrtc'); return; }
      if (type === 'peer-unavailable') {
        this.notFound++;
        if (this.dialing) { const d = this.dialing; this.dialing = null; try { d.close(); } catch (e) { /* nada */ } }
        this._later(() => this._dial(), 2500);
        return;
      }
      if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') { this.sigUp = false; revive(3000); }
    });
  }
  _rebuild(ms) {
    const old = this.peer;
    if (!old) return;
    this.peer = null;
    const hadConn = this.conn && this.conn.open;
    if (!hadConn) { try { old.destroy(); } catch (e) { /* nada */ } }
    else this.orphan = old; // la conexión directa sigue viva aunque el servidor de señalización caiga
    this._later(() => this._mkPeer(), ms);
  }
  _dial() {
    const peer = this.peer;
    if (!this.started || !peer || !peer.open || (this.conn && this.conn.open) || this.dialing) return;
    let conn;
    try { conn = peer.connect(this.hostId, { reliable: false, serialization: 'raw' }); } catch (e) { conn = null; }
    if (!conn) { this._later(() => this._dial(), 2500); return; }
    this.dialing = conn;
    this._adopt(conn);
    this._later(() => {
      if (this.dialing === conn) {
        this.dialing = null;
        if (!conn.open) { try { conn.close(); } catch (e) { /* nada */ } this._dial(); }
      }
    }, 12000);
  }
  _adopt(conn) {
    conn.on('open', () => {
      if (!this.started) { try { conn.close(); } catch (e) { /* nada */ } return; }
      const old = this.conn;
      this.conn = conn;
      if (this.dialing === conn) this.dialing = null;
      if (old && old !== conn) { try { old.close(); } catch (e) { /* nada */ } }
      this.lastRx = now();
      this.onopen();
    });
    conn.on('data', (d) => { if (conn === this.conn && typeof d === 'string') this.onmessage(d); });
    conn.on('close', () => {
      if (this.dialing === conn) this.dialing = null;
      if (conn === this.conn) {
        this.conn = null;
        this.onclose();
        if (this.role === 'guest') this._later(() => this._dial(), 1200);
      }
    });
    conn.on('error', () => {});
  }
  isOpen() { return !!(this.conn && this.conn.open); }
  send(str) {
    const c = this.conn;
    if (!c || !c.open) return false;
    try {
      const dc = c.dataChannel;
      if (dc && dc.bufferedAmount > 300000) return false; // atasco: mejor saltar que acumular retraso
      c.send(str);
      return true;
    } catch (e) { return false; }
  }
  // 'directa' o 'relé TURN' (para mostrar en pantalla)
  async kind() {
    try {
      const pc = this.conn && this.conn.peerConnection;
      if (!pc) return '';
      const stats = await pc.getStats();
      let pair = null;
      stats.forEach((r) => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId); });
      if (!pair) stats.forEach((r) => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
      if (!pair) return '';
      const loc = stats.get(pair.localCandidateId), rem = stats.get(pair.remoteCandidateId);
      const relay = (loc && loc.candidateType === 'relay') || (rem && rem.candidateType === 'relay');
      return relay ? 'turn' : 'direct';
    } catch (e) { return ''; }
  }
  stop() {
    this.started = false;
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    try { if (this.conn) this.conn.close(); } catch (e) { /* nada */ }
    this.conn = null; this.dialing = null;
    for (const p of [this.peer, this.orphan]) { try { if (p) p.destroy(); } catch (e) { /* nada */ } }
    this.peer = null; this.orphan = null;
  }
}

// ---------- vía de respaldo (MQTT por WebSocket) ----------
class RelayTransport {
  constructor(role, code, brokers = BROKERS) {
    this.name = 'relay';
    this.role = role; this.code = code;
    const base = APP + '/' + code;
    this.inbox = base + (role === 'host' ? '/h' : '/g');
    this.outbox = base + (role === 'host' ? '/g' : '/h');
    this.sid = Math.random().toString(36).slice(2, 10);
    this.slots = brokers.map((b, i) => ({ i, url: b.url, hz: b.hz, c: null, ok: false, busy: false }));
    this.active = null; this.cands = []; this.pickTimer = null;
    this.started = false; this.lastRx = 0; this.hellos = 0;
    this.timers = new Set(); this.helloTimer = null;
    this.onopen = this.onclose = this.onmessage = this.onfatal = () => {};
  }
  _later(fn, ms) {
    const id = setTimeout(() => { this.timers.delete(id); if (this.started) fn(); }, ms);
    this.timers.add(id);
  }
  start() {
    if (this.started) return;
    this.started = true;
    for (const s of this.slots) this._connect(s);
    this.helloTimer = setInterval(() => this._beat(), 1000);
  }
  _connect(slot) {
    if (!this.started || slot.busy || slot.ok) return;
    slot.busy = true;
    const c = new MqttLite(slot.url);
    slot.c = c;
    c.connect(9000).then(() => c.subscribe(this.inbox)).then(() => {
      slot.busy = false;
      if (!this.started || slot.c !== c) { c.close(); return; }
      slot.ok = true;
      c.onmessage = (t, p) => this._rx(slot, p);
      c.onclose = () => this._lost(slot);
      this._beat();
    }).catch(() => {
      slot.busy = false;
      try { c.close(); } catch (e) { /* nada */ }
      if (slot.c === c) slot.c = null;
      this._later(() => this._connect(slot), 5000);
    });
  }
  _lost(slot) {
    slot.ok = false; slot.c = null;
    if (slot === this.active) { this.active = null; this.onclose(); }
    this._later(() => this._connect(slot), 3000);
  }
  _stale() { return !this.active || now() - this.lastRx > 4000; }
  _beat() {
    if (!this.started) return;
    if (this.role === 'guest') {
      if (this.active && this._stale()) { this.active = null; this.onclose(); }
      if (!this.active) {
        this.hellos++;
        for (const s of this.slots) if (s.ok) s.c.publish(this.outbox, 'H' + this.sid);
      }
    }
  }
  _rx(slot, p) {
    const k = p[0];
    if (k === 'D') {
      if (slot === this.active) { this.lastRx = now(); this.onmessage(p.slice(1)); }
      return;
    }
    if (this.role === 'host' && k === 'H') {
      if (slot === this.active) { slot.c.publish(this.outbox, 'W' + this.sid); return; }
      if (this.active && !this._stale()) return; // ya enlazado por otro broker que funciona
      if (!this.cands.includes(slot)) this.cands.push(slot);
      if (!this.pickTimer) this.pickTimer = setTimeout(() => this._pick(), 300);
    } else if (this.role === 'guest' && k === 'W') {
      if (!this.active) { this.active = slot; this.lastRx = now(); this.onopen(); }
    }
  }
  _pick() {
    this.pickTimer = null;
    if (!this.started) return;
    const c = this.cands.filter((s) => s.ok).sort((a, b) => a.i - b.i)[0];
    this.cands = [];
    if (!c) return;
    const had = this.active;
    this.active = c; this.lastRx = now();
    c.c.publish(this.outbox, 'W' + this.sid);
    if (had && had !== c) this.onclose();
    this.onopen();
  }
  isOpen() { return !!(this.active && this.active.ok); }
  get hz() { return this.active ? this.active.hz : 20; }
  send(str) {
    const a = this.active;
    if (!a || !a.ok) return false;
    if (a.c.buffered > 200000) return false;
    return a.c.publish(this.outbox, 'D' + str);
  }
  async kind() { return 'relay'; }
  stop() {
    this.started = false;
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    if (this.helloTimer) clearInterval(this.helloTimer);
    if (this.pickTimer) clearTimeout(this.pickTimer);
    this.helloTimer = this.pickTimer = null;
    for (const s of this.slots) { try { if (s.c) s.c.close(); } catch (e) { /* nada */ } s.c = null; s.ok = false; }
    this.active = null;
  }
}

// ---------- enlace: combina las vías ----------
export class Link {
  // opts: { role: 'host'|'guest', code, mode: 'auto'|'p2p'|'relay', sim: { lag, jit, loss } }
  constructor(opts) {
    this.role = opts.role; this.code = opts.code;
    this.sim = opts.sim && (opts.sim.lag || opts.sim.jit || opts.sim.loss) ? opts.sim : null;
    this.ts = [];
    const mode = opts.mode || 'auto';
    if (mode !== 'relay') this.ts.push(new PeerTransport(this.role, this.code));
    if (mode !== 'p2p') this.ts.push(new RelayTransport(this.role, this.code));
    this.active = null; this.up = false; this.rtt = 0; this.kind = '';
    this.startedAt = 0; this.timer = null; this.lastPing = 0;
    this.onup = this.ondown = this.onmessage = this.onfatal = this.onchange = () => {};
    for (const t of this.ts) {
      t.onopen = () => { t.lastRx = now(); this._pick(); };
      t.onclose = () => this._pick();
      t.onmessage = (str) => this._rx(t, str);
      t.onfatal = (code) => this.onfatal(code);
    }
  }
  start() {
    this.startedAt = now();
    for (const t of this.ts) t.start();
    this.timer = setInterval(() => this._tick(), 250);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const t of this.ts) t.stop();
    this.active = null; this.up = false;
  }
  get via() { return this.active ? this.active.name : null; }
  // ¿La sala ya está registrada en algún servidor (lista para que entre el rival)?
  get ready() { return this.ts.some((t) => (t.name === 'p2p' ? t.sigUp : t.slots.some((s) => s.ok))); }
  // Frecuencia recomendada (Hz) para estados y entradas en la vía actual.
  get hz() { return this.active && this.active.name === 'relay' ? this.active.hz : 60; }
  // Segundos buscando al otro jugador sin éxito.
  get searching() { return this.up ? 0 : (now() - this.startedAt) / 1000; }
  send(msg) {
    const t = this.active;
    return t ? t.send(JSON.stringify(msg)) : false;
  }
  _rx(t, str) {
    if (this.sim) {
      if (this.sim.loss && (str.startsWith('["s"') || str.startsWith('["i"')) && Math.random() < this.sim.loss) return;
      const d = (this.sim.lag || 0) + Math.random() * (this.sim.jit || 0);
      setTimeout(() => this._rx2(t, str), d);
    } else this._rx2(t, str);
  }
  _rx2(t, str) {
    let msg;
    try { msg = JSON.parse(str); } catch (e) { return; }
    if (!Array.isArray(msg)) return;
    t.lastRx = now();
    if (msg[0] === '~p') { t.send(JSON.stringify(['~q', msg[1]])); return; }
    if (msg[0] === '~q') {
      if (t === this.active) { const r = now() - msg[1]; this.rtt = this.rtt ? this.rtt + (r - this.rtt) * 0.2 : r; }
      return;
    }
    if (!this.up) this._pick();
    this.onmessage(msg);
  }
  _tick() {
    const t0 = now();
    if (t0 - this.lastPing >= 480) {
      this.lastPing = t0;
      const ping = JSON.stringify(['~p', t0]);
      for (const t of this.ts) if (t.isOpen()) t.send(ping);
    }
    this._pick();
  }
  _pick() {
    const t0 = now();
    let best = null;
    for (const t of this.ts) if (t.isOpen() && t0 - t.lastRx < 3200) { best = t; break; }
    if (best !== this.active) {
      this.active = best; this.rtt = 0; this.kind = '';
      if (best) best.kind().then((k) => { if (this.active === best) { this.kind = k; this.onchange(); } });
      this.onchange();
    }
    const up = !!best;
    if (up !== this.up) { this.up = up; if (up) this.onup(); else this.ondown(); }
  }
}
