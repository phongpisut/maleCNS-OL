// Headless work-shift learning test on the connectome brain:
//   node tools/learn-test.js [dream-minutes]
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const D = path.join(__dirname, '..', 'data');
require('../js/world.js'); require('../js/flybrain.js');
(async () => {
  const mins = +(process.argv[2] || 30);
  const bin = zlib.gunzipSync(fs.readFileSync(path.join(D, 'circuit.bin.gz')));
  const circuit = JSON.parse(fs.readFileSync(path.join(D, 'circuit.json'), 'utf8'));
  const cfg = { motorFeatures: FB.MOTOR_FEATURES, motorActions: FB.MOTOR_ACTIONS, socialFeatures: FB.SOCIAL_FEATURES, socialActions: FB.SOCIAL_ACTIONS };
  const brain = await ConnectomeBrain.create(fs.readFileSync(path.join(D, 'flybrain.wasm')), bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength), circuit, cfg);
  const w = new World(brain, { headless: true, mode: 'shift' });
  const t0 = Date.now(), steps = (mins * 60) / 0.05, blocks = 6;
  for (let b = 0; b < blocks; b++) {
    const s0 = { ...w.stats };
    for (let i = 0; i < steps / blocks; i++) w.step(0.05);
    const st = w.stats;
    console.log(`block ${b}: filed ${st.done - s0.done} · shredded ${st.shredded - s0.shredded} · mistakes ${st.mistakes - s0.mistakes} · coffees ${st.coffees - s0.coffees} · money ${w.money}`);
  }
  const names = FB.MOTOR_ACTIONS.map((a) => a.id);
  const base = { holding: 0, important: 0, memo: 0, copied: 0, signed: 0, inbox: 1, energy: 0.8, atOffice: 1, cursorNear: 0, affection: 0.35 };
  const probe = (s) => { const q = brain.motor.peek({ ...base, ...s }); return names[q.indexOf(Math.max(...q))] + '(' + Math.max(...q).toFixed(2) + ')'; };
  console.log('decisions', w.stats.decisions, 'secs', ((Date.now() - t0) / 1000).toFixed(1));
  console.log('empty-handed', probe({}), '| imp new', probe({ holding: 1, important: 1 }), '| imp copied', probe({ holding: 1, important: 1, copied: 1 }),
    '| imp signed', probe({ holding: 1, important: 1, signed: 1 }), '| imp both', probe({ holding: 1, important: 1, copied: 1, signed: 1 }),
    '| memo', probe({ holding: 1, memo: 1 }), '| tired', probe({ energy: 0.1 }));
})();
