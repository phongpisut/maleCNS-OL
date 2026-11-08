// Loads the full MaleCNS graph (CSR by target) downloaded into tools/raw.
const fs = require('fs'), zlib = require('zlib'), path = require('path');
module.exports = function loadGraph() {
  const raw = path.join(__dirname, 'raw');
  const m = JSON.parse(fs.readFileSync(path.join(raw, 'manifest.json'), 'utf8'));
  const neurons = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(raw, m.metadata))));
  const g = { n: m.neurons, neurons, manifest: m };
  for (const a of m.arrays) {
    const out = new Uint32Array(a.length); let o = 0;
    for (const p of a.parts) {
      const b = zlib.gunzipSync(fs.readFileSync(path.join(raw, p.file)));
      const u = new Uint32Array(b.buffer, b.byteOffset, b.byteLength / 4);
      out.set(u, o); o += u.length;
    }
    g[a.name] = out;
  }
  return g;
};
