// Builds Fruity OL for any static web host (GitHub Pages, Netlify, Cloudflare
// Pages, itch.io, S3…).
//
//   node tools/build-static.js              → writes data/brain-manifest.json and dist/
//   node tools/build-static.js --manifest   → only refreshes data/brain-manifest.json
//
// The manifest lists every brain-model file with its exact size and SHA-256,
// so the page can tell players how much it will download, verify the files,
// and cache them in the browser (downloaded once, then loaded from the device).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist');

// group 'core' = always needed (her learning circuit); 'whole' = optional whole-brain mode
const BRAIN_FILES = [
  ['data/flybrain.wasm', 'Spiking-neuron engine (WebAssembly)', 'core'],
  ['data/circuit.bin.gz', 'Learning circuit: 4,804 neurons, 1.05 M synapses', 'core'],
  ['data/circuit.json', 'Neuron roles, glomeruli & readouts', 'core'],
  ['data/brainmap.bin.gz', 'Brain map: 166,700 neuron positions', 'core'],
  ['data/brainmap.json', 'Cell-type names for the brain map', 'core'],
  ['data/fullbrain.bin.gz', 'Whole connectome: 166,700 neurons, 25.6 M synapses', 'whole'],
];

function writeManifest() {
  const files = BRAIN_FILES.map(([p, label, group]) => {
    const buf = fs.readFileSync(path.join(ROOT, p));
    return { path: p, label, group, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
  });
  const total = files.reduce((s, f) => s + f.bytes, 0);
  const sizeOf = (g) => files.filter((f) => f.group === g).reduce((s, f) => s + f.bytes, 0);
  const version = crypto.createHash('sha256').update(files.map((f) => f.sha256).join('')).digest('hex').slice(0, 12);
  const manifest = { name: 'Fruity OL brain model', version, total, groups: { core: sizeOf('core'), whole: sizeOf('whole') }, files };
  fs.writeFileSync(path.join(ROOT, 'data', 'brain-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`brain-manifest.json: ${files.length} files · circuit ${(sizeOf('core') / 1e6).toFixed(2)} MB · whole brain +${(sizeOf('whole') / 1e6).toFixed(2)} MB · version ${version}`);
  return manifest;
}

function copy(rel) {
  const src = path.join(ROOT, rel), dst = path.join(OUT, rel);
  const st = fs.statSync(src);
  if (st.isDirectory()) { for (const f of fs.readdirSync(src)) copy(path.join(rel, f)); return; }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

const manifest = writeManifest();
if (!process.argv.includes('--manifest')) {
  fs.rmSync(OUT, { recursive: true, force: true });
  for (const rel of ['index.html', 'css', 'js', 'README.md', 'data/ATTRIBUTION.md', 'data/brain-manifest.json', ...manifest.files.map((f) => f.path)]) copy(rel);
  fs.writeFileSync(path.join(OUT, '.nojekyll'), ''); // GitHub Pages: serve files as-is
  let n = 0, bytes = 0;
  (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f), s = fs.statSync(p); if (s.isDirectory()) walk(p); else { n++; bytes += s.size; } } })(OUT);
  console.log(`dist/: ${n} files, ${(bytes / 1e6).toFixed(2)} MB. Upload this folder to any static host.`);
}
