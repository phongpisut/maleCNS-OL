// Activity check for the connectome circuit: node tools/tune.js
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const D = path.join(__dirname, '..', 'data');
require('../js/world.js'); require('../js/flybrain.js');

(async () => {
  const bin = zlib.gunzipSync(fs.readFileSync(path.join(D, 'circuit.bin.gz')));
  const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
  const circuit = JSON.parse(fs.readFileSync(path.join(D, 'circuit.json'), 'utf8'));
  const cfg = { motorFeatures: FB.MOTOR_FEATURES, motorActions: FB.MOTOR_ACTIONS, socialFeatures: FB.SOCIAL_FEATURES, socialActions: FB.SOCIAL_ACTIONS };
  const brain = await ConnectomeBrain.create(fs.readFileSync(path.join(D, 'flybrain.wasm')), buf, circuit, cfg);
  console.log('neurons', brain.n, 'edges', brain.m, 'plastic synapses', brain.nPlastic);

  const roleIdx = {}; circuit.neurons.forEach((r, i) => (roleIdx[r[5]] = roleIdx[r[5]] || []).push(i));
  const MB = { holding: 0, important: 0, memo: 0, copied: 0, signed: 0, inbox: 1, energy: 0.8, atOffice: 1, cursorNear: 0, affection: 0.4 };
  const SB = { pet: 0, scold: 0, food: 0, affection: 0.4, energy: 0.7, streak: 0 };
  const sets = {};
  function report(label, lobe, sense) {
    const t0 = process.hrtime.bigint();
    lobe.perceive(sense);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const w = brain.win, row = [];
    for (const r of ['PN', 'KC', 'APL', 'MBON', 'PAM', 'PPL1']) {
      const idx = roleIdx[r]; let act = 0, spk = 0;
      for (const i of idx) { if (w[i]) act++; spk += w[i]; }
      row.push(`${r} ${act}/${idx.length} (${spk}sp)`);
    }
    const kcs = new Set(roleIdx.KC.filter((i) => w[i])); sets[label] = kcs;
    console.log(label.padEnd(14), ms.toFixed(1) + 'ms', row.join(' | '), 'q', Array.from(lobe.q).map((x) => x.toFixed(2)).join(' '), 'in', Array.from(lobe.input).map((x) => x.toFixed(0)).join(' '));
  }
  report('empty-handed', brain.motor, { ...MB });
  report('important', brain.motor, { ...MB, holding: 1, important: 1 });
  report('imp copied', brain.motor, { ...MB, holding: 1, important: 1, copied: 1 });
  report('memo', brain.motor, { ...MB, holding: 1, memo: 1 });
  report('pat', brain.social, { ...SB, pet: 1 });
  report('scold', brain.social, { ...SB, scold: 1 });
  report('food', brain.social, { ...SB, food: 1 });
  const ov = (a, b) => { const A = sets[a], B = sets[b]; let c = 0; for (const x of A) if (B.has(x)) c++; return (c / Math.max(1, Math.min(A.size, B.size))).toFixed(2); };
  console.log('KC overlap: important/memo', ov('important', 'memo'), 'important/copied', ov('important', 'imp copied'), 'pat/scold', ov('pat', 'scold'), 'pat/food', ov('pat', 'food'));
})();
