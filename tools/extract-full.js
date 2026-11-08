// Packs the WHOLE MaleCNS connectome (166,700 neurons, 25.6 M connections) for
// Fruity OL's optional whole-brain mode.
//
//   node --max-old-space-size=4096 tools/extract-full.js   (needs tools/raw, see fetch-connectome.js)
//
// data/fullbrain.bin.gz layout (little-endian, then gzipped):
//   u32 magic 'FBW1', u32 n, u32 m, u32 degBytes, u32 tgtBytes
//   degBytes  — LEB128 varint out-degree of every neuron (in brain-map order)
//   tgtBytes  — per neuron, its targets sorted ascending, stored as varint gaps
//   m bytes   — synapse count per connection (capped at 255)
//   n bytes   — fast-transmitter sign per neuron (int8: +1 ACh, −1 GABA/Glu, 0 other)
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const loadGraph = require('./load-graph');
const OUT = path.join(__dirname, '..', 'data', 'fullbrain.bin.gz');

const g = loadGraph();
const n = g.n, m = g.sources.length;

// incoming CSR → outgoing CSR (targets come out sorted because j ascends)
const deg = new Uint32Array(n);
for (let e = 0; e < m; e++) deg[g.sources[e]]++;
const off = new Uint32Array(n + 1);
for (let i = 0; i < n; i++) off[i + 1] = off[i] + deg[i];
const cur = off.slice(0, n), tgt = new Uint32Array(m), cnt = new Uint8Array(m);
for (let j = 0; j < n; j++) for (let e = g.offsets[j]; e < g.offsets[j + 1]; e++) {
  const k = cur[g.sources[e]]++;
  tgt[k] = j; cnt[k] = Math.min(255, g.counts[e]);
}

function varints(count, get) {
  const out = Buffer.alloc(count * 5); let o = 0;
  for (let i = 0; i < count; i++) {
    let v = get(i);
    while (v >= 0x80) { out[o++] = (v & 0x7f) | 0x80; v >>>= 7; }
    out[o++] = v;
  }
  return out.subarray(0, o);
}
const degBuf = varints(n, (i) => deg[i]);
const gaps = new Uint32Array(m);
for (let i = 0; i < n; i++) { let prev = 0; for (let k = off[i]; k < off[i + 1]; k++) { gaps[k] = tgt[k] - prev; prev = tgt[k]; } }
const tgtBuf = varints(m, (k) => gaps[k]);
const sign = Int8Array.from(g.neurons, (r) => r[5]);

const header = Buffer.from(new Uint32Array([0x31574246 /* FBW1 */, n, m, degBuf.length, tgtBuf.length]).buffer);
const raw = Buffer.concat([header, degBuf, tgtBuf, Buffer.from(cnt.buffer), Buffer.from(sign.buffer)]);
fs.writeFileSync(OUT, zlib.gzipSync(raw, { level: 9 }));
console.log(`whole brain: ${n.toLocaleString()} neurons, ${m.toLocaleString()} connections`);
console.log(`raw ${(raw.length / 1e6).toFixed(1)} MB → data/fullbrain.bin.gz ${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB`);
