// Downloads the MaleCNS v1.0 connectome export (~77 MB) used by tools/extract.js
// from the Xenova/fruit-fly-simulation Space, and verifies every chunk's SHA-256.
//   node tools/fetch-connectome.js
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const BASE = 'https://huggingface.co/spaces/Xenova/fruit-fly-simulation/resolve/main/public/data/';
const RAW = path.join(__dirname, 'raw');
(async () => {
  fs.mkdirSync(RAW, { recursive: true });
  const get = async (f) => { const r = await fetch(BASE + f); if (!r.ok) throw Error(f + ': HTTP ' + r.status); return Buffer.from(await r.arrayBuffer()); };
  const manifest = await get('manifest.json');
  fs.writeFileSync(path.join(RAW, 'manifest.json'), manifest);
  const m = JSON.parse(manifest);
  const files = [{ file: m.metadata }, ...m.arrays.flatMap((a) => a.parts)];
  for (const p of files) {
    const out = path.join(RAW, p.file);
    if (!fs.existsSync(out)) { process.stdout.write(`downloading ${p.file}… `); fs.writeFileSync(out, await get(p.file)); console.log('ok'); }
    if (p.sha256 && crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex') !== p.sha256) throw Error('checksum mismatch: ' + p.file);
  }
  console.log('All connectome files present and verified.');
})().catch((e) => { console.error(e.message); process.exit(1); });
