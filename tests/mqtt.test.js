// Prueba real del canal de respaldo contra brokers MQTT públicos: node tests/mqtt.test.js
import { MqttLite } from '../js/mqtt-lite.js';

const brokers = process.argv.length > 2 ? process.argv.slice(2) : [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];
const room = 'duelotenis-test/' + Math.random().toString(36).slice(2, 8);

async function probe(url) {
  const a = new MqttLite(url), b = new MqttLite(url);
  const t0 = Date.now();
  try {
    await Promise.all([a.connect(), b.connect()]);
    const tc = Date.now() - t0;
    await Promise.all([a.subscribe(room + '/a'), b.subscribe(room + '/b')]);
    const rtts = [];
    let lost = 0;
    b.onmessage = (t, p) => b.publish(room + '/a', p); // eco
    const N = 40;
    await new Promise((res) => {
      let got = 0;
      a.onmessage = (t, p) => { rtts.push(Date.now() - Number(p.split('|')[0])); if (++got === N) res(); };
      let n = 0;
      const iv = setInterval(() => { a.publish(room + '/b', Date.now() + '|' + 'x'.repeat(300)); if (++n === N) clearInterval(iv); }, 33);
      setTimeout(() => { lost = N - got; res(); }, 6000);
    });
    rtts.sort((x, y) => x - y);
    console.log(`${url}\n   conecta en ${tc} ms | ida y vuelta: min ${rtts[0]} med ${rtts[rtts.length >> 1]} max ${rtts[rtts.length - 1]} ms | perdidos ${lost}/${N}`);
  } catch (e) {
    console.log(`${url}\n   FALLA: ${e.message}`);
  } finally { a.close(); b.close(); }
}
for (const u of brokers) await probe(u);
process.exit(0);
