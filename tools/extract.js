// Extracts Fly Buddy's brain from the MaleCNS v1.0 connectome.
//
//   node tools/extract.js      (needs tools/raw/*, see tools/README.md)
//
// Output (into ../data):
//   circuit.bin.gz  — the simulated mushroom-body circuit, outgoing CSR
//   circuit.json    — neuron roles: glomeruli (inputs), DANs, readout MBONs
//   brainmap.bin.gz — 2D soma positions + type of every neuron, for the map
//   brainmap.json   — type / superclass string tables
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const loadGraph = require('./load-graph');
const OUT = path.join(__dirname, '..', 'data');
fs.mkdirSync(OUT, { recursive: true });

const g = loadGraph();
const N = g.neurons; // [bodyId, type, superclass, side, transmitter, sign, [x,y,z]]

function roleOf(t) {
  if (!t) return null;
  if (/^KC/.test(t)) return 'KC';
  if (/_[a-z]*PN$/.test(t)) return 'PN';
  if (t === 'APL' || t === 'DPM') return t;
  if (/^MBON/.test(t)) return 'MBON';
  if (/^PAM/.test(t)) return 'PAM';
  if (/^PPL1/.test(t)) return 'PPL1';
  return null;
}

// --- choose the circuit ---
const globalIdx = [];
N.forEach((r, i) => { if (roleOf(r[1])) globalIdx.push(i); });
const local = new Int32Array(g.n).fill(-1);
globalIdx.forEach((gi, li) => { local[gi] = li; });
const n = globalIdx.length;

// --- outgoing CSR within the circuit (source data is incoming CSR) ---
const outDeg = new Uint32Array(n);
for (let li = 0; li < n; li++) {
  const j = globalIdx[li];
  for (let e = g.offsets[j]; e < g.offsets[j + 1]; e++) { const s = local[g.sources[e]]; if (s >= 0) outDeg[s]++; }
}
const offsets = new Uint32Array(n + 1);
for (let i = 0; i < n; i++) offsets[i + 1] = offsets[i] + outDeg[i];
const m = offsets[n];
const targets = new Uint16Array(m), counts = new Uint8Array(m), cursor = offsets.slice(0, n);
for (let li = 0; li < n; li++) {
  const j = globalIdx[li];
  for (let e = g.offsets[j]; e < g.offsets[j + 1]; e++) {
    const s = local[g.sources[e]]; if (s < 0) continue;
    const k = cursor[s]++;
    targets[k] = li; counts[k] = Math.min(255, g.counts[e]);
  }
}
// keep each neuron's targets sorted (deterministic accumulation order)
for (let i = 0; i < n; i++) {
  const a = offsets[i], b = offsets[i + 1];
  const pairs = []; for (let k = a; k < b; k++) pairs.push([targets[k], counts[k]]);
  pairs.sort((x, y) => x[0] - y[0]);
  pairs.forEach(([t, c], q) => { targets[a + q] = t; counts[a + q] = c; });
}
const sign = new Int8Array(n);
globalIdx.forEach((gi, li) => { sign[li] = N[gi][5]; });

const header = new Uint32Array([0x31434246 /* FBC1 */, n, m]);
const blob = Buffer.concat([Buffer.from(header.buffer), Buffer.from(offsets.buffer), Buffer.from(targets.buffer), Buffer.from(counts.buffer), Buffer.from(sign.buffer)]);
fs.writeFileSync(path.join(OUT, 'circuit.bin.gz'), zlib.gzipSync(blob, { level: 9 }));

// --- roles ---
const byType = {};
globalIdx.forEach((gi, li) => { (byType[N[gi][1]] = byType[N[gi][1]] || []).push(li); });

// Input channels: the largest uniglomerular PN types, one glomerulus per feature bin.
const glomeruli = Object.keys(byType).filter((t) => roleOf(t) === 'PN')
  .sort((a, b) => byType[b].length - byType[a].length || a.localeCompare(b))
  .map((t) => ({ type: t, idx: byType[t] }));

// Readouts: MBON types with the broadest KC input; their KC→MBON synapses are plastic.
const MOTOR = [['rest', 'MBON01'], ['wander', 'MBON12'], ['take', 'MBON11'], ['copy', 'MBON22'], ['sign', 'MBON02'], ['shred', 'MBON09'], ['file', 'MBON06'], ['coffee', 'MBON32'], ['follow', 'MBON30']];
const SOCIAL = [['giggle', 'MBON07'], ['shy', 'MBON14'], ['pout', 'MBON18'], ['cry', 'MBON05'], ['love', 'MBON21'], ['shock', 'MBON04']];
const ro = (list) => list.map(([action, type]) => { if (!byType[type]) throw Error('missing ' + type); return { action, type, idx: byType[type] }; });

const neurons = globalIdx.map((gi) => { const r = N[gi]; return [gi, r[0], r[1], r[3], r[4], roleOf(r[1])]; });
const circuit = {
  dataset: g.manifest.dataset,
  attribution: g.manifest.attribution,
  n, edges: m,
  neurons,
  glomeruli,
  readouts: { motor: ro(MOTOR), social: ro(SOCIAL) },
  dans: { PAM: neurons.map((r, i) => (r[5] === 'PAM' ? i : -1)).filter((i) => i >= 0), PPL1: neurons.map((r, i) => (r[5] === 'PPL1' ? i : -1)).filter((i) => i >= 0) },
  apl: byType.APL, dpm: byType.DPM,
};
fs.writeFileSync(path.join(OUT, 'circuit.json'), JSON.stringify(circuit));

// --- brain map: every neuron's soma, projected like a front view of the brain ---
const ang = (25 * Math.PI) / 180, sin = Math.sin(ang), cos = Math.cos(ang);
const CX = -48075.5, CY = 37479.77, SX = 91000, SY = 41200;
const typeIds = new Map(), types = [], classIds = new Map(), classes = [];
const id = (map, arr, k) => { if (!map.has(k)) { map.set(k, arr.length); arr.push(k); } return map.get(k); };
const U = new Uint16Array(g.n), V = new Uint16Array(g.n), T = new Uint16Array(g.n), S = new Uint8Array(g.n), C = new Uint8Array(g.n), B = new Uint32Array(g.n);
N.forEach((r, i) => {
  const p = r[6];
  T[i] = id(typeIds, types, r[1] || ''); C[i] = id(classIds, classes, r[2] || ''); B[i] = r[0];
  S[i] = r[3] === 'L' ? 1 : r[3] === 'R' ? 2 : 0;
  if (!p || p[2] > 58000 || p[2] < 9000) { U[i] = 65535; V[i] = 65535; return; }
  const u = (-p[0] - CX) / SX + 0.5, v = (p[1] * sin + p[2] * cos - CY) / SY + 0.5;
  U[i] = Math.max(0, Math.min(65534, Math.round(u * 65534)));
  V[i] = Math.max(0, Math.min(65534, Math.round(v * 65534)));
});
const mapBlob = Buffer.concat([Buffer.from(new Uint32Array([0x314d4246 /* FBM1 */, g.n]).buffer), Buffer.from(B.buffer), Buffer.from(U.buffer), Buffer.from(V.buffer), Buffer.from(T.buffer), Buffer.from(S.buffer), Buffer.from(C.buffer)]);
fs.writeFileSync(path.join(OUT, 'brainmap.bin.gz'), zlib.gzipSync(mapBlob, { level: 9 }));
fs.writeFileSync(path.join(OUT, 'brainmap.json'), JSON.stringify({ n: g.n, aspect: SX / SY, types, classes }));

const sz = (f) => (fs.statSync(path.join(OUT, f)).size / 1e6).toFixed(2) + ' MB';
console.log(`circuit: ${n} neurons, ${m} connections (${sz('circuit.bin.gz')})`);
console.log(`brain map: ${g.n} neurons (${sz('brainmap.bin.gz')}), ${types.length} types`);
console.log(`glomeruli available: ${glomeruli.length}`);
