// Cliente MQTT 3.1.1 mínimo sobre WebSocket (solo QoS 0). Se usa como canal de respaldo
// cuando la conexión directa (WebRTC) entre los dos jugadores no se puede establecer.

const enc = new TextEncoder();
const dec = new TextDecoder();

function varLen(n) {
  const out = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 128;
    out.push(b);
  } while (n > 0);
  return out;
}
function str(s) {
  const b = enc.encode(s);
  const out = new Uint8Array(2 + b.length);
  out[0] = b.length >> 8; out[1] = b.length & 255;
  out.set(b, 2);
  return out;
}
function packet(type, ...parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const vl = varLen(len);
  const out = new Uint8Array(1 + vl.length + len);
  out[0] = type;
  out.set(vl, 1);
  let o = 1 + vl.length;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export class MqttLite {
  constructor(url, opts = {}) {
    this.url = url;
    this.clientId = opts.clientId || 'dt' + Math.random().toString(36).slice(2, 12);
    this.keepAlive = opts.keepAlive || 30;
    this.WS = opts.WebSocketImpl || globalThis.WebSocket;
    this.ws = null;
    this.connected = false;
    this.buf = new Uint8Array(0);
    this.pid = 1;
    this.subs = new Map();
    this.lastRx = 0;
    this.timer = null;
    this.onmessage = null; // (topic, payloadString)
    this.onclose = null;
  }

  connect(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      let done = false;
      const fail = (why) => { if (!done) { done = true; clearTimeout(to); this._teardown(); reject(new Error(why)); } };
      const to = setTimeout(() => fail('timeout'), timeoutMs);
      let ws;
      try { ws = new this.WS(this.url, 'mqtt'); } catch (e) { fail('ws: ' + e.message); return; }
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        const vh = new Uint8Array([0, 4, 77, 81, 84, 84, 4, 2, this.keepAlive >> 8, this.keepAlive & 255]);
        ws.send(packet(0x10, vh, str(this.clientId)));
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') return;
        this.lastRx = Date.now();
        this._feed(new Uint8Array(ev.data), (rc) => {
          if (done) return;
          if (rc === 0) {
            done = true; clearTimeout(to);
            this.connected = true;
            this.timer = setInterval(() => this._tick(), 5000);
            resolve();
          } else fail('connack ' + rc);
        });
      };
      ws.onerror = () => fail('error');
      ws.onclose = () => {
        if (!done) { fail('closed'); return; }
        const was = this.connected;
        this._teardown();
        if (was && this.onclose) this.onclose();
      };
    });
  }

  _tick() {
    if (!this.connected) return;
    if (Date.now() - this.lastRx > this.keepAlive * 1500) { this.close(); if (this.onclose) this.onclose(); return; }
    try { this.ws.send(new Uint8Array([0xc0, 0])); } catch (e) { /* se detecta por onclose */ }
  }

  _feed(chunk, onConnack) {
    let buf;
    if (this.buf.length) { buf = new Uint8Array(this.buf.length + chunk.length); buf.set(this.buf); buf.set(chunk, this.buf.length); }
    else buf = chunk;
    let o = 0;
    for (;;) {
      if (buf.length - o < 2) break;
      let len = 0, mul = 1, i = o + 1, ok = false;
      for (; i < buf.length && i < o + 5; i++) {
        const b = buf[i];
        len += (b & 127) * mul; mul *= 128;
        if (!(b & 128)) { ok = true; i++; break; }
      }
      if (!ok) break;
      if (buf.length - i < len) break;
      this._handle(buf[o], buf.subarray(i, i + len), onConnack);
      o = i + len;
    }
    this.buf = o < buf.length ? buf.slice(o) : new Uint8Array(0);
  }

  _handle(b0, body, onConnack) {
    const type = b0 >> 4;
    if (type === 2) { if (onConnack) onConnack(body[1]); }
    else if (type === 3) {
      const qos = (b0 >> 1) & 3;
      const tl = (body[0] << 8) | body[1];
      const topic = dec.decode(body.subarray(2, 2 + tl));
      const start = 2 + tl + (qos > 0 ? 2 : 0);
      if (this.onmessage) this.onmessage(topic, dec.decode(body.subarray(start)));
    } else if (type === 9) {
      const id = (body[0] << 8) | body[1];
      const cb = this.subs.get(id);
      if (cb) { this.subs.delete(id); cb(body[2] !== 0x80); }
    }
  }

  subscribe(topic, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      if (!this.connected) { reject(new Error('not connected')); return; }
      const id = this.pid++ & 0xffff || this.pid++;
      const to = setTimeout(() => { this.subs.delete(id); reject(new Error('suback timeout')); }, timeoutMs);
      this.subs.set(id, (ok) => { clearTimeout(to); ok ? resolve() : reject(new Error('suback refused')); });
      this.ws.send(packet(0x82, new Uint8Array([id >> 8, id & 255]), str(topic), new Uint8Array([0])));
    });
  }

  publish(topic, payload) {
    if (!this.connected || this.ws.readyState !== 1) return false;
    try { this.ws.send(packet(0x30, str(topic), enc.encode(payload))); return true; } catch (e) { return false; }
  }

  get buffered() { return this.ws ? this.ws.bufferedAmount : 0; }

  _teardown() {
    this.connected = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try { ws.close(); } catch (e) { /* ya cerrado */ }
    }
  }

  close() {
    if (this.connected && this.ws && this.ws.readyState === 1) { try { this.ws.send(new Uint8Array([0xe0, 0])); } catch (e) { /* nada */ } }
    this._teardown();
  }
}
