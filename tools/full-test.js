// Compares circuit mode and whole-brain mode: node --max-old-space-size=4096 tools/full-test.js
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const D = path.join(__dirname, '..', 'data');
require('../js/world.js'); require('../js/flybrain.js');
const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
(async () => {
  const wasm = fs.readFileSync(path.join(D, 'flybrain.wasm'));
  const circuitBin = ab(zlib.gunzipSync(fs.readFileSync(path.join(D, 'circuit.bin.gz'))));
  const circuit = JSON.parse(fs.readFileSync(path.join(D, 'circuit.json'), 'utf8'));
  const cfg = { motorFeatures: FB.MOTOR_FEATURES, motorActions: FB.MOTOR_ACTIONS, socialFeatures: FB.SOCIAL_FEATURES, socialActions: FB.SOCIAL_ACTIONS };
  const base = { holding: 0, important: 0, memo: 0, copied: 0, signed: 0, inbox: 1, energy: 0.8, atOffice: 1, cursorNear: 0, affection: 0.4 };
  const states = [['empty-handed', {}], ['important', { holding: 1, important: 1 }], ['memo', { holding: 1, memo: 1 }]];
  for (const full of [false, true]) {
    const t0 = Date.now();
    const opts = full ? { fullBin: ab(zlib.gunzipSync(fs.readFileSync(path.join(D, 'fullbrain.bin.gz')))) } : {};
    const brain = await ConnectomeBrain.create(wasm, circuitBin.slice(0), circuit, cfg, opts);
    const mem = (brain.ex.memory.buffer.byteLength / 1e6).toFixed(0);
    console.log(`\n== ${full ? 'WHOLE BRAIN' : 'learning circuit'}: ${brain.n.toLocaleString()} neurons, ${brain.m.toLocaleString()} connections, plastic ${brain.nPlastic}, WASM memory ${mem} MB, load ${Date.now() - t0} ms`);
    const kcs = brain.circuit.simIdx.filter((s, li) => circuit.neurons[li][5] === 'KC');
    for (const [label, s] of states) {
      const t1 = process.hrtime.bigint();
      brain.motor.perceive({ ...base, ...s });
      const ms = Number(process.hrtime.bigint() - t1) / 1e6;
      const w = brain.win; let fired = 0, kcOn = 0;
      for (let i = 0; i < brain.n; i++) if (w[i]) fired++;
      for (const i of kcs) if (w[i]) kcOn++;
      console.log(`  ${label.padEnd(13)} ${ms.toFixed(1).padStart(6)} ms/decision · neurons firing ${fired.toLocaleString()} · KCs ${kcOn}/${kcs.length}`);
    }
    const t2 = process.hrtime.bigint(); const sp = brain.idle(60); const idleMs = Number(process.hrtime.bigint() - t2) / 1e6;
    console.log(`  idle frame (6 ms simulated): ${idleMs.toFixed(1)} ms, ${sp} spikes`);
    if (!full) global.trained = (brain.motor.perceive({ ...base }), brain.motor.teach(2, 0.8), brain.toJSON());
    else { brain.load(global.trained); brain.motor.perceive({ ...base }); const q = Array.from(brain.motor.q); console.log(`  circuit-trained brain loaded into whole brain → best action: ${FB.MOTOR_ACTIONS[q.indexOf(Math.max(...q))].label} (${Math.max(...q).toFixed(2)})`); }
  }
})();
